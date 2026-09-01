/**
 * Rail A (PRD §10.1/§6.1 J1): a wa.me deep link opens the merchant's own
 * WhatsApp with the message pre-filled — merchant taps send. Zero setup,
 * works for every merchant on day one, no Meta relationship required.
 */
export function buildWhatsAppSendLink(whatsapp: string, invoiceNumber: string, hostedUrl: string): string {
  const digits = whatsapp.replace(/[^\d]/g, '')
  const message = `Hi! Here's your invoice ${invoiceNumber}: ${hostedUrl}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}
