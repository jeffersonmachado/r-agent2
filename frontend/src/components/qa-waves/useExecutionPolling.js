import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../api/client';

/**
 * Hook para fazer polling de status de execução em tempo real.
 * 
 * @param {string} executionId - ID da execução a monitorar (ex: meshq-1777208944882-569yzf)
 * @param {number} pollInterval - Intervalo de polling em ms (padrão: 5000ms)
 * @returns {Object} { status, progress, currentStep, summary, error, isPolling }
 */
export function useExecutionPolling(executionId, pollInterval = 5000) {
  const MAX_NOT_FOUND_STREAK = 12;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [isPolling, setIsPolling] = useState(false);
  const pollRef = useRef(null);
  const lastDataRef = useRef(null);
  const notFoundStreakRef = useRef(0);

  const fetchExecutionStatus = useCallback(async () => {
    if (!executionId) return;

    try {
      const result = await fetchJson(`/api/test-executions/${executionId}`, {
        method: 'GET',
        silent: true, // Evita logs em cada polling
      });

      notFoundStreakRef.current = 0;
      setData(result);
      setError('');
      lastDataRef.current = result;
      return result;
    } catch (err) {
      // 404 pode ocorrer logo após enfileirar; tolera por uma janela antes de desistir.
      if (err.status === 404) {
        notFoundStreakRef.current += 1;
        if (notFoundStreakRef.current <= MAX_NOT_FOUND_STREAK) {
          setError('Aguardando registro da execução...');
          return (
            lastDataRef.current || {
              executionId,
              status: 'processing',
              progress: 0,
              summary: null,
              currentStep: null,
              results: [],
              durationMs: 0,
            }
          );
        }
        setError('Execução não encontrada');
        return null;
      }

      notFoundStreakRef.current = 0;
      // Para outros erros, usa a última resposta válida se existir
      setError(err.message || 'Erro ao buscar status');
      return lastDataRef.current;
    }
  }, [executionId]);

  const startPolling = useCallback(() => {
    if (pollRef.current || !executionId) return;

    notFoundStreakRef.current = 0;
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
    notFoundStreakRef.current = 0;
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
