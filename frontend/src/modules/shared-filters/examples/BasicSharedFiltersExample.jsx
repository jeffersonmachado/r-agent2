import React from 'react';
import { SharedSearchFilter } from '../components/SharedSearchFilter';
import { SharedSelectFilter } from '../components/SharedSelectFilter';
import { SharedPeriodFilter } from '../components/SharedPeriodFilter';
import { useSharedFiltersState } from '../hooks/useSharedFiltersState';

export function BasicSharedFiltersExample() {
  const { filters, updateFilter, resetFilters } = useSharedFiltersState({
    search: '',
    status: '',
    period: '7d',
  });

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SharedSearchFilter
          value={filters.search}
          onChange={(value) => updateFilter('search', value)}
        />
        <SharedSelectFilter
          label="Status"
          value={filters.status}
          onChange={(value) => updateFilter('status', value)}
          options={[
            { label: 'Ativo', value: 'active' },
            { label: 'Inativo', value: 'inactive' },
          ]}
        />
        <SharedPeriodFilter
          value={filters.period}
          onChange={(value) => updateFilter('period', value)}
          options={[
            { label: '7 dias', value: '7d' },
            { label: '30 dias', value: '30d' },
          ]}
        />
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={resetFilters}
          className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary"
        >
          Limpar filtros
        </button>
      </div>
    </div>
  );
}
