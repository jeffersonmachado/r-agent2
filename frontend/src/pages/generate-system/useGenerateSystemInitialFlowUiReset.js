import { useCallback } from 'react';

export const useGenerateSystemInitialFlowUiReset = ({
  setInitialFlow,
  setInitialFlowEntities,
  setShowInitialFlowModal,
  setInitialFlowModalSize,
  lastInitialFlowSignatureRef,
  setInitialGraphLoading,
}) => {
  return useCallback(() => {
    setInitialFlow(null);
    setInitialFlowEntities(null);
    setShowInitialFlowModal(false);
    setInitialFlowModalSize({ width: null, height: null });
    lastInitialFlowSignatureRef.current = null;
    setInitialGraphLoading(false);
  }, [
    lastInitialFlowSignatureRef,
    setInitialFlow,
    setInitialFlowEntities,
    setInitialFlowModalSize,
    setInitialGraphLoading,
    setShowInitialFlowModal,
  ]);
};
