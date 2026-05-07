import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '../../context/WebSocketContext';

/**
 * Hook para acompanhar status de execução em tempo real via WebSocket.
 * 
 * @param {string} executionId - ID da execução a monitorar (ex: meshq-1777208944882-569yzf)
 * @returns {Object} { status, progress, currentStep, summary, error, isPolling }
 */
export function useExecutionPolling(executionId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [isPolling, setIsPolling] = useState(false);
  const lastDataRef = useRef(null);

  const applyExecutionUpdate = useCallback((incoming) => {
    if (!incoming || typeof incoming !== 'object') return null;
    const normalized = {
      executionId: incoming.executionId || executionId,
      status: incoming.status || 'processing',
      progress: Number.isFinite(incoming.progress) ? incoming.progress : 0,
      summary: incoming.summary || null,
      currentStep: incoming.currentStep || null,
      results: Array.isArray(incoming.results) ? incoming.results : [],
      durationMs: Number.isFinite(incoming.durationMs) ? incoming.durationMs : 0,
      startedAt: incoming.startedAt || null,
      finishedAt: incoming.finishedAt || null,
    };

    setData(normalized);
    setError('');
    lastDataRef.current = normalized;
    if (normalized.status === 'success' || normalized.status === 'failed') {
      setIsPolling(false);
    }
    return normalized;
  }, [executionId]);

  const handleWsEvent = useCallback((eventName, payload) => {
    if (eventName !== 'qa-waves.execution.updated' && eventName !== 'qa-waves.execution.started') {
      return;
    }

    if (!payload || payload.executionId !== executionId) {
      return;
    }

    applyExecutionUpdate({
      ...lastDataRef.current,
      ...payload,
    });
  }, [applyExecutionUpdate, executionId]);

  useWebSocketContext({
    enabled: Boolean(executionId),
    onEvent: handleWsEvent,
    subscribeEvents: ['qa-waves.execution.updated', 'qa-waves.execution.started'],
  });

  const startPolling = useCallback(() => {
    if (!executionId) return;

    setIsPolling(true);
    setError('');
    if (!lastDataRef.current || lastDataRef.current.executionId !== executionId) {
      const optimistic = {
        executionId,
        status: 'processing',
        progress: 0,
        summary: null,
        currentStep: null,
        results: [],
        durationMs: 0,
        startedAt: null,
        finishedAt: null,
      };
      setData(optimistic);
      lastDataRef.current = optimistic;
    }
  }, [executionId]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
  }, []);

  const resetPolling = useCallback(() => {
    stopPolling();
    setData(null);
    setError('');
    lastDataRef.current = null;
  }, [stopPolling]);

  useEffect(() => {
    if (!executionId) {
      setData(null);
      setError('');
      setIsPolling(false);
      lastDataRef.current = null;
    }
  }, [executionId]);

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

    // Compatibilidade
    fetchExecutionStatus: () => Promise.resolve(lastDataRef.current),

    // Conveniências
    isRunning: data?.status === 'processing',
    isFinished: data?.status === 'success' || data?.status === 'failed',
    isSuccess: data?.status === 'success',
    isFailed: data?.status === 'failed',
  };
}
