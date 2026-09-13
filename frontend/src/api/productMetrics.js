import { fetchJson } from './client';

/**
 * API de Product Metrics (P4.13).
 * Contrato: GET /api/product-metrics/summary?windowDays=30 →
 *   { ok, windowDays, timeToFirstValue, timeToFirstResponse, navigation, clicksPerCoreSurface }
 *
 * O prefixo `/api` é obrigatório: sem ele o dev server (e o Apache em produção)
 * servem o index.html do SPA e o cliente acusa "API retornou HTML ao invés de
 * JSON". Defeito real observado na Page Surface Wave em /analytics (2026-09-13).
 */

export function getProductMetricsSummary(options = {}) {
  const params = new URLSearchParams();
  if (options.windowDays != null) {
    params.append('windowDays', String(options.windowDays));
  }
  const query = params.toString();
  return fetchJson(`/api/product-metrics/summary${query ? `?${query}` : ''}`, { method: 'GET' });
}
