/**
 * Hook para gerenciar conexão WebSocket com o servidor.
 * 
 * Funcionalidades:
 * - Conexão automática quando autenticado
 * - Reconexão automática em caso de desconexão
 * - Autenticação via token JWT
 * - Sistema de eventos para diferentes tipos de mensagens
 * - Ping/Pong para manter conexão viva
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { getToken } from '../api/auth';
import logger from '../utils/logger';

/**
 * Hook para usar WebSocket
 * 
 * @param {Object} options - Opções de configuração
 * @param {boolean} options.enabled - Se deve conectar (padrão: true)
 * @param {Function} options.onEvent - Callback para eventos recebidos
 * @param {Array<string>} options.subscribeEvents - Eventos para se inscrever
 * @returns {Object} { connected, send, reconnect }
 */
export function useWebSocket({ enabled = true, onEvent, subscribeEvents = [] } = {}) {
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const subscribeEventsRef = useRef(subscribeEvents);
  const isIntentionalCloseRef = useRef(false); // Flag para evitar reconexão quando fechamos intencionalmente
  const isConnectingRef = useRef(false); // Flag para evitar múltiplas conexões simultâneas

  // Atualiza refs quando callbacks mudam
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    subscribeEventsRef.current = subscribeEvents;
  }, [subscribeEvents]);

  // Constrói URL do WebSocket
  const getWebSocketUrl = useCallback(() => {
    const base = import.meta.env.VITE_API_BASE_URL;
    let basePath = '';

    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        const rawPath = url.pathname || window.location.pathname || '/';
        const match = rawPath.match(/^\/([^/]+)(\/|$)/);
        if (match && match[1]) {
          basePath = `/${match[1]}`;
        }
      } catch {
        const fallbackMatch = window.location.pathname && window.location.pathname.match(/^\/([^/]+)(\/|$)/);
        if (fallbackMatch && fallbackMatch[1]) {
          basePath = `/${fallbackMatch[1]}`;
        }
      }
    }
    
    // Se VITE_API_BASE_URL estiver definido, usa URL absoluta
    if (base && base.trim()) {
      const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
      const wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
      return `${wsBase}/ws`;
    }
    
    // Se estiver vazio, detecta ambiente em runtime
    if (typeof window !== 'undefined') {
      const isViteDev = window.location.port === '5173' || 
                        (window.location.hostname === 'localhost' && window.location.port !== '80' && window.location.port !== '443' && !window.location.port.includes('8086'));
      
      if (isViteDev) {
        // Desenvolvimento (Vite): usa a porta da API do config.json (via define do Vite)
        // Fallback para 3000 se não estiver disponível.
        const devPort = Number(import.meta.env.VITE_API_DEV_PORT || 3000);
        return `ws://localhost:${devPort}/ws`;
      }
    }
    
    // Produção ou quando servido via nginx/Apache: usa URL relativa com prefixo (/r-agent2/ws)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = `${basePath}/ws`.replace('//', '/');
    return `${protocol}//${window.location.host}${wsPath}`;
  }, []);

  // Função auxiliar para enviar mensagem (usa ref diretamente)
  const sendMessage = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(data));
        return true;
      } catch (err) {
        logger.error('[WebSocket] Erro ao enviar mensagem', err);
        return false;
      }
    }
    logger.warn('[WebSocket] Tentativa de enviar mensagem sem conexão');
    return false;
  }, []);

  // Envia mensagem via WebSocket (API pública)
  const send = useCallback((data) => {
    return sendMessage(data);
  }, [sendMessage]);

  // Conecta ao WebSocket
  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }

    // Se já está conectando, ignora nova tentativa
    if (isConnectingRef.current) {
      logger.debug('[WebSocket] Já está conectando, ignorando nova tentativa');
      return;
    }

    // Limpa timeout de reconexão pendente
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Se já existe uma conexão aberta, não cria nova
    if (wsRef.current) {
      const currentState = wsRef.current.readyState;
      if (currentState === WebSocket.OPEN) {
        logger.debug('[WebSocket] Conexão já aberta, ignorando nova tentativa');
        return;
      }
      if (currentState === WebSocket.CONNECTING) {
        logger.debug('[WebSocket] Conexão já em andamento, ignorando nova tentativa');
        return;
      }
      // Se está fechando ou fechado, limpa a referência
      isIntentionalCloseRef.current = true;
      try {
        wsRef.current.close();
      } catch (err) {
        // Ignora erros ao fechar
      }
      wsRef.current = null;
    }

    isConnectingRef.current = true;
    const url = getWebSocketUrl();
    logger.info('[WebSocket] Conectando...', { url });

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.info('[WebSocket] Conectado');
        isConnectingRef.current = false;
        setConnected(true);
        reconnectAttemptsRef.current = 0; // Reset contador de tentativas

        // Autentica com token
        const token = getToken();
        if (token) {
          sendMessage({ type: 'auth', token });
        } else {
          logger.warn('[WebSocket] Sem token para autenticação');
        }

        // Inicia ping/pong
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            sendMessage({ type: 'ping' });
          }
        }, 30000); // Ping a cada 30 segundos
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Trata mensagens de conexão
          if (data.type === 'connection') {
            logger.debug('[WebSocket] Mensagem de conexão', data);
            return;
          }

          // Trata autenticação
          if (data.type === 'auth') {
            if (data.status === 'success') {
              logger.info('[WebSocket] Autenticado com sucesso', data.agent);
              setAuthenticated(true);

              // Se inscreve em eventos
              if (subscribeEventsRef.current.length > 0) {
                sendMessage({ type: 'subscribe', events: subscribeEventsRef.current });
              }
            } else {
              logger.error('[WebSocket] Falha na autenticação', data.message);
              setAuthenticated(false);
            }
            return;
          }

          // Trata pong
          if (data.type === 'pong') {
            logger.debug('[WebSocket] Pong recebido');
            return;
          }

          // Trata eventos
          if (data.type === 'event') {
            logger.debug('[WebSocket] Evento recebido', data.event, data.data);
            if (onEventRef.current) {
              onEventRef.current(data.event, data.data, data);
            }
            return;
          }

          // Outros tipos de mensagem
          logger.debug('[WebSocket] Mensagem recebida', data);
          if (onEventRef.current) {
            onEventRef.current('message', data, data);
          }
        } catch (err) {
          logger.error('[WebSocket] Erro ao processar mensagem', err, event.data);
        }
      };

      ws.onerror = (error) => {
        logger.error('[WebSocket] Erro na conexão', error);
        isConnectingRef.current = false;
        setConnected(false);
        setAuthenticated(false);
      };

      ws.onclose = (event) => {
        logger.info('[WebSocket] Desconectado', { code: event.code, reason: event.reason });
        isConnectingRef.current = false;
        setConnected(false);
        setAuthenticated(false);

        // Limpa ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Se foi fechamento intencional (para reconectar), não agenda nova reconexão
        if (isIntentionalCloseRef.current) {
          isIntentionalCloseRef.current = false;
          return;
        }

        // Reconecta se não foi fechamento intencional (código 1000 = fechamento normal)
        if (event.code !== 1000 && enabled) {
          // Backoff exponencial: 1s, 2s, 4s, 8s, max 30s
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;

          logger.info(`[WebSocket] Reconectando em ${delay}ms (tentativa ${reconnectAttemptsRef.current})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (err) {
      logger.error('[WebSocket] Erro ao criar conexão', err);
      isConnectingRef.current = false;
      setConnected(false);
      setAuthenticated(false);
      if (enabled) {
        // Backoff exponencial
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    }
  }, [enabled, getWebSocketUrl, sendMessage]);

  // Ref para armazenar a função connect mais recente
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Reconecta ao WebSocket (API pública)
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0; // Reset contador
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      isIntentionalCloseRef.current = true;
      try {
        wsRef.current.close();
      } catch (err) {
        // Ignora erros
      }
      wsRef.current = null;
    }
    connectRef.current();
  }, []);

  // Conecta quando habilitado (apenas uma vez)
  useEffect(() => {
    if (enabled) {
      connectRef.current();
    }

    return () => {
      // Limpa ao desmontar
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (wsRef.current) {
        const currentState = wsRef.current.readyState;
        // Só fecha se não estiver em estado CONNECTING (que causaria erro)
        if (currentState !== WebSocket.CONNECTING) {
          isIntentionalCloseRef.current = true; // Marca como fechamento intencional
          try {
            wsRef.current.close(1000, 'Component unmounted');
          } catch (err) {
            // Ignora erros
          }
        } else {
          // Se está conectando, apenas remove os handlers para evitar reconexão
          isIntentionalCloseRef.current = true;
        }
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]); // Executa apenas quando enabled muda, não quando connect muda

  // Re-inscreve em eventos quando mudam
  useEffect(() => {
    if (authenticated && subscribeEventsRef.current.length > 0) {
      sendMessage({ type: 'subscribe', events: subscribeEventsRef.current });
    }
  }, [authenticated, sendMessage]);

  return {
    connected,
    authenticated,
    send,
    reconnect,
  };
}

