'use strict';

/**
 * osvConnector — sincronização de advisories e enriquecimento (KEV/EPSS).
 *
 * Separação CONTROL PLANE / LOCAL SCANNING PLANE:
 *   - A INTERNET só é tocada aqui (e apenas neste arquivo).
 *   - O resultado é persistido NORMALIZADO em `security_advisories`, para que a
 *     correlação com o inventário rode offline contra o banco.
 *
 * Controles obrigatórios (para não sobrecarregar terceiros nem travar o RAP):
 *   - Rate limit explícito (padrão conservador), retry com backoff exponencial
 *     e timeout por requisição.
 *   - Falha de fonte NUNCA é traduzida em "sem vulnerabilidades": cada falha vai
 *     para `failures` e a sincronização fica `DEGRADED`.
 *   - `fetch`, `sleep` e `now` são INJETÁVEIS (testável sem rede).
 */

const logger = require('../../utils/logger');
const { sha256 } = require('../../../engine/securityIntel/componentIdentity');
const { normalizeAdvisory } = require('../../../engine/securityIntel/advisoryModel');

const OSV_QUERY_URL = 'https://api.osv.dev/v1/query';
const KEV_FEED_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const EPSS_API_URL = 'https://api.first.org/data/v1/epss';

const DEFAULT_OPTIONS = Object.freeze({
  rateLimitPerSecond: 4,
  maxAttempts: 3,
  timeoutMs: 15000,
  backoffBaseMs: 500,
});

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Nome do ecossistema NA FORMA EXIGIDA PELO OSV.
 *
 * Defeito medido em 2026-10-08: o OSV responde 400 `{"code":3,"message":
 * "invalid ecosystem"}` para `pypi` minúsculo e exige `PyPI`. Como o inventário é
 * canônico em minúsculas, a tradução precisa acontecer na fronteira do
 * provedor — caso contrário NENHUM advisory do Python é consultado (e o erro
 * só apareceu quando o sweep passou dos pacotes npm, que vinham primeiro em
 * ordem alfabética).
 */
const OSV_ECOSYSTEM_NAMES = Object.freeze({
  npm: 'npm',
  pypi: 'PyPI',
  docker: 'Docker',
});

function toOsvEcosystem(ecosystem) {
  if (!ecosystem) return null;
  const key = String(ecosystem).toLowerCase();
  return OSV_ECOSYSTEM_NAMES[key] || null;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Limitador de taxa serial simples (não dispara rajadas contra o provedor). */
function createRateLimiter({ rateLimitPerSecond, sleep, now = Date.now }) {
  const minIntervalMs = rateLimitPerSecond > 0 ? Math.ceil(1000 / rateLimitPerSecond) : 0;
  let lastCallAt = null;
  return async function acquire() {
    if (minIntervalMs === 0) return;
    // A PRIMEIRA chamada não espera: o rate limit existe para separar
    // requisições, não para atrasar o início do trabalho.
    if (lastCallAt === null) {
      lastCallAt = now();
      return;
    }
    const elapsed = now() - lastCallAt;
    if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);
    lastCallAt = now();
  };
}

/**
 * POST /v1/query — todos os advisories conhecidos para um pacote.
 * Consultar por PACOTE (sem versão) e avaliar a faixa localmente reduz o número
 * de requisições e permite reaproveitar a mesma base para todas as versões
 * instaladas do mesmo pacote.
 */
async function queryOsvPackage({ ecosystem, name }, {
  fetchImpl,
  sleep = defaultSleep,
  acquire = async () => {},
  maxAttempts = DEFAULT_OPTIONS.maxAttempts,
  timeoutMs = DEFAULT_OPTIONS.timeoutMs,
  backoffBaseMs = DEFAULT_OPTIONS.backoffBaseMs,
} = {}) {
  const doFetch = fetchImpl || fetch;
  const osvEcosystem = toOsvEcosystem(ecosystem);
  if (!osvEcosystem) {
    // Falha explícita ANTES da rede: inventar o nome do ecossistema produziria
    // um 400 confuso e uma base parcial silenciosa.
    throw new Error(`osv_ecosystem_unsupported:${ecosystem}`);
  }
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await acquire();
    try {
      const response = await doFetch(OSV_QUERY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: { name, ecosystem: osvEcosystem } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const error = new Error(`osv_http_${response.status}${bodyText ? `:${bodyText.slice(0, 200)}` : ''}`);
        error.status = response.status;
        if (!RETRYABLE_STATUS.has(response.status)) throw error;
        lastError = error;
      } else {
        const body = await response.json().catch(() => ({}));
        return { vulns: Array.isArray(body.vulns) ? body.vulns : [], attempts: attempt };
      }
    } catch (error) {
      if (error.status && !RETRYABLE_STATUS.has(error.status)) throw error;
      lastError = error;
    }
    if (attempt < maxAttempts) await sleep(backoffBaseMs * (2 ** (attempt - 1)));
  }
  throw lastError || new Error('osv_query_failed');
}

