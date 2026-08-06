/**
 * Contexto global para gerenciar conexão WebSocket compartilhada.
 * 
 * Evita múltiplas conexões WebSocket quando vários componentes
 * precisam de atualizações em tempo real.
 */

import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '../api/auth';
import logger from '../utils/logger';
import { buildWebSocketUrl } from '../utils/wsUrl';

const WebSocketContext = createContext(null);

/**
 * Provider de WebSocket que gerencia uma única conexão compartilhada.
 */
export function WebSocketProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const authHandshakeTimeoutRef = useRef(null);
  const reconnectWatchdogRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const eventHandlersRef = useRef(new Map()); // Map<componentId, { onEvent, subscribeEvents }>
  const allSubscribedEventsRef = useRef(new Set()); // Set de todos os eventos inscritos
  const isIntentionalCloseRef = useRef(false); // Flag para evitar reconexão quando fechamos intencionalmente
  const isConnectingRef = useRef(false); // Flag para evitar múltiplas conexões simultâneas
  const authenticatedRef = useRef(false);
  const checkServerHealthRef = useRef(null);
  const isTestRuntime = Boolean(
    (typeof process !== 'undefined' && process.env && process.env.VITEST)
    || (import.meta.env && import.meta.env.MODE === 'test')
  );

  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

  const logReconnectConsole = useCallback((message, data = null) => {
    if (isTestRuntime) {
      return;
    }

    const timestamp = new Date().toISOString();
    if (data) {
      // eslint-disable-next-line no-console
      console.info(`[${timestamp}] [WS_RECONNECT] ${message}`, data);
      return;
    }
    // eslint-disable-next-line no-console
    console.info(`[${timestamp}] [WS_RECONNECT] ${message}`);
  }, [isTestRuntime]);

  const scheduleReconnect = useCallback((reason, extra = {}) => {
    if (isIntentionalCloseRef.current) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      return;
    }

    reconnectAttemptsRef.current += 1;
    const isServerRestart = Boolean(extra.isServerRestart);
    const baseDelay = isServerRestart ? 3000 : 1000;
    const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttemptsRef.current - 1), 30000);

    logger.info(`[WebSocketContext] Reconectando em ${Math.round(delay)}ms (tentativa ${reconnectAttemptsRef.current})`, {
      reason,
      ...extra,
    });
    logReconnectConsole(`Tentativa ${reconnectAttemptsRef.current} em ${Math.round(delay)}ms`, {
      reason,
      ...extra,
    });

    reconnectTimeoutRef.current = setTimeout(async () => {
      reconnectTimeoutRef.current = null;

      if (isServerRestart && reconnectAttemptsRef.current <= 3) {
        const isHealthy = checkServerHealthRef.current ? await checkServerHealthRef.current() : false;
        if (!isHealthy) {
          logger.debug('[WebSocketContext] Servidor ainda não está pronto, aguardando mais um pouco...');
          logReconnectConsole('Servidor ainda indisponível, nova tentativa em 2000ms');
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectRef.current();
          }, 2000);
          return;
        }
      }

      connectRef.current();
    }, delay);
  }, [logReconnectConsole]);

  // Constrói URL do WebSocket
  const getWebSocketUrl = useCallback(() => buildWebSocketUrl(), []);

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

  // Tenta autenticar o WebSocket com o token atual
  const authenticateWebSocket = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }

    const token = getToken();
    if (!token) {
      logger.debug('[WebSocketContext] Sem token para autenticação');
      return false;
    }

    // Se já está autenticado, não precisa autenticar novamente
    if (authenticated) {
      logger.debug('[WebSocketContext] Já autenticado, ignorando nova tentativa');
      return true;
    }

    if (authHandshakeTimeoutRef.current) {
      clearTimeout(authHandshakeTimeoutRef.current);
      authHandshakeTimeoutRef.current = null;
    }

    try {
      logger.debug('[WebSocketContext] Enviando autenticação...');
      wsRef.current.send(JSON.stringify({ type: 'auth', token }));
      logger.debug('[WebSocketContext] Mensagem de autenticação enviada');

      // Evita ficar preso em "Autenticando..." quando não chega resposta de auth.
      authHandshakeTimeoutRef.current = setTimeout(() => {
        authHandshakeTimeoutRef.current = null;
        const wsOpen = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
        if (!wsOpen || authenticatedRef.current) {
          return;
        }
        logger.warn('[WebSocketContext] Timeout aguardando resposta de autenticação; forçando reconexão');
        setAuthFailed(true);
        scheduleReconnect('auth_timeout', { timeoutMs: 8000 });
      }, 8000);
      return true;
    } catch (err) {
      logger.error('[WebSocketContext] Erro ao enviar autenticação', err);
      return false;
    }
  }, [authenticated, scheduleReconnect]);

  // Atualiza subscriptions quando handlers mudam
  const updateSubscriptions = useCallback(() => {
    if (!authenticatedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
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
  }, []);

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

  useEffect(() => {
    checkServerHealthRef.current = checkServerHealth;
  }, [checkServerHealth]);

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
        logReconnectConsole('Conectado com sucesso');
        isConnectingRef.current = false;
        setConnected(true);
        setAuthenticated(false);
        setAuthFailed(false);
        reconnectAttemptsRef.current = 0;

        // Tenta autenticar se houver token disponível
        // Se não houver token, será autenticado quando o usuário fizer login
        const token = getToken();
        if (token) {
          try {
            logger.debug('[WebSocketContext] Enviando autenticação na conexão...');
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
            if (authHandshakeTimeoutRef.current) {
              clearTimeout(authHandshakeTimeoutRef.current);
              authHandshakeTimeoutRef.current = null;
            }
            logger.debug('[WebSocketContext] Resposta de autenticação recebida', data);
            if (data.status === 'success') {
              logger.info('[WebSocketContext] Autenticado com sucesso', data.agent);
              setAuthenticated(true);
              setAuthFailed(false);
              // As subscriptions serão atualizadas pelo useEffect que observa 'authenticated'
            } else {
              // Se não há token, é esperado (usuário ainda não fez login)
              const hasToken = getToken();
              const messageText = String(data?.message || '');
              const isSessionExpired = /sessão expirada/i.test(messageText);
              if (!hasToken) {
                logger.debug('[WebSocketContext] Falha na autenticação (sem token - esperado antes do login)', data.message || data);
              } else if (isSessionExpired) {
                logger.warn('[WebSocketContext] Sessão expirada no WebSocket; aguardando fluxo de logout/redirecionamento', data.message || data);
              } else {
                // Se há token mas falhou, é um erro real
                logger.error('[WebSocketContext] Falha na autenticação', data.message || data);
              }
              setAuthenticated(false);
              setAuthFailed(true);
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
        if (authHandshakeTimeoutRef.current) {
          clearTimeout(authHandshakeTimeoutRef.current);
          authHandshakeTimeoutRef.current = null;
        }
        setConnected(false);
        setAuthenticated(false);
        setAuthFailed(false);

        scheduleReconnect('onerror', { error: errorMessage, url });
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
        
        // Detecta se foi fechamento devido a reinicialização do servidor (nodemon)
        const isServerRestart = event.code === 1006 || event.code === 1012 || !event.wasClean;
        
        logger.info('[WebSocketContext] Desconectado', { 
          code: event.code, 
          reason: event.reason || reasonText,
          url,
          wasClean: event.wasClean,
          isServerRestart,
          hint: isServerRestart 
            ? 'Servidor pode estar reiniciando (nodemon). Reconectando automaticamente...' 
            : (event.code === 1006 ? 'Servidor pode não estar rodando ou não estar acessível. Verifique se o servidor está ativo em ' + url.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '') : undefined)
        });
        logReconnectConsole('Desconectado', {
          code: event.code,
          reason: event.reason || reasonText,
          url,
          wasClean: event.wasClean,
        });
        isConnectingRef.current = false;
        if (authHandshakeTimeoutRef.current) {
          clearTimeout(authHandshakeTimeoutRef.current);
          authHandshakeTimeoutRef.current = null;
        }
        setConnected(false);
        setAuthenticated(false);
        setAuthFailed(false);

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

        // Reconecta para qualquer fechamento não intencional (inclusive código 1000)
        scheduleReconnect('onclose', {
          code: event.code,
          reason: event.reason || reasonText,
          isServerRestart,
          wasClean: event.wasClean,
        });
      };
    } catch (err) {
      logger.error('[WebSocketContext] Erro ao criar conexão', err);
      isConnectingRef.current = false;
      setConnected(false);
      setAuthenticated(false);
      setAuthFailed(false);
      scheduleReconnect('create_connection_error', {
        error: err?.message || 'erro desconhecido',
      });
    }
  }, [getWebSocketUrl, sendMessage, scheduleReconnect, logReconnectConsole]);

  // Registra um handler de eventos
  const registerHandler = useCallback((componentId, { onEvent, subscribeEvents = [] }) => {
    eventHandlersRef.current.set(componentId, { onEvent, subscribeEvents });
    // Só atualiza subscriptions se já estiver autenticado
    // Caso contrário, o useEffect que observa 'authenticated' fará isso
    if (authenticatedRef.current) {
      updateSubscriptions();
    }
  }, [updateSubscriptions]);

  // Remove um handler de eventos
  const unregisterHandler = useCallback((componentId) => {
    eventHandlersRef.current.delete(componentId);
    // Só atualiza subscriptions se já estiver autenticado
    if (authenticatedRef.current) {
      updateSubscriptions();
    }
  }, [updateSubscriptions]);

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

    const triggerRecoveryConnect = (source) => {
      if (isIntentionalCloseRef.current) return;
      if (connected && authenticated) return;
      logger.info('[WebSocketContext] Trigger de recuperação de conexão', { source });
      reconnect();
    };

    const handleOnline = () => {
      triggerRecoveryConnect('browser-online');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerRecoveryConnect('tab-visible');
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    reconnectWatchdogRef.current = setInterval(() => {
      if (isIntentionalCloseRef.current || isConnectingRef.current) return;
      const wsState = wsRef.current?.readyState;
      const hasPendingReconnect = !!reconnectTimeoutRef.current;

      if (!connected && !hasPendingReconnect && (wsState == null || wsState === WebSocket.CLOSED)) {
        logger.info('[WebSocketContext] Watchdog: forçando nova tentativa de conexão');
        connectRef.current();
      }
    }, 5000);

    return () => {
      // Limpa ao desmontar
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (reconnectWatchdogRef.current) {
        clearInterval(reconnectWatchdogRef.current);
        reconnectWatchdogRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (authHandshakeTimeoutRef.current) {
        clearTimeout(authHandshakeTimeoutRef.current);
        authHandshakeTimeoutRef.current = null;
      }
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  // Observa mudanças no token e tenta autenticar o WebSocket quando conectado
  useEffect(() => {
    if (!connected || authenticated) {
      return;
    }

    // Verifica se há token disponível
    const token = getToken();
    if (token) {
      // Aguarda um pouco para garantir que a conexão está estável
      const timeoutId = setTimeout(() => {
        authenticateWebSocket();
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [connected, authenticated, authFailed, authenticateWebSocket]);

  // Reseta authFailed quando o token muda (novo login em outra aba)
  // Isso permite que o cliente tente autenticar novamente com o novo token
  useEffect(() => {
    const lastTokenRef = { value: getToken() };

    const checkTokenChange = setInterval(() => {
      const currentToken = getToken();
      if (currentToken !== lastTokenRef.value) {
        lastTokenRef.value = currentToken;
        if (currentToken && authFailed) {
          logger.debug('[WebSocketContext] Token mudou, resetando authFailed para permitir nova tentativa');
          setAuthFailed(false);
        }
      }
    }, 500);

    return () => clearInterval(checkTokenChange);
  }, [authFailed]);

  // Observa mudanças no localStorage para detectar quando o token é salvo (após login)
  useEffect(() => {
    if (!connected) {
      return;
    }

    const handleStorageChange = (e) => {
      // Se o token foi salvo e não estamos autenticados, tenta autenticar
      if (e.key === 'auth_token' && e.newValue && !authenticated) {
        logger.debug('[WebSocketContext] Token detectado no localStorage (outra aba), tentando autenticar...');
        // Reseta authFailed para permitir nova tentativa
        setAuthFailed(false);
        setTimeout(() => {
          authenticateWebSocket();
        }, 200);
      }
    };

    // Escuta mudanças no localStorage (incluindo de outras abas)
    window.addEventListener('storage', handleStorageChange);

    // Verifica periodicamente se o token mudou (para a mesma aba - após login)
    // Isso é necessário porque o evento 'storage' só dispara em outras abas
    // Nota: para de tentar se authFailed=true (tentativa anterior falhou - deve aguardar novo login)
    const checkTokenInterval = setInterval(() => {
      if (!connected || authenticated) {
        return;
      }
      
      const token = getToken();
      if (token) {
        logger.debug('[WebSocketContext] Token detectado (mesma aba), tentando autenticar...');
        authenticateWebSocket();
      }
    }, 500); // Verifica a cada 500ms (mais frequente para detectar login rápido)

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(checkTokenInterval);
    };
  }, [connected, authenticated, authFailed, authenticateWebSocket]);

  const value = useMemo(() => ({
    connected,
    authenticated,
    authFailed,
    send: sendMessage,
    reconnect,
    registerHandler,
    unregisterHandler,
  }), [connected, authenticated, authFailed, sendMessage, reconnect, registerHandler, unregisterHandler]);

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
export function useWebSocketContext({ enabled = true, onEvent, subscribeEvents = [], testEventTrigger } = {}) {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext deve ser usado dentro de WebSocketProvider');
  }

  const componentIdRef = useRef(`component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  // Refs sempre atualizadas: o handler registrado uma única vez delega para a
  // versão mais recente dos callbacks, evitando re-registro a cada render.
  const onEventRef = useRef(onEvent);
  const subscribeEventsRef = useRef(subscribeEvents);

  useEffect(() => {
    onEventRef.current = onEvent;
    subscribeEventsRef.current = subscribeEvents;
  });

  const { registerHandler, unregisterHandler } = context;
  // Re-registra apenas quando o CONTEÚDO da lista de eventos muda
  const subscribeKey = Array.isArray(subscribeEvents) ? subscribeEvents.join('|') : '';

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    registerHandler(componentIdRef.current, {
      onEvent: (event, data, raw) => onEventRef.current?.(event, data, raw),
      subscribeEvents: subscribeEventsRef.current || [],
    });
    // Expor trigger de evento para testes automatizados
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'test') {
      window.__wsTestTrigger__ = (event, data, raw) => onEventRef.current?.(event, data, raw);
    }
    return () => {
      unregisterHandler(componentIdRef.current);
    };
  }, [enabled, subscribeKey, registerHandler, unregisterHandler]);

  return {
    connected: context.connected,
    authenticated: context.authenticated,
    authFailed: context.authFailed,
    send: context.send,
    reconnect: context.reconnect,
  };
}
