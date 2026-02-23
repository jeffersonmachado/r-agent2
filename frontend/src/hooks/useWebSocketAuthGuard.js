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
  const { authFailed, connected, authenticated } = useWebSocketContext();
  const { isAuthenticated, logout } = useAuth();
  const { navigate } = useRouter();
  const hasHandledFailureRef = useRef(false);
  const lastAuthFailedStateRef = useRef(false);

  useEffect(() => {
    // Se WebSocket falhou na autenticação E usuário está autenticado
    // MAS: só processa se o WebSocket já tentou conectar (evita falso positivo logo após login)
    if (authFailed && isAuthenticated && connected) {
      // Evita executar múltiplas vezes para mesma falha
      if (hasHandledFailureRef.current && lastAuthFailedStateRef.current === authFailed) {
        return;
      }

      // Aguarda um pequeno delay para garantir que não é um estado transitório
      // Logo após login, o WebSocket pode estar em processo de autenticação
      const timeoutId = setTimeout(() => {
        // Verifica novamente após o delay se ainda está com falha
        if (!authenticated && isAuthenticated && authFailed) {
          hasHandledFailureRef.current = true;
          lastAuthFailedStateRef.current = authFailed;

          logger.warn('[useWebSocketAuthGuard] WebSocket auth falhou após verificação, fazendo logout e redirecionando para login');
          
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
      }, 1500); // Aguarda 1.5s para garantir que o WebSocket tentou autenticar

      return () => clearTimeout(timeoutId);
    }

    // Se autenticou com sucesso, reseta a flag
    if (authenticated && isAuthenticated) {
      hasHandledFailureRef.current = false;
      lastAuthFailedStateRef.current = false;
    }

    // Se deixou de estar autenticado, reseta a flag para permitir nova falha futura
    if (!isAuthenticated) {
      hasHandledFailureRef.current = false;
      lastAuthFailedStateRef.current = false;
    }
  }, [authFailed, authenticated, connected, isAuthenticated, logout, navigate]);
}

export default useWebSocketAuthGuard;
