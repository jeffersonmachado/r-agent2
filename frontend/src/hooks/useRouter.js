import { useState, useEffect, useCallback } from 'react';
import { getBasePath } from '../utils';

// Evento customizado para notificar mudanças de rota
const ROUTE_CHANGE_EVENT = 'router:change';

/**
 * Remove o prefixo base path do pathname (ex: /r-agent2/dashboard -> /dashboard)
 * Suporta múltiplas formas de prefixo (configurado ou hardcoded)
 */
function normalizePath(pathname) {
  const basePath = getBasePath();
  
  // Primeiro tenta remover o basePath configurado (ex: /r-agent2)
  if (basePath && pathname.startsWith(basePath)) {
    const normalized = pathname.substring(basePath.length) || '/';
    return normalized;
  }
  
  // Fallback: Se não temos basePath definido mas a URL tem /r-agent2, remove mesmo assim
  // Isso garante que funcione em produção mesmo se VITE_BASE_PATH não estiver definido
  if (!basePath && pathname.startsWith('/r-agent2/')) {
    const normalized = pathname.substring('/r-agent2'.length) || '/';
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
    
    // Garante que o path comece com /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    
    // Constrói o fullPath com o prefixo se necessário
    let fullPath;
    if (basePath) {
      // Se temos um basePath, sempre adiciona ao path
      // Remove o basePath do path se já estiver presente para evitar duplicação
      let pathWithoutBase = normalizedPath;
      if (normalizedPath.startsWith(basePath)) {
        pathWithoutBase = normalizedPath.substring(basePath.length);
        // Garante que comece com / se não estiver vazio
        if (pathWithoutBase && !pathWithoutBase.startsWith('/')) {
          pathWithoutBase = `/${pathWithoutBase}`;
        }
        // Se ficou vazio após remover o basePath, usa /
        if (!pathWithoutBase) {
          pathWithoutBase = '/';
        }
      }
      fullPath = `${basePath}${pathWithoutBase}`;
    } else {
      fullPath = normalizedPath;
    }
    
    // Log para debug (pode ser removido em produção)
    if (process.env.NODE_ENV === 'development') {
      console.log('[useRouter] navigate:', { path, basePath, fullPath });
    }
    
    // Atualiza a URL sem recarregar a página
    window.history.pushState({}, '', fullPath);
    // Atualiza o estado local (sem o prefixo)
    setCurrentPath(normalizePath(fullPath));
    // Dispara evento customizado para notificar outras instâncias do hook
    window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT));
  }, []);

  return { currentPath, navigate };
}

