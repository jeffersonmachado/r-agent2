import { useCallback, useEffect, useRef, useState } from 'react';
import { executionService } from '../services/executionService';

export function useExecutionRunner(onExecutionFinished) {
  const [currentExecution, setCurrentExecution] = useState(null);
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    const executions = await executionService.listExecutions();
    setHistory(executions);
  }, []);

  useEffect(() => {
    refreshHistory().catch(() => {});
  }, [refreshHistory]);

  useEffect(() => stopPolling, [stopPolling]);

  const runSelection = useCallback(
    async ({ selectedWaveIds, selectedItemIds }) => {
      setError('');
      setRunning(true);
      try {
        const execution = await executionService.runSelection({ selectedWaveIds, selectedItemIds });
        setCurrentExecution(execution);
        await refreshHistory();

        stopPolling();
        pollRef.current = setInterval(async () => {
          const latest = await executionService.getExecution(execution.executionId);
          setCurrentExecution(latest);
          await refreshHistory();

          if (latest.finishedAt) {
            setRunning(false);
            stopPolling();
            if (onExecutionFinished) onExecutionFinished(latest);
          }
        }, 800);
      } catch (err) {
        setRunning(false);
        setError(err.message || 'Falha ao executar selecao');
      }
    },
    [onExecutionFinished, refreshHistory, stopPolling]
  );

  return {
    currentExecution,
    executionHistory: history,
    running,
    error,
    runSelection
  };
}
