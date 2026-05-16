export function resolveTicketPhone(ticket) {
  return (
    ticket?.phoneNumber
    || ticket?.phone_number
    || ticket?.phone
    || ticket?.contactPhone
    || ticket?.contact_phone
    || ticket?.contact?.phone
    || ticket?.contact?.waId
    || ticket?.contact?.wa_id
    || ticket?.contact?.whatsapp
    || ticket?.contact?.whatsappNumber
    || ticket?.context?.metadata?.phoneNumber
    || ticket?.context?.metadata?.phone_number
    || ticket?.context?.metadata?.phone
    || ticket?.context?.metadata?.waId
    || ticket?.context?.metadata?.wa_id
    || ticket?.context?.variables?.phoneNumber
    || ticket?.context?.variables?.phone_number
    || ticket?.context?.variables?.phone
    || ticket?.context?.variables?.waId
    || ticket?.context?.variables?.wa_id
    || ticket?.from
    || ticket?.remoteJid
    || null
  );
}

export function normalizeContactName(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (text === 'Contato sem nome') return null;
  if (/^Contato\s+•{4}\d{4}$/u.test(text)) return null;
  if (/^Contato\s+\d{8,}$/u.test(text)) return null;

  return text;
}

export function resolveContactName(ticket) {
  const composedName = [
    ticket?.firstName || ticket?.first_name,
    ticket?.lastName || ticket?.last_name,
  ].filter(Boolean).join(' ').trim();

  const contactField = typeof ticket?.contact === 'object'
    ? (
      ticket?.contact?.name
      || ticket?.contact?.displayName
      || ticket?.contact?.profileName
      || ticket?.contact?.pushName
      || ticket?.contact?.fullName
      || ticket?.contact?.nome
    )
    : ticket?.contact;

  return normalizeContactName(
    ticket?.contactName
    || ticket?.contact_name
    || ticket?.displayName
    || ticket?.display_name
    || ticket?.profileName
    || ticket?.profile_name
    || ticket?.pushName
    || ticket?.push_name
    || ticket?.fullName
    || ticket?.full_name
    || ticket?.name
    || ticket?.nome
    || ticket?.customerName
    || ticket?.customer_name
    || contactField
    || composedName
    || ticket?.context?.contactName
    || ticket?.context?.contact_name
    || ticket?.context?.displayName
    || ticket?.context?.display_name
    || ticket?.context?.profileName
    || ticket?.context?.profile_name
    || ticket?.context?.pushName
    || ticket?.context?.push_name
    || ticket?.context?.metadata?.contactName
    || ticket?.context?.metadata?.contact_name
    || ticket?.context?.metadata?.customerName
    || ticket?.context?.metadata?.customer_name
    || ticket?.context?.metadata?.name
    || ticket?.context?.metadata?.displayName
    || ticket?.context?.metadata?.display_name
    || ticket?.context?.metadata?.profileName
    || ticket?.context?.metadata?.profile_name
    || ticket?.context?.metadata?.pushName
    || ticket?.context?.metadata?.push_name
    || ticket?.context?.metadata?.fullName
    || ticket?.context?.metadata?.full_name
    || ticket?.context?.metadata?.nome
    || ticket?.context?.contact?.name
    || ticket?.context?.contact?.displayName
    || ticket?.context?.contact?.profileName
    || ticket?.context?.contact?.pushName
    || ticket?.context?.variables?.customerName
    || ticket?.context?.variables?.customer_name
    || ticket?.context?.variables?.name
    || ticket?.context?.variables?.displayName
    || ticket?.context?.variables?.display_name
    || ticket?.context?.variables?.profileName
    || ticket?.context?.variables?.profile_name
    || ticket?.context?.variables?.pushName
    || ticket?.context?.variables?.push_name
    || ticket?.context?.variables?.fullName
    || ticket?.context?.variables?.full_name
    || ticket?.context?.variables?.nome
  ) || null;
}
