const { generateAiResponse } = require('./aiProviderService');
const logger = require('../utils/logger');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeExclusions(exclusions) {
  const ex = Array.isArray(exclusions) ? exclusions : [];
  return ex
    .map((t) => safeString(t).trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

function findMatchedExclusionTerm(text, loweredTerms) {
  const s = safeString(text).toLowerCase();
  if (!s || !Array.isArray(loweredTerms) || loweredTerms.length === 0) return null;
  for (const term of loweredTerms) {
    if (term && s.includes(term)) return term;
  }
  return null;
}

function ensureExcludedMetrics(executionContext) {
  if (!executionContext || typeof executionContext !== 'object') return null;
  if (!executionContext._excludedMetrics || typeof executionContext._excludedMetrics !== 'object') {
    executionContext._excludedMetrics = {
      removedQuestions: 0,
      removedExamples: 0,
      regeneratedAnswers: 0, // mantido aqui para consolidar contagem no resumo
    };
  }
  if (typeof executionContext.excludedItemsCount !== 'number') executionContext.excludedItemsCount = 0;
  return executionContext._excludedMetrics;
}

function recomputeExcludedItemsCount(executionContext) {
  const m = executionContext?._excludedMetrics;
  if (!m) return;
  const total =
    (Number(m.removedQuestions) || 0) +
    (Number(m.removedExamples) || 0) +
    (Number(m.regeneratedAnswers) || 0);
  executionContext.excludedItemsCount = total;
}

function slugifyIntentId(raw) {
  const s = safeString(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (s || 'intent').slice(0, 50);
}

async function mapWithConcurrency(items, worker, concurrency = 3) {
  const results = new Array(items.length);
  let idx = 0;

  async function run() {
    while (idx < items.length) {
      const current = idx++;
      // eslint-disable-next-line no-await-in-loop
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run);
  await Promise.all(runners);
  return results;
}

function parseVariations(text) {
  const lines = safeString(text)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/g, '').trim())
    .filter(Boolean);
  // mantém no máx 5
  return lines.slice(0, 5);
}

/**
 * Constrói intents a partir de perguntas + respostas.
 *
 * @param {string} tenantId
 * @param {string[]} questions
 * @param {string[]} answers
 * @param {Object} [executionContext] - Contexto opcional (ex.: { executionId, exclusions, excludedItemsCount })
 * @returns {Promise<Array<{id:string,question:string,examples:string[],answer:string}>>}
 */
async function buildIntents(tenantId, questions, answers, executionContext = null) {
  tenantId = safeString(tenantId).trim();
  if (!tenantId) throw new Error('tenantId é obrigatório');

  const metrics = ensureExcludedMetrics(executionContext);
  const executionId = safeString(executionContext?.executionId || '').trim() || null;
  const loweredTerms = normalizeExclusions(executionContext?.exclusions);

  const qsRaw = Array.isArray(questions) ? questions.map((q) => safeString(q).trim()).filter(Boolean) : [];
  const asRaw = Array.isArray(answers) ? answers.map((a) => safeString(a).trim()) : [];

  // 1) Remove perguntas poluídas por termos excluídos ANTES de criar intents
  const removedQuestions = [];
  const pairs = [];
  for (let i = 0; i < qsRaw.length; i++) {
    const q = qsRaw[i];
    const matched = findMatchedExclusionTerm(q, loweredTerms);
    if (matched) {
      removedQuestions.push({ question: q, matchedTerm: matched });
      continue;
    }
    pairs.push({ question: q, answer: asRaw[i] || '' });
  }

  if (removedQuestions.length > 0) {
    metrics && (metrics.removedQuestions += removedQuestions.length);
    recomputeExcludedItemsCount(executionContext);
    logger.info('[intents.service] Perguntas removidas por exclusões', {
      tenantId,
      executionId,
      removedCount: removedQuestions.length,
      removedSample: removedQuestions.slice(0, 10),
    });
  }

  async function regenerateExamples(question) {
    const prompt = [
      'Crie 5 variações naturais da pergunta abaixo sem mudar o significado.',
      'Regras:',
      '- Não incluir nomes de arquivos, tokens OCR, lixo visual ou artefatos técnicos.',
      '- NÃO mencionar nem repetir os termos proibidos listados abaixo.',
      '',
      '<termos_proibidos>',
      (Array.isArray(executionContext?.exclusions) ? executionContext.exclusions : []).slice(0, 30).join('\n'),
      '</termos_proibidos>',
      '',
      'Pergunta:',
      question,
      '',
      'Formato: uma frase por linha (sem numeração).',
    ].join('\n');
    const ai = await generateAiResponse(prompt, tenantId, {});
    return parseVariations(ai?.text || '');
  }

  const intents = await mapWithConcurrency(pairs, async ({ question, answer }) => {
    const prompt = [
      'Crie 5 variações naturais da pergunta abaixo sem mudar o significado.',
      '',
      question,
    ].join('\n');

    let examples = [];
    try {
      const ai = await generateAiResponse(prompt, tenantId, {});
      examples = parseVariations(ai?.text || '');
    } catch {
      examples = [];
    }

    // 2) Filtra exemplos que contenham termos excluídos
    const beforeFilterCount = Array.isArray(examples) ? examples.length : 0;
    if (loweredTerms.length > 0 && Array.isArray(examples) && examples.length > 0) {
      examples = examples.filter((e) => !findMatchedExclusionTerm(e, loweredTerms));
    }
    const removedExamplesCount = Math.max(0, beforeFilterCount - (Array.isArray(examples) ? examples.length : 0));
    if (removedExamplesCount > 0) {
      metrics && (metrics.removedExamples += removedExamplesCount);
      recomputeExcludedItemsCount(executionContext);
      logger.info('[intents.service] Exemplos removidos por exclusões', {
        tenantId,
        executionId,
        question: question.slice(0, 160),
        removedCount: removedExamplesCount,
      });
    }

    // 3) Se examples < 3 após filtro, regenerar via LLM (best-effort)
    // Nota: o array final ainda inclui a pergunta original (abaixo).
    if ((Array.isArray(examples) ? examples.length : 0) < 3) {
      let regen = [];
      try {
        regen = await regenerateExamples(question);
      } catch (err) {
        regen = [];
        logger.warn('[intents.service] Falha ao regenerar exemplos (best-effort)', {
          tenantId,
          executionId,
          question: question.slice(0, 160),
          error: err?.message || String(err),
        });
      }
      if (Array.isArray(regen) && regen.length > 0) {
        const regenBefore = regen.length;
        const regenFiltered = loweredTerms.length > 0 ? regen.filter((e) => !findMatchedExclusionTerm(e, loweredTerms)) : regen;
        const regenRemoved = Math.max(0, regenBefore - regenFiltered.length);
        if (regenRemoved > 0) {
          metrics && (metrics.removedExamples += regenRemoved);
          recomputeExcludedItemsCount(executionContext);
        }
        examples = regenFiltered;
      }
    }

    // garante que a pergunta original esteja presente
    const merged = [question, ...examples]
      .map((x) => safeString(x).trim())
      .filter(Boolean);
    const uniq = [];
    const seen = new Set();
    for (const e of merged) {
      const k = e.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(e);
      if (uniq.length >= 6) break;
    }

    return {
      id: slugifyIntentId(question),
      question,
      examples: uniq.slice(0, 5),
      answer: safeString(answer).trim(),
    };
  }, 3);

  return intents.filter((it) => it && it.id && (it.question || it.answer)).slice(0, 60);
}

module.exports = {
  buildIntents,
  _internal: { slugifyIntentId },
};

