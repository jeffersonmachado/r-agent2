const logger = require('../utils/logger');
const { getEphemeralContextClient } = require('../../infra/redis/ephemeralContextClient');
const exclusionsService = require('./exclusions.service');
const ragService = require('./ragService');
const { normalizeEmbedding } = require('../utils/contentNormalization');
const { generateAiResponse } = require('./aiProviderService');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeWs(s) {
  return safeString(s).replace(/\s+/g, ' ').trim();
}

function getReadyRedisClientOrNull() {
  const redis = getEphemeralContextClient();
  if (!redis) return null;
  if (redis.status !== 'ready') return null;
  return redis;
}

function getTtlSeconds(input) {
  const env = Number(process.env.EPHEMERAL_RAG_TTL_SECONDS);
  const fallback = Number.isFinite(env) && env > 0 ? env : 1800; // 30min
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(60, Math.min(6 * 3600, Math.floor(n))); // 1min..6h
}

function buildCtxKey(tenantId, executionId) {
  return `ctx:${tenantId}:${executionId}`;
}

function buildEntitiesKey(tenantId, executionId) {
  return `entities:${tenantId}:${executionId}`;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosineNormalized(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  return dot(a, b);
}

function meanVector(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

function pickK(n) {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.min(6, Math.floor(Math.sqrt(n))));
}

function kmeansCosine(embeddings, k, maxIters = 25) {
  const n = embeddings.length;
  if (n === 0) return { assignments: [], centroids: [] };
  if (k <= 1) return { assignments: new Array(n).fill(0), centroids: [embeddings[0]] };
  const dim = embeddings[0].length;

  // k-means++ (simplificado) com distância (1 - cos)
  const centroids = [];
  const usedIdx = new Set();
  centroids.push(embeddings[0]);
  usedIdx.add(0);

  while (centroids.length < k) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      if (usedIdx.has(i)) continue;
      let minDist = Infinity;
      for (const c of centroids) {
        const dist = 1 - cosineNormalized(embeddings[i], c);
        if (dist < minDist) minDist = dist;
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    centroids.push(embeddings[bestIdx]);
    usedIdx.add(bestIdx);
  }

  while (centroids.length < k) centroids.push(new Array(dim).fill(0));

  let assignments = new Array(n).fill(0);
  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;

    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = cosineNormalized(embeddings[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    const grouped = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) grouped[assignments[i]].push(embeddings[i]);
    for (let c = 0; c < k; c++) {
      if (grouped[c].length === 0) continue;
      const m = meanVector(grouped[c]);
      if (!m) continue;
      centroids[c] = normalizeEmbedding(m);
    }

    if (!changed) break;
  }

  return { assignments, centroids };
}

function stripTerms(text, terms) {
  let out = safeString(text);
  const list = Array.isArray(terms) ? terms : [];
  for (const raw of list) {
    const t = safeString(raw).trim();
    if (!t) continue;
    if (t.length < 4) continue;
    // remove ocorrência literal (case-insensitive), sem regex complexa
    // (escapa caracteres especiais)
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), ' ');
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function defaultEntities() {
  return {
    services: [],
    plans: [],
    prices: [],
    schedules: [],
    promotions: [],
    paymentMethods: [],
    contacts: [],
  };
}

function coerceEntities(obj) {
  const base = defaultEntities();
  if (!obj || typeof obj !== 'object') return base;
  for (const k of Object.keys(base)) {
    const v = obj[k];
    if (Array.isArray(v)) {
      base[k] = v
        .map((x) => safeString(x).trim())
        .filter(Boolean)
        .slice(0, 60);
    }
  }
  return base;
}

function extractJsonObject(text) {
  const raw = safeString(text).trim();
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

async function readCtxChunksFromRedis({ tenantId, executionId }) {
  const redis = getReadyRedisClientOrNull();
  const key = buildCtxKey(tenantId, executionId);
  if (!redis) return { ok: true, key, used: 'noop', chunks: [] };

  const raw = await redis.get(key);
  if (!raw) return { ok: true, key, used: 'redis', chunks: [] };

  try {
    const parsed = JSON.parse(raw);
    const chunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
    return { ok: true, key, used: 'redis', chunks };
  } catch {
    // compat: se gravaram texto direto
    return { ok: true, key, used: 'redis', chunks: [{ text: safeString(raw) }] };
  }
}

function buildClusteredContext(texts, embeddingsNorm) {
  const validTexts = Array.isArray(texts) ? texts.filter(Boolean) : [];
  if (validTexts.length === 0) return '';
  if (!Array.isArray(embeddingsNorm) || embeddingsNorm.length !== validTexts.length) {
    return validTexts.slice(0, 12).join('\n\n').slice(0, 18000);
  }

  const k = pickK(validTexts.length);
  const { assignments } = kmeansCosine(embeddingsNorm, k);
  const groups = Array.from({ length: k }, () => []);
  for (let i = 0; i < validTexts.length; i++) {
    const c = Number.isFinite(assignments[i]) ? assignments[i] : 0;
    groups[c].push(validTexts[i]);
  }

  // Ordena grupos por tamanho (proxy de densidade)
  const nonEmpty = groups.filter((g) => g.length > 0).sort((a, b) => b.length - a.length);

  const blocks = [];
  for (const g of nonEmpty) {
    // pega até 3 trechos representativos (mais longos)
    const picked = g
      .slice()
      .sort((a, b) => (b.length - a.length))
      .slice(0, 3);
    blocks.push(picked.join('\n'));
    if (blocks.join('\n\n---\n\n').length >= 18000) break;
  }

  return blocks.join('\n\n---\n\n').slice(0, 18000);
}

/**
 * Etapa obrigatória: extrai entidades de negócio do contexto efêmero (Redis).
 *
 * Salva em Redis: entities:{tenantId}:{executionId}
 *
 * @param {{ tenantId: string, executionId: string, dryRun?: boolean }} input
 */
async function extractBusinessEntities({ tenantId, executionId, dryRun } = {}) {
  const tid = safeString(tenantId).trim();
  const exec = safeString(executionId).trim();
  const isDryRun = dryRun === true;
  if (!tid) throw new Error('tenantId é obrigatório');
  if (!exec) throw new Error('executionId é obrigatório');

  const entitiesKey = buildEntitiesKey(tid, exec);
  const ctx = await readCtxChunksFromRedis({ tenantId: tid, executionId: exec });
  const rawTexts = (Array.isArray(ctx?.chunks) ? ctx.chunks : [])
    .map((c) => normalizeWs(c?.text || c?.excerpt || ''))
    .filter(Boolean)
    .slice(0, 30);

  const aggregated = rawTexts.join('\n\n').slice(0, 24000);
  const sanitized = exclusionsService.sanitizeContext(aggregated);
  const { finalExclusions } = await exclusionsService.getFinalExclusions(sanitized, tid, { dryRun: isDryRun });
  const exclusions = Array.isArray(finalExclusions) ? finalExclusions.slice(0, 120) : [];

  // Sanitiza por chunk + remove termos excluídos (para reduzir ruído no prompt)
  const cleanedPerChunk = rawTexts
    .map((t) => exclusionsService.sanitizeContext(t))
    .map((t) => stripTerms(t, exclusions))
    .filter(Boolean)
    .slice(0, 30);

  let cleanContext = cleanedPerChunk.join('\n\n').slice(0, 18000);
  try {
    const embRes = await ragService.generateEmbeddingsBatch(cleanedPerChunk, tid, { timeoutMs: 15000 });
    if (embRes?.success && Array.isArray(embRes.embeddings) && embRes.embeddings.length === cleanedPerChunk.length) {
      const norm = embRes.embeddings.map((e) => normalizeEmbedding(e));
      cleanContext = buildClusteredContext(cleanedPerChunk, norm);
    }
  } catch (err) {
    logger.warn('[business-entities] Falha ao gerar embeddings; seguindo sem clusterização', {
      tenantId: tid,
      executionId: exec,
      error: err?.message || String(err),
    });
  }

  const prompt = [
    'A partir do contexto abaixo, identifique entidades de negócio.',
    '',
    '<contexto>',
    safeString(cleanContext).trim().slice(0, 18000),
    '</contexto>',
    '',
    'Extraia APENAS o que for explícito.',
    '',
    'Retorne JSON neste formato:',
    '',
    JSON.stringify(defaultEntities(), null, 2),
    '',
    'Regras:',
    '- Não inferir o que não estiver presente.',
    '- Não gerar conteúdo genérico.',
    '- Ignorar termos técnicos, nomes de arquivos, UUIDs, lixo OCR.',
    '- Valores devem manter formatação original.',
    '- Horários no formato original.',
  ].join('\n');

  let entities = defaultEntities();
  try {
    const ai = await generateAiResponse(prompt, tid, {});
    const parsed = extractJsonObject(ai?.text || '');
    entities = coerceEntities(parsed);
  } catch (err) {
    logger.warn('[business-entities] Falha ao extrair entidades via IA (best-effort)', {
      tenantId: tid,
      executionId: exec,
      error: err?.message || String(err),
    });
    entities = defaultEntities();
  }

  const redis = getReadyRedisClientOrNull();
  const ttlSeconds = getTtlSeconds();
  const payload = {
    tenantId: tid,
    executionId: exec,
    entities,
    updatedAt: new Date().toISOString(),
  };

  try {
    // Requisito: em dry-run, não persistir nada (nem no Redis efêmero).
    if (!isDryRun && redis) await redis.set(entitiesKey, JSON.stringify(payload), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn('[business-entities] Falha ao salvar entidades no Redis (best-effort)', {
      tenantId: tid,
      executionId: exec,
      error: err?.message || String(err),
    });
  }

  return { ok: true, key: entitiesKey, used: ctx?.used || 'noop', entities };
}

module.exports = {
  extractBusinessEntities,
  _internal: {
    buildEntitiesKey,
    buildCtxKey,
  },
};

