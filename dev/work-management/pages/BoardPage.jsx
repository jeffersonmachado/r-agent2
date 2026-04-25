import React from 'react';
import BoardView from '../components/BoardView.jsx';

export function BoardPage({ model, onOpenProject }) {
  return (
    <section className="wm-stack-lg">
      <div className="wm-panel-header">
        <h2>Kanban board</h2>
        <span>drag and drop habilitado</span>
      </div>
      <BoardView board={model.board} projectsById={model.projectsById} onMoveItem={model.moveWorkItem} onOpenProject={onOpenProject} />
    </section>
  );
}

export default BoardPage;