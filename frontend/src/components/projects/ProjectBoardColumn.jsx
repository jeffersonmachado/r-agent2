import React from 'react';

const ITEM_TYPE_LABELS = {
  epic: 'Epic',
  story: 'Historia',
  task: 'Tarefa',
  bug: 'Bug',
  incident: 'Incidente',
  improvement: 'Melhoria',
  deployment: 'Implantacao',
  qa_fix: 'Correcao QA',
  automation: 'Automacao',
  research: 'Pesquisa',
};

const PRIORITY_LABELS = {
  low: 'Baixa',
  medium: 'Media',
  high: 'Alta',
  critical: 'Critica',
};

function formatBadge(item) {
  const itemType = ITEM_TYPE_LABELS[item.item_type] || item.item_type || 'Tarefa';
  const priority = PRIORITY_LABELS[item.priority] || item.priority || 'Media';
  return `${itemType} • ${priority}`;
}

export function ProjectBoardColumn({ list, items, onDropItem, onOpenItem }) {
  return (
    <div
      className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const itemId = event.dataTransfer.getData('text/project-item-id');
        if (itemId) onDropItem(itemId, list.id);
      }}
      style={{ minWidth: '280px' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-base font-semibold text-text-primary">{list.name}</div>
          <div className="text-xs text-text-secondary">{items.length} itens</div>
        </div>
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: list.color || '#64748b' }}
        />
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('text/project-item-id', item.id)}
            onClick={() => onOpenItem(item)}
            className="text-left rounded-xl border border-border-default bg-bg-secondary p-3 transition hover:border-primary-400"
          >
            <div className="text-sm text-text-secondary mb-1">{formatBadge(item)}</div>
            <div className="text-sm font-semibold text-text-primary mb-2">{item.title}</div>
            <div className="text-xs text-text-secondary">
              {item.assignee?.name || item.assignee_user_id || 'Sem responsavel'}
            </div>
          </button>
        ))}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default p-4 text-sm text-text-secondary">
            Nenhum item nesta coluna.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ProjectBoardColumn;
