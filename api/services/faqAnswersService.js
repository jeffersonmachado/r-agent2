const logger = require('../utils/logger');
const exclusionsService = require('./exclusions.service');
const answersService = require('./answers.service');
const { resolveContextSources } = require('./contextSourceResolver');

function safeString(v) {
  if (v === null || v === undefined) return '';
  try {
    return String(v);
  } catch (_) {
    return '';
  }
}

function normalizeQuestions(raw, { max = 50 } = {}) {
  const items = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const q of items) {
    const s = safeString(q).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const clipped = s.slice(0, 220);
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
    if (out.length >= Math.max(1, Math.min(200, Number(max) || 50))) break;
  }
  return out;
}

function coerceInlineChunk(c) {
  const sourceType = safeString(c?.sourceType || '').trim();
  const sourceId = safeString(c?.sourceId || '').trim();
  const text = safeString(c?.text || c?.excerpt || '').trim();
  if (!text || text.length < 20) return null;
  return {
    sourceType: (sourceType === 'uploaded_file' || sourceType === 'web_scraping') ? sourceType : 'unknown',
    sourceId: sourceId ? sourceId.slice(0, 240) : null,
    text: text.slice(0, 5000),
    excerpt: safeString(c?.excerpt || '').trim().slice(0, 5000),
  };
}

function buildContextFromSources(contextSources) {
  const sources = Array.isArray(contextSources) ? contextSources : [];
  const aggregated = sources
    .map((s) => safeString(s?.text || s?.excerpt || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 24000);
  return exclusionsService.sanitizeContext(aggregated);
}

/**
 * Gera respostas para perguntas (FAQ) usando somente o contexto resolvido (RAG/Redis/inline).
 *
 * @param {{
 *  tenantId: string,
 *  questions: string[],
 *  executionId?: string|null,
 *  name?: string|null,
 *  urls?: string[],
 *  fileNames?: string[],
 *  chunks?: Array<{sourceType?: string, sourceId?: string|null, text?: string, excerpt?: string}>,
 *  contextMode?: 'auto'|'persisted'|'ephemeral',
 *  dryRun?: boolean
 * }} input
 * @returns {Promise<{questions: string[], answers: string[], exclusions: string[], meta: any}>}
 */
async function generateFaqAnswers(input = {}) {
  const tenantId = safeString(input?.tenantId).trim();
  if (!tenantId) throw new Error('tenantId é obrigatório');

  const questions = normalizeQuestions(input?.questions, { max: 50 });
  if (questions.length === 0) throw new Error('questions é obrigatório (array com pelo menos 1 item)');

  const executionId = (safeString(input?.executionId).trim() || null);
  const dryRun = input?.dryRun === true;

  const urls = Array.isArray(input?.urls)
    ? input.urls.filter((u) => typeof u === 'string' && u.trim()).map((u) => u.trim()).slice(0, 5)
    : [];
  const fileNames = Array.isArray(input?.fileNames)
    ? input.fileNames.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()).slice(0, 10)
    : [];
  const chunks = Array.isArray(input?.chunks)
    ? input.chunks.map(coerceInlineChunk).filter(Boolean).slice(0, 30)
    : [];

  const contextMode = (input?.contextMode === 'ephemeral' || input?.contextMode === 'persisted')
    ? input.contextMode
    : 'auto';
  const name = safeString(input?.name || '').trim() || null;

  const { contextSources, used } = await resolveContextSources({
    tenantId,
    executionId,
    contextMode,
    name,
    urls,
    fileNames,
    chunks,
  });

  const ragContext = buildContextFromSources(contextSources);

  // Exclusions: best-effort, persistidas por tenant (quando não for dry-run)
  const { finalExclusions } = await exclusionsService.getFinalExclusions(ragContext, tenantId, { dryRun });
  const exclusions = exclusionsService.augmentExclusions(
    Array.isArray(finalExclusions) ? finalExclusions : [],
    { fileNames }
  );

  logger.info('[faqAnswersService] Gerando respostas para FAQ', {
    tenantId,
    executionId,
    questions: questions.length,
    usedContext: used,
    sources: Array.isArray(contextSources) ? contextSources.length : 0,
    urls: urls.length,
    fileNames: fileNames.length,
    inlineChunks: chunks.length,
  });

  const executionContext = {
    executionId,
    exclusions,
    excludedItemsCount: 0,
  };

  const answers = await answersService.generateAnswers(tenantId, questions, ragContext, executionContext);

  return {
    questions,
    answers: Array.isArray(answers) ? answers : [],
    exclusions,
    meta: {
      usedContext: used,
      sourcesCount: Array.isArray(contextSources) ? contextSources.length : 0,
      executionId,
      contextMode,
    },
  };
}

module.exports = {
  generateFaqAnswers,
};

