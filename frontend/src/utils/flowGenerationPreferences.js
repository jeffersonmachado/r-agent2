const STORAGE_KEY = 'flow_generation_prefs_v1';

export function loadFlowGenerationPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFlowGenerationPrefs(prefs) {
  try {
    if (!prefs || typeof prefs !== 'object') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort
  }
}

