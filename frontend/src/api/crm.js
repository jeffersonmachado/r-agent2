import { fetchJson } from './client';

function normalizeCrmContactResponse(response) {
  if (Array.isArray(response?.contacts)) return response.contacts;
  if (Array.isArray(response?.items)) return response.items;
  return [];
}

function filterCrmContacts(contacts, query, limit) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  const qDigits = raw.replace(/\D/g, '');

  const scored = contacts
    .map((contact) => {
      const name = String(contact?.name || '').toLowerCase();
      const email = String(contact?.email || '').toLowerCase();
      const phone = String(contact?.phone || '');
      const phoneDigits = phone.replace(/\D/g, '');
      const startsWith = name.startsWith(q) || email.startsWith(q) || (qDigits && phoneDigits.startsWith(qDigits));
      const includes = name.includes(q) || email.includes(q) || (qDigits && phoneDigits.includes(qDigits));
      if (!startsWith && !includes) return null;
      return { score: startsWith ? 0 : 1, contact };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map((item) => item.contact);
}

export async function searchCrmContacts(query, { limit = 10 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { contacts: [] };

  const digits = q.replace(/\D/g, '');
  if (digits.length >= 8) {
    const byPhone = await fetchJson(`/api/crm/contacts?phone=${encodeURIComponent(digits)}&limit=${Math.max(limit, 1)}&offset=0`, {
      method: 'GET',
      silent: true,
    });
    const phoneMatches = normalizeCrmContactResponse(byPhone);
    if (phoneMatches.length > 0) {
      return { contacts: phoneMatches.slice(0, limit) };
    }
  }

  const response = await fetchJson('/api/crm/contacts?limit=1000&offset=0', {
    method: 'GET',
    silent: true,
  });
  const allContacts = normalizeCrmContactResponse(response);
  return { contacts: filterCrmContacts(allContacts, q, limit) };
}
