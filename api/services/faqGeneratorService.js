const logger = require('../utils/logger');
const ragService = require('./ragService');
const { generateAiResponse } = require('./aiProviderService');
const {
  getDefaultQuestionGenerationRules,
  generateQuestionsFromContent,
  mergeUniqueQuestions,
  generateQuestionsFromContext,
} = require('../utils/ragQuestionGenerator');
const { normalizeEmbedding } = require('../utils/contentNormalization');
const exclusionsService = require('./exclusions.service');
const questionGenerationRulesService = require('./questionGenerationRules.service');
const { resolveContextSources } = require('./contextSourceResolver');
const { extractSemanticContext, detectBusinessType } = require('./semanticContextService');

function safeString(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  try {
    return String(v);
  } catch (_) {
    return fallback;
  }
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function countAlphaNumChars(s) {
  if (!s) return 0;
  const m = String(s).match(/[\p{L}\p{N}]/gu);
  return m ? m.length : 0;
}

function isRelevantChunkText(text) {
  const t = safeString(text).replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Evita contar headings/menus/fragmentos curtos como “conhecimento”
  if (t.length < 220) return false;
  if (countAlphaNumChars(t) < 90) return false;

  // Heurística simples de repetição: chunks muito repetitivos tendem a ser boilerplate (menus/rodapés)
  const words = t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length < 40) return false;
  const unique = new Set(words);
  const uniqueRatio = unique.size / words.length;
  return uniqueRatio >= 0.22;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosineNormalized(a, b) {
  // assume a,b já normalizados (L2 = 1)
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  return dot(a, b);
}

function computeCoverageStats({ questionEmbeddings, chunkEmbeddings, threshold }) {
  const qEmb = Array.isArray(questionEmbeddings) ? questionEmbeddings : [];
  const cEmb = Array.isArray(chunkEmbeddings) ? chunkEmbeddings : [];
  const thr = Number.isFinite(Number(threshold)) ? Number(threshold) : 0.6;

  let covered = 0;
  const uncoveredIdx = [];
  for (let ci = 0; ci < cEmb.length; ci++) {
    let best = -1;
    for (let qi = 0; qi < qEmb.length; qi++) {
      const sim = cosineNormalized(qEmb[qi], cEmb[ci]);
      if (sim > best) best = sim;
      if (best >= thr) break;
    }
    if (best >= thr) covered += 1;
    else uncoveredIdx.push(ci);
  }

  const ratio = cEmb.length ? clamp01(covered / cEmb.length) : 0;
  return { ratio, covered, total: cEmb.length, uncoveredIdx };
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

  // k-means++ (simplificado) usando distância (1 - cos)
  const centroids = [];
  const usedIdx = new Set();
  let firstIdx = 0;
  centroids.push(embeddings[firstIdx]);
  usedIdx.add(firstIdx);

  while (centroids.length < k) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      if (usedIdx.has(i)) continue;
      // distância ao centroide mais próximo
      let minDist = Infinity;
      for (const c of centroids) {
        const sim = cosineNormalized(embeddings[i], c);
        const dist = 1 - sim;
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

  // Preenche caso falte
  while (centroids.length < k) centroids.push(new Array(dim).fill(0));

  let assignments = new Array(n).fill(0);
  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;

    // assign
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

    // recompute
    const grouped = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) grouped[assignments[i]].push(embeddings[i]);

    for (let c = 0; c < k; c++) {
      if (grouped[c].length === 0) continue;
      const m = meanVector(grouped[c]);
      if (!m) continue;
      // normaliza para manter cos consistente
      centroids[c] = normalizeEmbedding(m);
    }

    if (!changed) break;
  }

  return { assignments, centroids };
}

function flattenFaq(faq) {
  const out = [];
  for (const group of Array.isArray(faq) ? faq : []) {
    for (const q of Array.isArray(group?.questions) ? group.questions : []) out.push(safeString(q));
  }
  return out;
}

