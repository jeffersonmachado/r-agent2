import { useCallback, useRef } from 'react';

/**
 * Evita execução concorrente de operações assíncronas.
 *
 * Exemplo:
 * const guard = useInFlightGuard();
 * await guard.run(async () => { ... });
 */
export function useInFlightGuard(initialValue = false) {
  const inFlightRef = useRef(initialValue);

  const start = useCallback(() => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    return true;
  }, []);

  const end = useCallback(() => {
    inFlightRef.current = false;
  }, []);

  const run = useCallback(async (fn) => {
    if (!start()) return undefined;
    try {
      return await fn();
    } finally {
      end();
    }
  }, [start, end]);

  return { inFlightRef, start, end, run };
}
