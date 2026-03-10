import { useCallback, useEffect, useState } from 'react';
import { getCrmContactPlaybooks } from '../../../api/crm';
import { listOperationalPlaybooksAdmin } from '../../../api/superAdmin';
import logger from '../../../utils/logger';

function normalizeItems(value) {
  return Array.isArray(value) ? value : [];
}

export function usePlaybooks({
  tenantId = '',
  contactId = '',
  signalType = '',
  scope = 'contact',
  enabled = true,
  limit = 12,
} = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const tenantKey = String(tenantId || '').trim();
    const contactKey = String(contactId || '').trim();
    const signalKey = String(signalType || '').trim();
    const safeLimit = Math.max(1, Number(limit) || 12);

    if (!enabled || (scope === 'contact' && !contactKey)) {
      setItems([]);
      setError('');
      setLoading(false);
      return { ok: true, items: [] };
    }

    setLoading(true);
    setError('');
    try {
      const out = scope === 'contact'
        ? await getCrmContactPlaybooks(contactKey, { limit: safeLimit })
        : await listOperationalPlaybooksAdmin({
          tenantId: tenantKey || undefined,
          contactId: contactKey || undefined,
          signalType: signalKey || undefined,
          limit: safeLimit,
        });

      const nextItems = normalizeItems(out?.items);
      setItems(nextItems);
      return { ok: true, items: nextItems };
    } catch (err) {
      logger.error('Erro ao carregar playbooks operacionais', err);
      setItems([]);
      setError(err?.message || 'playbooks_unavailable');
      return { ok: false, error: err?.message || 'playbooks_unavailable' };
    } finally {
      setLoading(false);
    }
  }, [contactId, enabled, limit, scope, signalType, tenantId]);

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
    items,
    loading,
    error,
    reload: load,
  };
}
