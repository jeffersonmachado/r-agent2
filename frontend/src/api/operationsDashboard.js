import { fetchJson } from './client';

function toQuery(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    qs.set(key, String(value));
  });
  const query = qs.toString();
  return query ? `?${query}` : '';
}

export function getOperationsSummary(params = {}) {
  return fetchJson(`/api/operations-dashboard/summary${toQuery(params)}`);
}

export function getOperationsTimeline(params = {}) {
  return fetchJson(`/api/operations-dashboard/timeline${toQuery(params)}`);
}

export function getOperationsJobs(params = {}) {
  return fetchJson(`/api/operations-dashboard/jobs${toQuery(params)}`);
}

export function getOperationsNotifications(params = {}) {
  return fetchJson(`/api/operations-dashboard/notifications${toQuery(params)}`);
}

export function getOperationsInsights(params = {}) {
  return fetchJson(`/api/operations-dashboard/insights${toQuery(params)}`);
}

export function getOperationsFinance(params = {}) {
  return fetchJson(`/api/operations-dashboard/finance${toQuery(params)}`);
}

export function reconcileBilling(payload = {}) {
  return fetchJson('/billing/reconcile', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function getBillingHealth(params = {}) {
  return fetchJson(`/api/ops/billing/health${toQuery(params)}`);
}

export function getBillingAlerts(params = {}) {
  return fetchJson(`/api/ops/billing/alerts${toQuery(params)}`);
}
