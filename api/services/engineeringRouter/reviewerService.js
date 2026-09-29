'use strict';

/**
 * api/services/engineeringRouter/reviewerService.js
 *
 * Monta o prompt do REVIEWER (executado somente após o estágio determinístico de teste ter
 * passado — nunca antes) e exige decisão estruturada APPROVE/REJECT com findings
 * classificados. O reviewer NUNCA pode sobrepor um exitCode de teste real; ele só avalia
 * qualidade/segurança/arquitetura do diff já testado.
 */

const { invokeModel } = require('./engineeringAiInvoker');
const { parseStructuredJson } = require('../../../engine/engineeringRouter/responseParsing');
const { FAILURE_CODES, REVIEW_DECISIONS, FINDING_SEVERITIES } = require('../../../engine/engineeringRouter/constants');

const SYSTEM_CONTRACT = `Você é o REVIEWER independente de um pipeline automatizado de engenharia.
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, no formato exato:
{
  "decision": "APPROVE" | "REJECT",
  "findings": [
    {
      "severity": "BLOCKER" | "REGRESSION" | "POST_RELEASE",
      "category": "<categoria curta>",
      "description": "<descrição do problema>",
      "file": "<caminho ou null>",
      "line": <número ou null>,
      "releaseBlocking": <true|false>,
      "evidence": "<trecho do diff ou teste que sustenta o achado>"
    }
  ]
}
Regras obrigatórias:
- Os testes determinísticos já passaram (exitCode 0) antes desta revisão chegar até você — não questione o resultado do teste, avalie qualidade, segurança, arquitetura e aderência ao Task Contract.
- REJECT exige pelo menos um finding BLOCKER ou REGRESSION. Findings POST_RELEASE não bloqueiam aprovação.
- Nunca aprove um diff que toque arquivo fora de allowedPaths ou que contenha segredo.`;

function buildReviewerPrompt({ task, diff, testEvidence, contextFiles }) {
  return [
    SYSTEM_CONTRACT,
    '',
    '=== TASK CONTRACT ===',
    JSON.stringify({
      id: task.id,
      title: task.title,
      objective: task.objective,
      acceptanceCriteria: task.acceptanceCriteria,
      allowedPaths: task.allowedPaths,
      forbiddenPaths: task.forbiddenPaths,
    }, null, 2),
    '',
    '=== DIFF FINAL (já aplicado e testado) ===',
    diff,
    '',
    '=== EVIDÊNCIA DE TESTE (autoridade de PASS é o exitCode, não este texto) ===',
    JSON.stringify(testEvidence, null, 2),
    '',
    '=== ARQUIVOS DE CONTEXTO ===',
    (contextFiles || []).map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n') || '(nenhum)',
  ].join('\n');
}

function validateReviewShape(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not_object' };
  if (!REVIEW_DECISIONS.includes(value.decision)) return { ok: false, reason: 'invalid_decision' };
  if (!Array.isArray(value.findings)) return { ok: false, reason: 'findings_not_array' };
  for (const f of value.findings) {
    if (!FINDING_SEVERITIES.includes(f.severity)) return { ok: false, reason: `invalid_severity:${f.severity}` };
  }
  if (value.decision === 'REJECT') {
    const hasBlockingFinding = value.findings.some((f) => f.severity === 'BLOCKER' || f.severity === 'REGRESSION');
    if (!hasBlockingFinding) return { ok: false, reason: 'reject_without_blocking_finding' };
  }
  return { ok: true };
}

/**
 * @param {Object} params
 * @param {Object} params.task
 * @param {string} params.diff
 * @param {Object} params.testEvidence
 * @param {Object[]} [params.contextFiles]
 * @param {string} params.providerId
 * @param {string} params.modelId
 * @param {string} [params.tenantId]
 */
async function review({ task, diff, testEvidence, contextFiles, providerId, modelId, tenantId, signal = null, deadlineMeta = {} }) {
  const prompt = buildReviewerPrompt({ task, diff, testEvidence, contextFiles });
  const result = await invokeModel({
    providerId,
    modelId,
    prompt,
    tenantId,
    extraContext: { purpose: 'engineering_reviewer' },
    // Cancelamento cooperativo da TASK (lease perdido / NO_PROGRESS) chega até o transporte.
    signal,
    deadlineMeta,
  });

  const parsed = parseStructuredJson(result.text);
  if (!parsed.ok) {
    const err = new Error(`REVIEWER não retornou JSON estruturado válido (${parsed.error})`);
    err.code = FAILURE_CODES.PATCH_INVALID_FORMAT;
    err.rawResponse = result.text;
    throw err;
  }

  const shapeCheck = validateReviewShape(parsed.value);
  if (!shapeCheck.ok) {
    const err = new Error(`REVIEWER retornou JSON com formato inválido (${shapeCheck.reason})`);
    err.code = FAILURE_CODES.PATCH_INVALID_FORMAT;
    err.rawResponse = result.text;
    throw err;
  }

  return {
    decision: parsed.value.decision,
    findings: parsed.value.findings,
    raw: result.text,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}

module.exports = {
  buildReviewerPrompt,
  validateReviewShape,
  review,
};
