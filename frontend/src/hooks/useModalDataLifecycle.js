import { useEffect } from 'react';

/**
 * Executa carregamento quando modal está aberto e condição de carga é atendida.
 * Opcionalmente reseta estado quando condição não é atendida.
 */
export function useModalDataLifecycle({ isOpen, canLoad = true, load, reset }) {
  useEffect(() => {
    if (isOpen && canLoad) {
      load?.();
      return;
    }

    if (reset) {
      reset();
    }
  }, [isOpen, canLoad, load, reset]);
}
