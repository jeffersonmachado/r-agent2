import { useCallback, useState } from 'react';
import {
  executeOperationalPlaybookAdmin,
  stepOperationalPlaybookAdmin,
} from '../../../api/superAdmin';
import logger from '../../../utils/logger';

export function usePlaybookExecution() {
  const [execution, setExecution] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const startExecution = useCallback(async ({
    playbookId,
    tenantId,
    contactId,
    signalId = null,
    recommendationId = null,
    accountId = null,
    phoneNumber = null,
    teamId = null,
    conversationId = null,
    ticketId = null,
    metadata = {},
  }) => {
    setLoading(true);
    setError('');
    try {
      const out = await executeOperationalPlaybookAdmin(playbookId, {
        tenantId,
        contactId,
        signalId,
        recommendationId,
        accountId,
        phoneNumber,
        teamId,
        conversationId,
        ticketId,
        metadata,
      });

      if (!out?.ok) {
        setError(out?.error || 'playbook_execution_failed');
        return out;
      }

      setExecution(out.execution || null);
      return out;
    } catch (err) {
      logger.error('Erro ao iniciar execução de playbook', err);
      setError(err?.message || 'playbook_execution_failed');
      return { ok: false, error: err?.message || 'playbook_execution_failed' };
    } finally {
      setLoading(false);
    }
  }, []);

  const runNextStep = useCallback(async ({ playbookId, tenantId, executionId, context = {} }) => {
    setLoading(true);
    setError('');
    try {
      const out = await stepOperationalPlaybookAdmin(playbookId, {
        tenantId,
        executionId,
        action: 'next',
        context,
      });
      if (!out?.ok) {
        setError(out?.error || 'playbook_step_failed');
      }
      if (out?.execution) setExecution(out.execution);
      return out;
    } catch (err) {
      logger.error('Erro ao executar próximo passo do playbook', err);
      setError(err?.message || 'playbook_step_failed');
      return { ok: false, error: err?.message || 'playbook_step_failed' };
    } finally {
      setLoading(false);
    }
  }, []);

  const runStep = useCallback(async ({ playbookId, tenantId, executionId, stepId, context = {} }) => {
    setLoading(true);
    setError('');
    try {
      const out = await stepOperationalPlaybookAdmin(playbookId, {
        tenantId,
        executionId,
        action: 'step',
        stepId,
        context,
      });
      if (!out?.ok) {
        setError(out?.error || 'playbook_step_failed');
      }
      if (out?.execution) setExecution(out.execution);
      return out;
    } catch (err) {
      logger.error('Erro ao executar passo do playbook', err);
      setError(err?.message || 'playbook_step_failed');
      return { ok: false, error: err?.message || 'playbook_step_failed' };
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setExecution(null);
    setError('');
  }, []);

  return {
    execution,
    loading,
    error,
    startExecution,
    runNextStep,
    runStep,
    reset,
  };
}
