import { useState, useEffect, useCallback } from 'react';

// Evento customizado para notificar mudanças de rota
const ROUTE_CHANGE_EVENT = 'router:change';

/**
 * Hook para roteamento baseado em URL (sem dependências externas).
 * Usa window.location.pathname para determinar a rota atual.
 * 
 * @returns {{ currentPath: string, navigate: (path: string) => void }}
 */
export function useRouter() {
  const [currentPath, setCurrentPath] = useState(() => {
    // Lê a rota inicial da URL
    return window.location.pathname;
  });

  useEffect(() => {
    // Função para atualizar o path baseado na URL atual
    const updatePath = () => {
      setCurrentPath(window.location.pathname);
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
    // Atualiza a URL sem recarregar a página
    window.history.pushState({}, '', path);
    // Atualiza o estado local
    setCurrentPath(path);
    // Dispara evento customizado para notificar outras instâncias do hook
    window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT));
  }, []);

  return { currentPath, navigate };
}

