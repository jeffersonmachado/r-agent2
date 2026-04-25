import React from 'react';
import StatusBadge from './StatusBadge';

export function SubJourneyList({ step, onExecuteScenario, onReplayScenario }) {
  const subJourneys = (Array.isArray(step?.subJourneys) ? step.subJourneys : [])
    .map((subJourney) => ({
      ...subJourney,
      scenarios: Array.isArray(subJourney?.scenarios)
        ? subJourney.scenarios.filter((scenario) => Boolean(scenario?.id || scenario?.scenarioId))
        : [],
    }))
    .filter((subJourney) => subJourney.scenarios.length > 0);

  if (subJourneys.length === 0) {
    return <p className="qa-empty">Sem subjornadas mapeadas.</p>;
  }

  return (
    <div className="qa-subjourney-list">
      {subJourneys.map((subJourney) => (
        <section key={subJourney.id} className="qa-subjourney-card">
          <h5>{subJourney.name || subJourney.id}</h5>
          <div className="qa-subjourney-scenarios">
            {(subJourney.scenarios || []).map((scenario) => (
              <article key={scenario.id} className="qa-subjourney-scenario">
                <div>
                  <strong>{scenario.name || scenario.id}</strong>
                  <div className="qa-subjourney-meta">
                    <StatusBadge status={scenario.status} />
                    <span>{scenario.critical ? 'Critico' : 'Nao critico'}</span>
                    <span>{scenario.lastExecutionAt ? new Date(scenario.lastExecutionAt).toLocaleString('pt-BR') : 'Sem execucao'}</span>
                  </div>
                </div>
                <div className="qa-subjourney-scenario-actions">
                  <button type="button" onClick={() => onExecuteScenario(scenario.id)}>
                    Executar cenario
                  </button>
                  <button type="button" onClick={() => onReplayScenario?.(scenario.id)}>
                    Replay
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default SubJourneyList;
