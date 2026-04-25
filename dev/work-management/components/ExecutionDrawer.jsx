import React from 'react';
import EvidenceList from './EvidenceList.jsx';
import StatusBadge from './StatusBadge.jsx';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

export function ExecutionDrawer({ execution, workItem, evidence = [], onClose, onOpenReplay }) {
  if (!execution) return null;

  return (
    <div className="wm-drawer-backdrop" onClick={onClose}>
      <aside className="wm-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="wm-drawer-header">
          <div>
            <div className="wm-overline">Execution Drawer</div>
            <h2>{workItem?.title || execution.id}</h2>
            <div className="wm-inline-meta">
              <StatusBadge status={execution.status} />
              <span>{execution.environment}</span>
              <span>{execution.tenant}</span>
              <span>{formatDate(execution.timestamp)}</span>
            </div>
          </div>
          <button type="button" className="wm-button wm-button-secondary" onClick={onClose}>Fechar</button>
        </div>

        <section className="wm-panel is-flat">
          <div className="wm-panel-header">
            <h3>Timeline de steps</h3>
            <button type="button" className="wm-link-button" onClick={() => onOpenReplay?.(execution.id)}>
              Abrir replay
            </button>
          </div>
          <div className="wm-stack-sm">
            {execution.steps.map((step) => (
              <article key={step.id} className="wm-step-card">
                <div className="wm-split-row">
                  <strong>{step.action}</strong>
                  <StatusBadge status={step.status} />
                </div>
                <div className="wm-stack-xs">
                  <span><strong>Input:</strong> {step.input}</span>
                  <span><strong>Output:</strong> {step.output}</span>
                  {step.error ? <span><strong>Erro:</strong> {step.error}</span> : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="wm-panel is-flat">
          <div className="wm-panel-header">
            <h3>Logs tecnicos</h3>
            <span>{execution.logs.length}</span>
          </div>
          <div className="wm-code-block">
            {execution.logs.map((line) => <div key={line}>{line}</div>)}
          </div>
        </section>

        <section className="wm-panel is-flat">
          <div className="wm-panel-header">
            <h3>Evidencias</h3>
            <span>{evidence.length}</span>
          </div>
          <EvidenceList evidence={evidence} />
        </section>
      </aside>
    </div>
  );
}

export default ExecutionDrawer;