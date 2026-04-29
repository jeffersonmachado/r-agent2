import React from 'react';

export function WorkspaceHeader({ entity }) {
  if (!entity) {
    return (
      <header className="workspace-header">
        <div>
          <p className="workspace-kicker text-xs uppercase tracking-[0.24em]">Sistema unificado</p>
          <h1 className="workspace-main-title text-4xl">Escolha uma entidade</h1>
        </div>
      </header>
    );
  }

  return (
    <header className="workspace-header">
      <div>
        <p className="workspace-kicker text-xs uppercase tracking-[0.24em]">Entidade 360</p>
        <h1 className="workspace-main-title text-4xl">{entity.name}</h1>
        <div className="flex flex-wrap gap-2 mt-3">
          {entity.phone ? <span className="workspace-pill">Tel {entity.phone}</span> : null}
          {entity.email ? <span className="workspace-pill">Email {entity.email}</span> : null}
          <span className="workspace-pill">Status ativo</span>
        </div>
      </div>
      <div className="workspace-card max-w-sm">
        <strong>Próxima melhor ação</strong>
        <p className="workspace-muted text-sm mt-1">Insights e ações são calculados a partir da timeline unificada.</p>
      </div>
    </header>
  );
}
