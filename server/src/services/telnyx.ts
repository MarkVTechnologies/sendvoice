// PRD §8.1/§10.1: real OTP delivery via Telnyx (Open Decision #1 — decided
// for cost, see DEVELOPMENT_PLAN.md), and PRD §10's Rail B integration —
// Embedded Signup (via Telnyx's Hosted Signup), per-merchant WhatsApp
// sends, and template submission.
//
// Every one of these env vars needs the user's own Telnyx account (and, for
// Embedded Signup, a Meta Tech Provider App). Nothing here can be exercised
// for real without them. Until they're set, the relevant isXConfigured()
// stays false and callers keep their existing honest fallback/disabled
// state — same pattern as Paystack (services/paystack.ts).
const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const TELNYX_WHATSAPP_FROM = process.env.TELNYX_WHATSAPP_FROM
const TELNYX_SMS_FROM = process.env.TELNYX_SMS_FROM
const TELNYX_OTP_TEMPLATE_NAME = process.env.TELNYX_OTP_TEMPLATE_NAME
const TELNYX_OTP_TEMPLATE_LANG = process.env.TELNYX_OTP_TEMPLATE_LANG ?? 'en_US'
// PRD §10.1: the Meta App ID registered as a Tech Provider and linked to
// Telnyx — required by Hosted Signup (services/waba.ts), separate from the
// API key since OTP sending alone never needs it.
const TELNYX_APP_ID = process.env.TELNYX_APP_ID

export function isTelnyxConfigured(): boolean {
  return Boolean(TELNYX_API_KEY && TELNYX_WHATSAPP_FROM && TELNYX_OTP_TEMPLATE_NAME)
}

export function isEmbeddedSignupConfigured(): boolean {
  return Boolean(TELNYX_API_KEY && TELNYX_APP_ID)
}

