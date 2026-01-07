/**
 * Contexto de autenticação para gerenciar estado de login/logout.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authApi from '../api/auth';
import logger from '../utils/logger';

const AuthContext = createContext(null);

/**
 * Provider de autenticação.
 */
export function AuthProvider({ children }) {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Flag para evitar carregamento duplicado (especialmente com StrictMode)
  const isLoadingAgentRef = React.useRef(false);
  const hasLoadedAgentRef = React.useRef(false);

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
      setAgent(null);
      setIsAuthenticated(false);
      setLoading(false);
      isLoadingAgentRef.current = false;
      return;
    }

    try {
      const result = await authApi.getCurrentAgent();
      setAgent(result.agent);
      setIsAuthenticated(true);
      
      // Atualiza informações do agente no localStorage (incluindo tenantId)
      if (result.agent) {
        try {
          localStorage.setItem('auth_agent', JSON.stringify(result.agent));
        } catch (err) {
          logger.warn('Erro ao salvar informações do agente no localStorage:', err);
        }
      }
    } catch (err) {
      // Se for erro de conexão (servidor não acessível), não remove o token
      // Pode ser apenas o servidor iniciando
      const isConnectionError = err.message === 'Failed to fetch' || 
                                err.message?.includes('fetch') ||
                                err.message?.includes('ERR_CONNECTION_REFUSED');
      
      if (isConnectionError) {
        // Não loga warning para erros de conexão na inicialização
        // O servidor pode estar apenas iniciando
        logger.debug('Servidor não acessível ao carregar agente (pode estar iniciando)', err);
        // Não remove o token - pode ser apenas uma falha temporária
      } else {
        // Para outros erros (401, 403, etc)
        // Se for 401 e não houver token, é esperado (página carregada sem autenticação)
        const status = err.status || err.body?.status;
        const hasToken = authApi.getToken();
        
        if (status === 401 && !hasToken) {
          // Erro 401 sem token é esperado - usuário ainda não fez login
          logger.debug('Não autenticado (esperado se não houver token)');
        } else if (status === 401 && hasToken) {
          // Erro 401 com token significa que a sessão expirou ou é inválida
          logger.warn('Sessão inválida ou expirada', err);
          authApi.removeToken();
        } else {
          // Outros erros (403, 500, etc)
          logger.warn('Erro ao carregar agente autenticado', err);
          if (status === 403) {
            authApi.removeToken();
          }
        }
      }
      
      setAgent(null);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
      isLoadingAgentRef.current = false;
    }
  }, []);

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
      
      return result;
    } catch (err) {
      logger.error('Erro ao fazer login', err);
      throw err;
    }
  }, []);

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

  const value = {
    agent,
    loading,
    isAuthenticated,
    login,
    logout,
    reloadAgent: loadAgent,
    updateAgent,
  };

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

