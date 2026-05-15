import React from 'react';

export function AIInsightsMiniCard({ ai, execution, onReplay, onTestFlow }) {
  return (
    <section className="attendance-mini-card">
      <h3>IA operacional</h3>
      <div className="attendance-mini-content">
        <div><span>Intenção:</span> <strong>{ai?.intent || '-'}</strong></div>
        <div><span>Confiança:</span> <strong>{ai?.confidence || '-'}</strong></div>
        <div><span>Próxima melhor ação:</span> <strong>{ai?.nextBestAction || '-'}</strong></div>
        <div><span>Modo de execucao:</span> <strong>{execution?.mode || '-'}</strong></div>
      </div>
      <div className="attendance-mini-actions">
        <button type="button" onClick={onReplay}>Replay</button>
        <button type="button" onClick={onTestFlow}>Testar fluxo</button>
      </div>
    </section>
  );
}
