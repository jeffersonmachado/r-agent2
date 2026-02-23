import { useState } from 'react';

export type WebSocketStatusPhase = 'connecting' | 'auth' | 'auth_error' | 'ready' | 'disconnected';

export function useWebSocket() {
  const [wsStatusPhase, setWsStatusPhase] = useState<WebSocketStatusPhase>('connecting');
  const [wsConnected, setWsConnected] = useState(false);
  const [wsAuthenticated, setWsAuthenticated] = useState(false);
  const [wsAuthFailed, setWsAuthFailed] = useState(false);
  const [wsLastEvent, setWsLastEvent] = useState<string | null>(null);

  return {
    wsStatusPhase,
    setWsStatusPhase,
    wsConnected,
    setWsConnected,
    wsAuthenticated,
    setWsAuthenticated,
    wsAuthFailed,
    setWsAuthFailed,
    wsLastEvent,
    setWsLastEvent,
  };
}
