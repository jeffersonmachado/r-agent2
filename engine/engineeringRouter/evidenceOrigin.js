'use strict';

/**
 * engine/engineeringRouter/evidenceOrigin.js
 *
 * ORIGEM DA EVIDÊNCIA do ranking de modelos.
 *
 * Achado medido (auditoria de 2026-10-07, `AI_MEMORY/evidence/2026-10-07-pool-audit-controlado.json`):
 * o histórico de `engineering_tasks`/`engineering_attempts` contém execuções de ROTINA DE TESTE
 * gravadas como tasks reais. Elas NÃO representam capacidade de modelo e, quando entram na
 * evidência empírica do roteador, distorcem a ordenação dos candidatos:
 *
 *   - `jest-review` (267 tasks) grava `status=DONE`, `error=null`, `patch_validation={}` — ou seja,
 *     parece "patch aplicado" sem nunca ter passado pelo pipeline;
 *   - com o histórico contaminado, `P(patch aplicado)` do melhor coder real aparecia como 12%
 *     (green/red = 17/31) enquanto a medição limpa do mesmo modelo mostra 45% (green/red = 64/19);
 *   - `anthropic:claude-sonnet-5`, que NÃO tem credencial e nunca executou de verdade, aparecia com
 *     37/37 aplicados e 0 falhas (tier PROVEN, P=97%) por causa dessas execuções sintéticas.
 *
 * Este módulo exclui APENAS execuções comprovadamente sintéticas, identificadas pela ORIGEM
 * (`created_by`) da task. Ele NÃO filtra — e nunca deve passar a filtrar — modelo, provider,
 * classe de custo, risco, resultado ou qualquer característica que possa favorecer um candidato
 * específico. É uma mitigação mínima enquanto não existe um campo explícito de origem na task
 * (`origin = PRODUCTION | BENCHMARK | TEST`), que é a correção definitiva.
 */

/**
 * Criadores de task que representam ROTINA DE TESTE/VERIFICAÇÃO (execução sintética).
 * Cada entrada foi derivada por medição, com o volume observado em 2026-10-07:
 *   - prefixo `jest-`: jest-review (267), jest-regression-governance-test (240),
 *     jest-task-fencing (547), jest-natural-worker (51), jest-natural (3)
 *   - `TEST` (exato): 97
 *   - `verify-real-task-recovery`: 48 (executa o pipeline para provar recuperação; os attempts
 *     não têm `patch_validation`, ou seja, não são produção)
 */
const TEST_ROUTINE_PREFIXES = Object.freeze(['jest-']);
const TEST_ROUTINE_EXACT = Object.freeze(['TEST', 'verify-real-task-recovery']);

/** @returns {boolean} true quando a task foi criada por rotina de teste/verificação. */
function isTestRoutineOrigin(createdBy) {
  if (createdBy === null || createdBy === undefined) return false;
  const value = String(createdBy);
  if (TEST_ROUTINE_EXACT.includes(value)) return true;
  return TEST_ROUTINE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Filtra as tasks de produção e aplica o teto pedido pelo chamador.
 * A ordem original (mais recentes primeiro) é preservada.
 * @param {Array<{created_by?: string}>} tasks
 * @param {number} limit
 * @returns {Array} no máximo `limit` tasks de produção
 */
function selectProductionTasks(tasks, limit) {
  const rows = Array.isArray(tasks) ? tasks : [];
  const production = rows.filter((task) => task && !isTestRoutineOrigin(task.created_by));
  const capped = Number.isInteger(limit) && limit > 0 ? production.slice(0, limit) : production;
  return capped;
}

/**
 * Fator de sobre-amostragem ao consultar o banco: como as tasks sintéticas são descartadas depois
 * da consulta, buscamos mais linhas para ainda conseguir `limit` tasks de produção.
 */
const EVIDENCE_OVERSAMPLE_FACTOR = 4;
/** Teto absoluto de linhas buscadas, para não pesar a consulta. */
const EVIDENCE_MAX_SCAN = 800;

module.exports = {
  TEST_ROUTINE_PREFIXES,
  TEST_ROUTINE_EXACT,
  EVIDENCE_OVERSAMPLE_FACTOR,
  EVIDENCE_MAX_SCAN,
  isTestRoutineOrigin,
  selectProductionTasks,
};
