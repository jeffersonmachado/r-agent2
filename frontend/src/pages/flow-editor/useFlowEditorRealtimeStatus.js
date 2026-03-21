import { useCallback } from 'react';
import { useWebSocketContext } from '../../context/WebSocketContext';
import { useWebSocketStatus } from '../../utils/webSocketStatusConfig';
import logger from '../../utils/logger';

export function useFlowEditorRealtimeStatus({
  isAuthenticated,
  currentFlow,
  loadFlow,
  showToast,
}) {
  const handleWebSocketEvent = useCallback((event, data) => {
    logger.debug('[FlowEditorPage] Evento WebSocket recebido', { event, data });

    if (event !== 'flow.updated') {
      return;
    }

    const updatedFlowId = data?.flowId || data?.flow?.id || data?.id;
    const currentFlowId = currentFlow?.id;

    if (updatedFlowId && updatedFlowId === currentFlowId) {
      logger.info('[FlowEditorPage] Fluxo atual foi atualizado via WebSocket, recarregando...', {
        flowId: updatedFlowId,
        flowName: data?.flowName,
        updatedBy: data?.agentId,
      });

      loadFlow(updatedFlowId)
        .then(() => {
          const flowName = data?.flowName || currentFlow?.name || 'Fluxo';
          showToast(`"${flowName}" foi atualizado automaticamente`, 'info', 3000);
        })
        .catch((err) => {
          logger.error('[FlowEditorPage] Erro ao recarregar fluxo apos atualizacao WebSocket', err);
          showToast('Erro ao recarregar fluxo atualizado', 'error', 3000);
        });
      return;
    }

    if (updatedFlowId) {
      logger.debug('[FlowEditorPage] Outro fluxo foi atualizado', {
        updatedFlowId,
        currentFlowId,
        flowName: data?.flowName,
      });
    }
  }, [currentFlow, loadFlow, showToast]);

  const { connected, authenticated, authFailed } = useWebSocketContext({
    enabled: isAuthenticated,
    onEvent: handleWebSocketEvent,
    subscribeEvents: ['flow.updated'],
  });

  return useWebSocketStatus({
    connected,
    authenticated,
    authFailed,
  });
}
