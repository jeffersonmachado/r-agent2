import React from 'react';
import { PlatformDashboardPage } from '../components/PlatformDashboardPage';
import { PlatformDashboardHeader } from '../components/PlatformDashboardHeader';
import { PlatformDashboardSection } from '../components/PlatformDashboardSection';
import { PlatformKpiCard } from '../components/PlatformKpiCard';
import { useDashboardFilters } from '../hooks/useDashboardFilters';
import { getDashboardSectionClassName } from '../utils/dashboardLayout';

export function BasicDashboardExample() {
  const [filters, setFilters] = useDashboardFilters(
    { period: '7d' },
    'basic-dashboard-example',
  );

  return (
    <PlatformDashboardPage>
      <PlatformDashboardHeader
        title="Dashboard Exemplo"
        description="Exemplo mínimo de composição com shell analítico."
      />
      <PlatformDashboardSection title="Resumo" icon="📊">
        <div className={getDashboardSectionClassName({ columns: 3 })}>
          <PlatformKpiCard label="Tickets" value="128" hint={`Período ${filters.period}`} />
          <PlatformKpiCard label="Conversão" value="32%" />
          <PlatformKpiCard label="SLA" value="97%" />
        </div>
      </PlatformDashboardSection>
      <PlatformDashboardSection title="Filtros" icon="🔍">
        <select
          className="w-full max-w-xs px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
          value={filters.period}
          onChange={(event) => setFilters((current) => ({ ...current, period: event.target.value }))}
        >
          <option value="7d">7 dias</option>
          <option value="30d">30 dias</option>
        </select>
      </PlatformDashboardSection>
    </PlatformDashboardPage>
  );
}
