import React from 'react';

export function DocumentsPage({ model }) {
  return (
    <section className="wm-panel">
      <div className="wm-panel-header">
        <h2>Documents</h2>
        <span>specs, decisions, evidence, playbooks</span>
      </div>
      <div className="wm-card-grid">
        {model.documents.length ? model.documents.map((document) => (
          <article key={document.id} className="wm-doc-card">
            <div className="wm-overline">{document.category}</div>
            <h3>{document.title}</h3>
            <p>{model.projectsById[document.projectId]?.name || '-'}</p>
            <div className="wm-inline-meta">
              <span>{document.owner}</span>
              <span>{new Date(document.updatedAt).toLocaleString('pt-BR')}</span>
            </div>
          </article>
        )) : <div className="wm-empty-state">Nenhum documento para este recorte.</div>}
      </div>
    </section>
  );
}

export default DocumentsPage;