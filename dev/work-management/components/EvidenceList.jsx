import React from 'react';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

export function EvidenceList({ evidence = [] }) {
  if (!evidence.length) {
    return <div className="wm-empty-state">Nenhuma evidencia vinculada.</div>;
  }

  return (
    <div className="wm-stack-md">
      {evidence.map((entry) => (
        <article key={entry.id} className="wm-evidence-card">
          <div className="wm-split-row">
            <strong>{entry.title}</strong>
            <span className="wm-muted-text">{formatDate(entry.createdAt)}</span>
          </div>
          <p>{entry.payload}</p>
          <div className="wm-inline-meta">
            <span>{entry.type}</span>
            <span>{entry.fileUrl}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export default EvidenceList;