const logger = require('../utils/logger');
const { getEphemeralContextClient } = require('../../infra/redis/ephemeralContextClient');
const ragService = require('./ragService');
const { buildDiverseRagContext } = require('./ragContextBuilder');
const { getTenant } = require('./tenantService');
const { normalizeEmbedding } = require('../utils/contentNormalization');
const exclusionsService = require('./exclusions.service');
const businessEntitiesService = require('./business-entities.service');
const { extractSemanticContext, detectBusinessType } = require('./semanticContextService');
const { generateQuestionsFromContext } = require('../utils/ragQuestionGenerator');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeWs(s) {
  return safeString(s).replace(/\s+/g, ' ').trim();
}

function buildKey(tenantId, executionId) {
  return `ctx:${tenantId}:${executionId}`;
}

function buildEntitiesKey(tenantId, executionId) {
  return `entities:${tenantId}:${executionId}`;
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
      base[k] = v.map((x) => safeString(x).trim()).filter(Boolean).slice(0, 60);
    }
  }
  return base;
}

function mergeUniqueStrings(a, b, { max = 60 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = safeString(v).trim();
    if (!s) return;
    const k = s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (!k) return;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  (Array.isArray(a) ? a : []).forEach(push);
  (Array.isArray(b) ? b : []).forEach(push);
  return out.slice(0, Math.max(1, Math.min(200, Number(max) || 60)));
}

async function readEntitiesFromRedis({ tenantId, executionId }) {
  const redis = getEphemeralContextClient();
  const key = buildEntitiesKey(tenantId, executionId);
  if (!redis || redis.status !== 'ready') return { key, found: false, entities: defaultEntities(), used: 'noop' };

  const raw = await redis.get(key);
  if (!raw) return { key, found: false, entities: defaultEntities(), used: 'redis' };

  try {
    const parsed = JSON.parse(raw);
    const entities = coerceEntities(parsed?.entities || parsed);
    const found = Object.values(entities).some((arr) => Array.isArray(arr) && arr.length > 0);
    return { key, found, entities, used: 'redis' };
  } catch {
    return { key, found: false, entities: defaultEntities(), used: 'redis' };
  }
}

function formatEntitiesBlock(entities) {
  const e = coerceEntities(entities);
  const fmt = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr.join('\n') : '');
  return [
    'Entidades detectadas:',
    '',
    'Serviços:',
    fmt(e.services),
    '',
    'Planos:',
    fmt(e.plans),
    '',
    'Preços:',
    fmt(e.prices),
    '',
    'Horários:',
    fmt(e.schedules),
    '',
    'Promoções:',
    fmt(e.promotions),
    '',
    'Pagamentos:',
    fmt(e.paymentMethods),
    '',
    'Contatos:',
    fmt(e.contacts),
    '',
  ].join('\n');
}

function stripExplicitEntityValuesFromText(text, entities) {
  let out = safeString(text);
  const e = coerceEntities(entities);
  const values = [
    ...e.services,
    ...e.plans,
    ...e.prices,
    ...e.schedules,
    ...e.promotions,
    ...e.paymentMethods,
    ...e.contacts,
  ]
    .map((s) => safeString(s).trim())
    .filter((s) => s.length >= 4)
    .slice(0, 200);

  for (const v of values) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), ' ');
  }

  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function parseQuestionsFromText(text) {
  return safeString(text)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/g, '').trim())
    .filter(Boolean)
    .filter((q) => q.endsWith('?') || q.length >= 10)
    .slice(0, 200);
}

function semanticDedupeByEmbeddings(questions, embeddings, threshold = 0.85) {
  const kept = [];
  const keptEmb = [];
  for (let i = 0; i < questions.length; i++) {
    const e = embeddings[i];
    if (!e) continue;
    let maxSim = -1;
    for (const prev of keptEmb) {
      const sim = cosineNormalized(e, prev);
      if (sim > maxSim) maxSim = sim;
      if (maxSim >= threshold) break;
    }
    if (maxSim < threshold) {
      kept.push(questions[i]);
      keptEmb.push(e);
    }
    if (kept.length >= 80) break;
  }
  return kept;
}

async function readRagContextFromRedis({ tenantId, executionId }) {
  const redis = getEphemeralContextClient();
  const key = buildKey(tenantId, executionId);
  if (!redis || redis.status !== 'ready') {
    return { key, ragContext: '', used: 'noop' };
  }

  const raw = await redis.get(key);
  if (!raw) return { key, ragContext: '', used: 'redis' };

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // compat: se por algum motivo gravaram texto direto
    return { key, ragContext: normalizeWs(raw), used: 'redis' };
  }

  const chunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
  const texts = chunks
    .map((c) => normalizeWs(c?.text || c?.excerpt || ''))
    .filter(Boolean);

  // Dump simples (não “técnico”): só concatenamos texto
  const ragContext = texts.join('\n\n');
  return { key, ragContext, used: 'redis' };
}

