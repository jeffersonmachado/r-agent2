import React from 'react';
import StatusBadge from './StatusBadge';

export function SubJourneyList({ scenarios, onExecuteScenario, onReplayScenario }) {
  const safeScenarios = (Array.isArray(scenarios) ? scenarios : [])
    .filter((scenario) => Boolean(scenario?.id || scenario?.scenarioId));

  if (safeScenarios.length === 0) {
    return <p className="qa-empty">Sem cenarios vinculados a esta jornada.</p>;
  }

  return (
    <div className="qa-subjourney-list">
      <section className="qa-subjourney-card">
        <h5>Cenarios da jornada</h5>
        <div className="qa-subjourney-scenarios">
          {safeScenarios.map((scenario) => (
            <article key={scenario.id || scenario.scenarioId} className="qa-subjourney-scenario">
              <div>
                <strong>{scenario.title || scenario.name || scenario.id || scenario.scenarioId}</strong>
                <div className="qa-subjourney-meta">
                  <StatusBadge status={scenario.executionStatus || scenario.status} />
                  <span>{['blocking', 'high'].includes(String(scenario.criticality || '').toLowerCase()) ? 'Critico' : 'Nao critico'}</span>
                  <span>{scenario.lastExecutionAt ? new Date(scenario.lastExecutionAt).toLocaleString('pt-BR') : 'Sem execucao'}</span>
                </div>
              </div>
              <div className="qa-subjourney-scenario-actions">
                <button type="button" onClick={() => onExecuteScenario(scenario.id || scenario.scenarioId)}>
                  Executar cenario
                </button>
                <button type="button" onClick={() => onReplayScenario?.(scenario.id || scenario.scenarioId)}>
                  Replay
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default SubJourneyList;
