import React from 'react';

const ITEM_TYPE_LABELS = {
  epic: 'Épico',
  story: 'História',
  task: 'Tarefa',
  bug: 'Bug',
  incident: 'Incidente',
  improvement: 'Melhoria',
  deployment: 'Implantação',
  qa_fix: 'Correção QA',
  automation: 'Automação',
  research: 'Pesquisa',
};

const PRIORITY_LABELS = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

function formatListName(name) {
  const key = String(name || '').trim().toLowerCase();
  const map = {
    backlog: 'Backlog',
    'to do': 'A fazer',
    todo: 'A fazer',
    doing: 'Em andamento',
    in_progress: 'Em andamento',
    review: 'Revisão',
    blocked: 'Bloqueado',
    done: 'Concluído',
  };
  return map[key] || name || 'Lista';
}

function formatBadge(item) {
  const itemType = ITEM_TYPE_LABELS[item.item_type] || item.item_type || 'Tarefa';
  const priority = PRIORITY_LABELS[item.priority] || item.priority || 'Média';
  return `${itemType} • ${priority}`;
}

export function ProjectBoardColumn({ list, items, onDropItem, onOpenItem }) {
  return (
    <div
      className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg"
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(event) => {
        const transfer = event.dataTransfer;
        const itemId = transfer?.getData('text/project-item-id') || transfer?.getData('text/plain');
        if (itemId) onDropItem(itemId, list.id);
      }}
      style={{ minWidth: '280px' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-base font-semibold text-text-primary">{formatListName(list.name)}</div>
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
            onDragStart={(event) => {
              if (!event.dataTransfer) return;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/project-item-id', item.id);
              // Safari utiliza text/plain como tipo mais confiável para DnD customizado.
              event.dataTransfer.setData('text/plain', item.id);
            }}
            onClick={() => onOpenItem(item)}
            className="text-left rounded-xl border border-border-default bg-bg-secondary p-3 transition hover:border-primary-400 cursor-pointer"
          >
            <div className="text-sm text-text-secondary mb-1">{formatBadge(item)}</div>
            <div className="text-sm font-semibold text-text-primary mb-2">{item.title}</div>
            <div className="text-xs text-text-secondary">
              {item.assignee?.name || item.assignee_user_id || 'Sem responsável'}
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
