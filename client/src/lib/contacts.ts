// PRD §8.2 P0: "Device Contact Picker API integration where supported, with
// graceful manual fallback." Chromium-on-Android is the only real support
// today — every other browser (all of desktop, iOS Safari) simply lacks
// `navigator.contacts`, which is exactly the manual-fallback case: the
// composer's plain name/WhatsApp text inputs already are that fallback, so
// this only ever adds a button, never replaces the inputs.
type ContactsManager = {
  select: (
    properties: Array<'name' | 'tel'>,
    options?: { multiple?: boolean },
  ) => Promise<Array<{ name?: string[]; tel?: string[] }>>
}

export function contactPickerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window
}

export async function pickContact(): Promise<{ name?: string; tel?: string } | null> {
  if (!contactPickerSupported()) return null
  const contactsApi = (navigator as unknown as { contacts: ContactsManager }).contacts
  try {
    const [contact] = await contactsApi.select(['name', 'tel'], { multiple: false })
    if (!contact) return null
    return { name: contact.name?.[0], tel: contact.tel?.[0] }
  } catch {
    // Permission denied or the user dismissed the picker — same outcome as
    // "nothing selected", not an error worth surfacing.
    return null
  }
}
