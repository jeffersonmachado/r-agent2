import React, { useEffect, useState } from 'react';
import { CrmCard } from '../../components/crm/CrmComponents';
import { buildApiUrl } from '../../api/client';
import { getAuthHeaders } from '../../api/auth';

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
      <div className="support-page">
        <div className="support-header">
          <h1>📊 CRM Analytics</h1>
        </div>
        <div className="text-center text-text-secondary">Carregando dashboard...</div>
      </div>
    );
  }
  if (!dashboard) {
    return (
      <div className="support-page">
        <div className="support-header">
          <h1>📊 CRM Analytics</h1>
        </div>
        <div className="text-center text-status-error">Erro ao carregar dados</div>
      </div>
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
    <div className="support-page">
      <div className="support-header">
        <h1>📊 Análises CRM</h1>
        <p>Métricas de performance, conversão e receita.</p>
      </div>

      <div className="space-y-6">

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total de Contas"
          value={summary.totalAccounts}
          icon="🏢"
          color="blue"
        />
        <MetricCard
          title="Total de Contatos"
          value={summary.totalContacts}
          icon="👤"
          color="green"
        />
        <MetricCard title="Total de Leads" value={summary.totalLeads} icon="🎯" color="orange" />
        <MetricCard
          title="Oportunidades"
          value={summary.totalOpportunities}
          icon="💼"
          color="purple"
        />
        <MetricCard
          title="Atividades"
          value={summary.totalActivities}
          icon="📝"
          color="pink"
        />
      </div>

      {/* Opportunity Metrics */}
      <CrmCard className="lg:col-span-2">
        <h2 className="text-2xl font-bold text-text-primary mb-4">💰 Métricas de oportunidades</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-bg-hover p-4 rounded-lg border border-border-default">
            <p className="text-text-secondary text-sm">Valor total do pipeline</p>
            <p className="text-3xl font-bold text-text-primary mt-2">
              {formatCurrency(opportunity.totalValue)}
            </p>
          </div>
          <div className="bg-bg-hover p-4 rounded-lg border border-border-default">
            <p className="text-text-secondary text-sm">Ganho (closed won)</p>
            <p className="text-3xl font-bold text-text-primary mt-2">
              {formatCurrency(opportunity.closedWonValue)}
            </p>
          </div>
          <div className="bg-bg-hover p-4 rounded-lg border border-border-default">
            <p className="text-text-secondary text-sm">Ticket médio</p>
            <p className="text-3xl font-bold text-text-primary mt-2">
              {formatCurrency(opportunity.avgDealSize)}
            </p>
          </div>
          <div className="bg-bg-hover p-4 rounded-lg border border-border-default">
            <p className="text-text-secondary text-sm">Taxa de ganho</p>
            <p className="text-3xl font-bold text-text-primary mt-2">{opportunity.winRate}</p>
          </div>
        </div>
      </CrmCard>

      {/* Pipeline Stage Distribution */}
      <CrmCard>
        <h2 className="text-2xl font-bold text-text-primary mb-4">📈 Estágios do pipeline</h2>
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
      </CrmCard>

      {/* Activity Metrics */}
      <CrmCard>
        <h2 className="text-2xl font-bold text-text-primary mb-4">📝 Resumo de atividades</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="border-l-4 border-accent-primary pl-4">
            <p className="text-text-secondary text-sm">Esta semana</p>
            <p className="text-2xl font-bold text-text-primary mt-1">{activity.thisWeekCount}</p>
          </div>
          <div className="border-l-4 border-status-success pl-4">
            <p className="text-text-secondary text-sm">Total</p>
            <p className="text-2xl font-bold text-text-primary mt-1">{activity.totalCount}</p>
          </div>
        </div>
      </CrmCard>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon, color }) {
  return (
    <div className="bg-bg-elevated border border-border-default rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{title}</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}

export default AnalyticsDashboard;
