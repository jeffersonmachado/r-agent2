/** @typedef {{url?: string, success?: boolean, isDuplicate?: boolean, extractedText?: string, error?: Record<string, unknown>|string}} ScrapingResultItem */

/** @typedef {{url?: string, name: string, message: string}} ScrapingErrorSummaryItem */

/** @typedef {{results: ScrapingResultItem[], successCount: number, failedCount: number, duplicateCount: number, newCount: number, errorSummary: ScrapingErrorSummaryItem[]}} ScrapingSummary */

/** @typedef {{response: Record<string, unknown>, durationMs: number, results: ScrapingResultItem[], successCount: number, failedCount: number, duplicateCount: number, newCount: number, errorSummary: ScrapingErrorSummaryItem[]}} WebScrapingBatchResult */

/**
 * @param {string[]} urls
 * @returns {string[]}
 */
export function getValidHttpUrls(urls) {
  return (Array.isArray(urls) ? urls : []).filter((url) => {
    return url && String(url).trim().startsWith('http');
  });
}

/**
 * @param {{results?: ScrapingResultItem[], success?: number, failed?: number, duplicates?: number, new?: number, errorSummary?: ScrapingErrorSummaryItem[]}} scrapingResponse
 * @param {number} urlsTotal
 * @returns {ScrapingSummary}
 */
export function summarizeScrapingResponse(scrapingResponse, urlsTotal) {
  const results = Array.isArray(scrapingResponse?.results) ? scrapingResponse.results : [];
  const successCount = Number.isFinite(scrapingResponse?.success)
    ? Number(scrapingResponse.success)
    : results.filter((result) => result && result.success).length;
  const failedCount = Number.isFinite(scrapingResponse?.failed)
    ? Number(scrapingResponse.failed)
    : (urlsTotal - successCount);
  const duplicateCount = Number.isFinite(scrapingResponse?.duplicates)
    ? Number(scrapingResponse.duplicates)
    : results.filter((result) => result && result.success && result.isDuplicate).length;
  const newCount = Number.isFinite(scrapingResponse?.new)
    ? Number(scrapingResponse.new)
    : (successCount - duplicateCount);

  const errorSummary = Array.isArray(scrapingResponse?.errorSummary)
    ? scrapingResponse.errorSummary
    : results
        .filter((result) => !result?.success)
        .map((result) => ({
          url: result?.url,
          name: result?.error?.name || 'Error',
          message: result?.error?.message || (typeof result?.error === 'string' ? result.error : 'Erro desconhecido'),
        }));

  return {
    results,
    successCount,
    failedCount,
    duplicateCount,
    newCount,
    errorSummary,
  };
}

/**
 * @param {{targetChunks: Array<{sourceType: string, sourceId: string, text: string}>, results: ScrapingResultItem[], minLength?: number}} params
 * @returns {void}
 */
export function appendScrapedTextChunks({ targetChunks, results, minLength = 20 }) {
  if (!Array.isArray(targetChunks) || !Array.isArray(results)) return;

  for (const result of results) {
    const url = result?.url;
    const text = (result?.extractedText || '').trim();
    if (url && text && text.length >= minLength) {
      targetChunks.push({ sourceType: 'web_scraping', sourceId: url, text });
    }
  }
}

/**
 * @param {{fetchJson: (path: string, options: Object) => Promise<Object>, urls: string[], headers?: Record<string, string>, payload?: Object, timeoutMs?: number, silent?: boolean}} params
 * @param {(path: string, options: Object) => Promise<Object>} params.fetchJson
 * @param {string[]} params.urls
 * @param {Record<string, string>} [params.headers]
 * @param {Record<string, unknown>} [params.payload]
 * @param {number} [params.timeoutMs=60000]
 * @param {boolean} [params.silent]
 * @returns {Promise<WebScrapingBatchResult>}
 */
export async function executeWebScrapingBatch({
  fetchJson,
  urls,
  headers,
  payload = {},
  timeoutMs = 60000,
  silent,
}) {
  const startedAt = Date.now();
  const response = await fetchJson('/web-scraping/scrape-batch', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      urls,
      ...payload,
    }),
    timeoutMs,
    ...(silent ? { silent: true } : {}),
  });
  const durationMs = Date.now() - startedAt;
  const summary = summarizeScrapingResponse(response, Array.isArray(urls) ? urls.length : 0);
  return {
    response,
    durationMs,
    ...summary,
  };
}

/**
 * @param {{fetchJson: (path: string, options: Object) => Promise<Object>, validatedTenantId: string|null, validUrlsForScraping: string[], executionId: string|null, shouldPersistScraping: boolean, timeoutMs?: number}} params
 * @param {(path: string, options: Object) => Promise<Object>} params.fetchJson
 * @param {string|null} params.validatedTenantId
 * @param {string[]} params.validUrlsForScraping
 * @param {string|null} params.executionId
 * @param {boolean} params.shouldPersistScraping
 * @param {number} [params.timeoutMs=60000]
 * @returns {Promise<WebScrapingBatchResult>}
 */
export async function executeTenantPostDescriptionScraping({
  fetchJson,
  validatedTenantId,
  validUrlsForScraping,
  executionId,
  shouldPersistScraping,
  timeoutMs = 60000,
}) {
  return executeWebScrapingBatch({
    fetchJson,
    urls: validUrlsForScraping,
    headers: validatedTenantId ? { 'X-Tenant-Id': validatedTenantId } : undefined,
    payload: {
      autoIndex: shouldPersistScraping,
      source: 'web_scraping',
      category: 'general',
      executionId,
      dryRun: !shouldPersistScraping,
    },
    timeoutMs,
  });
}

/**
 * @param {{fetchJson: (path: string, options: Object) => Promise<Object>, validUrlsToPersist: string[], contextTenantId: string, executionId: string|null, tenantTargetId: string, timeoutMs?: number}} params
 * @param {(path: string, options: Object) => Promise<Object>} params.fetchJson
 * @param {string[]} params.validUrlsToPersist
 * @param {string} params.contextTenantId
 * @param {string|null} params.executionId
 * @param {string} params.tenantTargetId
 * @param {number} [params.timeoutMs=60000]
 * @returns {Promise<void>}
 */
export async function persistWebScrapingOnTargetTenant({
  fetchJson,
  validUrlsToPersist,
  contextTenantId,
  executionId,
  tenantTargetId,
  timeoutMs = 60000,
}) {
  await executeWebScrapingBatch({
    fetchJson,
    urls: validUrlsToPersist,
    headers: { 'X-Tenant-Id': contextTenantId },
    payload: {
      autoIndex: true,
      source: 'web_scraping',
      category: 'general',
      executionId,
      dryRun: false,
      persistTenantId: tenantTargetId,
    },
    timeoutMs,
    silent: true,
  });

  // Aguarda indexação completar (best-effort)
  await new Promise((resolve) => setTimeout(resolve, 2000));
}