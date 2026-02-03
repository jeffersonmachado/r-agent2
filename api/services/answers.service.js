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
      regeneratedAnswers: 0,
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

/**
 * Gera respostas para perguntas usando apenas o contexto.
 *
 * @param {string} tenantId
 * @param {string[]} questions
 * @param {string} ragContext
 * @param {Object} [executionContext] - Contexto opcional (ex.: { executionId, exclusions, excludedItemsCount })
 * @returns {Promise<string[]>} answers alinhadas por índice
 */
async function generateAnswers(tenantId, questions, ragContext, executionContext = null) {
  tenantId = safeString(tenantId).trim();
  const ctx = safeString(ragContext).trim();
  const qs = Array.isArray(questions) ? questions.map((q) => safeString(q).trim()).filter(Boolean) : [];
  if (!tenantId) throw new Error('tenantId é obrigatório');
  if (qs.length === 0) return [];

  const metrics = ensureExcludedMetrics(executionContext);
  const executionId = safeString(executionContext?.executionId || '').trim() || null;
  const loweredTerms = normalizeExclusions(executionContext?.exclusions);

  return mapWithConcurrency(qs, async (question) => {
    const basePrompt = [
      'Responda usando apenas o contexto abaixo.',
      '',
      '<contexto>',
      ctx.slice(0, 18000),
      '</contexto>',
      '',
      'Pergunta:',
      question,
      '',
      'Se não houver resposta no contexto, diga:',
      '"Essa informação não está disponível no material fornecido."',
    ].join('\n');

    let ai = await generateAiResponse(basePrompt, tenantId, {});
    let answer = safeString(ai?.text || '').trim() || 'Essa informação não está disponível no material fornecido.';

    // Garantir limpeza também nas respostas: se contiver termo excluído, regenerar (máx 2 tentativas)
    const matched0 = findMatchedExclusionTerm(answer, loweredTerms);
    if (matched0) {
      let hadRegen = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        logger.warn('[answers.service] Resposta contém termo excluído; regenerando', {
          tenantId,
          executionId,
          attempt,
          matchedTerm: matched0,
          question: question.slice(0, 160),
        });

        const regenPrompt = [
          basePrompt,
          '',
          'IMPORTANTE:',
          '- A resposta anterior continha ruído técnico / termos proibidos.',
          '- Gere novamente SEM mencionar nem repetir os termos proibidos listados abaixo.',
          '- Evite nomes de arquivos, tokens OCR, lixo visual e artefatos técnicos.',
          '',
          '<termos_proibidos>',
          (Array.isArray(executionContext?.exclusions) ? executionContext.exclusions : []).slice(0, 30).join('\n'),
          '</termos_proibidos>',
        ].join('\n');

        ai = await generateAiResponse(regenPrompt, tenantId, {});
        answer = safeString(ai?.text || '').trim() || 'Essa informação não está disponível no material fornecido.';
        hadRegen = true;

        const matched = findMatchedExclusionTerm(answer, loweredTerms);
        if (!matched) break;
      }

      if (hadRegen) {
        metrics && (metrics.regeneratedAnswers += 1);
        recomputeExcludedItemsCount(executionContext);
      }

      const stillMatched = findMatchedExclusionTerm(answer, loweredTerms);
      if (stillMatched) {
        logger.error('[answers.service] Resposta ainda contém termo excluído após regeneração (best-effort)', {
          tenantId,
          executionId,
          matchedTerm: stillMatched,
          question: question.slice(0, 160),
        });
      }
    }

    return answer;
  }, 3);
}

module.exports = {
  generateAnswers,
};

