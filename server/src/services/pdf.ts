import puppeteer from 'puppeteer-core'
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

  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true })
  let pdfData: Uint8Array
  try {
    const page = await browser.newPage()
    // 'load' is enough — the HTML is fully self-contained, no external
    // requests to wait out (system fonts, no network fetches).
    await page.setContent(html, { waitUntil: 'load' })
    pdfData = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    })
  } finally {
    await browser.close()
  }

  await withTenant(tenantId, (tx) =>
    tx.document.update({
      where: { id: documentId },
      data: { pdfData: new Uint8Array(pdfData), pdfUrl: `/api/invoices/${documentId}/pdf` },
    }),
  )
}
