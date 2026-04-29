import React, { useState } from 'react';
import SubJourneyList from './SubJourneyList';

export function StepBreakdown({ steps, scenarios, onExecuteStep, onExecuteScenario, onReplayScenario }) {
  const safeSteps = (Array.isArray(steps) ? steps : []).filter((step) => {
    // Novo modelo: usar totalScenarios que vem do backend
    const totalScenarios = Number(step?.totalScenarios || 0);
    return totalScenarios > 0;
  });
  const [expandedStepId, setExpandedStepId] = useState(null);

  function toggleStep(stepId) {
    setExpandedStepId((current) => (current === stepId ? null : stepId));
  }

  return (
    <div className="qa-step-breakdown">
      {safeSteps.map((step) => {
        const isExpanded = expandedStepId === step.stepId;
        const statusClass = String(step.status || 'warning').toLowerCase();

        return (
          <article key={step.stepId} className="qa-step-card">
            <header className="qa-step-card-header">
              <div>
                <h4>{step.stepName}</h4>
                <p>
                  Status: <span className={`qa-business-status qa-business-status--${statusClass}`}>{step.status}</span>
                </p>
                <p>
                  Cobertura: {step.successRate}% | Cenários: {step.totalScenarios} | Última execução:{' '}
                  {step.lastExecutionAt ? new Date(step.lastExecutionAt).toLocaleString('pt-BR') : 'Sem execução'}
                </p>
              </div>
              <div className="qa-step-actions">
                <button type="button" onClick={() => onExecuteStep(step.stepId)}>
                  Executar passo
                </button>
                <button type="button" onClick={() => toggleStep(step.stepId)}>
                  {isExpanded ? 'Recolher' : 'Expandir'}
                </button>
              </div>
            </header>

            {isExpanded ? (
              <SubJourneyList
                step={step}
                scenarios={scenarios}
                onExecuteScenario={onExecuteScenario}
                onReplayScenario={onReplayScenario}
              />
            ) : null}
          </article>
        );
      })}
      {safeSteps.length === 0 ? <p className="qa-empty">Nenhum passo disponível para esta jornada.</p> : null}
    </div>
  );
}

export default StepBreakdown;
