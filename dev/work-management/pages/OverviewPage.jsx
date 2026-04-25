import React, { useMemo } from 'react';
import OverviewDashboard from '../components/OverviewDashboard.jsx';

export function OverviewPage({ model, onOpenProject }) {
  const alerts = useMemo(() => {
    return [
      ...model.executions.filter((execution) => execution.status === 'failed').map((execution) => ({
        id: execution.id,
        title: 'Falha recorrente de execucao',
        detail: execution.logs[1] || 'Investigue a causa raiz e reexecute com evidencia.',
        status: execution.status,
      })),
      ...model.aiSuggestions.slice(0, 2).map((suggestion) => ({
        id: suggestion.id,
        title: suggestion.summary,
        detail: suggestion.recommendation,
        status: suggestion.priority,
      })),
    ].slice(0, 4);
  }, [model.aiSuggestions, model.executions]);

  return (
    <OverviewDashboard
      totals={model.totals}
      projects={model.projects}
      activity={model.activity}
      aiSuggestions={model.aiSuggestions}
      alerts={alerts}
      onOpenProject={onOpenProject}
    />
  );
}

export default OverviewPage;