import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from '../hooks/useRouter';
import { buildApiUrl } from '../api/client';

export function ChatHumanoDashboardPage() {
  const { navigate } = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [failedMessages, setFailedMessages] = useState({ pending: 0, failed: 0, errors: [] });
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  // ✅ Buscar dados de mensagens falhadas
  useEffect(() => {
    const fetchFailedMessages = async () => {
      try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
        const response = await fetch(buildApiUrl('/api/support/dashboard'), {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setFailedMessages({
            pending: data.outboundPendingCount || 0,
            failed: data.outboundFailedCount || 0,
            errors: data.recentErrors || []
          });
        }
      } catch (err) {
        console.error('[ChatHumano] Erro ao carregar métricas:', err);
      } finally {
        setLoadingMetrics(false);
      }
    };

    fetchFailedMessages();
    const interval = setInterval(fetchFailedMessages, 30000); // Atualiza a cada 30s
    return () => clearInterval(interval);
  }, []);

  const features = [
    { id: 'support', title: 'Atendimento', description: 'Operação central de tickets e conversas', icon: '💬', path: '/support', color: 'bg-cyan-500', category: 'Operação' },
    { id: 'inbox', title: 'Inbox', description: 'Fila unificada com filtros, transferência e notas', icon: '📥', path: '/inbox', color: 'bg-sky-500', category: 'Operação' },
    { id: 'quick-replies', title: 'Respostas Rápidas', description: 'Templates e atalhos operacionais', icon: '⚡', path: '/quick-replies', color: 'bg-emerald-500', category: 'Produtividade' },
    { id: 'faq', title: 'FAQ / RAG', description: 'Base de conhecimento para apoiar atendimento', icon: '📚', path: '/faq', color: 'bg-violet-500', category: 'Conhecimento' },
    { id: 'departments', title: 'Departamentos', description: 'Estrutura de squads e roteamento por equipe', icon: '🏢', path: '/departments', color: 'bg-indigo-500', category: 'Organização' },
    { id: 'whatsapp', title: 'WhatsApp', description: 'Gerencie conexões, IVR e templates do WhatsApp', icon: '🟢', path: '/whatsapp-connections', color: 'bg-green-500', category: 'Omnichannel' },
    { id: 'sla', title: 'SLA', description: 'Políticas de prazo e governança operacional', icon: '⏱️', path: '/sla-policies', color: 'bg-amber-500', category: 'Governança' },
    { id: 'supervisor', title: 'Painel Supervisor', description: 'TME, TMA, abandono e status operacional', icon: '🧭', path: '/supervisor', color: 'bg-teal-500', category: 'Analytics' },
    { id: 'analytics', title: 'Analytics', description: 'Métricas de performance e qualidade', icon: '📊', path: '/analytics', color: 'bg-rose-500', category: 'Analytics' },
    { id: 'automations', title: 'Automações', description: 'Regras para ganho de escala e consistência', icon: '🧩', path: '/automations', color: 'bg-fuchsia-500', category: 'Automação' },
    { id: 'audit', title: 'Auditoria', description: 'Rastro de eventos para compliance e suporte', icon: '📋', path: '/audit', color: 'bg-slate-500', category: 'Governança' },
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

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Dashboard Chat Humano</h1>
        <p>Pilar 1: cockpit operacional para atendimento omnichannel.</p>
      
        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Módulos</div>
          <div className="text-2xl font-semibold text-text-primary">{features.length}</div>
          <div className="text-xs text-text-secondary">atalhos do pilar</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Categorias</div>
          <div className="text-2xl font-semibold text-text-primary">{categories.length}</div>
          <div className="text-xs text-text-secondary">grupos de navegação</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Core</div>
          <div className="text-2xl font-semibold text-text-primary">Atendimento + Inbox</div>
          <div className="text-xs text-text-secondary">execução diária</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Indicadores</div>
          <div className="text-2xl font-semibold text-text-primary">Supervisor + Analytics</div>
          <div className="text-xs text-text-secondary">medição e ajuste</div>
        </div>
        <div 
          className={`rounded-xl border p-4 shadow-lg cursor-pointer transition-all ${failedMessages.failed > 0 ? 'bg-red-50 border-red-300 hover:shadow-xl' : 'bg-bg-elevated border-border-default'}`}
          onClick={() => navigate('/inbox')}
          role="button"
          tabIndex={0}
        >
          <div className="text-xs text-text-tertiary flex items-center gap-2">
            {failedMessages.failed > 0 ? '⚠️' : '✅'} Mensagens Falhadas
          </div>
          <div className={`text-2xl font-semibold ${failedMessages.failed > 0 ? 'text-red-600' : 'text-text-primary'}`}>
            {failedMessages.failed}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {failedMessages.pending} pendentes • Clique para ver
          </div>
        </div>
      </div>

      {failedMessages.errors.length > 0 && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>🚨</span>
            <span>Erros Recentes</span>
          </h3>
          <div className="space-y-2">
            {failedMessages.errors.slice(0, 5).map((error, idx) => (
              <div key={idx} 
                className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm cursor-pointer hover:bg-red-100 transition-colors"
                onClick={() => navigate('/failed-messages')}
                role="button"
                tabIndex={0}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono text-xs text-red-700 cursor-help" title={`ID: ${error.id}\n\nClique para filtrar em Mensagens Falhadas`}>
                      {error.id?.substring(0, 20)}
                      {error.id?.length > 20 ? '...' : ''}
                    </div>
                    <div className="text-text-secondary">{error.last_error}</div>
                  </div>
                  <div className="text-xs text-text-tertiary">
                    {error.attempts || 0} tentativas
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/failed-messages')}
            className="mt-4 w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
          >
            Ver Todas as Falhas
          </button>
        </div>
      )}

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros da Navegação</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Buscar card</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome ou descrição..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Categoria</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todas as categorias</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredFeatures.map((feature) => (
          <button key={feature.id} onClick={() => navigate(feature.path)} className="block text-left">
            <div className="bg-bg-elevated rounded-xl border border-border-default hover:shadow-lg transition-shadow p-6 cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className={`${feature.color} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>{feature.icon}</div>
                <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">{feature.category}</span>
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">{feature.title}</h3>
              <p className="text-sm text-text-secondary">{feature.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
