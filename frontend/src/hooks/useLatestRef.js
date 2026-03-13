import { useEffect, useRef } from 'react';

/**
 * Mantém uma ref sempre sincronizada com o valor mais recente.
 * Útil para callbacks/eventos assíncronos sem recriar handlers.
 */
export function useLatestRef(value) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}
