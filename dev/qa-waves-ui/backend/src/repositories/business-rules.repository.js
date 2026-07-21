/**
 * Business Rules Repository — Persistência em memória (mock).
 * Segue o padrão de stateRepository.js.
 */

let state = null;

/**
 * Retorna o BusinessRulesState atual ou null se nunca executado.
 */
export function getLatestState() {
  return state;
}

/**
 * Salva o estado em memória.
 */
export function saveState(newState) {
  state = {
    ...newState,
    gaps: (newState.gaps || []).map((g) => ({ ...g })),
    flows: (newState.flows || []).map((f) => ({
      ...f,
      steps: (f.steps || []).map((s) => ({ ...s }))
    }))
  };
  return state;
}

/**
 * Lista gaps com filtros opcionais.
 */
export function getGaps(filters = {}) {
  const current = getLatestState();
  if (!current) return [];

  let gaps = current.gaps || [];

  if (filters.status) {
    const statuses = filters.status.split(',').map((s) => s.trim());
    gaps = gaps.filter((g) => statuses.includes(g.status));
  }

  if (filters.severity) {
    const severities = filters.severity.split(',').map((s) => s.trim());
    gaps = gaps.filter((g) => severities.includes(g.severity));
  }

  return gaps;
}

/**
 * Atualiza status (e opcionalmente notas) de um gap.
 */
export function updateGap(gapId, updates = {}) {
  const current = getLatestState();
  if (!current) return null;

  const gap = (current.gaps || []).find((g) => g.gapId === gapId);
  if (!gap) return null;

  if (updates.status) {
    gap.status = updates.status;
  }
  if (updates.notes !== undefined) {
    gap.notes = updates.notes;
  }

  saveState(current);
  return gap;
}

/**
 * Reseta o estado (útil para testes).
 */
export function clearState() {
  state = null;
}

export default { getLatestState, saveState, getGaps, updateGap, clearState };
