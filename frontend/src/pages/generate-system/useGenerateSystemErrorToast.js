import { useEffect, useRef } from 'react';

export const useGenerateSystemErrorToast = ({ error, showToast }) => {
  const lastErrorToastRef = useRef(null);

  useEffect(() => {
    if (!error) return;
    const message = typeof error === 'string' ? error.trim() : String(error);
    if (!message) return;
    if (lastErrorToastRef.current === message) return;

    lastErrorToastRef.current = message;
    showToast?.(message, 'error', 10000);
  }, [error, showToast]);
};
