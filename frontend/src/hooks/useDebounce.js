import { useRef, useCallback, useEffect } from 'react';

/**
 * Hook para debounce de funções.
 * Útil para evitar múltiplas chamadas rápidas de funções, especialmente em eventos WebSocket.
 * 
 * @param {Function} fn - Função a ser debounced
 * @param {number} delay - Delay em milissegundos (padrão: 500ms)
 * @returns {Function} Função debounced
 * 
 * @example
 * const debouncedLoadTickets = useDebounce(loadTickets, 500);
 * // Agora pode chamar debouncedLoadTickets() múltiplas vezes
 * // mas só executará após 500ms sem novas chamadas
 */
export function useDebounce(fn, delay = 500) {
  const timeoutRef = useRef(null);
  const latestFnRef = useRef(fn);

  useEffect(() => {
    latestFnRef.current = fn;
  }, [fn]);

  const debouncedFn = useCallback(
    (...args) => {
      // Limpa timeout anterior se existir
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Cria novo timeout
      timeoutRef.current = setTimeout(() => {
        latestFnRef.current(...args);
        timeoutRef.current = null;
      }, delay);
    },
    [delay]
  );

  // Limpa timeout ao desmontar
  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return { debouncedFn, cancel };
}
