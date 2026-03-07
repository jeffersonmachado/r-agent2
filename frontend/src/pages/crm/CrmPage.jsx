import React, { useState, useEffect } from 'react';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { CrmProvider } from '../../context/crm/CrmContext';
import { AccountsPage } from './AccountsPage';
import { ContactsPage } from './ContactsPage';
import { LeadsPage } from './LeadsPage';
import { PipelinesPage } from './PipelinesPage';
import { OpportunitiesPage } from './OpportunitiesPage';
import { ActivitiesPage } from './ActivitiesPage';
import { AnalyticsPage } from './AnalyticsPage';
import { ReportsPage } from './ReportsPage';
import { CampaignsPage } from './CampaignsPage';
import { WebhooksPage } from './WebhooksPage';
import { RbacPage } from './RbacPage';
import { AuditPage } from './AuditPage';
import { buildApiUrl } from '../../api/client';
import { getAuthHeaders } from '../../api/auth';

export function CrmPage() {
  const { currentPath, navigate } = useRouter();
  const [currentSection, setCurrentSection] = useState(() => {
    // Detecta a seção da URL (ex: /crm/contacts -> contacts)
    const pathParts = currentPath.split('/').filter(Boolean);
    if (pathParts.length > 1 && pathParts[0] === 'crm') {
      return pathParts[1];
    }
    return 'dashboard';
  });

  // Sincroniza a seção quando a URL muda
  useEffect(() => {
    const pathParts = currentPath.split('/').filter(Boolean);
    if (pathParts.length > 1 && pathParts[0] === 'crm') {
      setCurrentSection(pathParts[1]);
    } else {
      setCurrentSection('dashboard');
    }
  }, [currentPath]);

  return (
    <CrmProvider>
      {currentSection === 'dashboard' && <DashboardSection />}
      {currentSection === 'accounts' && <AccountsPage />}
      {currentSection === 'contacts' && <ContactsPage />}
      {currentSection === 'leads' && <LeadsPage />}
      {currentSection === 'pipelines' && <PipelinesPage />}
      {currentSection === 'opportunities' && <OpportunitiesPage />}
      {currentSection === 'activities' && <ActivitiesPage />}
      {currentSection === 'analytics' && <AnalyticsPage />}
      {currentSection === 'reports' && <ReportsPage />}
      {currentSection === 'campaigns' && <CampaignsPage />}
      {currentSection === 'webhooks' && <WebhooksPage />}
      {currentSection === 'rbac' && <RbacPage />}
      {currentSection === 'audit' && <AuditPage />}
    </CrmProvider>
  );
}

function DashboardSection() {
  const { showToast, ToastContainer } = useToast();
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const response = await fetch(buildApiUrl('/api/crm/analytics/dashboard'), {
          headers: getAuthHeaders(),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.ok) {
          setDashboardData(data.dashboard);
        } else {
          showToast(data.error || 'Erro ao carregar dashboard', 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [showToast]);

  if (loading) {
    return (
      <div className="support-page">
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>📊 Dashboard CRM</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando dashboard...</p>
          </div>
        </div>
        <ToastContainer />
      </div>
    );
  }

  const stats = [
    { label: 'Total de contas', value: dashboardData?.summary?.totalAccounts || 0, icon: '🏢' },
    { label: 'Contatos ativos', value: dashboardData?.summary?.totalContacts || 0, icon: '👤' },
    { label: 'Leads qualificados', value: dashboardData?.summary?.totalLeads || 0, icon: '🎯' },
    { label: 'Valor do pipeline', value: `R$ ${(dashboardData?.opportunity?.totalValue || 0).toFixed(0)}`, icon: '💰' },
  ];

  const recentActivities = [
    { id: 1, action: 'Total de oportunidades', value: dashboardData?.summary?.totalOpportunities || 0 },
    { id: 2, action: 'Total de atividades', value: dashboardData?.summary?.totalActivities || 0 },
    { id: 3, action: 'Taxa de ganho', value: dashboardData?.opportunity?.winRate || '0%' },
  ];

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📊 Dashboard CRM</h1>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-bg-elevated rounded-lg shadow border border-border-default p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-secondary text-sm">{stat.label}</p>
                <p className="text-2xl font-bold text-text-primary mt-2">{stat.value}</p>
              </div>
              <span className="text-4xl">{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Dashboard Summary */}
      <div className="bg-bg-elevated rounded-lg shadow border border-border-default mb-6">
        <div className="p-6 border-b border-border-default">
          <h2 className="text-xl font-bold text-text-primary">Métricas Principais</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
          {recentActivities.map((activity) => (
            <div key={activity.id} className="p-4 bg-bg-hover rounded-lg">
              <p className="text-text-secondary text-sm">{activity.action}</p>
              <p className="text-2xl font-bold text-accent-primary mt-2">{activity.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-bg-elevated rounded-lg shadow border border-border-default p-6">
          <h3 className="font-bold text-text-primary mb-3">ℹ️ Informações do Sistema</h3>
          <ul className="space-y-2 text-sm text-text-secondary">
            <li>✓ Dashboard carregado com sucesso</li>
            <li>✓ Dados em tempo real do banco de dados</li>
            <li>✓ Atualizado pelo endpoint `/api/crm/analytics/dashboard`</li>
            <li>✓ Navegue pelas abas para gerenciar dados</li>
          </ul>
        </div>
        <div className="bg-bg-elevated rounded-lg shadow border border-border-default p-6">
          <h3 className="font-bold text-text-primary mb-3">🎯 Próximas Ações</h3>
          <ul className="space-y-2 text-sm text-text-secondary">
            <li>→ Adicionar novas contas em Accounts</li>
            <li>→ Gerenciar contatos em Contatos</li>
            <li>→ Qualificar leads em Leads</li>
            <li>→ Monitorar oportunidades em Opportunities</li>
          </ul>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}

export default CrmPage;
