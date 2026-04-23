import React, { useMemo, useState } from 'react';
import StatusBadge from './StatusBadge';

export function ReplayPlayer({ steps = [], typedEntries = [] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const activeStep = useMemo(() => steps[currentIndex] || null, [steps, currentIndex]);

  function next() {
    setCurrentIndex((prev) => Math.min(steps.length - 1, prev + 1));
  }

  function prev() {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }

  return (
    <div className="qa-replay-player">
      <div className="qa-replay-controls">
        <button type="button" onClick={prev} disabled={currentIndex <= 0}>Anterior</button>
        <button type="button" onClick={next} disabled={currentIndex >= steps.length - 1}>Proximo</button>
        <span>Passo {steps.length === 0 ? 0 : currentIndex + 1}/{steps.length}</span>
      </div>

      {activeStep ? (
        <div className="qa-replay-step-card">
          <div className="qa-replay-step-header">
            <strong>{activeStep.title}</strong>
            <StatusBadge status={activeStep.status} />
          </div>
          <div className="qa-replay-muted">
            {activeStep.at ? new Date(activeStep.at).toLocaleString('pt-BR') : 'Sem timestamp'}
          </div>
          {activeStep.screenshot ? (
            <div className="qa-replay-small">
              Screenshot: {activeStep.screenshot}
            </div>
          ) : null}
        </div>
      ) : (
        <p>Sem passos de replay.</p>
      )}

      <div>
        <h4>Digitado no replay</h4>
        {typedEntries.length === 0 ? (
          <p className="qa-replay-typed-empty">Nenhuma entrada digitada identificada.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
            {typedEntries.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.field}:</strong> {entry.value}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ReplayPlayer;
