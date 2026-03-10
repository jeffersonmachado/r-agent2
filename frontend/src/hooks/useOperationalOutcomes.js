import { useEffect, useState } from 'react';
import * as superAdminApi from '../api/superAdmin';

export function useOperationalOutcomes({
  tenantId,
  enabled = true,
  limit = 50,
  status = '',
  sourceType = '',
  outcomeType = '',
  signalId = '',
  recommendationId = '',
  playbookExecutionId = '',
  from = '',
  to = '',
} = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function reload() {
    if (!tenantId || !enabled) {
      setItems([]);
      return;
    }

    try {
      setLoading(true);
      setError('');
      const out = await superAdminApi.getOccTenantOperationalOutcomes(tenantId, {
        limit,
        status: status || undefined,
        sourceType: sourceType || undefined,
        outcomeType: outcomeType || undefined,
        signalId: signalId || undefined,
        recommendationId: recommendationId || undefined,
        playbookExecutionId: playbookExecutionId || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (err) {
      setError(err?.message || 'Erro ao carregar outcomes operacionais');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, [tenantId, enabled, limit, status, sourceType, outcomeType, signalId, recommendationId, playbookExecutionId, from, to]);

  return {
    items,
    loading,
    error,
    reload,
  };
}
