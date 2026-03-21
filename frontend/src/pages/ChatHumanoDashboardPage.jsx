import React, { useMemo, useEffect } from 'react';
import { useRouter } from '../hooks/useRouter';
import { buildApiUrl } from '../api/client';
import { DashboardKpiCard, DashboardSection, DashboardFeatureGrid } from '../modules/dashboard-base';
import { CrudPageBase } from '../modules/crud-base';

export function ChatHumanoDashboardPage() {
  const { navigate } = useRouter();
  const [failedMessages, setFailedMessages] = React.useState({ pending: 0, failed: 0, errors: [] });
  const [loadingMetrics, setLoadingMetrics] = React.useState(true);

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

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>Dashboard Chat Humano</h1>
        <p>Pilar 1: cockpit operacional para atendimento omnichannel.</p>
        <div className="support-controls">
          <button type="button" className="btn-default px-4 py-2 text-sm" onClick={() => window.location.reload()}>
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <DashboardKpiCard label="Módulos" value={features.length} subtitle="atalhos do pilar" />
        <DashboardKpiCard label="Categorias" value={categories.length} subtitle="grupos de navegação" />
        <DashboardKpiCard label="Core" value="Atendimento + Inbox" subtitle="execução diária" />
        <DashboardKpiCard label="Indicadores" value="Supervisor + Analytics" subtitle="medição e ajuste" />
        <DashboardKpiCard
          label="Mensagens Falhadas"
          value={failedMessages.failed}
          subtitle={`${failedMessages.pending} pendentes • Clique para ver`}
          icon={failedMessages.failed > 0 ? '⚠️' : '✅'}
          variant={failedMessages.failed > 0 ? 'danger' : 'default'}
          onClick={() => navigate('/inbox')}
        />
      </div>

      {failedMessages.errors.length > 0 && (
        <DashboardSection title="Erros Recentes" icon="🚨">
          <div className="space-y-2">
            {failedMessages.errors.slice(0, 5).map((error, idx) => (
              <div
                key={idx}
                className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm cursor-pointer hover:bg-red-100 transition-colors"
                onClick={() => navigate('/failed-messages')}
                role="button"
                tabIndex={0}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono text-xs text-red-700 cursor-help" title={`ID: ${error.id}\n\nClique para filtrar em Mensagens Falhadas`}>
                      {error.id?.substring(0, 20)}{error.id?.length > 20 ? '...' : ''}
                    </div>
                    <div className="text-text-secondary">{error.last_error}</div>
                  </div>
                  <div className="text-xs text-text-tertiary">{error.attempts || 0} tentativas</div>
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
        </DashboardSection>
      )}

      <DashboardFeatureGrid features={features} onNavigate={navigate} />
    </CrudPageBase>
  );
}
