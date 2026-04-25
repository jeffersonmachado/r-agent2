import React, { useState } from 'react';
import SubJourneyList from './SubJourneyList';

export function StepBreakdown({ steps, onExecuteStep, onExecuteScenario, onReplayScenario }) {
  const safeSteps = (Array.isArray(steps) ? steps : []).filter((step) => {
    const totalScenarios = Number(step?.totalScenarios || 0);
    const hasSubJourneyWithScenarios = Array.isArray(step?.subJourneys)
      && step.subJourneys.some((subJourney) => Array.isArray(subJourney?.scenarios) && subJourney.scenarios.length > 0);
    return totalScenarios > 0 || hasSubJourneyWithScenarios;
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
                  Cobertura: {step.successRate}% | Cenarios: {step.totalScenarios} | Ultima execucao:{' '}
                  {step.lastExecutionAt ? new Date(step.lastExecutionAt).toLocaleString('pt-BR') : 'Sem execucao'}
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
                onExecuteScenario={onExecuteScenario}
                onReplayScenario={onReplayScenario}
              />
            ) : null}
          </article>
        );
      })}
      {safeSteps.length === 0 ? <p className="qa-empty">Nenhum passo disponivel para esta jornada.</p> : null}
    </div>
  );
}

export default StepBreakdown;
