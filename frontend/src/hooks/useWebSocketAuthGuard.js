/**
 * Hook para monitorar falhas de autenticação do WebSocket e redirecionar para login.
 * 
 * Quando o WebSocket falha na autenticação (token inválido/expirado),
 * faz logout do usuário e redireciona para a página de login.
 */

import { useEffect, useRef } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useAuth } from '../context/authContext';
import { useRouter } from './useRouter';
import logger from '../utils/logger';

/**
 * Hook que redireciona para login quando WebSocket auth falha.
 * 
 * Use em componente dentro de AuthProvider + WebSocketProvider.
 */
export function useWebSocketAuthGuard() {
  const { authFailed } = useWebSocketContext();
  const { isAuthenticated, logout } = useAuth();
  const { navigate } = useRouter();
  const hasHandledFailureRef = useRef(false);

  useEffect(() => {
    // Se WebSocket falhou na autenticação E usuário está autenticado
    if (authFailed && isAuthenticated) {
      // Evita executar múltiplas vezes para mesma falha
      if (hasHandledFailureRef.current) {
        return;
      }

      hasHandledFailureRef.current = true;

      logger.warn('[useWebSocketAuthGuard] WebSocket auth falhou, fazendo logout e redirecionando para login');
      
      // Faz logout de forma assíncrona
      (async () => {
        try {
          await logout();
        } catch (err) {
          logger.error('[useWebSocketAuthGuard] Erro ao fazer logout', err);
        } finally {
          // Redireciona para login independentemente de sucesso/erro
          navigate('/login');
        }
      })();
    }

    // Se deixou de estar autenticado, reseta a flag para permitir nova falha futura
    if (!isAuthenticated) {
      hasHandledFailureRef.current = false;
    }
  }, [authFailed, isAuthenticated, logout, navigate]);
}

export default useWebSocketAuthGuard;
