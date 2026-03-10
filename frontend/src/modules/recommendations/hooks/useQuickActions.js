import { useCallback, useState } from 'react';
import * as superAdminApi from '../../../api/superAdmin';
import * as crmApi from '../../../api/crm';
import logger from '../../../utils/logger';

/**
 * useQuickActions
 * Hook for fetching and executing quick actions for signals/recommendations
 */

export function useQuickActions({
  scope = 'admin', // 'admin' | 'contact'
  tenantId = '',
  contactId = '',
  supportContext = null,
  sourceType = 'signal', // 'signal' or 'recommendation'
  sourceId = '',
  enabled = true,
}) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(null);
  const [error, setError] = useState('');

  const mode = String(scope || 'admin').trim().toLowerCase() === 'contact' ? 'contact' : 'admin';

  const loadActions = useCallback(async () => {
    const tenantKey = String(tenantId || '').trim();
    const contactKey = String(contactId || '').trim();
    const sourceKey = String(sourceId || '').trim();
    const typeKey = String(sourceType || '').trim();

    const hasScope = mode === 'contact'
      ? !!contactKey
      : !!tenantKey;

    if (!enabled || !hasScope || !sourceKey || !typeKey) {
      setActions([]);
      return { ok: true, actions: [] };
    }

    setLoading(true);
    setError('');
    try {
      let response;
      if (typeKey === 'signal') {
        response = mode === 'contact'
          ? await crmApi.listContactQuickActionsForSignal({
            contactId: contactKey,
            signalId: sourceKey,
            ...(supportContext ? { supportContext } : {}),
          })
          : await superAdminApi.listQuickActionsForSignal({
            tenantId: tenantKey,
            signalId: sourceKey,
          });
      } else {
        response = mode === 'contact'
          ? await crmApi.listContactQuickActionsForRecommendation({
            contactId: contactKey,
            recommendationId: sourceKey,
            ...(supportContext ? { supportContext } : {}),
          })
          : await superAdminApi.listQuickActionsForRecommendation({
            tenantId: tenantKey,
            recommendationId: sourceKey,
          });
      }

      if (response?.ok && Array.isArray(response.items)) {
        setActions(response.items);
        return { ok: true, actions: response.items };
      } else {
        setError(response?.error?.message || 'Erro ao carregar quick actions');
        setActions([]);
        return { ok: false, actions: [] };
      }
    } catch (err) {
      logger.error('[useQuickActions] Erro ao carregar actions:', err);
      setError(err.message);
      setActions([]);
      return { ok: false, actions: [] };
    } finally {
      setLoading(false);
    }
  }, [tenantId, contactId, supportContext, sourceId, sourceType, enabled, mode]);

  const executeAction = useCallback(async (actionId, input = {}) => {
    const tenantKey = String(tenantId || '').trim();
    const contactKey = String(contactId || '').trim();
    const sourceKey = String(sourceId || '').trim();
    const actionKey = String(actionId || '').trim();
    const typeKey = String(sourceType || '').trim();

    const hasScope = mode === 'contact' ? !!contactKey : !!tenantKey;
    if (!hasScope || !sourceKey || !actionKey) {
      return { ok: false, error: 'Parâmetros obrigatórios ausentes' };
    }

    setExecuting(actionId);
    try {
      let response;
      if (typeKey === 'signal') {
        response = mode === 'contact'
          ? await crmApi.executeContactQuickActionForSignal({
            contactId: contactKey,
            signalId: sourceKey,
            actionId: actionKey,
            input,
            ...(supportContext ? { supportContext } : {}),
          })
          : await superAdminApi.executeQuickActionForSignal({
            tenantId: tenantKey,
            signalId: sourceKey,
            actionId: actionKey,
            input,
          });
      } else {
        response = mode === 'contact'
          ? await crmApi.executeContactQuickActionForRecommendation({
            contactId: contactKey,
            recommendationId: sourceKey,
            actionId: actionKey,
            input,
            ...(supportContext ? { supportContext } : {}),
          })
          : await superAdminApi.executeQuickActionForRecommendation({
            tenantId: tenantKey,
            recommendationId: sourceKey,
            actionId: actionKey,
            input,
          });
      }

      if (!response?.ok) {
        const errMsg = response?.error?.message || 'Erro ao executar ação';
        setError(errMsg);
        return { ok: false, error: errMsg };
      }

      return { ok: true, result: response.result };
    } catch (err) {
      logger.error('[useQuickActions] Erro ao executar action:', err);
      setError(err.message);
      return { ok: false, error: err.message };
    } finally {
      setExecuting(null);
    }
  }, [tenantId, contactId, supportContext, sourceId, sourceType, mode]);

  return {
    actions,
    loading,
    executing,
    error,
    loadActions,
    executeAction,
  };
}
