import React, { useEffect, useState } from 'react';
import { CrmCard } from '../../components/crm/CrmComponents';

export function AnalyticsDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('http://localhost:3000/api/crm/analytics/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setDashboard(data.dashboard);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-6 text-center">Carregando dashboard...</div>;
  if (!dashboard) return <div className="p-6 text-center text-red-600">Erro ao carregar dados</div>;

  const { summary, opportunity, activity } = dashboard;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-4xl font-bold text-gray-900 mb-8">📊 CRM Analytics Dashboard</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Accounts"
          value={summary.totalAccounts}
          icon="🏢"
          color="blue"
        />
        <MetricCard
          title="Total Contacts"
          value={summary.totalContacts}
          icon="👤"
          color="green"
        />
        <MetricCard title="Total Leads" value={summary.totalLeads} icon="🎯" color="orange" />
        <MetricCard
          title="Opportunities"
          value={summary.totalOpportunities}
          icon="💼"
          color="purple"
        />
        <MetricCard
          title="Activities"
          value={summary.totalActivities}
          icon="📝"
          color="pink"
        />
      </div>

      {/* Opportunity Metrics */}
      <CrmCard className="lg:col-span-2">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">💰 Opportunity Metrics</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg">
            <p className="text-gray-600 text-sm">Total Pipeline Value</p>
            <p className="text-3xl font-bold text-blue-600 mt-2">
              R$ {(opportunity.totalValue / 1000).toFixed(0)}k
            </p>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg">
            <p className="text-gray-600 text-sm">Closed Won</p>
            <p className="text-3xl font-bold text-green-600 mt-2">
              R$ {(opportunity.closedWonValue / 1000).toFixed(0)}k
            </p>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg">
            <p className="text-gray-600 text-sm">Average Deal Size</p>
            <p className="text-3xl font-bold text-purple-600 mt-2">
              R$ {(opportunity.avgDealSize / 1000).toFixed(0)}k
            </p>
          </div>
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg">
            <p className="text-gray-600 text-sm">Win Rate</p>
            <p className="text-3xl font-bold text-orange-600 mt-2">{opportunity.winRate}</p>
          </div>
        </div>
      </CrmCard>

      {/* Pipeline Stage Distribution */}
      <CrmCard>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">📈 Pipeline Stages</h2>
        <div className="space-y-3">
          {Object.entries(opportunity.stageDistribution).map(([stage, count]) => (
            <div key={stage}>
              <div className="flex justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">{stage}</span>
                <span className="text-sm font-bold text-gray-900">{count} opps</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
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
        <h2 className="text-2xl font-bold text-gray-900 mb-4">📝 Activity Summary</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="border-l-4 border-blue-500 pl-4">
            <p className="text-gray-600 text-sm">This Week</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{activity.thisWeekCount}</p>
          </div>
          <div className="border-l-4 border-green-500 pl-4">
            <p className="text-gray-600 text-sm">All Time</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{activity.totalCount}</p>
          </div>
        </div>
      </CrmCard>
    </div>
  );
}

function MetricCard({ title, value, icon, color }) {
  const colorClass = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    orange: 'bg-orange-50 border-orange-200',
    purple: 'bg-purple-50 border-purple-200',
    pink: 'bg-pink-50 border-pink-200',
  }[color];

  return (
    <div className={`${colorClass} border rounded-lg p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}

export default AnalyticsDashboard;
