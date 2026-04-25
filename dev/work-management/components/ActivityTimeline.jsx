import React from 'react';
import StatusBadge from './StatusBadge.jsx';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

export function ActivityTimeline({ items = [], emptyMessage = 'Nenhuma atividade encontrada.' }) {
  if (!items.length) {
    return <div className="wm-empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="wm-timeline-list">
      {items.map((item) => (
        <article key={item.id} className="wm-timeline-item">
          <div className="wm-timeline-dot" />
          <div className="wm-timeline-content">
            <div className="wm-timeline-topline">
              <strong>{item.title}</strong>
              <StatusBadge status={item.status} />
            </div>
            <p>{item.type}</p>
            <span>{formatDate(item.timestamp)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export default ActivityTimeline;