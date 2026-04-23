import React from 'react';

export function ProjectFilters({ filters, onChange, onClear }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg mb-6">
      <div className="flex flex-wrap gap-3 items-end">
        <div style={{ minWidth: '220px', flex: 1 }}>
          <label className="support-form-label">Busca</label>
          <input
            className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
            value={filters.q || ''}
            onChange={(event) => onChange('q', event.target.value)}
            placeholder="Nome, codigo ou descricao"
          />
        </div>
        <div style={{ minWidth: '180px' }}>
          <label className="support-form-label">Status</label>
          <select
            className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
            value={filters.status || ''}
            onChange={(event) => onChange('status', event.target.value)}
          >
            <option value="">Todos</option>
            <option value="active">Ativo</option>
            <option value="paused">Pausado</option>
            <option value="done">Concluido</option>
          </select>
        </div>
        <button className="support-button" onClick={onClear} type="button">
          Limpar
        </button>
      </div>
    </div>
  );
}

export default ProjectFilters;
