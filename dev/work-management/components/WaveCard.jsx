import React from 'react';
import StatusBadge from './StatusBadge.jsx';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

export function WaveCard({ wave }) {
  return (
    <article className="wm-wave-card">
      <div className="wm-split-row">
        <div>
          <h3>{wave.name}</h3>
          <p>{wave.domain}</p>
        </div>
        <StatusBadge status={wave.status} />
      </div>
      <div className="wm-wave-grid">
        <div>
          <span>Cobertura</span>
          <strong>{wave.coverage}%</strong>
        </div>
        <div>
          <span>Falhas</span>
          <strong>{wave.failures}</strong>
        </div>
        <div>
          <span>Ultima execucao</span>
          <strong>{formatDate(wave.lastExecution)}</strong>
        </div>
      </div>
    </article>
  );
}

export default WaveCard;