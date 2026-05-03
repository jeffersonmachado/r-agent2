/**
 * Hook SSE para o Painel de Operador PBX.
 *
 * Usa EventSource para receber snapshots em tempo real do servidor.
 * Fallback automático para polling quando EventSource não está disponível
 * ou a conexão SSE fecha/falha.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildOperatorPanelEventsUrl, getOperatorPanelSnapshot } from '../api/pbx';
import logger from '../utils/logger';

const DEFAULT_INTERVAL_SEC = 10;
const MAX_RECONNECT_DELAY_MS = 30000;
const BASE_RECONNECT_DELAY_MS = 2000;

/**
 * @param {Object} options
 * @param {boolean} options.enabled         - Ativa/desativa o stream (padrão: true)
 * @param {Object}  options.filters         - Filtros passados ao SSE endpoint
 * @param {number}  options.intervalSec     - Intervalo de push do servidor (padrão: 10)
 * @param {number}  options.maxDurationSec  - Duração máxima do stream antes de reconectar (padrão: 300)
 * @param {Function} options.onSnapshot     - Callback chamado a cada snapshot recebido
 * @param {Function} options.onError        - Callback chamado em erros
 */
export function usePbxOperatorPanelSSE({
  enabled = true,
  filters = {},
  intervalSec = DEFAULT_INTERVAL_SEC,
  maxDurationSec = 300,
  onSnapshot,
  onError,
} = {}) {
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const esRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const unmountedRef = useRef(false);
  const filtersRef = useRef(filters);
  const onSnapshotRef = useRef(onSnapshot);
  const onErrorRef = useRef(onError);

  // Keep refs fresh without causing reconnects
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const closeEs = useCallback(() => {
    if (esRef.current) {
      try { esRef.current.close(); } catch (_) {}
      esRef.current = null;
    }
    if (!unmountedRef.current) setConnected(false);
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttemptsRef.current,
      MAX_RECONNECT_DELAY_MS,
    );
    reconnectAttemptsRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      if (!unmountedRef.current) {
        reconnectTimerRef.current = null;
        connect(); // eslint-disable-line no-use-before-define
      }
    }, delay);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => {
    if (unmountedRef.current || !enabled) return;
    if (typeof EventSource === 'undefined') {
      // Fallback: polling one-shot via REST
      getOperatorPanelSnapshot(filtersRef.current)
        .then((data) => {
          if (unmountedRef.current) return;
          setLastUpdated(new Date());
          if (onSnapshotRef.current) onSnapshotRef.current(data);
        })
        .catch((err) => {
          logger.warn('[usePbxOperatorPanelSSE] EventSource not available, polling fallback failed', err);
          if (onErrorRef.current) onErrorRef.current(err);
        });
      return;
    }

    closeEs();

    const url = buildOperatorPanelEventsUrl(filtersRef.current, { intervalSec, maxDurationSec });
    logger.debug('[usePbxOperatorPanelSSE] Connecting SSE', url);

    let es;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch (err) {
      logger.error('[usePbxOperatorPanelSSE] EventSource constructor failed', err);
      scheduleReconnect();
      return;
    }

    esRef.current = es;

    es.addEventListener('snapshot', (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (!unmountedRef.current) {
          reconnectAttemptsRef.current = 0;
          setConnected(true);
          setLastUpdated(new Date());
          if (onSnapshotRef.current) onSnapshotRef.current(data);
        }
      } catch (parseErr) {
        logger.error('[usePbxOperatorPanelSSE] Failed to parse snapshot event', parseErr);
      }
    });

    es.addEventListener('error', (evt) => {
      try {
        const data = JSON.parse(evt.data);
        logger.warn('[usePbxOperatorPanelSSE] Server error event', data);
        if (onErrorRef.current) onErrorRef.current(new Error(data?.error || 'sse_server_error'));
      } catch (_) { /* non-JSON error event */ }
    });

    es.addEventListener('close', () => {
      // Server sent explicit close — reconnect after max_duration
      logger.debug('[usePbxOperatorPanelSSE] Server closed stream, reconnecting...');
      closeEs();
      if (!unmountedRef.current) scheduleReconnect();
    });

    es.onerror = () => {
      logger.warn('[usePbxOperatorPanelSSE] EventSource onerror, will reconnect');
      setConnected(false);
      closeEs();
      if (!unmountedRef.current) scheduleReconnect();
    };
  }, [enabled, intervalSec, maxDurationSec, closeEs, scheduleReconnect]);

  useEffect(() => {
    unmountedRef.current = false;
    if (enabled) {
      connect();
    } else {
      closeEs();
    }
    return () => {
      unmountedRef.current = true;
      closeEs();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [enabled, connect, closeEs]);

  /** Force an immediate reconnect (e.g. after filters change) */
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  return { connected, lastUpdated, reconnect };
}
