import React from 'react';

function formatDate(value) {
  if (!value) return 'sem histórico';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function WorkspaceHeader({ entity, summary, onCreateTask, onCreateFollowUp }) {
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
      <div className="workspace-header-main">
        <p className="workspace-kicker text-xs uppercase tracking-[0.24em]">Entidade 360</p>
        <div className="workspace-header-title-row">
          <h1 className="workspace-main-title text-4xl">{entity.name}</h1>
          <span className={`workspace-health-badge ${summary?.healthTone || 'healthy'}`}>{summary?.healthLabel || 'Saudável'} · {summary?.score ?? 100}</span>
        </div>
        <div className="workspace-header-grid mt-4">
          {entity.phone ? <span className="workspace-pill">Telefone {entity.phone}</span> : null}
          {entity.email ? <span className="workspace-pill">E-mail {entity.email}</span> : null}
          <span className="workspace-pill subtle">Tipo {entity.type || 'contact'}</span>
          <span className="workspace-pill subtle">Status {summary?.status || 'ativo'}</span>
          <span className="workspace-pill subtle">Última interação {formatDate(summary?.lastActivityAt)}</span>
          {(summary?.tags || []).slice(0, 4).map((tag) => <span key={tag} className="workspace-pill subtle">#{tag}</span>)}
        </div>
      </div>
      <div className="workspace-header-actions">
        <div className="workspace-card workspace-header-card max-w-sm">
          <strong>Próxima melhor ação</strong>
          <p className="workspace-muted text-sm mt-1">{summary?.qaFailures > 0 ? 'Existe falha QA/RPA exigindo revisão técnica.' : 'Insights e ações são calculados a partir da timeline unificada.'}</p>
        </div>
        <div className="workspace-header-button-row">
          <button className="workspace-secondary-button" type="button" onClick={onCreateTask}>Criar tarefa</button>
          <button className="workspace-action-button" type="button" onClick={onCreateFollowUp}>Criar follow-up</button>
        </div>
      </div>
    </header>
  );
}
