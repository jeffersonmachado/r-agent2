import React, { useMemo } from 'react';
import OperationsPanel from '../components/OperationsPanel.jsx';

export function OperationsPage({ model }) {
  const alerts = useMemo(() => {
    return [
      ...model.executions
        .filter((execution) => execution.status === 'failed' || execution.status === 'warning')
        .map((execution) => ({
          id: execution.id,
          title: model.itemsById[execution.workItemId]?.title || 'Execucao em alerta',
          detail: execution.logs[1] || execution.logs[0] || 'Sinal operacional precisa de revisao.',
          status: execution.status,
        })),
      ...model.aiSuggestions.slice(0, 2).map((suggestion) => ({
        id: suggestion.id,
        title: suggestion.summary,
        detail: suggestion.recommendation,
        status: suggestion.priority,
      })),
    ].slice(0, 5);
  }, [model.aiSuggestions, model.executions, model.itemsById]);

  return (
    <OperationsPanel
      healthDomains={model.healthDomains}
      waves={model.waves}
      executions={model.executions}
      itemsById={model.itemsById}
      activity={model.activity}
      alerts={alerts}
      onOpenExecution={model.openExecution}
    />
  );
}

export default OperationsPage;