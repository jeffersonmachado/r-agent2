'use strict';

/**
 * Regra do gate de evidência de runtime do Ask AI — pura, para poder ser testada.
 *
 * O validador só lê arquivo + escreve relatório; a DECISÃO mora aqui. Um gate
 * que não consegue falhar foi exatamente o que deixou a evidência de 20/09 passar
 * enquanto o copiloto estava degradado (2026-10-08).
 */

const GENERATION_CHECK_ID = 'first_turn_answer_generated';

/**
 * @param {object} input
 * @param {object|null} input.evidence conteúdo do relatório de runtime
 * @param {string|null} [input.readError] erro ao ler o arquivo (ausente/ilegível)
 * @param {number} input.maxAgeMs TTL da evidência
 * @param {number} input.now timestamp atual (ms)
 * @returns {{violations: Array<object>, evidenceAgeMs: number|null, generationCheck: object|null}}
 */
function evaluateRuntimeEvidence({ evidence, readError = null, maxAgeMs, now }) {
  const violations = [];
  let evidenceAgeMs = null;
  let generationCheck = null;

  if (!evidence) {
    violations.push({
      code: 'ASK_AI_RUNTIME_EVIDENCE_MISSING',
      detail: `evidência de runtime ausente ou ilegível: ${readError || 'arquivo inexistente'}`,
    });
    return { violations, evidenceAgeMs, generationCheck };
  }

  const generatedAtMs = Date.parse(evidence.generatedAt || '');
  if (Number.isFinite(generatedAtMs)) {
    evidenceAgeMs = Math.max(0, now - generatedAtMs);
  }

  if (evidence.status !== 'PASS') {
    violations.push({
      code: 'ASK_AI_RUNTIME_EVIDENCE_FAILED',
      detail: `evidência com status=${evidence.status || '(vazio)'} — o copiloto não foi provado em runtime`,
      failedChecks: (evidence.checks || []).filter((c) => c.status !== 'PASS').map((c) => c.id),
    });
  }

  generationCheck = (evidence.checks || []).find((check) => check.id === GENERATION_CHECK_ID) || null;
  if (!generationCheck) {
    violations.push({
      code: 'ASK_AI_RUNTIME_EVIDENCE_WITHOUT_GENERATION_CHECK',
      detail: `a evidência não contém o check ${GENERATION_CHECK_ID}: nada prova que a resposta foi SINTETIZADA (não é trecho recuperado)`,
    });
  } else if (generationCheck.status !== 'PASS') {
    violations.push({
      code: 'ASK_AI_RUNTIME_EVIDENCE_GENERATION_FAILED',
      detail: `${GENERATION_CHECK_ID}=${generationCheck.status} — resposta degradada (trecho recuperado no lugar de resposta gerada)`,
      detail_payload: generationCheck.detail || null,
    });
  }

  if (evidenceAgeMs === null) {
    violations.push({
      code: 'ASK_AI_RUNTIME_EVIDENCE_UNDATED',
      detail: 'evidência sem generatedAt válido: idade não é verificável',
    });
  } else if (evidenceAgeMs > maxAgeMs) {
    violations.push({
      code: 'ASK_AI_RUNTIME_EVIDENCE_STALE',
      detail: `evidência com ${(evidenceAgeMs / 3600000).toFixed(1)}h (TTL ${(maxAgeMs / 3600000).toFixed(1)}h) — refresque com: ASKAI_VERIFY_USER=… ASKAI_VERIFY_PASSWORD=… npm run verify:ask-ai-copilot:runtime`,
    });
  }

  return { violations, evidenceAgeMs, generationCheck };
}

module.exports = { GENERATION_CHECK_ID, evaluateRuntimeEvidence };
