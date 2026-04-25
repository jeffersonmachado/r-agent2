import React from 'react';

export function JourneyStatusCard({ journey, stepStatuses }) {
  if (!journey) {
    return <div className="qa-journey-status-card qa-empty">Selecione uma jornada para ver o status.</div>;
  }

  const safeStepStatuses = (Array.isArray(stepStatuses) ? stepStatuses : []).filter((step) => {
    const totalScenarios = Number(step?.totalScenarios || 0);
    const executedScenarios = Number(step?.executedScenarios || 0);
    const failedScenarios = Number(step?.failedScenarios || 0);
    const hasLastExecution = Boolean(step?.lastExecutionAt);
    return totalScenarios > 0 || executedScenarios > 0 || failedScenarios > 0 || hasLastExecution;
  });
  const riskySteps = safeStepStatuses.filter((step) => step.riskScore >= 50).length;

  return (
    <article className="qa-journey-status-card">
      <header className="qa-journey-status-header">
        <h2>{journey.journeyName}</h2>
        <span className={`qa-business-status qa-business-status--${String(journey.status || 'warning').toLowerCase()}`}>
          {journey.status || 'WARNING'}
        </span>
      </header>

      <div className="qa-journey-metrics">
        <div>
          <strong>{journey.successRate}%</strong>
          <span>Sucesso</span>
        </div>
        <div>
          <strong>{journey.executedRate}%</strong>
          <span>Cobertura de execucao</span>
        </div>
        <div>
          <strong>{journey.totalScenarios}</strong>
          <span>Cenarios</span>
        </div>
        <div>
          <strong>{journey.failedScenarios}</strong>
          <span>Falhas</span>
        </div>
      </div>

      <div className="qa-risk-heatmap">
        <h3>Heatmap de risco</h3>
        <p>Passos com risco alto: {riskySteps}</p>
        <div className="qa-risk-bars">
          {safeStepStatuses.map((step) => {
            const risk = Number(step.riskScore || 0);
            return (
              <div key={step.stepId} className="qa-risk-bar-item" title={`${step.stepName}: risco ${risk}`}> 
                <span>{step.stepName}</span>
                <div className="qa-risk-bar-track">
                  <div className="qa-risk-bar-fill" style={{ width: `${Math.min(100, risk)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

export default JourneyStatusCard;