async function buildRagContextFromPersistedRag(tenantId) {
  let tenant = null;
  try { tenant = await getTenant(tenantId); } catch { tenant = null; }
  const name = normalizeWs(tenant?.name || '');
  const site = normalizeWs(tenant?.site || '');

  const ragQuery = name
    ? `Perguntas frequentes sobre ${name} informações serviços produtos contato horários valores`
    : (site ? `Perguntas frequentes informações do site ${site}` : 'Perguntas frequentes e informações gerais do tenant');

  const diverse = await buildDiverseRagContext({
    query: ragQuery,
    tenantId,
    totalK: 18,
    minUploaded: 6,
    minWeb: 6,
    minScore: 0.12,
    maxTokens: 4500,
  });

  const sources = Array.isArray(diverse?.contextSources) ? diverse.contextSources : [];
  const ragContext = sources
    .map((s) => normalizeWs(s?.text || s?.excerpt || ''))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 24000);

  return { ragContext, sourcesCount: sources.length };
}

function buildRagContextFromInlineChunks(chunks) {
  const safeChunks = Array.isArray(chunks) ? chunks : [];
  const texts = safeChunks
    .map((c) => normalizeWs(c?.text || c?.excerpt || ''))
    .filter(Boolean)
    .slice(0, 60);
  const ragContext = texts.join('\n\n').slice(0, 24000);
  return { ragContext };
}

/**
 * Gera perguntas (FAQ) a partir do contexto efêmero (Redis).
 *
 * @param {{ tenantId: string, executionId: string, chunks?: any[] }} input
 * @returns {Promise<{ questions: string[], ragContext: string, meta: any }>}
 */
