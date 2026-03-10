import React, { useEffect, useState } from 'react';
import { QuickActionButton } from './QuickActionButton';
import { QuickActionDialog } from './QuickActionDialog';
import { useQuickActions } from '../hooks/useQuickActions';

/**
 * QuickActionsBar
 * Displays available quick actions for a signal or recommendation
 */

export function QuickActionsBar({
  scope = 'admin', // 'admin' | 'contact'
  tenantId = '',
  contactId = '',
  supportContext = null,
  sourceType = 'signal', // 'signal' or 'recommendation'
  sourceId = '',
  sourceObject = null,
  onActionExecuted = null,
  onError = null,
  compact = false,
}) {
  const [selectedAction, setSelectedAction] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const { actions, loading, executing, loadActions, executeAction } = useQuickActions({
    scope,
    tenantId,
    contactId,
    ...(supportContext ? { supportContext } : {}),
    sourceType,
    sourceId,
    enabled: !!sourceId && (scope === 'contact' ? !!contactId : !!tenantId),
  });

  // Load actions on mount or when source changes
  useEffect(() => {
    const hasScope = scope === 'contact' ? !!contactId : !!tenantId;
    if (hasScope && sourceId) {
      loadActions();
    }
  }, [scope, tenantId, contactId, sourceId, loadActions]);

  if (!(scope === 'contact' ? contactId : tenantId) || !sourceId) return null;
  if (loading) return <div className="text-sm text-gray-500">Carregando ações...</div>;
  if (actions.length === 0) return null;

  const handleActionClick = (action) => {
    setSelectedAction(action);
    if (action.confirmationRequired) {
      setDialogOpen(true);
    } else {
      // Execute immediately if no confirmation required
      executeActionInternal(action.id, {});
    }
  };

  const handleDialogConfirm = (input) => {
    if (selectedAction) {
      executeActionInternal(selectedAction.id, input);
    }
    setDialogOpen(false);
    setSelectedAction(null);
  };

  const handleDialogCancel = () => {
    setDialogOpen(false);
    setSelectedAction(null);
  };

  const executeActionInternal = async (actionId, input) => {
    const result = await executeAction(actionId, input);
    if (result.ok) {
      setSuccessMessage('Ação executada com sucesso!');
      setTimeout(() => setSuccessMessage(''), 3000);
      if (onActionExecuted) {
        onActionExecuted({ actionId, result: result.result });
      }
    } else {
      if (onError) {
        onError(result.error);
      }
    }
  };

  const containerClass = compact
    ? 'flex gap-2 flex-wrap'
    : 'flex gap-2 flex-wrap p-3 bg-blue-50 rounded border border-blue-200';

  return (
    <>
      <div className={containerClass}>
        {actions.map(action => (
          <QuickActionButton
            key={action.id}
            action={action}
            onExecute={() => handleActionClick(action)}
            isLoading={executing === action.id}
            disabled={executing !== null}
          />
        ))}
      </div>

      {successMessage && (
        <div className="text-sm text-green-700 bg-green-50 p-2 rounded mt-2">
          {successMessage}
        </div>
      )}

      <QuickActionDialog
        action={selectedAction}
        isOpen={dialogOpen}
        onClose={handleDialogCancel}
        onConfirm={handleDialogConfirm}
        isLoading={selectedAction && executing === selectedAction.id}
      />
    </>
  );
}
