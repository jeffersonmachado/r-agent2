import { useCallback, useEffect, useState } from 'react';

export const useGenerateSystemRateLimit = ({ fetchJson, logger, setError }) => {
  const [rateLimitUntil, setRateLimitUntil] = useState(null);
  const [rateLimitSecondsRemaining, setRateLimitSecondsRemaining] = useState(0);

  useEffect(() => {
    if (!rateLimitUntil) {
      setRateLimitSecondsRemaining(0);
      return;
    }

    const updateCounter = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((rateLimitUntil - now) / 1000));
      setRateLimitSecondsRemaining(remaining);

      if (remaining <= 0) {
        setRateLimitUntil(null);
        setError(null);
      }
    };

    updateCounter();
    const interval = setInterval(updateCounter, 1000);

    return () => clearInterval(interval);
  }, [rateLimitUntil, setError]);

  const clearRateLimit = useCallback(async () => {
    try {
      logger.info('[RateLimit] Tentando limpar rate limit');
      const response = await fetchJson('/admin/rate-limit/clear', {
        method: 'POST',
      });

      if (!response.success) {
        throw new Error(response.message || 'Erro ao limpar rate limit');
      }

      setRateLimitUntil(null);
      setRateLimitSecondsRemaining(0);
      setError(null);
      logger.info('[RateLimit] Rate limit limpo com sucesso', response);
    } catch (err) {
      logger.error('[RateLimit] Erro ao limpar rate limit', err);
      if (err.status === 403) {
        setError('Este recurso esta disponivel apenas em desenvolvimento');
      } else {
        setError(`Erro ao limpar rate limit: ${err.message || 'Erro desconhecido'}`);
      }
    }
  }, [fetchJson, logger, setError]);

  return {
    rateLimitUntil,
    setRateLimitUntil,
    rateLimitSecondsRemaining,
    setRateLimitSecondsRemaining,
    clearRateLimit,
  };
};
