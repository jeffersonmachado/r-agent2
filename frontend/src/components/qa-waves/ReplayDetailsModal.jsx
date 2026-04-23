import React from 'react';
import ReplayPlayer from './ReplayPlayer';
import StatusBadge from './StatusBadge';

export function ReplayDetailsModal({ details, onClose }) {
  if (!details) return null;

  return (
    <section className="qa-replay-details">
      <div className="qa-replay-details-header">
        <h3>Detalhes: {details.itemName}</h3>
        <StatusBadge status={details.status} />
      </div>
      <p className="qa-replay-details-meta">Canal: {details.channel}</p>
      <p className="qa-replay-details-meta">Inicio: {new Date(details.startedAt).toLocaleString('pt-BR')}</p>
      <p className="qa-replay-details-meta">Fim: {new Date(details.finishedAt).toLocaleString('pt-BR')}</p>

      <ReplayPlayer steps={details.steps || []} typedEntries={details.typedEntries || []} />

      <button type="button" onClick={onClose}>Fechar</button>
    </section>
  );
}

export default ReplayDetailsModal;
