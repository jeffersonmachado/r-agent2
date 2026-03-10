import { useCallback, useEffect, useState } from 'react';
import { getCrmContactOperationalSummary } from '../../../api/crm';
import { getOccTenantCrmOperationalSummary } from '../../../api/superAdmin';
import logger from '../../../utils/logger';

export function useCrmTimelineSummary({
  tenantId = '',
  contactId = '',
  enabled = true,
  recentWindowHours = 72,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const tenantKey = String(tenantId || '').trim();
    const contactKey = String(contactId || '').trim();
    if (!enabled || (!tenantKey && !contactKey)) {
      setSummary(null);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const out = contactKey
        ? await getCrmContactOperationalSummary(contactKey, { recentWindowHours })
        : await getOccTenantCrmOperationalSummary(tenantKey, { recentWindowHours });
      setSummary(out?.summary || null);
    } catch (err) {
      logger.error('Erro ao carregar resumo CRM operacional', err);
      setSummary(null);
      setError(err?.message || 'summary_unavailable');
    } finally {
      setLoading(false);
    }
  }, [contactId, enabled, recentWindowHours, tenantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return {
    summary,
    loading,
    error,
    reload: load,
  };
}
