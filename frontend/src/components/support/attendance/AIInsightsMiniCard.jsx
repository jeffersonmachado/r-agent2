import React from 'react';

function hasValue(v) {
  return v && v !== '-';
}

export function AIInsightsMiniCard({ ai, execution, onReplay, onTestFlow }) {
  return (
    <section className="attendance-mini-card">
      <h3>IA operacional</h3>
      <div className="attendance-mini-content">
        {hasValue(ai?.intent) ? (
          <div><span>Intenção:</span> <strong>{ai.intent}</strong></div>
        ) : null}
        {hasValue(ai?.confidence) ? (
          <div><span>Confiança:</span> <strong>{ai.confidence}</strong></div>
        ) : null}
        {hasValue(ai?.nextBestAction) ? (
          <div>
            <span>Próxima ação:</span>{' '}
            <strong
              title={ai.nextBestAction}
              className="text-truncate block max-w-full"
            >
              {ai.nextBestAction}
            </strong>
          </div>
        ) : null}
        <div><span>Modo:</span> <strong>{execution?.mode || '-'}</strong></div>
      </div>
      {onReplay || onTestFlow ? (
        <div className="attendance-mini-actions">
          {onReplay ? (
            <button type="button" onClick={onReplay} title="Replay do atendimento">▶ Replay</button>
          ) : null}
          {onTestFlow ? (
            <button type="button" onClick={onTestFlow} title="Testar fluxo de bot">⚙ Testar fluxo</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
