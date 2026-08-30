/**
 * Contexto de autenticação para gerenciar estado de login/logout.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import * as authApi from '../api/auth';
import { getTenantCapabilities, updateTenantCapabilities, DEFAULT_TENANT_CAPABILITIES } from '../api/tenantCapabilities';
import logger from '../utils/logger';

const AuthContext = createContext(null);

/**
 * Provider de autenticação.
 */
export function AuthProvider({ children }) {
  const [agent, setAgent] = useState(null);
  const [capabilities, setCapabilities] = useState(DEFAULT_TENANT_CAPABILITIES);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Flag para evitar carregamento duplicado (especialmente com StrictMode)
  const isLoadingAgentRef = React.useRef(false);
  const hasLoadedAgentRef = React.useRef(false);
  const retryCountRef = React.useRef(0);
  const retryTimerRef = React.useRef(null);

  /**
   * Carrega as capacidades operacionais do tenant (inbox, case management...).
   * Falha de fetch mantém o default seguro e apenas loga — nunca bloqueia a sessão.
   */
  const loadCapabilities = useCallback(async () => {
    try {
      const result = await getTenantCapabilities();
      if (result && result.capabilities && typeof result.capabilities === 'object') {
        setCapabilities({ ...DEFAULT_TENANT_CAPABILITIES, ...result.capabilities });
      }
    } catch (err) {
      logger.warn('Erro ao carregar capacidades do tenant; mantendo defaults', err);
    }
  }, []);

  /**
   * Carrega informações do agente autenticado.
   */
  const loadAgent = useCallback(async () => {
    // Evita requisições duplicadas
    if (isLoadingAgentRef.current) {
      return;
    }
    
    isLoadingAgentRef.current = true;
    const token = authApi.getToken();
    if (!token) {
      retryCountRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setAgent(null);
      setIsAuthenticated(false);
      setLoading(false);
      isLoadingAgentRef.current = false;
      return;
    }

    try {
      const result = await authApi.getCurrentAgent();
      
      // Preserva originalTenantId do localStorage se existir
      let agentToSet = result.agent;
      if (agentToSet) {
        try {
          const storedAgent = localStorage.getItem('auth_agent');
          if (storedAgent) {
            const parsedStoredAgent = JSON.parse(storedAgent);
            // Preserva originalTenantId e tenantId selecionado (super-admin)
            if (parsedStoredAgent.originalTenantId) {
              agentToSet = {
                ...agentToSet,
                originalTenantId: parsedStoredAgent.originalTenantId,
                // Se o super-admin selecionou um tenant no modal, mantém esse tenantId
                // mesmo que /auth/me retorne tenantId="system".
                ...(parsedStoredAgent.tenantId ? { tenantId: parsedStoredAgent.tenantId } : {}),
              };
            }
          }
        } catch (err) {
          logger.warn('Erro ao ler informações do agente do localStorage:', err);
        }
      }
      
      setAgent(agentToSet);
      setIsAuthenticated(true);
      retryCountRef.current = 0;

      // Capacidades do tenant acompanham a sessão autenticada (fonte: servidor)
      loadCapabilities();
      
      // Atualiza informações do agente no localStorage (preservando originalTenantId)
      if (agentToSet) {
        try {
          localStorage.setItem('auth_agent', JSON.stringify(agentToSet));
        } catch (err) {
          logger.warn('Erro ao salvar informações do agente no localStorage:', err);
        }
      }
    } catch (err) {
      const msg = String(err?.message || '');
      const isAbortError = err?.name === 'AbortError' || msg.includes('signal is aborted');
      const isConnectionError =
        err?.connectionRefused ||
        err?.status === 0 ||
        msg === 'Failed to fetch' ||
        msg.includes('fetch') ||
        msg.includes('ERR_CONNECTION_REFUSED') ||
        msg.includes('NetworkError');

      const isTransient = isAbortError || isConnectionError;

      if (isTransient) {
        // Servidor pode estar reiniciando/ocupado; não “desloga” o usuário.
        logger.debug('Falha temporária ao carregar agente (servidor pode estar iniciando)', err);

        // Se houver um agente salvo, mantém a sessão local enquanto o servidor volta.
        try {
          const storedAgent = localStorage.getItem('auth_agent');
          if (storedAgent) {
            const parsedStoredAgent = JSON.parse(storedAgent);
            if (parsedStoredAgent) {
              setAgent(parsedStoredAgent);
              setIsAuthenticated(true);
            }
          }
        } catch {
          // ignora
        }

        // Agenda novas tentativas com backoff (máx. 5) para recuperar a sessão automaticamente.
        if (retryCountRef.current < 5 && !retryTimerRef.current) {
          const attempt = retryCountRef.current + 1;
          retryCountRef.current = attempt;
          const delayMs = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            loadAgent();
          }, delayMs);
        }
      } else {
        // Para outros erros (401, 403, etc)
        const status = err?.status || err?.body?.status;
        const hasToken = authApi.getToken();

        if (status === 401 && !hasToken) {
          logger.debug('Não autenticado (esperado se não houver token)');
        } else if (status === 401 && hasToken) {
          logger.warn('Sessão inválida ou expirada', err);
          authApi.removeToken();
        } else {
          logger.warn('Erro ao carregar agente autenticado', err);
          if (status === 403) {
            authApi.removeToken();
          }
        }

        setAgent(null);
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
      isLoadingAgentRef.current = false;
    }
  }, [loadCapabilities]);

  /**
   * Faz login.
   */
  const login = useCallback(async (username, password) => {
    try {
      const result = await authApi.login(username, password);
      // Garante que o token foi salvo antes de definir o estado
      // O authApi.login já salva o token, mas vamos garantir que está disponível
      const token = authApi.getToken();
      if (!token && result.token) {
        // Se por algum motivo o token não foi salvo, salva agora
        authApi.setToken(result.token);
      }
      
      // Define o agente e estado de autenticação diretamente do resultado do login
      // Não precisamos recarregar do servidor, pois já temos os dados
      setAgent(result.agent);
      setIsAuthenticated(true);
      setLoading(false);

      // Capacidades do tenant acompanham o login (fonte: servidor)
      loadCapabilities();

      return result;
    } catch (err) {
      logger.error('Erro ao fazer login', err);
      throw err;
    }
  }, [loadCapabilities]);

  /**
   * Faz logout.
   */
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      logger.warn('Erro ao fazer logout', err);
    } finally {
      setAgent(null);
      setIsAuthenticated(false);
      setCapabilities(DEFAULT_TENANT_CAPABILITIES);
    }
  }, []);

  // Carrega agente ao montar - apenas uma vez
  useEffect(() => {
    // Evita carregar múltiplas vezes (especialmente com StrictMode)
    if (hasLoadedAgentRef.current) {
      return;
    }
    
    hasLoadedAgentRef.current = true;
    loadAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Executa apenas uma vez no mount

  // Cleanup de timer de retry
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  /**
   * Atualiza o agente diretamente (útil para atualizações locais sem buscar do servidor)
   */
  const updateAgent = useCallback((updatedAgent) => {
    setAgent(updatedAgent);
    setIsAuthenticated(!!updatedAgent);
    if (updatedAgent) {
      try {
        localStorage.setItem('auth_agent', JSON.stringify(updatedAgent));
      } catch (err) {
        logger.warn('Erro ao salvar informações do agente no localStorage:', err);
      }
    }
  }, []);

  /**
   * Atualiza capacidades do tenant no servidor e reflete no contexto.
   * Re-lança o erro para o chamador decidir (ex.: 403 para não admin/owner).
   */
  const updateCapabilities = useCallback(async (partialCapabilities) => {
    const result = await updateTenantCapabilities(partialCapabilities);
    if (result && result.capabilities && typeof result.capabilities === 'object') {
      setCapabilities({ ...DEFAULT_TENANT_CAPABILITIES, ...result.capabilities });
    }
    return result;
  }, []);

  const value = useMemo(() => ({
    agent,
    capabilities,
    loading,
    isAuthenticated,
    login,
    logout,
    reloadAgent: loadAgent,
    updateAgent,
    refreshCapabilities: loadCapabilities,
    updateCapabilities,
  }), [agent, capabilities, loading, isAuthenticated, login, logout, loadAgent, updateAgent, loadCapabilities, updateCapabilities]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook para usar o contexto de autenticação.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider');
  }
  return context;
}

