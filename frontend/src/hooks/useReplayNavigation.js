import { useMemo } from 'react';

export function useReplayNavigation({ reportData, currentReplayStep, setCurrentReplayStep }) {
  const replaySteps = useMemo(() => {
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
        (screens[index] && screens[index].step === stepNumber ? screens[index] : null) ||
        screens[index];

      return {
        index,
        stepNumber,
        action,
        screen,
        timestamp: action.timestamp || action.startTime || screen?.timestamp,
      };
    });
  }, [reportData]);

  const currentStep = replaySteps[currentReplayStep];
  const totalSteps = replaySteps.length;

  const goToStep = (stepIndex) => {
    if (stepIndex >= 0 && stepIndex < totalSteps) {
      setCurrentReplayStep(stepIndex);
    }
  };

  return {
    replaySteps,
    currentStep,
    totalSteps,
    goToStep,
    goToPrevious: () => goToStep(currentReplayStep - 1),
    goToNext: () => goToStep(currentReplayStep + 1),
    goToFirst: () => goToStep(0),
    goToLast: () => goToStep(totalSteps - 1),
  };
}

export function getExecutionFinalStatus(result) {
  if (!result) return null;

  if (result.success && result.rpaPassed) {
    return { status: 'approved', color: 'green', icon: '🟢', label: 'APROVADO' };
  }
  if (result.success && result.warnings && result.warnings.length > 0) {
    return { status: 'approved_with_warnings', color: 'yellow', icon: '🟡', label: 'APROVADO COM WARNINGS' };
  }
  if (result.success && !result.rpaPassed) {
    return { status: 'rejected', color: 'red', icon: '🔴', label: 'REPROVADO' };
  }
  return { status: 'rejected', color: 'red', icon: '🔴', label: 'REPROVADO' };
}
