import puppeteer, { type Browser } from 'puppeteer-core'
import { withTenant } from '../lib/prisma.js'
import { renderInvoiceHtml } from './pdf/template.js'

/**
 * PRD §9.2 P0: server-side headless render, never client-side (device-
 * dependent output is a support and audit problem).
 *
 * Dev/local shortcut, not a production choice: this points at a Chrome
 * already installed on the machine (via CHROME_PATH, or the common Windows
 * install path as a fallback) instead of bundling a downloaded Chromium —
 * disk on this dev machine can't reliably fit one. A real deployment needs
 * a headless Chromium the runtime actually ships (e.g. @sparticuz/chromium
 * on serverless, or a container image with Chrome installed) — tracked as
 * remaining work, not something to paper over with this shortcut.
 */
const CHROME_PATH =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

/**
 * One Chrome process, reused across every render, instead of launching a
 * fresh one per request — that cold launch was ~9-10s of a ~10s total
 * approve latency (measured directly: see DEVELOPMENT_PLAN.md's TTFI entry).
 * Still a single-instance shortcut, not a production pool — concurrent
 * renders serialize behind whichever request launches the browser first,
 * but every render after the first pays only page-open + render time, not
 * a full Chrome boot. A real deployment wants a small pool with queueing;
 * tracked as remaining work, same as the launch-target itself (see below).
 */
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const browser = await browserPromise
    if (browser.connected) return browser
    // Crashed or was closed externally since we last handed it out — fall
    // through and relaunch rather than handing back a dead browser.
  }
  browserPromise = puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  return browserPromise
}

// tsx watch (and any real process manager) sends SIGTERM/SIGINT on restart
// or shutdown — without this, every dev-server reload leaked another
// chrome.exe that nothing ever closes.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void browserPromise
      ?.then((browser) => browser.close())
      .finally(() => process.exit(0))
  })
}

/**
 * Deliberately two short DB transactions around the (slow, seconds-long)
 * browser render rather than one transaction spanning it — holding a
 * Postgres transaction open for however long Chrome takes to boot and
 * render is its own hazard, independent of the RLS/tenant-scoping this
 * still needs on both sides of the render.
 */
export async function renderAndStorePdf(tenantId: string, documentId: string): Promise<void> {
  const doc = await withTenant(tenantId, (tx) =>
    tx.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { lines: true, customer: true, tenant: true },
    }),
  )

  const html = renderInvoiceHtml(doc)

  const browser = await getBrowser()
  const page = await browser.newPage()
  let pdfData: Uint8Array
  try {
    // 'load' is enough — the HTML is fully self-contained, no external
    // requests to wait out (system fonts, no network fetches).
    await page.setContent(html, { waitUntil: 'load' })
    pdfData = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    })
  } finally {
    await page.close()
  }

  await withTenant(tenantId, (tx) =>
    tx.document.update({
      where: { id: documentId },
      data: { pdfData: new Uint8Array(pdfData), pdfUrl: `/api/invoices/${documentId}/pdf` },
    }),
  )
}
