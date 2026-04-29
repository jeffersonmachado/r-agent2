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
            placeholder="Nome, código ou descrição"
          />
        </div>
        <div style={{ minWidth: '180px' }}>
          <label className="support-form-label">Status</label>
          <select
            className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary cursor-pointer"
            value={filters.status || ''}
            onChange={(event) => onChange('status', event.target.value)}
          >
            <option value="">Todos</option>
            <option value="active">Ativo</option>
            <option value="paused">Pausado</option>
            <option value="done">Concluído</option>
          </select>
        </div>
        <button
          className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer"
          onClick={onClear}
          type="button"
        >
          Limpar
        </button>
      </div>
    </div>
  );
}

export default ProjectFilters;
