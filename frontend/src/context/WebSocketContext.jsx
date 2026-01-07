/**
 * Contexto global para gerenciar conexão WebSocket compartilhada.
 * 
 * Evita múltiplas conexões WebSocket quando vários componentes
 * precisam de atualizações em tempo real.
 */

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../api/auth';
import logger from '../utils/logger';

const WebSocketContext = createContext(null);

/**
 * Provider de WebSocket que gerencia uma única conexão compartilhada.
 */
export function WebSocketProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const eventHandlersRef = useRef(new Map()); // Map<componentId, { onEvent, subscribeEvents }>
  const allSubscribedEventsRef = useRef(new Set()); // Set de todos os eventos inscritos
  const isIntentionalCloseRef = useRef(false); // Flag para evitar reconexão quando fechamos intencionalmente
  const isConnectingRef = useRef(false); // Flag para evitar múltiplas conexões simultâneas

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
        // Desenvolvimento: usa localhost:3000
        return 'ws://localhost:3000/ws';
      }
    }
    
    // Produção ou quando servido via nginx/Apache: usa URL relativa com prefixo (/r-agent2/ws)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = `${basePath}/ws`.replace('//', '/');
    return `${protocol}//${window.location.host}${wsPath}`;
  }, []);

  // Envia mensagem via WebSocket
  const sendMessage = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(data));
        return true;
      } catch (err) {
        logger.error('[WebSocketContext] Erro ao enviar mensagem', err);
        return false;
      }
    }
    return false;
  }, []);

  // Atualiza subscriptions quando handlers mudam
  const updateSubscriptions = useCallback(() => {
    if (!authenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    // Coleta todos os eventos únicos de todos os handlers
    const allEvents = new Set();
    for (const handler of eventHandlersRef.current.values()) {
      if (handler.subscribeEvents) {
        handler.subscribeEvents.forEach(event => allEvents.add(event));
      }
    }

    // Compara com eventos já inscritos (ordena para comparação consistente)
    const currentEvents = Array.from(allSubscribedEventsRef.current).sort();
    const newEvents = Array.from(allEvents).sort();
    
    // Se mudou, re-inscreve
    if (currentEvents.length !== newEvents.length || 
        !currentEvents.every((e, i) => e === newEvents[i])) {
      allSubscribedEventsRef.current = allEvents;
      if (newEvents.length > 0) {
        const message = JSON.stringify({ type: 'subscribe', events: newEvents });
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send(message);
            logger.debug('[WebSocketContext] Re-inscrito em eventos', { events: newEvents });
          } catch (err) {
            logger.error('[WebSocketContext] Erro ao re-inscrever em eventos', err);
          }
        }
      }
    } else {
      logger.debug('[WebSocketContext] Eventos não mudaram, ignorando re-inscrição');
    }
  }, [authenticated]);

  // Verifica se o servidor está acessível antes de conectar
  const checkServerHealth = useCallback(async () => {
    const url = getWebSocketUrl();
    const httpUrl = url.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '/health');
    
    try {
      const response = await fetch(httpUrl, { 
        method: 'GET',
        signal: AbortSignal.timeout(3000) // Timeout de 3 segundos
      });
      return response.ok;
    } catch (err) {
      // Não loga warning na primeira tentativa - pode ser apenas o servidor iniciando
      // Só loga se já tentou várias vezes
      if (reconnectAttemptsRef.current > 0) {
        logger.debug('[WebSocketContext] Servidor não está acessível', { 
          httpUrl, 
          error: err.message,
          hint: 'Verifique se o servidor está rodando e acessível'
        });
      }
      return false;
    }
  }, [getWebSocketUrl]);

  // Conecta ao WebSocket
  const connect = useCallback(async () => {
    // Se já está conectando, ignora nova tentativa
    if (isConnectingRef.current) {
      logger.debug('[WebSocketContext] Já está conectando, ignorando nova tentativa');
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
        logger.debug('[WebSocketContext] Conexão já aberta, ignorando nova tentativa');
        return;
      }
      if (currentState === WebSocket.CONNECTING) {
        logger.debug('[WebSocketContext] Conexão já em andamento, ignorando nova tentativa');
        return;
      }
      // Se está fechando ou fechado, limpa a referência
      isIntentionalCloseRef.current = true;
      try {
        wsRef.current.close();
      } catch (err) {
        // Ignora erros
      }
      wsRef.current = null;
    }

    isConnectingRef.current = true;
    const url = getWebSocketUrl();
    
    // Verifica se o servidor está acessível (apenas após algumas tentativas para evitar logs desnecessários)
    // Na primeira tentativa, não verifica para evitar erros durante a inicialização do servidor
    if (reconnectAttemptsRef.current > 0 && reconnectAttemptsRef.current % 5 === 0) {
      const isHealthy = await checkServerHealth();
      if (!isHealthy) {
        logger.warn('[WebSocketContext] Servidor não está acessível após várias tentativas. Verifique se o servidor está rodando.', {
          url: url.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', ''),
          attempts: reconnectAttemptsRef.current,
          hint: 'Inicie o servidor com: cd api && npm start'
        });
      }
    }
    
    logger.info('[WebSocketContext] Conectando...', { url });

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.info('[WebSocketContext] Conectado');
        isConnectingRef.current = false;
        setConnected(true);
        reconnectAttemptsRef.current = 0;

        // Autentica com token - envia diretamente usando a referência do WebSocket
        const token = getToken();
        if (token) {
          try {
            logger.debug('[WebSocketContext] Enviando autenticação...');
            // Envia diretamente usando ws para evitar problemas de timing com wsRef.current
            ws.send(JSON.stringify({ type: 'auth', token }));
            logger.debug('[WebSocketContext] Mensagem de autenticação enviada');
          } catch (err) {
            logger.error('[WebSocketContext] Erro ao enviar autenticação', err);
          }
        } else {
          // Usa debug ao invés de warn - é esperado não ter token antes do login
          logger.debug('[WebSocketContext] Sem token para autenticação (usuário não autenticado ainda)');
        }

        // Inicia ping/pong
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            sendMessage({ type: 'ping' });
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Trata mensagens de conexão
          if (data.type === 'connection') {
            logger.debug('[WebSocketContext] Mensagem de conexão', data);
            return;
          }

          // Trata autenticação
          if (data.type === 'auth') {
            logger.debug('[WebSocketContext] Resposta de autenticação recebida', data);
            if (data.status === 'success') {
              logger.info('[WebSocketContext] Autenticado com sucesso', data.agent);
              setAuthenticated(true);
              // As subscriptions serão atualizadas pelo useEffect que observa 'authenticated'
            } else {
              logger.error('[WebSocketContext] Falha na autenticação', data.message || data);
              setAuthenticated(false);
            }
            return;
          }

          // Trata pong
          if (data.type === 'pong') {
            logger.debug('[WebSocketContext] Pong recebido');
            return;
          }

          // Trata eventos - distribui para todos os handlers registrados
          if (data.type === 'event') {
            logger.debug('[WebSocketContext] Evento recebido', data.event, data.data);
            for (const handler of eventHandlersRef.current.values()) {
              if (handler.onEvent) {
                try {
                  handler.onEvent(data.event, data.data, data);
                } catch (err) {
                  logger.error('[WebSocketContext] Erro ao processar evento no handler', err);
                }
              }
            }
            return;
          }

          // Outros tipos de mensagem
          logger.debug('[WebSocketContext] Mensagem recebida', data);
          for (const handler of eventHandlersRef.current.values()) {
            if (handler.onEvent) {
              try {
                handler.onEvent('message', data, data);
              } catch (err) {
                logger.error('[WebSocketContext] Erro ao processar mensagem no handler', err);
              }
            }
          }
        } catch (err) {
          logger.error('[WebSocketContext] Erro ao processar mensagem', err, event.data);
        }
      };

      ws.onerror = (error) => {
        const errorMessage = error.message || 'Erro desconhecido na conexão WebSocket';
        const url = getWebSocketUrl();
        // Só loga erro se já tentou várias vezes - na primeira tentativa pode ser apenas o servidor iniciando
        if (reconnectAttemptsRef.current > 2) {
          logger.error('[WebSocketContext] Erro na conexão WebSocket', {
            error: errorMessage,
            url,
            readyState: ws.readyState,
            attempts: reconnectAttemptsRef.current,
            hint: 'Verifique se o servidor está rodando e acessível em ' + url.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '')
          });
        } else {
          logger.debug('[WebSocketContext] Erro na conexão WebSocket (tentativa inicial)', {
            error: errorMessage,
            url,
            readyState: ws.readyState
          });
        }
        isConnectingRef.current = false;
        setConnected(false);
        setAuthenticated(false);
      };

      ws.onclose = (event) => {
        const url = getWebSocketUrl();
        const closeReasons = {
          1000: 'Fechamento normal',
          1001: 'Endpoint desconectado',
          1002: 'Erro de protocolo',
          1003: 'Tipo de dado não suportado',
          1006: 'Conexão fechada anormalmente (sem frame de fechamento)',
          1007: 'Dados inválidos',
          1008: 'Violação de política',
          1009: 'Mensagem muito grande',
          1010: 'Extensão não suportada',
          1011: 'Erro interno do servidor',
          1012: 'Serviço reiniciando',
          1013: 'Tente novamente mais tarde',
          1014: 'Gateway ruim',
          1015: 'Falha na negociação TLS'
        };
        
        const reasonText = closeReasons[event.code] || `Código desconhecido: ${event.code}`;
        logger.info('[WebSocketContext] Desconectado', { 
          code: event.code, 
          reason: event.reason || reasonText,
          url,
          hint: event.code === 1006 ? 'Servidor pode não estar rodando ou não estar acessível. Verifique se o servidor está ativo em ' + url.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '') : undefined
        });
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
        if (event.code !== 1000) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;

          logger.info(`[WebSocketContext] Reconectando em ${delay}ms (tentativa ${reconnectAttemptsRef.current})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connectRef.current();
          }, delay);
        }
      };
    } catch (err) {
      logger.error('[WebSocketContext] Erro ao criar conexão', err);
      isConnectingRef.current = false;
      setConnected(false);
      setAuthenticated(false);
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
      reconnectAttemptsRef.current++;
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, delay);
    }
  }, [getWebSocketUrl, sendMessage, checkServerHealth]);

  // Registra um handler de eventos
  const registerHandler = useCallback((componentId, { onEvent, subscribeEvents = [] }) => {
    eventHandlersRef.current.set(componentId, { onEvent, subscribeEvents });
    // Só atualiza subscriptions se já estiver autenticado
    // Caso contrário, o useEffect que observa 'authenticated' fará isso
    if (authenticated) {
      updateSubscriptions();
    }
  }, [authenticated, updateSubscriptions]);

  // Remove um handler de eventos
  const unregisterHandler = useCallback((componentId) => {
    eventHandlersRef.current.delete(componentId);
    // Só atualiza subscriptions se já estiver autenticado
    if (authenticated) {
      updateSubscriptions();
    }
  }, [authenticated, updateSubscriptions]);

  // Ref para armazenar a função connect mais recente
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Reconecta manualmente
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
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

  // Conecta quando monta (apenas uma vez)
  useEffect(() => {
    connectRef.current();

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
            wsRef.current.close(1000, 'Provider unmounted');
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
  }, []); // Executa apenas uma vez na montagem

  // Atualiza subscriptions quando authenticated muda
  useEffect(() => {
    if (authenticated) {
      // Usa setTimeout para garantir que handlers já foram registrados
      const timeoutId = setTimeout(() => {
        updateSubscriptions();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [authenticated, updateSubscriptions]);

  const value = {
    connected,
    authenticated,
    send: sendMessage,
    reconnect,
    registerHandler,
    unregisterHandler,
  };

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

/**
 * Hook para usar o WebSocket compartilhado.
 * 
 * @param {Object} options - Opções
 * @param {boolean} options.enabled - Se deve registrar handler (padrão: true)
 * @param {Function} options.onEvent - Callback para eventos recebidos
 * @param {Array<string>} options.subscribeEvents - Eventos para se inscrever
 * @returns {Object} { connected, authenticated, send, reconnect }
 */
export function useWebSocketContext({ enabled = true, onEvent, subscribeEvents = [] } = {}) {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext deve ser usado dentro de WebSocketProvider');
  }

  const componentIdRef = useRef(`component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    if (enabled) {
      context.registerHandler(componentIdRef.current, { onEvent, subscribeEvents });
      return () => {
        context.unregisterHandler(componentIdRef.current);
      };
    }
  }, [enabled, onEvent, subscribeEvents, context]);

  return {
    connected: context.connected,
    authenticated: context.authenticated,
    send: context.send,
    reconnect: context.reconnect,
  };
}

