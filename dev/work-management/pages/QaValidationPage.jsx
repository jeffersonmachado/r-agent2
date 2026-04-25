import React from 'react';
import StatusBadge from '../components/StatusBadge.jsx';

export function QaValidationPage({ model }) {
  return (
    <section className="wm-panel">
      <div className="wm-panel-header">
        <h2>QA & Validation</h2>
        <span>cenarios, suites, replays e retestes</span>
      </div>
      <div className="wm-table-wrap">
        <table className="wm-table">
          <thead>
            <tr>
              <th>Cenario</th>
              <th>Canal</th>
              <th>Status</th>
              <th>Duracao</th>
              <th>Cobertura</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {model.qaScenarios.map((scenario) => (
              <tr key={scenario.id}>
                <td><strong>{scenario.title}</strong></td>
                <td>{scenario.channel}</td>
                <td><StatusBadge status={scenario.status} /></td>
                <td>{Math.round(scenario.durationMs / 1000)}s</td>
                <td>{scenario.coverage}</td>
                <td>
                  <div className="wm-table-actions">
                    <button type="button" className="wm-button wm-button-secondary" onClick={() => model.openExecution(scenario.executionId)}>
                      Executar
                    </button>
                    <button type="button" className="wm-button wm-button-secondary" onClick={() => scenario.replayId && model.openReplay(scenario.replayId)} disabled={!scenario.replayId}>
                      Replay
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default QaValidationPage;