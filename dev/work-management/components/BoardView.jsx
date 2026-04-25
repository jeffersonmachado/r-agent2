import React, { useState } from 'react';
import { WORK_ITEM_STATUS_LABELS } from '../types/models.js';
import PriorityBadge from './PriorityBadge.jsx';
import StatusBadge from './StatusBadge.jsx';

export function BoardView({ board = [], projectsById = {}, onMoveItem, onOpenProject }) {
  const [draggingId, setDraggingId] = useState(null);

  return (
    <div className="wm-board-grid">
      {board.map((column) => (
        <section
          key={column.id}
          className="wm-board-column"
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (draggingId) onMoveItem?.(draggingId, column.id);
            setDraggingId(null);
          }}
        >
          <header className="wm-board-column-header">
            <h3>{WORK_ITEM_STATUS_LABELS[column.id] || column.id}</h3>
            <span>{column.items.length}</span>
          </header>

          <div className="wm-board-column-body">
            {column.items.length ? column.items.map((item) => (
              <article
                key={item.id}
                className="wm-board-card"
                draggable
                onDragStart={() => setDraggingId(item.id)}
                onDragEnd={() => setDraggingId(null)}
              >
                <div className="wm-split-row wm-gap-sm">
                  <strong>{item.title}</strong>
                  <PriorityBadge priority={item.priority} />
                </div>
                <p>{item.description}</p>
                <div className="wm-inline-meta">
                  <StatusBadge status={item.status} />
                  <span>{item.channel}</span>
                  <span>{item.environment}</span>
                </div>
                <div className="wm-inline-meta">
                  <button type="button" className="wm-link-button" onClick={() => onOpenProject?.(item.projectId)}>
                    {projectsById[item.projectId]?.name || item.projectId}
                  </button>
                  <span>{item.assignee}</span>
                </div>
              </article>
            )) : <div className="wm-empty-state">Sem itens nesta coluna.</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

export default BoardView;