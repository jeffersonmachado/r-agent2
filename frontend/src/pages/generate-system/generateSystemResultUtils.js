/** @typedef {{status: 'approved'|'approved_with_warnings'|'rejected', color: 'green'|'yellow'|'red', icon: string, label: string}} FinalStatus */

/** @typedef {{index: number, stepNumber: string, action: Record<string, unknown>, screen: Record<string, unknown>|null|undefined, timestamp: string|number|null|undefined}} ReplayStep */

/**
 * @param {Record<string, unknown>|null} result
 * @returns {FinalStatus|null}
 */
export function buildFinalStatus(result) {
  if (!result) return null;

  if (result.success && result.rpaPassed) {
    return { status: 'approved', color: 'green', icon: '🟢', label: 'APROVADO' };
  }
  if (result.success && result.warnings && result.warnings.length > 0) {
    return {
      status: 'approved_with_warnings',
      color: 'yellow',
      icon: '🟡',
      label: 'APROVADO COM WARNINGS',
    };
  }
  if (result.success && !result.rpaPassed) {
    return { status: 'rejected', color: 'red', icon: '🔴', label: 'REPROVADO' };
  }
  return { status: 'rejected', color: 'red', icon: '🔴', label: 'REPROVADO' };
}

/**
 * @param {Record<string, unknown>|null} reportData
 * @returns {ReplayStep[]}
 */
export function buildReplaySteps(reportData) {
  if (!reportData) return [];

  const replayData = reportData.replayData || reportData;
  if (!replayData) return [];

  const actions = replayData.actions || [];
  const screens = replayData.screens || [];
  if (actions.length === 0) return [];

  const screensByStep = {};
  screens.forEach((screen) => {
    if (screen.step) {
      screensByStep[screen.step] = screen;
    }
  });

  return actions.map((action, index) => {
    const stepNumber = action.step || `step-${index + 1}`;
    const screen =
      screensByStep[stepNumber] ||
      screensByStep[`step-${index + 1}`] ||
      ((screens[index] && screens[index].step === stepNumber) ? screens[index] : null) ||
      screens[index];

    return {
      index,
      stepNumber,
      action,
      screen,
      timestamp: action.timestamp || action.startTime || screen?.timestamp,
    };
  });
}
