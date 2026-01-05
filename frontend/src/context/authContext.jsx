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
        // Para outros erros (401, 403, etc), remove o token
        logger.warn('Erro ao carregar agente autenticado', err);
        authApi.removeToken();
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
      setAgent(result.agent);
      setIsAuthenticated(true);
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

  const value = {
    agent,
    loading,
    isAuthenticated,
    login,
    logout,
    reloadAgent: loadAgent,
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

