import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook para fazer polling de status de execução em tempo real.
 * 
 * @param {string} executionId - ID da execução a monitorar (ex: meshq-1777208944882-569yzf)
 * @param {number} pollInterval - Intervalo de polling em ms (padrão: 2000ms)
 * @returns {Object} { status, progress, currentStep, summary, error, isPolling }
 */
export function useExecutionPolling(executionId, pollInterval = 2000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [isPolling, setIsPolling] = useState(false);
  const pollRef = useRef(null);
  const lastDataRef = useRef(null);

  const fetchExecutionStatus = useCallback(async () => {
    if (!executionId) return;

    try {
      const response = await fetch(`/api/qa-waves/executions/${executionId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError('Execução não encontrada');
          return null;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      setData(result);
      setError('');
      lastDataRef.current = result;
      return result;
    } catch (err) {
      setError(err.message || 'Erro ao buscar status');
      return lastDataRef.current;
    }
  }, [executionId]);

  const startPolling = useCallback(() => {
    if (pollRef.current || !executionId) return;

    setIsPolling(true);

    // Busca inicial
    fetchExecutionStatus().then((result) => {
      if (!result || result.status !== 'processing') {
        setIsPolling(false);
        return;
      }

      // Inicia polling contínuo
      pollRef.current = setInterval(async () => {
        const latest = await fetchExecutionStatus();
        if (!latest) return;

        // Para polling quando execução termina
        if (latest.status === 'success' || latest.status === 'failed') {
          stopPolling();
        }
      }, pollInterval);
    });
  }, [executionId, pollInterval, fetchExecutionStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const resetPolling = useCallback(() => {
    stopPolling();
    setData(null);
    setError('');
    lastDataRef.current = null;
  }, [stopPolling]);

  // Limpa polling ao desmontar
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    // Estado
    data,
    status: data?.status || 'idle', // idle | processing | success | failed
    progress: data?.progress || 0, // 0-100
    summary: data?.summary || null,
    currentStep: data?.currentStep || null,
    results: data?.results || [],
    durationMs: data?.durationMs || 0,

    // Controle
    isPolling,
    error,
    startPolling,
    stopPolling,
    resetPolling,

    // Fetch manual
    fetchExecutionStatus,

    // Conveniências
    isRunning: data?.status === 'processing',
    isFinished: data?.status === 'success' || data?.status === 'failed',
    isSuccess: data?.status === 'success',
    isFailed: data?.status === 'failed',
  };
}
