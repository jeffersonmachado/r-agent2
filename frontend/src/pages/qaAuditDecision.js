/**
 * Derivação de veredito nas telas de auditoria QA.
 *
 * Regra: **não existe veredito sem dado**. Antes, estes dois pontos fabricavam
 * decisão a partir da ausência de informação:
 *   - `j.decision || j.goNoGo || (failed === 0 ? 'GO' : 'NO_GO')` na linha da
 *     tabela — um registro de jornada sem decisão gravada aparecia como **GO**
 *     (porque `failed` cai para 0 via `j.failed || 0`);
 *   - `latest.goNoGo || latest.decision || (latest.status === 'GO' ? 'GO' : 'NO_GO')`
 *     no resumo — sem NENHUM registro (`latest = {}`) a tela exibia **NO_GO**,
 *     que parece falha medida quando na verdade não há execução nenhuma.
 *
 * Verificado antes da correção: os 7 registros reais em `qa-mesh/meshHistory/`
 * possuem campo de decisão, então o fallback da linha não era atingido — era
 * risco latente, não defeito presente. O resumo, porém, fabricava NO_GO sempre
 * que não houvesse histórico (estado vazio).
 */

export const NO_VERDICT = '—';

/**
 * Decisão de uma jornada monitorada. Só devolve GO/NO_GO se algo foi REGISTRADO.
 * @param {Object} journey - Registro de jornada (decision/goNoGo)
 * @returns {string} decisão registrada ou NO_VERDICT
 */
export function resolveJourneyDecision(journey = {}) {
  if (!journey || typeof journey !== 'object') return NO_VERDICT;
  return journey.decision || journey.goNoGo || NO_VERDICT;
}

/**
 * Decisão do resumo do mesh. Sem registro algum, não há veredito.
 * @param {Object} latest - Registro mais recente (goNoGo/decision/status)
 * @returns {string} decisão registrada ou NO_VERDICT
 */
export function resolveMeshDecision(latest = {}) {
  if (!latest || typeof latest !== 'object') return NO_VERDICT;
  return latest.goNoGo || latest.decision || latest.status || NO_VERDICT;
}

/**
 * Tom visual da decisão: apenas GO é positivo; NO_VERDICT é neutro (não é falha).
 * @param {string} decision
 * @returns {string} classe CSS de cor
 */
export function decisionToneClass(decision) {
  if (decision === 'GO') return 'text-green-400';
  if (decision === NO_VERDICT || !decision) return 'text-text-secondary';
  return 'text-red-400';
}