/** Catálogo CISA KEV (exploração conhecida) — lista completa em 1 requisição. */
async function fetchKevCatalog({ fetchImpl, timeoutMs = DEFAULT_OPTIONS.timeoutMs } = {}) {
  const doFetch = fetchImpl || fetch;
  const response = await doFetch(KEV_FEED_URL, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`kev_http_${response.status}`);
  const body = await response.json();
  const byCve = new Map();
  for (const entry of Array.isArray(body.vulnerabilities) ? body.vulnerabilities : []) {
    if (!entry || !entry.cveID) continue;
    byCve.set(String(entry.cveID).toUpperCase(), {
      dueDate: entry.dueDate || null,
      knownRansomware: entry.knownRansomwareCampaignUse || null,
      vendorProject: entry.vendorProject || null,
      product: entry.product || null,
    });
  }
  return { catalog: byCve, released: body.dateReleased || null, count: byCve.size };
}

/** EPSS em lote (probabilidade de exploração nos próximos 30 dias). */
async function fetchEpssScores(cves, { fetchImpl, timeoutMs = DEFAULT_OPTIONS.timeoutMs } = {}) {
  if (!Array.isArray(cves) || cves.length === 0) return new Map();
  const doFetch = fetchImpl || fetch;
  const url = `${EPSS_API_URL}?cve=${cves.slice(0, 100).join(',')}`;
  const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`epss_http_${response.status}`);
  const body = await response.json();
  const map = new Map();
  for (const row of Array.isArray(body.data) ? body.data : []) {
    if (!row || !row.cve) continue;
    map.set(String(row.cve).toUpperCase(), {
      epss: row.epss === undefined ? null : Number(row.epss),
      percentile: row.percentile === undefined ? null : Number(row.percentile),
      date: row.date || null,
    });
  }
  return map;
}

/** CVEs presentes nos aliases (o KEV/EPSS indexam por CVE). */
function cveIdsOf(advisory) {
  return (advisory.aliases || []).filter((alias) => /^CVE-/i.test(alias)).map((alias) => alias.toUpperCase());
}

/** Aplica o catálogo KEV e os scores EPSS a uma lista de advisories normalizados. */
function applyEnrichment(advisories, { kevCatalog, epssByCve, checkedAt }) {
  let kevMatches = 0;
  let epssMatches = 0;
  for (const advisory of advisories) {
    const cves = cveIdsOf(advisory);
    for (const cve of cves) {
      const kevEntry = kevCatalog ? kevCatalog.get(cve) : null;
      if (kevEntry) {
        advisory.kev = true;
        advisory.kevDueDate = kevEntry.dueDate || null;
        kevMatches += 1;
      }
      const epss = epssByCve ? epssByCve.get(cve) : null;
      if (epss && typeof epss.epss === 'number') {
        // Guarda o MAIOR EPSS entre as CVEs do advisory (mais conservador).
        if (advisory.epss === null || advisory.epss === undefined || epss.epss > advisory.epss) {
          advisory.epss = epss.epss;
          advisory.epssPercentile = epss.percentile;
        }
        epssMatches += 1;
      }
    }
    advisory.kevCheckedAt = kevCatalog ? checkedAt : null;
    advisory.epssCheckedAt = epssByCve ? checkedAt : null;
  }
  return { kevMatches, epssMatches };
}

/**
 * Sincroniza advisories para uma lista de pacotes.
 *
 * @param {object} input
 * @param {Array<{ecosystem:string,name:string}>} input.packages
 * @param {object} [input.options] `fetchImpl`, `sleep`, `now`, `rateLimitPerSecond`,
 *   `maxPackages`, `maxAttempts`, `includeKev`, `includeEpss`
 * @returns {Promise<object>} `{advisories, failures, stats, snapshotSha256, sourceAgeHours}`
 */
