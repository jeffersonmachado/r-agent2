'use strict';

/**
 * Classificação ÚNICA de erros de IA que são do CLIENTE/contrato (400
 * estruturado) e não falha interna (500).
 *
 * Motivação — defeito medido no QA Mesh `mesh-2026-10-19T18-38-34-650Z`,
 * cenário `business-core-biz-flows-editor` (domínio crítico `core`):
 *
 *   "500 Internal Server Error: Provider de IA 'qwen' indisponível
 *    (circuit breaker aberto)."
 *
 * Os handlers de geração já tratavam `AI_PROVIDER_NOT_CONFIGURED` e
 * `AI_GENERATION_FAILED` como 400 estruturado ("nunca 500", decisão registrada
 * no próprio código), mas a lista era DUPLICADA em quatro pontos e NÃO incluía
 * `provider_circuit_open` — o código emitido por
 * `api/services/aiControlPlaneStatus.js` quando o breaker do provider abre.
 * Resultado: indisponibilidade de provider virava `internal_error` (500),
 * o cenário de contrato reprovava e o selo abortava no `prepare`.
 *
 * A lista vive AQUI para não divergir de novo: quem trata erro de IA importa
 * daqui em vez de repetir o `if`.
 */

const AI_STRUCTURED_ERROR_CODES = new Set([
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  // Tenant sem credencial de IA — configuração do cliente, não bug do servidor.
  'AI_PROVIDER_NOT_CONFIGURED',
  // Provider indisponível/resposta inválida — falha agregada esperada.
  'AI_GENERATION_FAILED',
  // Breaker do provider aberto (api/services/aiControlPlaneStatus.js). É a
  // MESMA classe de indisponibilidade de `AI_GENERATION_FAILED`; ficar de fora
  // era o defeito que produzia 500 e derrubava o gate.
  'provider_circuit_open',
]);

/**
 * @param {any} err erro capturado em handler de geração por IA
 * @returns {boolean} true quando a resposta correta é 400 estruturado
 */
function isStructuredAiClientError(err) {
  const code = err && err.code;
  if (typeof code !== 'string' || !code) return false;
  if (AI_STRUCTURED_ERROR_CODES.has(code)) return true;
  // FLOW_* vem do flowPreValidator (ex.: FLOW_DISCONNECTED — nós não
  // alcançáveis a partir do start): erro do fluxo gerado, não falha interna.
  return code.startsWith('FLOW_');
}

module.exports = {
  AI_STRUCTURED_ERROR_CODES,
  isStructuredAiClientError,
};
