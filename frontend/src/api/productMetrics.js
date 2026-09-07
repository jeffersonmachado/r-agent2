import { fetchJson } from './client';

/**
 * API de Product Metrics (P4.13).
 * Contrato: GET /product-metrics/summary?windowDays=30 →
 *   { ok, windowDays, timeToFirstValue, timeToFirstResponse, navigation, clicksPerCoreSurface }
 */

export function getProductMetricsSummary(options = {}) {
  const params = new URLSearchParams();
  if (options.windowDays != null) {
    params.append('windowDays', String(options.windowDays));
  }
  const query = params.toString();
  return fetchJson(`/product-metrics/summary${query ? `?${query}` : ''}`, { method: 'GET' });
}
