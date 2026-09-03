// PRD §8.1/§10.1: real OTP delivery via Telnyx (Open Decision #1 — decided
// for cost, see DEVELOPMENT_PLAN.md). WhatsApp utility template first,
// falling back to plain SMS only if the WhatsApp send itself fails
// synchronously — a fallback driven by actual delivery-status webhooks
// (message sent to WhatsApp but never delivered) needs the Delivery-row
// webhook plumbing that's explicitly Phase 2 scope (see routes/webhooks.ts);
// this covers the case that's buildable without it.
//
// Every one of these env vars needs the user's own Telnyx account + a Meta
// WhatsApp Business Account with an approved OTP template — nothing here
// can be exercised for real without that. Until they're all set,
// isTelnyxConfigured() is false and routes/auth.ts keeps using the existing
// dev-mode log-instead-of-send path unchanged.
const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const TELNYX_WHATSAPP_FROM = process.env.TELNYX_WHATSAPP_FROM
const TELNYX_SMS_FROM = process.env.TELNYX_SMS_FROM
const TELNYX_OTP_TEMPLATE_NAME = process.env.TELNYX_OTP_TEMPLATE_NAME
const TELNYX_OTP_TEMPLATE_LANG = process.env.TELNYX_OTP_TEMPLATE_LANG ?? 'en_US'

export function isTelnyxConfigured(): boolean {
  return Boolean(TELNYX_API_KEY && TELNYX_WHATSAPP_FROM && TELNYX_OTP_TEMPLATE_NAME)
}

async function telnyxPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(`https://api.telnyx.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Telnyx ${path} failed: ${res.status} ${detail}`)
  }
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
  await telnyxPost('/v2/messages/whatsapp', {
    from: TELNYX_WHATSAPP_FROM,
    to: phone,
    whatsapp_message: {
      type: 'template',
      template: {
        name: TELNYX_OTP_TEMPLATE_NAME,
        language: { policy: 'deterministic', code: TELNYX_OTP_TEMPLATE_LANG },
        components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
      },
    },
  })
}

export async function sendSmsOtp(phone: string, code: string): Promise<void> {
  await telnyxPost('/v2/messages', {
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
