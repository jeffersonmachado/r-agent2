import { useCallback, useEffect, useState } from 'react';
import { getTenantSetting } from '../api/tenantSettings';
import logger from '../utils/logger';

export function usePhoneMasking() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await getTenantSetting('phone-masking');
      const value = resp?.value || resp?.data?.value || null;
      let next = true;
      if (value && typeof value === 'object' && typeof value.enabled === 'boolean') {
        next = value.enabled;
      } else if (typeof value === 'boolean') {
        next = value;
      } else if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') next = true;
        if (normalized === 'false') next = false;
      }
      setEnabled(next);
    } catch (err) {
      logger.warn('[PhoneMasking] Falha ao carregar setting', err);
      setEnabled(true);
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
