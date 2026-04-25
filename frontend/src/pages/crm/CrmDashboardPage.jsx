import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from '../../hooks/useRouter';
import { CrmPage } from './CrmPage';
import { buildApiUrl } from '../../api/client';
import { getAuthHeaders } from '../../api/auth';
import { CrudPageBase } from '../../modules/crud-base';

export function CrmDashboardPage() {
  const { currentPath } = useRouter();
  
  // Verifica se é uma seção CRM específica baseado na URL (sem state)
  // Suporta ambos /crm/contacts e /r-agent2/crm/contacts em produção
  let pathParts = currentPath.split('/').filter(Boolean);
  
  // Se começar com /r-agent2, remove esse prefixo para análise
  if (pathParts[0] === 'r-agent2') {
    pathParts = pathParts.slice(1);
  }
  
  const isCrmSubSection = pathParts.length > 1 && 
    pathParts[0] === 'crm' && 
    ['accounts', 'contacts', 'leads', 'pipelines', 'opportunities', 'activities', 'analytics', 'reports', 'campaigns', 'webhooks', 'rbac', 'audit'].includes(pathParts[1]);

  // Se for uma seção CRM específica, renderiza a página interna
  if (isCrmSubSection) {
    return <CrmPage />;
  }

  // Caso contrário, renderiza o dashboard
  return <CrmDashboardContent />;
}