async function inferCategoryNamesWithAI({ tenantId, clusters }) {
  const prompt = [
    'Você vai nomear categorias de FAQ.',
    '',
    'REGRAS:',
    '- Responda APENAS com JSON (um array de strings).',
    '- 2 a 5 palavras por categoria.',
    '- Em Português.',
    '- Totalmente generalista: não assuma tipo de negócio.',
    '- Baseie-se SOMENTE nas perguntas de cada grupo.',
    '',
    'GRUPOS (cada item tem exemplos de perguntas):',
    JSON.stringify(
      clusters.map((c) => ({
        examples: (Array.isArray(c?.questions) ? c.questions : []).slice(0, 6),
      })),
      null,
      2
    ),
  ].join('\n');

  const r = await generateAiResponse(prompt, tenantId, {});
  const raw = safeString(r?.text || '').trim();

  // Tenta extrair JSON de dentro do texto
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) return null;
  const names = parsed.map((s) => safeString(s).trim()).filter(Boolean);
  if (names.length !== clusters.length) return null;
  return names;
}

function inferCategoryNameDeterministic(questions) {
  const text = (Array.isArray(questions) ? questions : []).join(' ').toLowerCase();
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const stop = new Set([
    'como', 'que', 'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'para', 'por', 'em', 'no', 'na',
    'e', 'ou', 'se', 'com', 'sem', 'sobre', 'qual', 'quais', 'onde', 'quando', 'quanto', 'é', 'são', 'ser', 'ficar',
    'minha', 'meu', 'minhas', 'meus', 'você', 'vocês',
  ]);

  const freq = new Map();
  for (const w of words) {
    if (w.length < 4) continue;
    if (stop.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
  if (top.length === 0) return 'Outros';
  return top.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' / ');
}

/**
 * Gera FAQ agrupado por categoria, ordenado por relevância e com score de cobertura.
 *
 * @param {{
 *  tenantId: string,
 *  name?: string|null,
 *  urls?: string[],
 *  fileNames?: string[],
 *  chunks?: Array<{sourceType?: string, sourceId?: string|null, text?: string, excerpt?: string}>,
 *  executionId?: string|null,
 *  contextMode?: 'auto'|'persisted'|'ephemeral',
 *  rules?: any,
 * }} input
 */
async function generateFaq(input) {
  const tenantId = safeString(input?.tenantId).trim();
  if (!tenantId) throw new Error('tenantId é obrigatório');
  const dryRun = input?.dryRun === true;

  const { contextSources, used } = await resolveContextSources(input);
  const sources = Array.isArray(contextSources) ? contextSources : [];
  const fallbackDescription = safeString(input?.description || '').trim();

  // Prepara texto dos chunks para embeddings/coverage.
  // Importante: evita strings vazias (isso quebrava o alinhamento com embeddings) e reduz ruído para a métrica.
  const chunkTextsAll = sources
    .map((s) => safeString(s?.text || s?.excerpt || '').trim())
    .filter(Boolean);
  const relevantIdx = [];
  for (let i = 0; i < chunkTextsAll.length; i++) {
    if (isRelevantChunkText(chunkTextsAll[i])) relevantIdx.push(i);
  }
  const allIdx = chunkTextsAll.map((_, i) => i);
  const effectiveIdx = relevantIdx.length >= 3 ? relevantIdx : allIdx;
  const chunkCoverageMode = relevantIdx.length >= 3 ? 'relevant' : 'all';

  // Base rules (fallback). As regras finais são derivadas do contexto do tenant (não fixas).
  const baseRules = (input?.rules && typeof input.rules === 'object')
    ? input.rules
    : getDefaultQuestionGenerationRules();

  // 1) Geração de perguntas (maximal e generalista) a partir dos trechos
  const suggested = [];
  const aggregatedText = sources
    .map((s) => safeString(s?.text || s?.excerpt || '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 24000);

  // ============================================================
  // Exclusions: remove ruído técnico (best-effort, dinâmico)
  // Pipeline:
  // ragContext → sanitize → exclusions = inferExclusions → generate → filterQuestions → semanticDedup
  // ============================================================
  const sanitizedAggregatedText = exclusionsService.sanitizeContext(aggregatedText);
  const { finalExclusions } = await exclusionsService.getFinalExclusions(sanitizedAggregatedText, tenantId, { dryRun });
  const exclusions = exclusionsService.augmentExclusions(
    Array.isArray(finalExclusions) ? finalExclusions : [],
    { fileNames: Array.isArray(input?.fileNames) ? input.fileNames : [] }
  );

  // Regras derivadas do domínio a partir do contexto real (PDF/OCR/scraping).
  // Isso substitui a necessidade de um JSON fixo por domínio.
  const rules = questionGenerationRulesService.deriveQuestionGenerationRulesFromContext({
    tenantName: safeString(input?.name || '').trim(),
    contextText: sanitizedAggregatedText,
    baseRules,
  });

  // ============================================================
  // Novo pipeline: RAG → limpeza → tópicos/entidades → categorias → perguntas
  // ============================================================
  let semantic = null;
  try {
    semantic = await extractSemanticContext({
      tenantId,
      executionId: safeString(input?.executionId || '').trim() || null,
      dryRun,
      name: safeString(input?.name || '').trim() || null,
      urls: Array.isArray(input?.urls) ? input.urls : [],
      fileNames: Array.isArray(input?.fileNames) ? input.fileNames : [],
      chunks: Array.isArray(input?.chunks) ? input.chunks : [],
      contextMode: input?.contextMode,
    });
  } catch (err) {
    // best-effort: segue com gerador antigo
    logger.warn('[FAQ] Falha ao extrair contexto semântico; usando pipeline legado (best-effort)', {
      tenantId,
      error: err?.message || safeString(err),
    });
    semantic = null;
  }

  if (semantic && semantic.cleanText && semantic.cleanText.length >= 50) {
    const businessType = detectBusinessType(semantic);
    const qs = generateQuestionsFromContext({
      context: semantic,
      businessType,
      limits: { maxQuestions: 110, minQuestionsIfRich: 20 },
    });
    if (Array.isArray(qs) && qs.length > 0) suggested.push(...qs);
  } else {
    // Fallback legado: usa chunks + regras derivadas
    if (aggregatedText.length >= 50) {
      const boostedRules = {
        ...rules,
        limits: {
          ...(rules?.limits || {}),
          maxQuestionsPerDocument: 45,
          maxQuestionsFromKeywords: 45,
          maxQuestionsFromContent: 18,
        },
      };
      const agg = generateQuestionsFromContent(safeString(input?.name || '').trim(), aggregatedText, boostedRules);
      if (Array.isArray(agg) && agg.length > 0) suggested.push(...agg);
    }

    for (const s of sources) {
      const title = safeString(s?.sourceId || '').trim();
      const content = safeString(s?.text || s?.excerpt || '').trim();
      if (!content) continue;
      const q = generateQuestionsFromContent(title, content, rules);
      if (Array.isArray(q) && q.length > 0) suggested.push(...q);
      if (suggested.length >= 140) break;
    }
  }

  // Fallback: sem chunks suficientes, usa descrição (mantém comportamento "generalista")
  if (suggested.length === 0 && fallbackDescription.length >= 10) {
    const local = generateQuestionsFromContent(safeString(input?.name || '').trim(), fallbackDescription, rules);
    if (Array.isArray(local) && local.length > 0) suggested.push(...local);
  }

  // Aumenta o teto para permitir "perguntas reais" (30–90) antes da dedup semântica/clusterização.
  const rawQuestions = mergeUniqueQuestions([], suggested, 160).slice(0, 90);
  const filteredQuestions = exclusionsService.filterQuestions(rawQuestions, exclusions);
  let questionsForPipeline = (Array.isArray(filteredQuestions) && filteredQuestions.length > 0)
    ? filteredQuestions
    : rawQuestions;

  if (questionsForPipeline.length === 0) {
    logger.info('FAQ coverage:', 0);
    return {
      faq: [{ category: 'Outros', questions: [] }],
      flatQuestions: [],
      coverage: 0,
      exclusions,
      meta: { usedContext: used, chunks: sources.length, exclusions },
    };
  }

  // 2) Embeddings (reaproveita modelo do RAG)
  let questionEmb = null;
  let chunkEmbAll = null;
  let coverageBoostMeta = null;
  try {
    const [qRes, cRes] = await Promise.all([
      ragService.generateEmbeddingsBatch(questionsForPipeline, tenantId, { timeoutMs: 15000 }),
      ragService.generateEmbeddingsBatch(chunkTextsAll, tenantId, { timeoutMs: 15000 }),
    ]);
    if (qRes.success && Array.isArray(qRes.embeddings) && qRes.embeddings.length === questionsForPipeline.length) {
      questionEmb = qRes.embeddings.map((e) => normalizeEmbedding(e));
    }
    if (cRes.success && Array.isArray(cRes.embeddings)) {
      if (cRes.embeddings.length === chunkTextsAll.length) chunkEmbAll = cRes.embeddings.map((e) => normalizeEmbedding(e));
    }

    // 2.1) Coverage boost (best-effort):
    // Gera algumas perguntas adicionais para chunks ainda não cobertos, para aumentar utilidade e reduzir “buracos”.
    const enableCoverageBoost = String(process.env.FAQ_ENABLE_COVERAGE_BOOST || 'true').toLowerCase() !== 'false';
    if (enableCoverageBoost && questionEmb && chunkEmbAll && chunkEmbAll.length >= 3) {
      const BOOST_THRESHOLD = Number.isFinite(Number(process.env.FAQ_COVERAGE_BOOST_THRESHOLD))
        ? Number(process.env.FAQ_COVERAGE_BOOST_THRESHOLD)
        : 0.6;
      // Evita “boost” em boilerplate: tenta priorizar apenas chunks relevantes quando houver massa crítica.
      const boostIdx = relevantIdx.length >= 3 ? relevantIdx : allIdx;
      const boostChunkEmb = boostIdx.map((i) => chunkEmbAll[i]).filter(Boolean);
      const statsBefore = computeCoverageStats({ questionEmbeddings: questionEmb, chunkEmbeddings: boostChunkEmb, threshold: BOOST_THRESHOLD });
      const maxChunks = Number.isFinite(Number(process.env.FAQ_COVERAGE_BOOST_MAX_CHUNKS))
        ? Math.max(0, Number(process.env.FAQ_COVERAGE_BOOST_MAX_CHUNKS))
        : 8;
      const maxExtra = Number.isFinite(Number(process.env.FAQ_COVERAGE_BOOST_MAX_EXTRA_QUESTIONS))
        ? Math.max(0, Number(process.env.FAQ_COVERAGE_BOOST_MAX_EXTRA_QUESTIONS))
        : 18;

      if (statsBefore.uncoveredIdx.length > 0 && maxChunks > 0 && maxExtra > 0) {
        const extraCandidates = [];
        for (const localIdx of statsBefore.uncoveredIdx.slice(0, maxChunks)) {
          const globalIdx = boostIdx[localIdx];
          const chunkText = safeString(chunkTextsAll[globalIdx] || '').trim();
          if (!chunkText) continue;
          // Sanitiza para evitar “Texto extraído (OCR)” e ruídos similares virarem “conceitos”
          // (e reduz chance de gerar perguntas do tipo "Como funciona texto extraido?")
          const sanitizedSnippet = exclusionsService.sanitizeContext(chunkText);
          // Limita tamanho para manter geração rápida e evitar perguntas “ensaboando o chunk inteiro”
          const snippet = safeString(sanitizedSnippet || '').trim().slice(0, 2200);
          if (!snippet) continue;
          const qs = generateQuestionsFromContent('Contexto do tenant', snippet, rules);
          if (Array.isArray(qs) && qs.length > 0) extraCandidates.push(...qs.slice(0, 8));
          if (extraCandidates.length >= maxExtra * 2) break;
        }

        const extraDedup = mergeUniqueQuestions([], extraCandidates, maxExtra).slice(0, maxExtra);
        const extraFiltered = exclusionsService.filterQuestions(extraDedup, exclusions);

        const beforeLen = questionsForPipeline.length;
        const merged = mergeUniqueQuestions(questionsForPipeline, extraFiltered, Math.max(120, beforeLen + maxExtra)).slice(0, 120);
        const added = Math.max(0, merged.length - beforeLen);
        if (added > 0) {
          questionsForPipeline = merged;
          // Recalcula embeddings das perguntas (chunks ficam os mesmos)
          const q2 = await ragService.generateEmbeddingsBatch(questionsForPipeline, tenantId, { timeoutMs: 20000 });
          if (q2.success && Array.isArray(q2.embeddings) && q2.embeddings.length === questionsForPipeline.length) {
            questionEmb = q2.embeddings.map((e) => normalizeEmbedding(e));
          }
        }

        coverageBoostMeta = {
          enabled: true,
          threshold: BOOST_THRESHOLD,
          uncoveredChunksBefore: statsBefore.uncoveredIdx.length,
          extraQuestionsAdded: added,
          boostMode: relevantIdx.length >= 3 ? 'relevant' : 'all',
        };
      } else {
        coverageBoostMeta = {
          enabled: true,
          threshold: BOOST_THRESHOLD,
          uncoveredChunksBefore: statsBefore.uncoveredIdx.length,
          extraQuestionsAdded: 0,
          boostMode: relevantIdx.length >= 3 ? 'relevant' : 'all',
        };
      }
    }
  } catch (err) {
    logger.warn('[FAQ] Falha ao gerar embeddings; degradando para agrupamento simples', { tenantId, error: err.message });
    questionEmb = null;
    chunkEmbAll = null;
  }

  // Se não há embeddings, retorna 1 cluster (mantém compatibilidade e não quebra UI)
  if (!questionEmb || !chunkEmbAll || chunkEmbAll.length === 0) {
    const faq = [{ category: 'Outros', questions: questionsForPipeline }];
    logger.info('FAQ coverage:', 0);
    return {
      faq,
      flatQuestions: questionsForPipeline,
      coverage: 0,
      exclusions,
      meta: {
        usedContext: used,
        chunks: sources.length,
        chunkTextsAll: chunkTextsAll.length,
        chunkTextsEffective: effectiveIdx.length,
        chunkCoverageMode,
        coverageModeUsed: 'all',
        coverageAll: 0,
        coverageRelevant: 0,
        coverageBoost: coverageBoostMeta,
        degraded: true,
        exclusions,
      },
    };
  }

  // 3) Deduplicação semântica (greedy)
  const SEMANTIC_DEDUP_THRESHOLD = Number.isFinite(Number(process.env.FAQ_SEMANTIC_DEDUP_THRESHOLD))
    ? Number(process.env.FAQ_SEMANTIC_DEDUP_THRESHOLD)
    : 0.88;

  const keptQuestions = [];
  const keptEmbeddings = [];
  for (let i = 0; i < questionsForPipeline.length; i++) {
    const emb = questionEmb[i];
    let maxSim = 0;
    for (const prev of keptEmbeddings) {
      const sim = cosineNormalized(emb, prev);
      if (sim > maxSim) maxSim = sim;
      if (maxSim >= SEMANTIC_DEDUP_THRESHOLD) break;
    }
    if (maxSim < SEMANTIC_DEDUP_THRESHOLD) {
      keptQuestions.push(questionsForPipeline[i]);
      keptEmbeddings.push(emb);
    }
  }

  // 4) Score de relevância: média da similaridade com todos os chunks
  const questionScores = keptEmbeddings.map((qEmb) => {
    let sum = 0;
    for (const cEmb of chunkEmbAll) sum += cosineNormalized(qEmb, cEmb);
    return chunkEmbAll.length ? sum / chunkEmbAll.length : 0;
  });

  // 5) Clusterização leve (k-means)
  const k = pickK(keptQuestions.length);
  const { assignments } = kmeansCosine(keptEmbeddings, k);

  const clusters = Array.from({ length: k }, () => ({ questions: [], scores: [] }));
  for (let i = 0; i < keptQuestions.length; i++) {
    const c = Number.isFinite(assignments[i]) ? assignments[i] : 0;
    clusters[c].questions.push(keptQuestions[i]);
    clusters[c].scores.push(questionScores[i]);
  }

  // Remove clusters vazios (raros, mas pode acontecer)
  const nonEmpty = clusters.filter((c) => c.questions.length > 0);

  // 6) Ordena perguntas dentro do cluster por score desc
  const enrichedClusters = nonEmpty.map((c) => {
    const items = c.questions.map((q, idx) => ({ q, score: c.scores[idx] }));
    items.sort((a, b) => b.score - a.score);
    return {
      questions: items.map((it) => it.q),
      scores: items.map((it) => it.score),
      clusterScore: items.length ? items[0].score : 0,
    };
  });

  // Ordena clusters por relevância global
  enrichedClusters.sort((a, b) => b.clusterScore - a.clusterScore);

  // 7) Inferir labels (best-effort via IA; fallback determinístico)
  let categoryNames = null;
  try {
    categoryNames = await inferCategoryNamesWithAI({ tenantId, clusters: enrichedClusters });
  } catch (err) {
    logger.debug('[FAQ] Falha ao inferir labels via IA; fallback determinístico', { tenantId, error: err.message });
    categoryNames = null;
  }

  const faq = enrichedClusters.map((c, idx) => ({
    category: categoryNames?.[idx] || inferCategoryNameDeterministic(c.questions),
    questions: c.questions,
  }));

  // 8) Coverage:
  // - coverageAll: % de TODOS os chunks (não vazios) com pelo menos uma pergunta com similaridade >= threshold
  // - coverageRelevant: % dos chunks “relevantes” (heurística) com pelo menos uma pergunta com similaridade >= threshold
  // Por padrão, expomos coverage = coverageAll para evitar “cair” quando o conjunto relevante muda.
  const COVERAGE_THRESHOLD = 0.6;
  const statsAll = computeCoverageStats({ questionEmbeddings: keptEmbeddings, chunkEmbeddings: chunkEmbAll, threshold: COVERAGE_THRESHOLD });
  const chunkEmbRelevant = relevantIdx.length ? relevantIdx.map((i) => chunkEmbAll[i]).filter(Boolean) : [];
  const statsRelevant = computeCoverageStats({ questionEmbeddings: keptEmbeddings, chunkEmbeddings: chunkEmbRelevant, threshold: COVERAGE_THRESHOLD });
  const coverage = statsAll.ratio;
  logger.info('FAQ coverage:', coverage, { coverageAll: statsAll.ratio, coverageRelevant: statsRelevant.ratio });

  return {
    faq,
    flatQuestions: flattenFaq(faq),
    coverage,
    exclusions,
    meta: {
      usedContext: used,
      chunks: sources.length,
      chunkTextsAll: chunkTextsAll.length,
      chunkTextsEffective: effectiveIdx.length,
      chunkCoverageMode,
      coverageModeUsed: 'all',
      coverageAll: statsAll.ratio,
      coverageRelevant: statsRelevant.ratio,
      coverageBoost: coverageBoostMeta,
      questions: rawQuestions.length,
      questionsAfterFilter: questionsForPipeline.length,
      questionsAfterDedup: keptQuestions.length,
      k,
      exclusions,
    },
  };
}

module.exports = {
  generateFaq,
  // Exporta internos para reuso por serviços (ex.: grafo inicial) sem duplicar lógica.
  // Não é uma API pública estável.
  _internal: {
    resolveContextSources,
  },
};

