import { useState, useEffect } from 'react';

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
    // Escuta mudanças no histórico do navegador (botões voltar/avançar)
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path) => {
    // Atualiza a URL sem recarregar a página
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  return { currentPath, navigate };
}

