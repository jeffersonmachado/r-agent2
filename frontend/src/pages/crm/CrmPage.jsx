import React, { useState, useEffect } from 'react';
import { useRouter } from '../../hooks/useRouter';
import { CrmProvider } from '../../context/crm/CrmContext';
import { AccountsPage } from './AccountsPage';
import { ContactsPage } from './ContactsPage';
import { LeadsPage } from './LeadsPage';
import { PipelinesPage } from './PipelinesPage';
import { OpportunitiesPage } from './OpportunitiesPage';

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

  const navItems = [
    { id: 'dashboard', label: '📊 Dashboard', icon: '📊' },
    { id: 'accounts', label: '🏢 Accounts', icon: '🏢' },
    { id: 'contacts', label: '👤 Contatos', icon: '👤' },
    { id: 'leads', label: '🎯 Leads', icon: '🎯' },
    { id: 'pipelines', label: '📈 Pipelines', icon: '📈' },
    { id: 'opportunities', label: '💼 Opportunities', icon: '💼' },
  ];

  const handleNavClick = (sectionId) => {
    setCurrentSection(sectionId);
    if (sectionId === 'dashboard') {
      navigate('/crm');
    } else {
      navigate(`/crm/${sectionId}`);
    }
  };

  return (
    <CrmProvider>
      <div className="flex h-screen bg-bg-secondary">
        {/* Sidebar */}
        <div className="w-56 bg-bg-elevated shadow-lg border-r border-border-default">
          <div className="p-6 border-b border-border-default">
            <h1 className="text-2xl font-bold text-accent-primary">🚀 CRM</h1>
            <p className="text-sm text-text-secondary mt-1">Operational Hub</p>
          </div>

          <nav className="p-4 space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${
                  currentSection === item.id
                    ? 'bg-accent-primary text-white'
                    : 'text-text-primary hover:bg-bg-hover'
                }`}
              >
                <span className="mr-2">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="absolute bottom-0 left-0 right-0 p-4 bg-bg-secondary border-t border-border-default w-56">
            <button className="w-full px-4 py-2 bg-status-error text-white rounded-lg hover:opacity-80 font-medium">
              🚪 Sair
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {currentSection === 'dashboard' && <DashboardSection />}
          {currentSection === 'accounts' && <AccountsPage />}
          {currentSection === 'contacts' && <ContactsPage />}
          {currentSection === 'leads' && <LeadsPage />}
          {currentSection === 'pipelines' && <PipelinesPage />}
          {currentSection === 'opportunities' && <OpportunitiesPage />}
        </div>
      </div>
    </CrmProvider>
  );
}

function DashboardSection() {
  const stats = [
    { label: 'Total Accounts', value: '24', icon: '🏢', color: 'blue' },
    { label: 'Active Contacts', value: '127', icon: '👤', color: 'green' },
    { label: 'Qualified Leads', value: '18', icon: '🎯', color: 'orange' },
    { label: 'Pipeline Value', value: 'R$ 2.5M', icon: '💰', color: 'purple' },
  ];

  const recentActivities = [
    { id: 1, action: 'Nova opportunity criada: ABC Corp - R$ 150k', time: '2 min' },
    { id: 2, action: 'Lead qualificado: João Silva', time: '15 min' },
    { id: 3, action: 'Conta atualizada: Empresa XYZ', time: '1 hora' },
    { id: 4, action: 'Atividade registrada em oportunidade', time: '2 horas' },
  ];

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-text-primary mb-6">Dashboard CRM</h1>

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

      {/* Recent Activities */}
      <div className="bg-bg-elevated rounded-lg shadow border border-border-default">
        <div className="p-6 border-b border-border-default">
          <h2 className="text-xl font-bold text-text-primary">Atividades Recentes</h2>
        </div>
        <div className="divide-y divide-border-default">
          {recentActivities.map((activity) => (
            <div key={activity.id} className="p-4 hover:bg-bg-hover">
              <p className="text-text-primary">{activity.action}</p>
              <p className="text-xs text-text-tertiary mt-1">{activity.time} atrás</p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <div className="bg-bg-elevated rounded-lg shadow border border-border-default p-6">
          <h3 className="font-bold text-text-primary mb-3">Próximos Passos</h3>
          <ul className="space-y-2 text-sm text-text-secondary">
            <li>✓ Seguir com 5 leads qualificados</li>
            <li>✓ Validar 3 propostas em aberto</li>
            <li>✓ Agendar 2 reuniões de fechamento</li>
          </ul>
        </div>
        <div className="bg-bg-elevated rounded-lg shadow border border-border-default p-6">
          <h3 className="font-bold text-text-primary mb-3">Performance</h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-text-secondary">Taxa de Conversão</p>
              <div className="bg-bg-secondary rounded h-2 mt-1">
                <div className="bg-status-success h-2 rounded" style={{ width: '68%' }}></div>
              </div>
              <p className="text-xs text-text-secondary mt-1">68%</p>
            </div>
          </div>
        </div>
        <div className="bg-bg-elevated rounded-lg shadow border border-border-default p-6">
          <h3 className="font-bold text-text-primary mb-3">Pipeline Status</h3>
          <div className="space-y-2 text-sm">
            <p className="text-text-secondary">Qualificação: <span className="font-bold text-text-primary">12</span></p>
            <p className="text-text-secondary">Proposta: <span className="font-bold text-text-primary">8</span></p>
            <p className="text-text-secondary">Fechamento: <span className="font-bold text-text-primary">4</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CrmPage;
