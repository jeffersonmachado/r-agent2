import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Store opcional para controles de simulação (play/pause, step).
 * Mantido separado do estado de dados de simulação em si, que
 * continua no `editorStore`.
 */

const SimulationContext = createContext(null);

export function SimulationProvider({ children }) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const goToStep = useCallback((index) => {
    setCurrentStepIndex(index);
  }, []);

  const value = useMemo(
    () => ({
      currentStepIndex,
      isPlaying,
      play,
      pause,
      goToStep,
    }),
    [currentStepIndex, isPlaying, goToStep, pause, play],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulationControls() {
  const ctx = useContext(SimulationContext);
  if (!ctx) {
    throw new Error('useSimulationControls deve ser usado dentro de um <SimulationProvider>');
  }
  return ctx;
}


