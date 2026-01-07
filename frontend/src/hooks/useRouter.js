import { useState, useEffect, useCallback } from 'react';
import { getBasePath } from '../utils';

// Evento customizado para notificar mudanças de rota
const ROUTE_CHANGE_EVENT = 'router:change';

/**
 * Remove o prefixo base path do pathname (ex: /r-agent2/dashboard -> /dashboard)
 */
function normalizePath(pathname) {
  const basePath = getBasePath();
  if (basePath && pathname.startsWith(basePath)) {
    const normalized = pathname.substring(basePath.length) || '/';
    return normalized;
  }
  return pathname;
}

/**
 * Hook para roteamento baseado em URL (sem dependências externas).
 * Usa window.location.pathname para determinar a rota atual.
 * Remove automaticamente o prefixo /r-agent2 se presente.
 * 
 * @returns {{ currentPath: string, navigate: (path: string) => void }}
 */
export function useRouter() {
  const [currentPath, setCurrentPath] = useState(() => {
    // Lê a rota inicial da URL e remove o prefixo se existir
    return normalizePath(window.location.pathname);
  });

  useEffect(() => {
    // Função para atualizar o path baseado na URL atual
    const updatePath = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };

    // Escuta mudanças no histórico do navegador (botões voltar/avançar)
    window.addEventListener('popstate', updatePath);
    
    // Escuta mudanças de rota via evento customizado (quando navigate é chamado)
    window.addEventListener(ROUTE_CHANGE_EVENT, updatePath);

    return () => {
      window.removeEventListener('popstate', updatePath);
      window.removeEventListener(ROUTE_CHANGE_EVENT, updatePath);
    };
  }, []);

  const navigate = useCallback((path) => {
    // Adiciona o prefixo base path se necessário
    const basePath = getBasePath();
    const fullPath = basePath && !path.startsWith(basePath) 
      ? `${basePath}${path.startsWith('/') ? path : `/${path}`}`
      : path;
    
    // Atualiza a URL sem recarregar a página
    window.history.pushState({}, '', fullPath);
    // Atualiza o estado local (sem o prefixo)
    setCurrentPath(normalizePath(fullPath));
    // Dispara evento customizado para notificar outras instâncias do hook
    window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT));
  }, []);

  return { currentPath, navigate };
}