async function generateFAQ({ tenantId, executionId, chunks, dryRun } = {}) {
  tenantId = safeString(tenantId).trim();
  executionId = safeString(executionId).trim();
  const isDryRun = dryRun === true;
  if (!tenantId) throw new Error('tenantId é obrigatório');
  if (!executionId) throw new Error('executionId é obrigatório');

  const { key, ragContext, used } = await readRagContextFromRedis({ tenantId, executionId });
  let normalizedContext = safeString(ragContext).trim();
  let usedFinal = used;

  // Fallback 1: aceita chunks inline (para dry-run quando o backend caiu em store "memory")
  if (!normalizedContext) {
    const inline = buildRagContextFromInlineChunks(chunks);
    if (inline?.ragContext) {
      normalizedContext = inline.ragContext;
      usedFinal = 'inline';
    }
  }

  // Fallback: se Redis não tem contexto, tenta RAG persistido (pgvector)
  if (!normalizedContext) {
    try {
      const persisted = await buildRagContextFromPersistedRag(tenantId);
      if (persisted?.ragContext) {
        normalizedContext = persisted.ragContext;
        usedFinal = 'rag';
      }
    } catch (err) {
      logger.debug('[faq.service] Falha ao buscar contexto no RAG persistido (best-effort)', {
        tenantId,
        error: err?.message || String(err),
      });
    }
  }

  // Se vazio: fallback mínimo solicitado
  if (!normalizedContext) {
    return {
      questions: [
        'O que é esta entidade?',
        'Qual é o objetivo principal?',
        'Como obter mais informações?',
      ],
      ragContext: '',
      meta: { used: usedFinal, key, empty: true },
    };
  }

  // ============================================================
  // Novo pipeline: contexto real → limpeza semântica → perguntas determinísticas
  // ============================================================
  let semantic = null;
  try {
    semantic = await extractSemanticContext({
      tenantId,
      executionId,
      dryRun: isDryRun,
      chunks: Array.isArray(chunks) ? chunks : [],
      contextMode: isDryRun ? 'ephemeral' : 'auto',
    });
  } catch (err) {
    // Degradação: mantém compatibilidade com o comportamento anterior
    logger.warn('[faq.service] Falha ao extrair contexto semântico; usando fallback mínimo', {
      tenantId,
      executionId,
      error: err?.message || String(err),
    });
    return {
      questions: [
        'O que é esta entidade?',
        'Qual é o objetivo principal?',
        'Como obter mais informações?',
      ],
      ragContext: normalizedContext,
      meta: { used: usedFinal, key, empty: false, degraded: true },
    };
  }

  const exclusions = Array.isArray(semantic?.excludedTerms?.inferred)
    ? semantic.excludedTerms.inferred.slice(0, 100)
    : [];

  // ============================================================
  // Business Entities: lê do Redis (entities:{tenantId}:{executionId})
  // e, se necessário, extrai best-effort (mantém pipeline obrigatório).
  // ============================================================
  let entitiesInfo = await readEntitiesFromRedis({ tenantId, executionId });
  if (!entitiesInfo?.found) {
    try {
      const be = await businessEntitiesService.extractBusinessEntities({ tenantId, executionId, dryRun: isDryRun });
      const e = be?.entities || null;
      entitiesInfo = { ...(entitiesInfo || {}), found: !!e, entities: e ? coerceEntities(e) : defaultEntities(), used: 'service' };
    } catch (err) {
      logger.debug('[faq.service] Falha ao extrair entidades (best-effort)', {
        tenantId,
        executionId,
        error: err?.message || String(err),
      });
      entitiesInfo = entitiesInfo || { found: false, entities: defaultEntities(), used: 'noop' };
    }
  }

  // Mescla entidades do Redis (quando disponíveis) ao contexto semântico (sem persistir).
  // Isso ajuda a melhorar a cobertura de serviços/preços/horários quando já foram detectados.
  try {
    const e = coerceEntities(entitiesInfo?.entities);
    if (Array.isArray(e.services) && e.services.length > 0) {
      semantic.services = mergeUniqueStrings(semantic.services || [], e.services, { max: 60 });
    }
    if (Array.isArray(e.prices) && e.prices.length > 0) {
      semantic.prices = mergeUniqueStrings(semantic.prices || [], e.prices, { max: 60 });
    }
    if (Array.isArray(e.schedules) && e.schedules.length > 0) {
      semantic.schedules = mergeUniqueStrings(semantic.schedules || [], e.schedules, { max: 60 });
    }
    if (Array.isArray(e.paymentMethods) && e.paymentMethods.length > 0) {
      semantic.paymentMethods = mergeUniqueStrings(semantic.paymentMethods || [], e.paymentMethods, { max: 60 });
    }
    if (Array.isArray(e.contacts) && e.contacts.length > 0) {
      semantic.contacts = mergeUniqueStrings(semantic.contacts || [], e.contacts, { max: 60 });
    }
  } catch {
    // noop
  }

  const businessType = detectBusinessType(semantic);
  const generatedQuestions = generateQuestionsFromContext({
    context: semantic,
    businessType,
    limits: { maxQuestions: 90, minQuestionsIfRich: 20 },
  });

  const filteredQuestions = exclusionsService.filterQuestions(generatedQuestions, exclusions);
  if (filteredQuestions.length === 0) {
    return {
      questions: [
        'O que é esta entidade?',
        'Qual é o objetivo principal?',
        'Como obter mais informações?',
      ],
      ragContext: normalizedContext,
      meta: { used: usedFinal, key, empty: false, degraded: true },
    };
  }

  // Embeddings + dedupe semântico
  const embRes = await ragService.generateEmbeddingsBatch(filteredQuestions, tenantId, { timeoutMs: 15000 });
  if (!embRes?.success || !Array.isArray(embRes.embeddings) || embRes.embeddings.length !== filteredQuestions.length) {
    logger.warn('[faq.service] Falha ao gerar embeddings; dedupe simples por texto', { tenantId, executionId });
    const uniq = Array.from(new Set(filteredQuestions.map((q) => q.toLowerCase()))).slice(0, 80);
    const questions = uniq.map((q) => filteredQuestions.find((x) => x.toLowerCase() === q)).filter(Boolean);
    return { questions, ragContext: (sanitizedContext || normalizedContext), meta: { used, key, degraded: true } };
  }

  const normEmb = embRes.embeddings.map((e) => normalizeEmbedding(e));
  const questions = semanticDedupeByEmbeddings(filteredQuestions, normEmb, 0.85);

  logger.info('[faq.service] FAQ gerado', {
    tenantId,
    executionId,
    key,
    used: usedFinal,
    raw: generatedQuestions.length,
    filtered: filteredQuestions.length,
    deduped: questions.length,
  });

  return {
    questions,
    ragContext: normalizedContext,
    meta: {
      used: usedFinal,
      key,
      exclusions,
      entitiesKey: entitiesInfo?.key || buildEntitiesKey(tenantId, executionId),
      entitiesUsed: !!entitiesInfo?.found,
      businessType,
      semantic: {
        usedContext: semantic?.meta?.usedContext || null,
        chunks: semantic?.meta?.chunks || 0,
      },
    },
  };
}

module.exports = {
  generateFAQ,
  _internal: { readRagContextFromRedis, buildKey },
};

