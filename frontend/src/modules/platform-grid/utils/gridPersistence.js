export function readPersistedGridState(persistenceKey, fallbackState) {
  if (!persistenceKey || typeof window === 'undefined') return fallbackState;
  try {
    const raw = window.localStorage.getItem(persistenceKey);
    if (!raw) return fallbackState;
    return { ...fallbackState, ...JSON.parse(raw) };
  } catch {
    return fallbackState;
  }
}

export function writePersistedGridState(persistenceKey, state) {
  if (!persistenceKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(persistenceKey, JSON.stringify(state));
  } catch {
    // Ignora falhas de persistencia para nao afetar a grade.
  }
}
