import { useState, useEffect } from 'react';

/**
 * Hook para detectar se está em tela pequena (mobile)
 * Considera mobile quando a largura é menor que 768px (breakpoint md do Tailwind)
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}
