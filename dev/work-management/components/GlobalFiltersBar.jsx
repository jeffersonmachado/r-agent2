import React from 'react';
import { FILTER_PERIODS } from '../types/models.js';

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function GlobalFiltersBar({ filters, projects = [], workspaces = [], onChange, onReset }) {
  const tenants = uniqueValues(projects.map((project) => project.tenant).concat(workspaces.map((workspace) => workspace.name)));
  const environments = uniqueValues(projects.map((project) => project.environment));
  const channels = uniqueValues(projects.map((project) => project.channel));
  const statuses = uniqueValues(projects.map((project) => project.status));

  return (
    <section className="wm-filter-bar">
      <div className="wm-filter-grid">
        <label>
          <span>Periodo</span>
          <select value={filters.period} onChange={(event) => onChange('period', event.target.value)}>
            {FILTER_PERIODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>

        <label>
          <span>Projeto</span>
          <select value={filters.project} onChange={(event) => onChange('project', event.target.value)}>
            <option value="all">Todos</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>

        <label>
          <span>Tenant</span>
          <select value={filters.tenant} onChange={(event) => onChange('tenant', event.target.value)}>
            <option value="all">Todos</option>
            {tenants.map((tenant) => <option key={tenant} value={tenant}>{tenant}</option>)}
          </select>
        </label>

        <label>
          <span>Ambiente</span>
          <select value={filters.environment} onChange={(event) => onChange('environment', event.target.value)}>
            <option value="all">Todos</option>
            {environments.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
          </select>
        </label>

        <label>
          <span>Canal</span>
          <select value={filters.channel} onChange={(event) => onChange('channel', event.target.value)}>
            <option value="all">Todos</option>
            {channels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
          </select>
        </label>

        <label>
          <span>Status</span>
          <select value={filters.status} onChange={(event) => onChange('status', event.target.value)}>
            <option value="all">Todos</option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
      </div>

      <button type="button" className="wm-button wm-button-secondary" onClick={onReset}>
        Limpar filtros
      </button>
    </section>
  );
}

export default GlobalFiltersBar;