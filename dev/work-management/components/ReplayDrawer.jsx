import React from 'react';
import StatusBadge from './StatusBadge.jsx';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

export function ReplayDrawer({ replay, workItem, onClose }) {
  if (!replay) return null;

  return (
    <div className="wm-drawer-backdrop" onClick={onClose}>
      <aside className="wm-drawer is-wide" onClick={(event) => event.stopPropagation()}>
        <div className="wm-drawer-header">
          <div>
            <div className="wm-overline">Replay Drawer</div>
            <h2>{workItem?.title || replay.id}</h2>
            <div className="wm-inline-meta">
              <StatusBadge status={replay.status} />
              <span>{formatDate(replay.createdAt)}</span>
            </div>
          </div>
          <button type="button" className="wm-button wm-button-secondary" onClick={onClose}>Fechar</button>
        </div>

        <section className="wm-grid-2 is-wide-left">
          <div className="wm-panel is-flat">
            <div className="wm-panel-header">
              <h3>Timeline</h3>
              <span>{replay.timeline.length} eventos</span>
            </div>
            <div className="wm-stack-sm">
              {replay.timeline.map((step) => (
                <article key={step.id} className="wm-step-card">
                  <div className="wm-split-row">
                    <strong>{step.label}</strong>
                    <StatusBadge status={step.status} />
                  </div>
                  <p>{step.detail}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="wm-stack-md">
            <section className="wm-panel is-flat">
              <div className="wm-panel-header">
                <h3>Fluxo simplificado</h3>
                <span>start - decision - action - end</span>
              </div>
              <div className="wm-flow-pill-row">
                <span>start</span>
                <span>decision</span>
                <span>message</span>
                <span>fallback</span>
                <span>end</span>
              </div>
            </section>

            <section className="wm-panel is-flat">
              <div className="wm-panel-header">
                <h3>Acoes</h3>
                <span>proximos passos</span>
              </div>
              <div className="wm-stack-sm">
                <button type="button" className="wm-button wm-button-primary">Reproduzir novamente</button>
                <button type="button" className="wm-button wm-button-secondary">Ver evidencia</button>
                <button type="button" className="wm-button wm-button-secondary">Gerar novo teste</button>
              </div>
            </section>

            <section className="wm-panel is-flat">
              <div className="wm-panel-header">
                <h3>Resumo</h3>
                <span>narrativa operacional</span>
              </div>
              <p>{replay.summary}</p>
            </section>
          </div>
        </section>
      </aside>
    </div>
  );
}

export default ReplayDrawer;