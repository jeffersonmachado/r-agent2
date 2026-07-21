import { useCallback, useEffect, useState } from 'react';
import { businessRulesService } from '../services/businessRulesService';

export function useBusinessRules() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await businessRulesService.fetchJourneys();
      setData(result);
    } catch (err) {
      setError(err.message || 'Falha ao carregar regras de negocio');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

