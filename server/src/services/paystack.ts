import { createHmac, timingSafeEqual } from 'node:crypto'

// PRD §8.7 P0: "Payment provider connection with regional routing:
// Paystack/Flutterwave (Africa)." Nigeria is the launch-market
// recommendation (PRD §11.6); Ghana/South Africa/Kenya are included here
// because Paystack itself supports collection in all four currencies
// today, not because any of them are a decided launch market yet.
//
// Needs the user's own Paystack account (PAYSTACK_SECRET_KEY) — nothing
// here can be exercised for real without it. Until it's set,
// isPaystackConfigured() is false and the hosted page keeps showing the
// existing honest disabled "Pay Now" state (services/hostedInvoicePage.ts).
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY
const PAYSTACK_CURRENCIES = new Set(['NGN', 'GHS', 'ZAR', 'KES'])

export function isPaystackConfigured(): boolean {
  return Boolean(PAYSTACK_SECRET_KEY)
}

export function paystackSupportsCurrency(currency: string): boolean {
  return PAYSTACK_CURRENCIES.has(currency)
}

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const body = (await res.json()) as { status: boolean; message: string; data: T }
  if (!res.ok || !body.status) {
    throw new Error(`Paystack ${path} failed: ${res.status} ${body.message}`)
  }
  return body.data
}

type InitializeInput = {
  email: string
  amountMinorUnits: number
  currency: string
  reference: string
  callbackUrl: string
  metadata: Record<string, unknown>
}

type InitializeResult = {
  authorizationUrl: string
  reference: string
}

/**
 * PRD §8.7 P0 / §12 P0 (PCI scope minimisation): the customer enters card
 * details on Paystack's own hosted page, never ours — this call only ever
 * gets back a URL to redirect to.
 *
 * Money currently settles to the platform's own Paystack account, not a
 * per-merchant one. Real per-merchant payout — a Paystack Subaccount funded
 * from the bank details already collected at onboarding (PRD §8.1), split
 * automatically per PRD §11.2's 0.4% take rate — is real, unbuilt follow-up
 * work (tracked in DEVELOPMENT_PLAN.md), not something this scaffold
 * pretends to have solved. Getting a customer paying end-to-end comes
 * first: nothing else in Phase 1 (including the take rate itself) has
 * anything to operate on until money actually moves.
 */
export async function initializeTransaction(input: InitializeInput): Promise<InitializeResult> {
  const data = await paystackFetch<{ authorization_url: string; reference: string }>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      amount: input.amountMinorUnits,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  })
  return { authorizationUrl: data.authorization_url, reference: data.reference }
}

export type VerifiedTransaction = {
  status: string // 'success' | 'failed' | 'abandoned' | ...
  reference: string
  amountMinorUnits: number
  currency: string
  metadata: Record<string, unknown> | null
}

/**
 * Standard PSP practice, and PRD §9.5's own idempotency discipline applied
 * to money: never trust a webhook body's amount/status directly — re-verify
 * server-to-server against Paystack's own record of the transaction before
 * ever recording a payment (services/payments.ts calls this from both the
 * webhook handler and the hosted page's post-payment redirect).
 */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const data = await paystackFetch<{
    status: string
    reference: string
    amount: number
    currency: string
    metadata: Record<string, unknown> | null
  }>(`/transaction/verify/${encodeURIComponent(reference)}`)
  return {
    status: data.status,
    reference: data.reference,
    amountMinorUnits: data.amount,
    currency: data.currency,
    metadata: data.metadata,
  }
}

/**
 * PRD §12 P0 — the signature-verification TODO explicitly left in
 * routes/webhooks.ts. Paystack signs the raw request body with our own
 * secret key (HMAC-SHA512); this is what proves an incoming webhook
 * actually came from Paystack and not an attacker POSTing a fake
 * charge.success to mark an unpaid invoice as paid. Constant-time compare
 * (timingSafeEqual) rather than `===`, same reasoning as any credential
 * check — a length mismatch is handled explicitly since timingSafeEqual
 * throws on mismatched buffer lengths rather than returning false.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature || !PAYSTACK_SECRET_KEY) return false
  const expected = createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const signatureBuf = Buffer.from(signature, 'utf8')
  return expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf)
}
