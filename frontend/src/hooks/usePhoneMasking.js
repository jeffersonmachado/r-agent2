import { useCallback, useEffect, useState } from 'react';
import { getTenantSetting } from '../api/tenantSettings';
import logger from '../utils/logger';

export function usePhoneMasking() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await getTenantSetting('phone-masking');
      const value = resp?.value || resp?.data?.value || null;
      const next = value && typeof value === 'object' ? !!value.enabled : false;
      setEnabled(next);
    } catch (err) {
      logger.warn('[PhoneMasking] Falha ao carregar setting', err);
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    enabled,
    loading,
    refresh: load,
    setEnabled,
  };
}
