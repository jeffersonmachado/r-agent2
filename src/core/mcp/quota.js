'use strict';

/**
 * MCP Quota — limite de uso LOCAL por tenant, conexão e tool.
 *
 * Por que local (M49): depender apenas do limite do servidor remoto significa
 * que um bug de loop, um agente em retry ou um tenant abusivo consomem a cota
 * antes que qualquer limite remoto reaja — e o custo/impacto já aconteceu. O
 * controle local é a primeira linha de defesa e é o único que o RAP governa.
 *
 * Escopos resolvidos em cascata (o mais específico primeiro):
 *   tool:<tenant>:<connection>:<tool>
 *   connection:<tenant>:<connection>
 *   tenant:<tenant>
 *
 * Implementação: janela DESLIZANTE determinística com timestamps injetáveis —
 * sem timer, sem I/O, sem estado global implícito. Uma janela fixa permitiria
 * 2× o limite na virada; a deslizante não.
 */

const QUOTA_SCOPES = Object.freeze({
  TENANT: 'tenant',
  CONNECTION: 'connection',
  TOOL: 'tool',
});

const QUOTA_REASONS = Object.freeze({
  EXCEEDED: 'mcp_quota_exceeded',
  INVALID_LIMIT: 'mcp_quota_invalid_limit',
});

function scopeKey(scope, { tenantId, connection = null, tool = null }) {
  if (scope === QUOTA_SCOPES.TOOL) return `tool:${tenantId}:${connection}:${tool}`;
  if (scope === QUOTA_SCOPES.CONNECTION) return `connection:${tenantId}:${connection}`;
  return `tenant:${tenantId}`;
}

/**
 * Normaliza a configuração de quota.
 * `limits` aceita número (chamadas por janela) ou `{ limit, windowMs }`.
 */
function normalizeQuotaConfig(raw = {}) {
  const windowMs = Number.isFinite(Number(raw.windowMs)) && Number(raw.windowMs) > 0
    ? Number(raw.windowMs)
    : 60000;

  const limits = {};
  for (const scope of Object.values(QUOTA_SCOPES)) {
    const value = raw[scope];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number') {
      if (value > 0) limits[scope] = { limit: Math.floor(value), windowMs };
      continue;
    }
    const limit = Number(value.limit);
    if (Number.isFinite(limit) && limit > 0) {
      limits[scope] = {
        limit: Math.floor(limit),
        windowMs: Number.isFinite(Number(value.windowMs)) && Number(value.windowMs) > 0
          ? Number(value.windowMs)
          : windowMs,
      };
    }
  }
  return { windowMs, limits };
}

/**
 * @param {object} [deps]
 * @param {Function} [deps.now] relógio injetável (epoch ms)
 */
function createMcpQuota({ now } = {}) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  /** @type {Map<string, {limit:number, windowMs:number, hits:number[]}>} */
  const buckets = new Map();

  function configure(quotaConfig) {
    const normalized = normalizeQuotaConfig(quotaConfig);
    let configured = 0;
    for (const [scope, config] of Object.entries(normalized.limits)) {
      buckets.set(`__config__:${scope}`, { ...config, hits: [] });
      configured += 1;
    }
    return { configured, scopes: Object.keys(normalized.limits) };
  }

  /** Configuração REGISTRADA para um escopo (compartilhada pelas suas chaves). */
  function configFor(scope) {
    return buckets.get(`__config__:${scope}`) || null;
  }

  function prune(hits, windowMs, current) {
    const threshold = current - windowMs;
    let index = 0;
    while (index < hits.length && hits[index] <= threshold) index += 1;
    if (index > 0) hits.splice(0, index);
    return hits;
  }

  /**
   * Tenta consumir uma unidade em CADA escopo configurado.
   * Tudo ou nada: se qualquer escopo estourar, nenhum é consumido (senão uma
   * chamada negada ainda consumiria cota de outros escopos).
   *
   * @param {object} context `{ tenantId, connection, tool }`
   * @returns {{allowed: boolean, reason: string|null, retryAfterMs: number, violatedScope: string|null, remaining: object}}
   */
  function acquire({ tenantId, connection = null, tool = null } = {}) {
    if (!tenantId) throw new Error('mcp_quota_tenant_required');
    const current = clock();

    const checks = [];
    for (const scope of [QUOTA_SCOPES.TOOL, QUOTA_SCOPES.CONNECTION, QUOTA_SCOPES.TENANT]) {
      const scopeConfig = configFor(scope);
      if (!scopeConfig) continue;
      // Escopo de tool/conexão só se aplica quando os identificadores existem.
      if (scope === QUOTA_SCOPES.TOOL && (!connection || !tool)) continue;
      if (scope === QUOTA_SCOPES.CONNECTION && !connection) continue;

      const key = scopeKey(scope, { tenantId, connection, tool });
      if (!buckets.has(key)) buckets.set(key, { limit: scopeConfig.limit, windowMs: scopeConfig.windowMs, hits: [] });
      const bucket = buckets.get(key);
      bucket.limit = scopeConfig.limit;
      bucket.windowMs = scopeConfig.windowMs;
      prune(bucket.hits, bucket.windowMs, current);
      checks.push({ scope, key, bucket });
    }

    if (checks.length === 0) {
      return { allowed: true, reason: null, retryAfterMs: 0, violatedScope: null, remaining: {} };
    }

    for (const check of checks) {
      if (check.bucket.hits.length >= check.bucket.limit) {
        const oldest = check.bucket.hits[0];
        return {
          allowed: false,
          reason: QUOTA_REASONS.EXCEEDED,
          retryAfterMs: Math.max(0, (oldest + check.bucket.windowMs) - current),
          violatedScope: check.scope,
          remaining: Object.fromEntries(checks.map((c) => [c.scope, Math.max(0, c.bucket.limit - c.bucket.hits.length)])),
        };
      }
    }

    for (const check of checks) check.bucket.hits.push(current);
    return {
      allowed: true,
      reason: null,
      retryAfterMs: 0,
      violatedScope: null,
      remaining: Object.fromEntries(checks.map((c) => [c.scope, Math.max(0, c.bucket.limit - c.bucket.hits.length)])),
    };
  }

  /** Devolve a cota consumida (uso quando a chamada falhou antes de sair). */
  function release({ tenantId, connection = null, tool = null } = {}) {
    for (const scope of [QUOTA_SCOPES.TOOL, QUOTA_SCOPES.CONNECTION, QUOTA_SCOPES.TENANT]) {
      const scopeConfig = configFor(scope);
      if (!scopeConfig) continue;
      if (scope === QUOTA_SCOPES.TOOL && (!connection || !tool)) continue;
      if (scope === QUOTA_SCOPES.CONNECTION && !connection) continue;
      const bucket = buckets.get(scopeKey(scope, { tenantId, connection, tool }));
      if (bucket && bucket.hits.length > 0) bucket.hits.pop();
    }
  }

  function snapshot({ tenantId = null } = {}) {
    const entries = [];
    for (const [key, bucket] of buckets.entries()) {
      if (key.startsWith('__config__:')) continue;
      if (tenantId && !key.includes(`:${tenantId}:`) && key !== `tenant:${tenantId}`) continue;
      entries.push({ key, limit: bucket.limit, used: bucket.hits.length, windowMs: bucket.windowMs });
    }
    return entries;
  }

  return { configure, acquire, release, snapshot, scopes: QUOTA_SCOPES, reasons: QUOTA_REASONS };
}

module.exports = {
  QUOTA_SCOPES,
  QUOTA_REASONS,
  scopeKey,
  normalizeQuotaConfig,
  createMcpQuota,
};
