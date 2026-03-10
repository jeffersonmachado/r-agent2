import React, { useEffect, useState } from 'react';
import { buildApiUrl } from '../../api/client';
import { getAuthHeaders } from '../../api/auth';
import {
  PlatformChartCard,
  PlatformDashboardHeader,
  PlatformDashboardLoadingState,
  PlatformDashboardPage,
  PlatformDashboardSection,
  PlatformKpiCard,
} from '../../modules/platform-dashboard';

export function AnalyticsDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const response = await fetch(buildApiUrl('/api/crm/analytics/dashboard'), {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      setDashboard(data.dashboard);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <PlatformDashboardPage>
        <PlatformDashboardHeader
          title="📊 CRM Analytics"
          description="Métricas de performance, conversão e receita."
        />
        <PlatformDashboardLoadingState label="Carregando dashboard..." />
      </PlatformDashboardPage>
    );
  }
  if (!dashboard) {
    return (
      <PlatformDashboardPage>
        <PlatformDashboardHeader
          title="📊 CRM Analytics"
          description="Métricas de performance, conversão e receita."
        />
        <div className="text-center text-status-error">Erro ao carregar dados</div>
      </PlatformDashboardPage>
    );
  }

  const { summary, opportunity, activity } = dashboard;

  const formatCurrency = (value) => {
    const numeric = Number(value || 0);
    if (numeric >= 1000000) {
      return `R$ ${(numeric / 1000000).toFixed(1)}M`;
    }
    if (numeric >= 1000) {
      return `R$ ${(numeric / 1000).toFixed(0)}k`;
    }
    return `R$ ${numeric.toFixed(0)}`;
  };

  return (
    <PlatformDashboardPage>
      <PlatformDashboardHeader
        title="📊 Análises CRM"
        description="Métricas de performance, conversão e receita."
      />

      <div className="space-y-6">

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard title="Total de Contas" value={summary.totalAccounts} icon="🏢" />
        <MetricCard title="Total de Contatos" value={summary.totalContacts} icon="👤" />
        <MetricCard title="Total de Leads" value={summary.totalLeads} icon="🎯" />
        <MetricCard title="Oportunidades" value={summary.totalOpportunities} icon="💼" />
        <MetricCard title="Atividades" value={summary.totalActivities} icon="📝" />
      </div>

      {/* Opportunity Metrics */}
      <PlatformDashboardSection title="Métricas de oportunidades" icon="💰" className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-4">
          <PlatformKpiCard label="Valor total do pipeline" value={formatCurrency(opportunity.totalValue)} />
          <PlatformKpiCard label="Ganho (closed won)" value={formatCurrency(opportunity.closedWonValue)} />
          <PlatformKpiCard label="Ticket médio" value={formatCurrency(opportunity.avgDealSize)} />
          <PlatformKpiCard label="Taxa de ganho" value={opportunity.winRate} />
        </div>
      </PlatformDashboardSection>

      {/* Pipeline Stage Distribution */}
      <PlatformDashboardSection title="Estágios do pipeline" icon="📈">
        <PlatformChartCard>
        <div className="space-y-3">
          {Object.entries(opportunity.stageDistribution).map(([stage, count]) => (
            <div key={stage}>
              <div className="flex justify-between mb-1">
                <span className="text-sm font-medium text-text-secondary">{stage}</span>
                <span className="text-sm font-bold text-text-primary">{count} oportunidades</span>
              </div>
              <div className="w-full bg-bg-secondary rounded-full h-2">
                <div
                  className="bg-accent-primary h-2 rounded-full"
                  style={{
                    width: `${Math.max(
                      5,
                      (count /
                        Object.values(opportunity.stageDistribution).reduce((a, b) => a + b, 0)) *
                        100
                    )}%`,
                  }}
                ></div>
              </div>
            </div>
          ))}
        </div>
        </PlatformChartCard>
      </PlatformDashboardSection>

      {/* Activity Metrics */}
      <PlatformDashboardSection title="Resumo de atividades" icon="📝">
        <div className="grid grid-cols-2 gap-4">
          <PlatformKpiCard label="Esta semana" value={activity.thisWeekCount} />
          <PlatformKpiCard label="Total" value={activity.totalCount} />
        </div>
      </PlatformDashboardSection>
      </div>
    </PlatformDashboardPage>
  );
}

function MetricCard({ title, value, icon }) {
  return (
    <PlatformKpiCard label={`${icon} ${title}`} value={value} />
  );
}

export default AnalyticsDashboard;