async function fetchAdvisoriesForPackages({ packages = [], options = {} } = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sleep = opts.sleep || defaultSleep;
  const now = opts.now || (() => new Date());
  const acquire = createRateLimiter({
    rateLimitPerSecond: opts.rateLimitPerSecond,
    sleep,
    now: opts.nowMs || Date.now,
  });

  const limit = opts.maxPackages && opts.maxPackages > 0 ? Math.min(opts.maxPackages, packages.length) : packages.length;
  const selected = packages.slice(0, limit);
  const advisoriesById = new Map();
  const failures = [];
  let attemptsTotal = 0;

  for (const pkg of selected) {
    try {
      const { vulns, attempts } = await queryOsvPackage(pkg, { ...opts, acquire, sleep });
      attemptsTotal += attempts;
      for (const raw of vulns) {
        const normalized = normalizeAdvisory(raw, {
          source: 'osv',
          sourceUrl: `https://osv.dev/vulnerability/${raw.id}`,
          fetchedAt: now().toISOString(),
        });
        if (!normalized) continue;
        const existing = advisoriesById.get(normalized.id);
        if (!existing) {
          advisoriesById.set(normalized.id, normalized);
          continue;
        }
        // Mesmo advisory citado por dois pacotes: mescla as entradas afetadas.
        for (const entry of normalized.affected) {
          const already = existing.affected.some(
            (candidate) => candidate.ecosystem === entry.ecosystem && candidate.normalizedName === entry.normalizedName
          );
          if (!already) existing.affected.push(entry);
        }
      }
    } catch (error) {
      failures.push({
        package: `${pkg.ecosystem}:${pkg.name}`,
        reason: error.message,
        status: error.status || null,
      });
      logger.warn('[SecurityIntel] falha ao consultar OSV', {
        package: `${pkg.ecosystem}:${pkg.name}`,
        error: error.message,
      });
    }
  }

  const advisories = [...advisoriesById.values()];
  const checkedAt = now().toISOString();
  let enrichment = { kevMatches: 0, epssMatches: 0 };
  const enrichmentFailures = [];

  if (opts.includeKev !== false) {
    try {
      const kev = await fetchKevCatalog({ fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
      enrichment = applyEnrichment(advisories, { kevCatalog: kev.catalog, checkedAt });
      enrichment.kevCatalogSize = kev.count;
      enrichment.kevReleased = kev.released;
    } catch (error) {
      enrichmentFailures.push({ source: 'cisa-kev', reason: error.message });
      logger.warn('[SecurityIntel] catálogo KEV indisponível — achados NÃO serão tratados como não-explorados', {
        error: error.message,
      });
    }
  }

  if (opts.includeEpss !== false) {
    const cves = [...new Set(advisories.flatMap(cveIdsOf))];
    if (cves.length > 0) {
      try {
        // Lotes de 100 (limite prático da API pública).
        for (let index = 0; index < Math.min(cves.length, 300); index += 100) {
          const batch = cves.slice(index, index + 100);
          const epssByCve = await fetchEpssScores(batch, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
          const applied = applyEnrichment(advisories, { epssByCve, checkedAt });
          enrichment.epssMatches += applied.epssMatches;
        }
      } catch (error) {
        enrichmentFailures.push({ source: 'first-epss', reason: error.message });
        logger.warn('[SecurityIntel] EPSS indisponível — probabilidade de exploração fica DESCONHECIDA', {
          error: error.message,
        });
      }
    }
  }

  const snapshotSha256 = sha256(
    advisories
      .map((advisory) => `${advisory.id}|${advisory.modified || advisory.published || ''}|${advisory.aliases.join(',')}`)
      .sort()
      .join('\n')
  );

  return {
    advisories,
    failures: [...failures, ...enrichmentFailures],
    stats: {
      packagesRequested: packages.length,
      packagesQueried: selected.length,
      packagesTruncated: packages.length > selected.length,
      attempts: attemptsTotal,
      advisories: advisories.length,
      kevMatches: enrichment.kevMatches,
      epssMatches: enrichment.epssMatches,
      kevCatalogSize: enrichment.kevCatalogSize || null,
    },
    snapshotSha256,
    fetchedAt: checkedAt,
  };
}

module.exports = {
  OSV_QUERY_URL,
  KEV_FEED_URL,
  EPSS_API_URL,
  DEFAULT_OPTIONS,
  OSV_ECOSYSTEM_NAMES,
  toOsvEcosystem,
  createRateLimiter,
  queryOsvPackage,
  fetchKevCatalog,
  fetchEpssScores,
  fetchAdvisoriesForPackages,
  applyEnrichment,
  cveIdsOf,
};
