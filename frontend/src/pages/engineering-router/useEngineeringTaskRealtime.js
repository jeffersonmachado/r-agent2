import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '../../context/WebSocketContext';

const FEED_LIMIT = 50;
const TERMINAL_STAGES = ['GREEN', 'RED'];

/**
 * Feedback em tempo real de uma EngineeringTask via WebSocket (evento `engineering.task.stage`,
 * emitido por `api/services/engineeringRouter/engineeringRouterEvents.js`).
 *
 * Reutiliza o mesmo padrão de `useGenerateSystemPipelineRealtime.js`: broadcast por tenant,
 * filtro client-side pelo `taskId` da tela aberta — sem polling, sem setInterval, sem reload de
 * página (a única atualização de estado "pesada" acontece quando um estágio terminal chega, via
 * `onTerminalStage`, para sincronizar attempts/tests/reviews/telemetria uma última vez).
 */
export function useEngineeringTaskRealtime(taskId, { onTerminalStage } = {}) {
  const [feed, setFeed] = useState([]);
  const [changedFiles, setChangedFiles] = useState([]);
  const onTerminalStageRef = useRef(onTerminalStage);
  useEffect(() => { onTerminalStageRef.current = onTerminalStage; }, [onTerminalStage]);

  const ws = useWebSocketContext({
    enabled: Boolean(taskId),
    onEvent: (event, data) => {
      if (event !== 'engineering.task.stage') return;
      if (!data || data.taskId !== taskId) return;

      setFeed((prev) => [...prev.slice(-(FEED_LIMIT - 1)), data]);

      if (data.stage === 'PATCH_APPLIED' && Array.isArray(data.changedFiles)) {
        setChangedFiles(data.changedFiles);
      }

      if (TERMINAL_STAGES.includes(data.stage)) {
        onTerminalStageRef.current?.(data);
      }
    },
    subscribeEvents: ['engineering.task.stage'],
  });

  const resetFeed = useCallback(() => {
    setFeed([]);
    setChangedFiles([]);
  }, []);

  return {
    feed,
    changedFiles,
    resetFeed,
    connected: ws.connected,
    authenticated: ws.authenticated,
  };
}

export default useEngineeringTaskRealtime;