function CrmDashboardContent() {
  const { navigate } = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [crmMetrics, setCrmMetrics] = useState({ 
    accounts: 0, 
    contacts: 0, 
    leads: 0, 
    opportunities: 0,
    pipelineValue: 0,
    winRate: 0
  });
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  // Buscar métricas do CRM
  useEffect(() => {
    const fetchCrmMetrics = async () => {
      try {
        const headers = getAuthHeaders();
        if (!headers.Authorization) {
          setLoadingMetrics(false);
          return;
        }
        
        const response = await fetch(buildApiUrl('/api/crm/analytics/dashboard'), {
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          const { summary, opportunity } = data.dashboard || {};
          
          setCrmMetrics({
            accounts: summary?.totalAccounts || 0,
            contacts: summary?.totalContacts || 0,
            leads: summary?.totalLeads || 0,
            opportunities: summary?.totalOpportunities || 0,
            pipelineValue: opportunity?.totalValue || 0,
            winRate: opportunity?.winRate || '0%',
          });
        }
      } catch (err) {
        console.error('[CRM] Erro ao carregar métricas:', err);
      } finally {
        setLoadingMetrics(false);
      }
    };

    fetchCrmMetrics();
    const interval = setInterval(fetchCrmMetrics, 60000); // Atualiza a cada 60s
    return () => clearInterval(interval);
  }, []);

  const features = [
    { 
      id: 'accounts', 
      title: 'Contas', 
      description: 'Empresas e organizações no pipeline comercial', 
      icon: '🏢', 
      path: '/crm/accounts', 
      color: 'bg-blue-500', 
      category: 'CRM Base' 
    },
    { 
      id: 'contacts', 
      title: 'Contatos', 
      description: 'Pessoas vinculadas às contas e oportunidades', 
      icon: '👤', 
      path: '/crm/contacts', 
      color: 'bg-green-500', 
      category: 'CRM Base' 
    },
    { 
      id: 'leads', 
      title: 'Leads', 
      description: 'Prospecção, qualificação e conversão de leads', 
      icon: '🎯', 
      path: '/crm/leads', 
      color: 'bg-orange-500', 
      category: 'Pipeline' 
    },
    { 
      id: 'opportunities', 
      title: 'Oportunidades', 
      description: 'Gestão de negociações e fechamentos', 
      icon: '💼', 
      path: '/crm/opportunities', 
      color: 'bg-purple-500', 
      category: 'Pipeline' 
    },
    { 
      id: 'pipelines', 
      title: 'Pipelines', 
      description: 'Funis de vendas e estágios customizados', 
      icon: '📈', 
      path: '/crm/pipelines', 
      color: 'bg-indigo-500', 
      category: 'Pipeline' 
    },
    { 
      id: 'activities', 
      title: 'Atividades', 
      description: 'Registro de chamadas, reuniões e follow-ups', 
      icon: '📝', 
      path: '/crm/activities', 
      color: 'bg-cyan-500', 
      category: 'Engajamento' 
    },
    { 
      id: 'analytics', 
      title: 'Análises', 
      description: 'Métricas de performance, conversão e receita', 
      icon: '📊', 
      path: '/crm/analytics', 
      color: 'bg-rose-500', 
      category: 'Analises' 
    },
    { 
      id: 'reports', 
      title: 'Relatórios', 
      description: 'Dashboards de vendas e previsões', 
      icon: '📈', 
      path: '/crm/reports', 
      color: 'bg-amber-500', 
      category: 'Analises' 
    },
    { 
      id: 'campaigns', 
      title: 'Campanhas', 
      description: 'Automação de marketing e nutrição de leads', 
      icon: '📢', 
      path: '/crm/campaigns', 
      color: 'bg-pink-500', 
      category: 'Marketing' 
    },
    { 
      id: 'webhooks', 
      title: 'Webhooks', 
      description: 'Integrações e notificações em tempo real', 
      icon: '🔗', 
      path: '/crm/webhooks', 
      color: 'bg-teal-500', 
      category: 'Integrações' 
    },
    { 
      id: 'rbac', 
      title: 'Permissões', 
      description: 'Controle de acesso e roles do CRM', 
      icon: '🔐', 
      path: '/crm/rbac', 
      color: 'bg-slate-500', 
      category: 'Governanca' 
    },
    { 
      id: 'audit', 
      title: 'Auditoria', 
      description: 'Logs de ações e compliance', 
      icon: '📋', 
      path: '/crm/audit', 
      color: 'bg-gray-500', 
      category: 'Governanca' 
    },
  ];

  const categories = useMemo(
    () => Array.from(new Set(features.map((f) => f.category))).sort(),
    [],
  );

  const filteredFeatures = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return features.filter((feature) => {
      const matchesCategory = !selectedCategory || feature.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!query) return true;
      return feature.title.toLowerCase().includes(query) || feature.description.toLowerCase().includes(query);
    });
  }, [features, searchTerm, selectedCategory]);

  const formatCurrency = (value) => {
    if (value >= 1000000) {
      return `R$ ${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `R$ ${(value / 1000).toFixed(0)}k`;
    }
    return `R$ ${value}`;
  };

  const dashboardPageStyle = {
    height: 'auto',
    minHeight: '100%',
    overflowY: 'visible',
    overflowX: 'visible',
  };

  const quickActionBaseStyle = {
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '1rem',
    padding: '1rem',
    textAlign: 'left',
    color: '#ffffff',
    boxShadow: '0 18px 40px rgba(0, 0, 0, 0.24)',
    transition: 'transform 160ms ease, box-shadow 160ms ease, filter 160ms ease',
  };

  const quickActionMetaStyle = {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.86)',
  };

  const quickActionStyles = {
    accounts: {
      background: 'linear-gradient(135deg, #5e6ad2, #4651b8)',
    },
    leads: {
      background: 'linear-gradient(135deg, #d97706, #b45309)',
    },
    opportunities: {
      background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    },
    activities: {
      background: 'linear-gradient(135deg, #0f766e, #115e59)',
    },
  };

  return (
    <CrudPageBase style={dashboardPageStyle}>
      <div className="support-header">
        <h1>🚀 Painel CRM</h1>
        <p>Pilar de Relacionamento com Cliente: gestão comercial end-to-end.</p>
      
        <div className="support-controls">
          <button
            type="button"
            className="px-4 py-2 text-sm rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      {/* Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary flex items-center gap-1">
            <span>🏢</span> Contas
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {loadingMetrics ? '...' : crmMetrics.accounts}
          </div>
          <div className="text-xs text-text-secondary">empresas ativas</div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary flex items-center gap-1">
            <span>👤</span> Contatos
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {loadingMetrics ? '...' : crmMetrics.contacts}
          </div>
          <div className="text-xs text-text-secondary">pessoas cadastradas</div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary flex items-center gap-1">
            <span>🎯</span> Leads
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {loadingMetrics ? '...' : crmMetrics.leads}
          </div>
          <div className="text-xs text-text-secondary">em qualificação</div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary flex items-center gap-1">
            <span>💼</span> Oportunidades
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {loadingMetrics ? '...' : crmMetrics.opportunities}
          </div>
          <div className="text-xs text-text-secondary">em negociação</div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary flex items-center gap-1">
            <span>💰</span> Pipeline
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {loadingMetrics ? '...' : formatCurrency(crmMetrics.pipelineValue)}
          </div>
          <div className="text-xs text-text-secondary">valor total</div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary flex items-center gap-1">
            <span>📈</span> Taxa de Ganho
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {loadingMetrics ? '...' : crmMetrics.winRate}
          </div>
          <div className="text-xs text-text-secondary">taxa de conversão</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <button
          onClick={() => navigate('/crm/accounts')}
          className="hover:opacity-95 text-white hover:shadow-xl transition-all"
          style={{ ...quickActionBaseStyle, ...quickActionStyles.accounts }}
        >
          <div className="text-2xl mb-2">➕</div>
          <div className="font-semibold">Nova Conta</div>
          <div style={quickActionMetaStyle}>Cadastrar empresa</div>
        </button>

        <button
          onClick={() => navigate('/crm/leads')}
          className="hover:opacity-95 text-white hover:shadow-xl transition-all"
          style={{ ...quickActionBaseStyle, ...quickActionStyles.leads }}
        >
          <div className="text-2xl mb-2">🎯</div>
          <div className="font-semibold">Novo Lead</div>
          <div style={quickActionMetaStyle}>Qualificar prospecto</div>
        </button>

        <button
          onClick={() => navigate('/crm/opportunities')}
          className="hover:opacity-95 text-white hover:shadow-xl transition-all"
          style={{ ...quickActionBaseStyle, ...quickActionStyles.opportunities }}
        >
          <div className="text-2xl mb-2">💼</div>
          <div className="font-semibold">Nova Oportunidade</div>
          <div style={quickActionMetaStyle}>Criar negocio</div>
        </button>

        <button
          onClick={() => navigate('/crm/activities')}
          className="hover:opacity-95 text-white hover:shadow-xl transition-all"
          style={{ ...quickActionBaseStyle, ...quickActionStyles.activities }}
        >
          <div className="text-2xl mb-2">📞</div>
          <div className="font-semibold">Registrar Atividade</div>
          <div style={quickActionMetaStyle}>Log de interação</div>
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Navegação do CRM</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Buscar módulo</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome ou descrição..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Categoria</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:bg-bg-hover"
            >
              <option value="">Todas as categorias</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Grid de Módulos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredFeatures.map((feature) => (
          <button key={feature.id} onClick={() => navigate(feature.path)} className="block text-left">
            <div className="bg-bg-elevated rounded-xl border border-border-default hover:shadow-lg transition-shadow p-6 cursor-pointer h-full">
              <div className="flex items-start justify-between mb-3">
                <div className={`${feature.color} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
                  {feature.icon}
                </div>
                <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">
                  {feature.category}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">{feature.title}</h3>
              <p className="text-sm text-text-secondary">{feature.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Footer Info */}
      <div className="mt-8 bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <span>💡</span>
          <span>Sobre o CRM</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-text-secondary">
          <div>
            <div className="font-semibold text-text-primary mb-2">Core CRM</div>
            <ul className="space-y-1">
              <li>• Gestão de contas e contatos</li>
              <li>• Qualificação de leads</li>
              <li>• Pipeline de oportunidades</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-text-primary mb-2">Analytics</div>
            <ul className="space-y-1">
              <li>• Métricas de vendas em tempo real</li>
              <li>• Relatórios customizados</li>
              <li>• Previsões de receita</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-text-primary mb-2">Integrações</div>
            <ul className="space-y-1">
              <li>• Webhooks para automação</li>
              <li>• API REST completa</li>
              <li>• RBAC e auditoria</li>
            </ul>
          </div>
        </div>
      </div>
    </CrudPageBase>
  );
}
