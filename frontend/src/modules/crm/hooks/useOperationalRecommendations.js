import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCrmContactOperationalRecommendations } from '../../../api/crm';
import {
  generateOccTenantOperationalRecommendations,
  getOccTenantOperationalRecommendations,
  updateOccTenantOperationalRecommendationStatus,
} from '../../../api/superAdmin';
import logger from '../../../utils/logger';

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

export function useOperationalRecommendations({
  tenantId = '',
  contactId = '',
  scope = 'contact',
  enabled = true,
  limit = 100,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const mode = useMemo(() => (scope === 'tenant' ? 'tenant' : 'contact'), [scope]);

  const load = useCallback(async ({ generateFirst = false } = {}) => {
    const tenantKey = String(tenantId || '').trim();
    const contactKey = String(contactId || '').trim();
    const safeLimit = Math.max(1, Number(limit) || 100);
    if (!enabled || (mode === 'tenant' ? !tenantKey : !contactKey)) {
      setItems([]);
      setError('');
      setLoading(false);
      return { ok: true, items: [] };
    }

    setLoading(true);
    setError('');
    try {
      if (mode === 'tenant' && generateFirst) {
        await generateOccTenantOperationalRecommendations(tenantKey, {
          contactId: contactKey || null,
        });
      }

      const out = mode === 'tenant'
        ? await getOccTenantOperationalRecommendations(tenantKey, { limit: safeLimit })
        : await getCrmContactOperationalRecommendations(contactKey, { limit: safeLimit });
      const nextItems = normalizeList(out?.items);
      setItems(nextItems);
      return { ok: true, items: nextItems };
    } catch (err) {
      logger.error('Erro ao carregar recomendações operacionais', err);
      setItems([]);
      setError(err?.message || 'operational_recommendations_unavailable');
      return { ok: false, error: err?.message || 'operational_recommendations_unavailable' };
    } finally {
      setLoading(false);
    }
  }, [contactId, enabled, limit, mode, tenantId]);

  const generate = useCallback(async () => {
    if (mode !== 'tenant') return { ok: false, error: 'unsupported_scope' };
    return load({ generateFirst: true });
  }, [load, mode]);

  const updateStatus = useCallback(async (recommendationId, status) => {
    const tenantKey = String(tenantId || '').trim();
    if (mode !== 'tenant') return { ok: false, error: 'unsupported_scope' };
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    const id = String(recommendationId || '').trim();
    if (!id) return { ok: false, error: 'recommendation_id_required' };

    try {
      const out = await updateOccTenantOperationalRecommendationStatus(tenantKey, id, status);
      if (!out?.ok) return out;
      await load({ generateFirst: false });
      return out;
    } catch (err) {
      logger.error('Erro ao atualizar status da recomendação operacional', err);
      return { ok: false, error: err?.message || 'operational_recommendation_status_update_failed' };
    }
  }, [load, mode, tenantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load({ generateFirst: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return {
    items,
    loading,
    error,
    reload: () => load({ generateFirst: false }),
    generate,
    updateStatus,
  };
}
