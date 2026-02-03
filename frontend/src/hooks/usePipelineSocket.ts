import { useCallback, useEffect, useRef } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';

type PipelineStageStatus = 'info' | 'success' | 'warning' | 'error' | 'running';

type PipelineStageEvent = {
  executionId: string;
  stage: string;
  status: PipelineStageStatus;
  message: string;
  meta?: any;
  ts?: number;
};

/**
 * Único ponto do frontend responsável por converter eventos WS em toasts.
 * NÃO contém lógica de decisão de sucesso/erro do pipeline.
 */
export function usePipelineSocket(showToast: (message: string, type?: any) => void) {
  const executionIdRef = useRef<string | null>(null);

  const { authenticated, send } = useWebSocketContext({
    enabled: true,
    subscribeEvents: ['generation.stage'],
    onEvent: (event: string, data: any) => {
      if (event !== 'generation.stage') return;
      const e = (data || {}) as PipelineStageEvent;
      if (!e || typeof e.message !== 'string') return;

      // Correlação por execução (para evitar toasts de outras execuções do mesmo tenant).
      const current = executionIdRef.current;
      if (current && e.executionId && e.executionId !== current) return;

      // Fonte única: o backend decide mensagem e severidade.
      showToast(e.message, (e.status || 'info') as any);
    },
  });

  const subscribe = useCallback((executionId: string) => {
    const id = (executionId && String(executionId).trim()) ? String(executionId).trim() : '';
    if (!id) return;
    executionIdRef.current = id;
    // Importante: o backend usa "rooms" por executionId; precisamos enviar subscribeExecution
    // mesmo antes de authenticated=true (o servidor vai armazenar e aplicar depois do auth).
    send({ type: 'subscribeExecution', executionId: id });
  }, [send]);

  // Reenvia subscribe após (re)autenticação do WS.
  useEffect(() => {
    const id = executionIdRef.current;
    if (!authenticated || !id) return;
    send({ type: 'subscribeExecution', executionId: id });
  }, [authenticated, send]);

  return { subscribe };
}

