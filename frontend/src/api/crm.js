import { fetchJson } from './client';

function normalizeQuickActionSupportContext(supportContext = null) {
  const source = supportContext && typeof supportContext === 'object' ? supportContext : {};
  const ticketId = String(source.ticketId || source.ticket_id || '').trim();
  const queueId = String(source.queueId || source.queue_id || source.queue || source.queueName || '').trim();
  const departmentId = String(source.departmentId || source.department_id || source.department || '').trim();

  const out = {};
  if (ticketId) out.ticketId = ticketId;
  if (queueId) out.queueId = queueId;
  if (departmentId) out.departmentId = departmentId;
  return Object.keys(out).length > 0 ? out : null;
}

function buildQuickActionSupportContextQuery(supportContext = null) {
  const normalized = normalizeQuickActionSupportContext(supportContext);
  if (!normalized) return '';

  const params = new URLSearchParams();
  if (normalized.ticketId) params.set('ticketId', normalized.ticketId);
  if (normalized.queueId) params.set('queueId', normalized.queueId);
  if (normalized.departmentId) params.set('departmentId', normalized.departmentId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

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

export async function getCrmContactTimeline(contactId, { limit = 30, offset = 0 } = {}) {
  const id = String(contactId || '').trim();
  if (!id) return { ok: false, items: [], total: 0, limit: 0, offset: 0 };
  return fetchJson(`/api/crm/contacts/${encodeURIComponent(id)}/timeline?limit=${Math.max(1, Number(limit) || 30)}&offset=${Math.max(0, Number(offset) || 0)}`, {
    method: 'GET',
    silent: true,
  });
}

export async function getCrmContactOperationalProfile(contactId, { timelineLimit = 30 } = {}) {
  const id = String(contactId || '').trim();
  if (!id) return { ok: false, profile: null, timeline: { items: [], total: 0, limit: 0, offset: 0 } };
  return fetchJson(`/api/crm/contacts/${encodeURIComponent(id)}/operational-profile?timelineLimit=${Math.max(1, Number(timelineLimit) || 30)}`, {
    method: 'GET',
    silent: true,
  });
}

export async function getCrmContactOperationalSummary(contactId, { recentWindowHours = 72 } = {}) {
  const id = String(contactId || '').trim();
  if (!id) return { ok: false, summary: null };
  return fetchJson(`/api/crm/contacts/${encodeURIComponent(id)}/operational-summary?recentWindowHours=${Math.max(1, Number(recentWindowHours) || 72)}`, {
    method: 'GET',
    silent: true,
  });
}

export async function getCrmContactOperationalSignals(contactId, { activeOnly = true, limit = 100 } = {}) {
  const id = String(contactId || '').trim();
  if (!id) return { ok: false, items: [] };
  const params = new URLSearchParams();
  if (activeOnly) params.set('activeOnly', 'true');
  params.set('limit', String(Math.max(1, Number(limit) || 100)));
  return fetchJson(`/api/crm/contacts/${encodeURIComponent(id)}/operational-signals?${params.toString()}`, {
    method: 'GET',
    silent: true,
  });
}

export async function getCrmContactOperationalRecommendations(contactId, { limit = 100 } = {}) {
  const id = String(contactId || '').trim();
  if (!id) return { ok: false, items: [] };
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Number(limit) || 100)));
  return fetchJson(`/api/crm/contacts/${encodeURIComponent(id)}/operational-recommendations?${params.toString()}`, {
    method: 'GET',
    silent: true,
  });
}

export async function getCrmContactPlaybooks(contactId, { limit = 12 } = {}) {
  const id = String(contactId || '').trim();
  if (!id) return { ok: false, items: [] };
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Number(limit) || 12)));
  return fetchJson(`/api/crm/contacts/${encodeURIComponent(id)}/playbooks?${params.toString()}`, {
    method: 'GET',
    silent: true,
  });
}

export async function listContactQuickActionsForSignal({ contactId, signalId, supportContext = null }) {
  const contactKey = String(contactId || '').trim();
  const signalKey = String(signalId || '').trim();
  if (!contactKey || !signalKey) return { ok: false, items: [] };
  const supportQuery = buildQuickActionSupportContextQuery(supportContext);
  return fetchJson(
    `/api/crm/contacts/${encodeURIComponent(contactKey)}/operational-signals/${encodeURIComponent(signalKey)}/quick-actions${supportQuery}`,
    {
      method: 'GET',
      silent: true,
    }
  );
}

export async function executeContactQuickActionForSignal({
  contactId,
  signalId,
  actionId,
  input = {},
  supportContext = null,
}) {
  const contactKey = String(contactId || '').trim();
  const signalKey = String(signalId || '').trim();
  const actionKey = String(actionId || '').trim();
  if (!contactKey || !signalKey || !actionKey) return { ok: false, error: 'invalid_params' };
  const normalizedSupportContext = normalizeQuickActionSupportContext(supportContext);
  return fetchJson(
    `/api/crm/contacts/${encodeURIComponent(contactKey)}/operational-signals/${encodeURIComponent(signalKey)}/quick-actions/${encodeURIComponent(actionKey)}`,
    {
      method: 'POST',
      body: JSON.stringify({ input, ...(normalizedSupportContext ? { supportContext: normalizedSupportContext } : {}) }),
      silent: true,
    }
  );
}

export async function listContactQuickActionsForRecommendation({ contactId, recommendationId, supportContext = null }) {
  const contactKey = String(contactId || '').trim();
  const recommendationKey = String(recommendationId || '').trim();
  if (!contactKey || !recommendationKey) return { ok: false, items: [] };
  const supportQuery = buildQuickActionSupportContextQuery(supportContext);
  return fetchJson(
    `/api/crm/contacts/${encodeURIComponent(contactKey)}/operational-recommendations/${encodeURIComponent(recommendationKey)}/quick-actions${supportQuery}`,
    {
      method: 'GET',
      silent: true,
    }
  );
}

export async function executeContactQuickActionForRecommendation({
  contactId,
  recommendationId,
  actionId,
  input = {},
  supportContext = null,
}) {
  const contactKey = String(contactId || '').trim();
  const recommendationKey = String(recommendationId || '').trim();
  const actionKey = String(actionId || '').trim();
  if (!contactKey || !recommendationKey || !actionKey) return { ok: false, error: 'invalid_params' };
  const normalizedSupportContext = normalizeQuickActionSupportContext(supportContext);
  return fetchJson(
    `/api/crm/contacts/${encodeURIComponent(contactKey)}/operational-recommendations/${encodeURIComponent(recommendationKey)}/quick-actions/${encodeURIComponent(actionKey)}`,
    {
      method: 'POST',
      body: JSON.stringify({ input, ...(normalizedSupportContext ? { supportContext: normalizedSupportContext } : {}) }),
      silent: true,
    }
  );
}
