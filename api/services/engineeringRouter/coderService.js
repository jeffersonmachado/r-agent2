'use strict';

/**
 * api/services/engineeringRouter/coderService.js
 *
 * Monta o prompt do CODER a partir do contexto real (Task Contract + arquivos + falhas
 * anteriores) e exige resposta ESTRUTURADA contendo um unified diff real — nunca aceita
 * "descreva a mudança em texto" como saída final. A validação de sintaxe/escopo do diff é
 * feita depois por `engine/engineeringRouter/patchValidator.js` (este serviço só extrai o
 * JSON e falha explicitamente se a extração falhar).
 */

const { invokeModel } = require('./engineeringAiInvoker');
const { parseStructuredJson, repairCoderResponse } = require('../../../engine/engineeringRouter/responseParsing');
const { FAILURE_CODES } = require('../../../engine/engineeringRouter/constants');

const SYSTEM_CONTRACT = `Você é o CODER de um pipeline automatizado de engenharia (Engineering Model Router).
Responda SOMENTE com um objeto JSON válido, sem nenhum texto antes ou depois, no formato exato:
{
  "summary": "<resumo curto da mudança em português>",
  "diff": "<unified diff real, formato 'diff --git a/<path> b/<path>' com hunks '@@ -l,c +l,c @@', aplicável via git apply>"
}
Regras obrigatórias:
- O campo "diff" precisa ser um unified diff de verdade (não uma descrição em linguagem natural).
- Só pode tocar arquivos dentro de allowedPaths listados no Task Contract abaixo.
- Nunca inclua segredos, chaves de API, senhas ou tokens no diff.
- Nunca inclua comandos de shell, apenas o diff de código.
- Se a tentativa anterior falhou (failureBundle presente), corrija a causa raiz indicada por stderr/failedTests.`;

function renderFilesBlock(files) {
  if (!files || files.length === 0) return '(nenhum arquivo de contexto incluído)';
  return files.map((f) => `--- arquivo: ${f.path} ---\n${f.content}`).join('\n\n');
}

function buildCoderPrompt(context) {
  const { task, files, failureBundle, previousAttemptSummary } = context;
  const parts = [
    SYSTEM_CONTRACT,
    '',
    '=== TASK CONTRACT ===',
    JSON.stringify({
      id: task.id,
      title: task.title,
      objective: task.objective,
      taskType: task.taskType,
      risk: task.risk,
      scope: task.scope,
      acceptanceCriteria: task.acceptanceCriteria,
      allowedPaths: task.allowedPaths,
      forbiddenPaths: task.forbiddenPaths,
    }, null, 2),
  ];

  if (previousAttemptSummary) {
    parts.push('', '=== TENTATIVA ANTERIOR ===', JSON.stringify(previousAttemptSummary, null, 2));
  }
  if (failureBundle) {
    parts.push('', '=== FAILURE BUNDLE (corrigir esta causa raiz) ===', JSON.stringify(failureBundle, null, 2));
  }

  parts.push('', '=== ARQUIVOS DE CONTEXTO ===', renderFilesBlock(files));
  return parts.join('\n');
}

/**
 * @param {Object} params
 * @param {Object} params.context - saída de contextBuilderService.buildContext
 * @param {string} params.providerId
 * @param {string} params.modelId
 * @param {string} [params.tenantId]
 * @returns {Promise<{summary:string, diff:string, raw:string, usage:Object|null, latencyMs:number}>}
 */
async function generatePatch({ context, providerId, modelId, tenantId }) {
  const prompt = buildCoderPrompt(context);
  const result = await invokeModel({
    providerId,
    modelId,
    prompt,
    tenantId,
    extraContext: { purpose: 'engineering_coder' },
  });

  const parsed = parseStructuredJson(result.text);
  let summary;
  let diff;

  if (parsed.ok) {
    ({ summary, diff } = parsed.value || {});
  } else {
    // Fallback de reparo: um diff que contém código-fonte com strings JSON embutidas (ex.:
    // uma tarefa TEST_GENERATION que testa um parser de JSON) pode fazer o modelo escapar as
    // aspas internas de um jeito que quebra o JSON.parse ingênuo do envelope externo, mesmo
    // com o texto sendo, na intenção, bem formado. Antes de desistir, tenta reconstruir
    // summary/diff diretamente (ver `repairCoderResponse`).
    const repaired = repairCoderResponse(result.text);
    if (!repaired) {
      const err = new Error(`CODER não retornou JSON estruturado válido (${parsed.error})`);
      err.code = FAILURE_CODES.PATCH_INVALID_FORMAT;
      err.rawResponse = result.text;
      err.usage = result.usage;
      err.latencyMs = result.latencyMs;
      throw err;
    }
    ({ summary, diff } = repaired);
  }
  if (typeof diff !== 'string' || !diff.trim()) {
    const err = new Error('CODER retornou JSON sem campo "diff" utilizável');
    err.code = FAILURE_CODES.PATCH_INVALID_FORMAT;
    err.rawResponse = result.text;
    throw err;
  }

  return {
    summary: typeof summary === 'string' ? summary : '',
    diff,
    raw: result.text,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}

module.exports = {
  buildCoderPrompt,
  generatePatch,
};
