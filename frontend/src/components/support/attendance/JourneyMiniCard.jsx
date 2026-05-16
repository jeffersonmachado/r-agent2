import React from 'react';

const JOURNEY_DEFAULTS = new Set([
  'Jornada de atendimento', 'Qualificação', 'Fechamento',
  'Fluxo padrão RAP', 'Coleta de contexto',
]);

function isDefault(value) {
  return !value || JOURNEY_DEFAULTS.has(value);
}

export function JourneyMiniCard({ journey, execution }) {
  const allDefault = isDefault(journey?.name) && isDefault(journey?.stage) && isDefault(execution?.flow);

  return (
    <section className="attendance-mini-card">
      <h3 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        Jornada
        {allDefault ? (
          <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            padrão
          </span>
        ) : null}
      </h3>
      <div className="attendance-mini-content">
        <div><span>Jornada atual:</span> <strong>{journey?.name || '-'}</strong></div>
        <div><span>Etapa:</span> <strong>{journey?.stage || '-'}</strong></div>
        <div><span>Próxima etapa:</span> <strong>{journey?.nextStage || '-'}</strong></div>
        <div><span>Fluxo:</span> <strong>{execution?.flow || '-'}</strong></div>
        <div><span>Step:</span> <strong>{execution?.step || '-'}</strong></div>
      </div>
    </section>
  );
}