async function telnyxRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telnyx.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Telnyx ${method} ${path} failed: ${res.status} ${text}`)
  }
  return text ? (JSON.parse(text) as T) : (undefined as T)
}

type TemplateBodyParam = string

type DocumentHeader = { url: string; filename: string }

/**
 * WhatsApp template send, generalized: OTP (sendOtp below) and Rail B
 * invoice/reminder sends (services/railB.ts) both go through this one wire
 * call — the only differences are which number sends it, which approved
 * template it names, and whether it carries a document header. `from` is
 * deliberately a parameter here (not the module-level TELNYX_WHATSAPP_FROM
 * constant) — OTP always sends from our own platform number, but a Rail B
 * send must go from the *merchant's own* registered number (their
 * WabaConnection.phoneNumberId) so the invoice arrives from their business,
 * not "Sendvoice" (PRD §10.1: a shared-number model "destroys the
 * merchant's brand presence").
 */
export async function sendWhatsAppTemplateMessage(input: {
  from: string
  to: string
  templateName: string
  templateLang: string
  bodyParams?: TemplateBodyParam[]
  documentHeader?: DocumentHeader
}): Promise<void> {
  const components: unknown[] = []
  if (input.documentHeader) {
    components.push({
      type: 'header',
      parameters: [{ type: 'document', document: { link: input.documentHeader.url, filename: input.documentHeader.filename } }],
    })
  }
  if (input.bodyParams?.length) {
    components.push({ type: 'body', parameters: input.bodyParams.map((text) => ({ type: 'text', text })) })
  }

  await telnyxRequest('POST', '/v2/messages/whatsapp', {
    from: input.from,
    to: input.to,
    whatsapp_message: {
      type: 'template',
      template: {
        name: input.templateName,
        language: { policy: 'deterministic', code: input.templateLang },
        components,
      },
    },
  })
}

/**
 * WhatsApp OTP as a pre-approved utility template — a plain text message
 * can't initiate a conversation outside the 24h window a customer opens by
 * messaging first, and a signup OTP is by definition the very first
 * contact. `code` is the template's one body parameter; the template text
 * itself (approved by Meta, referenced only by name here) supplies the
 * wording around it.
 */
export async function sendWhatsAppOtp(phone: string, code: string): Promise<void> {
  await sendWhatsAppTemplateMessage({
    from: TELNYX_WHATSAPP_FROM!,
    to: phone,
    templateName: TELNYX_OTP_TEMPLATE_NAME!,
    templateLang: TELNYX_OTP_TEMPLATE_LANG,
    bodyParams: [code],
  })
}

export async function sendSmsOtp(phone: string, code: string): Promise<void> {
  await telnyxRequest('POST', '/v2/messages', {
    from: TELNYX_SMS_FROM,
    to: phone,
    text: `Your Sendvoice verification code is ${code}.`,
  })
}

/**
 * WhatsApp first, SMS only if that send itself fails (network error, bad
 * number, template rejected) and an SMS-capable number is configured —
 * re-throws the original WhatsApp error if there's nothing to fall back to,
 * since that's more actionable than a silent swallow.
 */
export async function sendOtp(phone: string, code: string): Promise<void> {
  try {
    await sendWhatsAppOtp(phone, code)
  } catch (whatsappError) {
    if (!TELNYX_SMS_FROM) throw whatsappError
    await sendSmsOtp(phone, code)
  }
}

export type HostedSignup = { id: string; url: string; expiresAt: string }

/**
 * PRD §10.1: Embedded Signup under the Meta Tech Provider program, so each
 * merchant gets their own WABA inside their own Meta Business Portfolio.
 * Telnyx's "Hosted Signup" is the simpler of their two documented paths —
 * a URL we hand the merchant, with Telnyx (not us) handling Meta's actual
 * signup flow and WABA/number registration — versus embedding Meta's own
 * JS SDK and exchanging an auth code ourselves. Chosen for the same reason
 * the BSP itself was: it removes months of undifferentiated onboarding
 * work (DEVELOPMENT_PLAN.md Open Decision #1's own reasoning, applied a
 * second time here).
 *
 * No field exists in this request to pass our own tenantId through — see
 * WabaConnection.signupSessionId's comment for how correlation is done
 * instead (we poll only the id we ourselves stored for that tenant).
 */
export async function createHostedSignup(): Promise<HostedSignup> {
  const res = await telnyxRequest<{ data: { id: string; url: string; expires_at: string } }>(
    'POST',
    '/v2/whatsapp/hosted_signups',
    { app_id: TELNYX_APP_ID },
  )
  return { id: res.data.id, url: res.data.url, expiresAt: res.data.expires_at }
}

export type HostedSignupStatus = { status: string; wabaId: string | null; phoneNumberId: string | null }

/**
 * Polled from services/waba.ts, not pushed to us — Telnyx's docs describe
 * this status endpoint but don't document a completion webhook, so polling
 * is the one mechanism here confirmed to exist at all.
 */
export async function getHostedSignupStatus(sessionId: string): Promise<HostedSignupStatus> {
  const res = await telnyxRequest<{ data: { status: string; waba_id?: string; phone_number_id?: string } }>(
    'GET',
    `/v2/whatsapp/signup/${encodeURIComponent(sessionId)}/status`,
  )
  return {
    status: res.data.status,
    wabaId: res.data.waba_id ?? null,
    phoneNumberId: res.data.phone_number_id ?? null,
  }
}

export type CreateTemplateInput = {
  wabaId: string
  name: string
  language: string
  bodyText: string
  documentHeaderExampleUrl?: string
  buttonUrl?: { text: string; url: string } // {{1}} in the URL is filled per-send by Meta/Telnyx from the button's own example
}

export type CreatedTemplate = { id: string; status: string }

/**
 * PRD §10.2 P0: "a per-merchant template management surface" needs
 * something to manage — this is what actually submits a template to Meta
 * (via Telnyx) for review. Every template here is UTILITY category and
 * transactional-only copy, never MARKETING (PRD §10.2: "the most
 * cost-sensitive decision in the product" — a misclassified template can
 * cost several times the utility rate, and marketing carries no volume
 * discount at any scale).
 *
 * The DOCUMENT header's `example.header_handle` is Meta's required review
 * sample, not the real per-send attachment — the actual invoice PDF is
 * supplied separately, per-send, as the message's own header parameter
 * (sendWhatsAppTemplateMessage's `documentHeader`). Needs a real,
 * publicly-fetchable URL at submission time; services/waba.ts points this
 * at a fixed static sample PDF (services/sampleInvoicePdf.ts) rather than
 * a real merchant invoice, since a template is submitted once and must not
 * depend on one existing yet.
 */
export async function createWhatsAppTemplate(input: CreateTemplateInput): Promise<CreatedTemplate> {
  const components: unknown[] = []
  if (input.documentHeaderExampleUrl) {
    components.push({
      type: 'HEADER',
      format: 'DOCUMENT',
      example: { header_handle: [input.documentHeaderExampleUrl] },
    })
  }
  components.push({
    type: 'BODY',
    text: input.bodyText,
  })
  if (input.buttonUrl) {
    components.push({
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: input.buttonUrl.text, url: input.buttonUrl.url, example: ['sample'] }],
    })
  }

  // Confirmed by dry run against Telnyx's live API, not just docs: the
  // unversioned /whatsapp/message_templates path the docs page's summary
  // showed 404s outright, while /v2/whatsapp/message_templates correctly
  // reaches auth (401 on a fake key) — the docs summary had silently
  // dropped the /v2 prefix every other Telnyx endpoint here uses.
  const res = await telnyxRequest<{ data: { id: string; status: string } }>('POST', '/v2/whatsapp/message_templates', {
    waba_id: input.wabaId,
    name: input.name,
    category: 'UTILITY',
    language: input.language,
    components,
  })
  return { id: res.data.id, status: res.data.status }
}

/**
 * Telnyx's docs show the create response's shape but never document a
 * corresponding GET-by-id endpoint — inferred from the same resource-by-id
 * convention every other Telnyx endpoint here uses. Dry-run tested against
 * the live API with a fake key and template id: this path reaches real
 * auth (401 "Authentication failed"), not a 404 — meaning the route itself
 * genuinely exists, even though the success-path response shape (field
 * names for status/rejection reason) is still unconfirmed without a real
 * account and a real template to look up.
 */
export async function getWhatsAppTemplateStatus(
  templateId: string,
): Promise<{ status: string; rejectionReason: string | null }> {
  const res = await telnyxRequest<{ data: { status: string; rejection_reason?: string | null } }>(
    'GET',
    `/v2/whatsapp/message_templates/${encodeURIComponent(templateId)}`,
  )
  return { status: res.data.status, rejectionReason: res.data.rejection_reason ?? null }
}
