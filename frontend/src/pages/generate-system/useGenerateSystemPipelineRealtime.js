import { useCallback, useEffect, useRef } from 'react';
import { useWebSocketContext } from '../../context/WebSocketContext';
import logger from '../../utils/logger';

export function useGenerateSystemPipelineRealtime({ pipelineMachine }) {
  const ws = useWebSocketContext({
    enabled: true,
    onEvent: (event, data) => {
      if (event === 'pipeline.status') {
        logger.debug('[WebSocket] pipeline.status recebido', { event, data });
        pipelineMachine.dispatch({ type: 'PIPELINE_STATUS', payload: data });
      }
    },
    subscribeEvents: ['pipeline.status'],
  });

  const wsStateRef = useRef({ connected: false, authenticated: false });

  useEffect(() => {
    wsStateRef.current = { connected: !!ws?.connected, authenticated: !!ws?.authenticated };
  }, [ws?.connected, ws?.authenticated]);

  const ensureWebSocketAuthenticated = useCallback(async (timeoutMs = 5000) => {
    const start = Date.now();

    if (wsStateRef.current.connected && wsStateRef.current.authenticated) return true;

    try {
      ws?.reconnect?.();
    } catch {
      // best-effort
    }

    while (Date.now() - start < timeoutMs) {
      if (wsStateRef.current.connected && wsStateRef.current.authenticated) return true;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }

    return false;
  }, [ws]);

  return {
    wsStateRef,
    ensureWebSocketAuthenticated,
  };
}
