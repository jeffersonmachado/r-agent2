import React from 'react';

const defaultCards = [
  { key: 'items', label: 'Itens', value: 0 },
  { key: 'done', label: 'Concluidos', value: 0 },
  { key: 'blocked', label: 'Bloqueados', value: 0 },
  { key: 'overdue', label: 'Atrasados', value: 0 },
];

export function ProjectKpis({ dashboard }) {
  const totals = dashboard?.totals || {};
  const cards = defaultCards.map((entry) => ({
    ...entry,
    value: totals[entry.key] || 0,
  }));

  return (
    <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {cards.map((card) => (
        <div key={card.key} className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-sm text-text-secondary mb-1">{card.label}</div>
          <div className="text-3xl font-semibold text-text-primary">{card.value}</div>
        </div>
      ))}
    </div>
  );
}

export default ProjectKpis;
