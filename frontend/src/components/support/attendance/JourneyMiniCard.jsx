import React from 'react';

export function JourneyMiniCard({ journey, execution }) {
  return (
    <section className="attendance-mini-card">
      <h3>Jornada</h3>
      <div className="attendance-mini-content">
        <div><span>Jornada atual:</span> <strong>{journey?.name || '-'}</strong></div>
        <div><span>Etapa:</span> <strong>{journey?.stage || '-'}</strong></div>
        <div><span>Proxima etapa:</span> <strong>{journey?.nextStage || '-'}</strong></div>
        <div><span>Fluxo:</span> <strong>{execution?.flow || '-'}</strong></div>
        <div><span>Step:</span> <strong>{execution?.step || '-'}</strong></div>
      </div>
    </section>
  );
}
