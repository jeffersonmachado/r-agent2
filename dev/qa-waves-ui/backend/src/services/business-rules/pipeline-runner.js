/**
 * PipelineRunner — Orquestra a execução completa do pipeline de regras de negócio.
 *
 * Fluxo:
 *  1. Recebe PipelineInput (entities + relationships + sourceFiles)
 *  2. FlowInferencer.infer() → regras + fluxos
 *  3. CoverageEvaluator.evaluate() → fluxos com cobertura + gaps
 *  4. Monta BusinessRulesState
 */

import { infer } from './flow-inferencer.js';
import { evaluate } from './coverage-evaluator.js';

/**
 * @param {Object} input — PipelineInput
 * @param {Array} input.entities
 * @param {Array} input.relationships
 * @param {Object<string, string[]>} [input.sourceFiles]
 * @param {string} [input.sourceLabel]
 * @returns {Object} BusinessRulesState
 */
export function run(input) {
  if (!input || !Array.isArray(input.entities) || !Array.isArray(input.relationships)) {
    throw new Error('PipelineInput invalido: entities e relationships sao obrigatorios');
  }

  const { rules, flows } = infer(input.entities, input.relationships);
  const { flowsWithCoverage, gaps } = evaluate(flows, input.sourceFiles || {});

  const rulesEvaluated = rules.length;
  const rulesOk = rules.length - gaps.length;
  const rulesBroken = gaps.length;

  let recommendation;
  if (gaps.length === 0) {
    recommendation = 'Nenhum gap detectado. Todos os fluxos possuem cobertura completa.';
  } else if (gaps.length <= 2) {
    recommendation = `${gaps.length} gap(s) detectado(s). Recomenda-se criar os programas ausentes antes da proxima release.`;
  } else {
    recommendation = `${gaps.length} gaps detectados. Priorize as entidades criticas (raizes de fluxo) antes de avancar.`;
  }

  const sourceInfo = input.sourceLabel
    || `${input.entities.length} entidades, ${input.relationships.length} relacoes`;

  return {
    rulesEvaluated,
    rulesOk,
    rulesBroken,
    gaps,
    flows: flowsWithCoverage,
    recommendation,
    sourceInfo
  };
}

export default { run };
