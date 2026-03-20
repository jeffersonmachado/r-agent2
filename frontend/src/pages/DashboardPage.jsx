import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from '../hooks/useRouter';
import { useAuth } from '../context/authContext';
import { NavigationLink } from '../components/NavigationLink';
import { getGeneralMetrics, getQueueMetrics } from '../api/analytics';
import { fetchJson } from '../api/client';
import logger from '../utils/logger';

/**
 * Página Dashboard - Hub central com todas as funcionalidades
 */
export function DashboardPage() {
  const { navigate } = useRouter();
  const { agent } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [kpis, setKpis] = useState(null);
  const [queuesKpis, setQueuesKpis] = useState(null);
  const [kpiError, setKpiError] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [versionInfo, setVersionInfo] = useState(null);
  const [versionError, setVersionError] = useState(null);

  function formatSecondsCompact(sec) {
    if (sec === null || sec === undefined) return '-';
    const n = Number(sec);
    if (!Number.isFinite(n)) return '-';
    if (n < 60) return `${Math.round(n)}s`;
    const m = Math.floor(n / 60);
    const s = Math.round(n % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }

  function formatPct(x) {
    if (x === null || x === undefined) return '-';
    const n = Number(x);
    if (!Number.isFinite(n)) return '-';
    return `${(n * 100).toFixed(1)}%`;
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setKpiLoading(true);
        setKpiError(null);
        const [data, qData] = await Promise.all([
          getGeneralMetrics(),
          getQueueMetrics(),
        ]);
        if (!mounted) return;
        setKpis(data);
        setQueuesKpis(qData);
      } catch (err) {
        logger.error('[Dashboard] Erro ao carregar KPIs', err);
        if (!mounted) return;
        setKpiError('Erro ao carregar KPIs');
        setKpis(null);
        setQueuesKpis(null);
      } finally {
        if (mounted) setKpiLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchJson('/version', { silent: true });
        if (!mounted) return;
        setVersionInfo(data || null);
        setVersionError(null);
      } catch (err) {
        logger.error('[Dashboard] Erro ao carregar versão', err);
        if (!mounted) return;
        setVersionInfo(null);
        setVersionError('Não foi possível carregar versão');
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const features = [
    {
      id: 'chat-humano-dashboard',
      title: 'Dashboard Chat Humano',
      description: 'Pilar 1: cockpit de atendimento omnichannel',
      icon: '💬',
      path: '/chat-humano',
      color: 'bg-cyan-500',
      category: 'Pilares',
    },
    {
      id: 'queue-physical-dashboard',
      title: 'Dashboard Fila Física',
      description: 'Pilar 2: operação kiosk/station/panel',
      icon: '🎫',
      path: '/fila-fisica',
      color: 'bg-indigo-500',
      category: 'Pilares',
    },
    {
      id: 'support',
      title: 'Atendimento',
      description: 'Gerencie tickets e conversas com clientes',
      icon: '💬',
      path: '/support',
      color: 'bg-blue-500',
      category: 'Atendimento',
    },
    {
      id: 'inbox',
      title: 'Inbox',
      description: 'Inbox unificado com atribuição, transferência e notas',
      icon: '📥',
      path: '/inbox',
      color: 'bg-sky-500',
      category: 'Atendimento',
    },
    {
      id: 'quick-replies',
      title: 'Respostas Rápidas',
      description: 'Mensagens pré-definidas e templates',
      icon: '⚡',
      path: '/quick-replies',
      color: 'bg-green-500',
      category: 'Atendimento',
    },
    {
      id: 'faq',
      title: 'FAQ',
      description: 'Gerencie perguntas e respostas (base RAG)',
      icon: '❓',
      path: '/faq',
      color: 'bg-purple-500',
      category: 'Conhecimento',
    },
    {
      id: 'departments',
      title: 'Departamentos',
      description: 'Organize equipe em departamentos',
      icon: '🏢',
      path: '/departments',
      color: 'bg-indigo-500',
      category: 'Organização',
    },
    {
      id: 'bulk-messaging',
      title: 'Disparos em Massa',
      description: 'Envie mensagens para múltiplos contatos',
      icon: '📢',
      path: '/bulk-messaging',
      color: 'bg-yellow-500',
      category: 'Marketing',
    },
    {
      id: 'marketing',
      title: 'Marketing v1',
      description: 'Forms, leads, scoring e campanhas',
      icon: '🧲',
      path: '/marketing',
      color: 'bg-rose-500',
      category: 'Marketing',
    },
    {
      id: 'solutions',
      title: 'Solutions Packs',
      description: 'Templates por segmento e checklist operacional',
      icon: '📦',
      path: '/solutions',
      color: 'bg-amber-500',
      category: 'Marketing',
    },
    {
      id: 'analytics',
      title: 'Analytics & Métricas',
      description: 'Dashboard com KPIs e indicadores',
      icon: '📊',
      path: '/analytics',
      color: 'bg-red-500',
      category: 'Analytics',
    },
    {
      id: 'supervisor',
      title: 'Painel Supervisor',
      description: 'TME, TMA, abandono e status por agente/fila',
      icon: '🧭',
      path: '/supervisor',
      color: 'bg-teal-500',
      category: 'Analytics',
    },
    {
      id: 'operations-dashboard',
      title: 'Painel Operacional',
      description: 'Monitoramento do piloto Beauty/Fitness (jornada, jobs, notificacoes e insights)',
      icon: '🧭',
      path: '/operations-dashboard',
      color: 'bg-emerald-600',
      category: 'Operacao',
      requiresAdmin: true,
    },
    {
      id: 'export',
      title: 'Exportação',
      description: 'Exporte dados em CSV e JSON',
      icon: '📥',
      path: '/export',
      color: 'bg-teal-500',
      category: 'Analytics',
    },
    {
      id: 'ai-tools',
      title: 'Ferramentas de IA',
      description: 'Sugestões de resposta e reescrita inteligente',
      icon: '🤖',
      path: '/ai-tools',
      color: 'bg-pink-500',
      category: 'IA',
    },
    {
      id: 'segmentation',
      title: 'Segmentação',
      description: 'Tags, categorias e filtros avançados',
      icon: '🏷️',
      path: '/segmentation',
      color: 'bg-orange-500',
      category: 'Organização',
    },
    {
      id: 'whatsapp-templates',
      title: 'Templates WhatsApp',
      description: 'Gerencie templates do WhatsApp Business API',
      icon: '📋',
      path: '/whatsapp-templates',
      color: 'bg-emerald-500',
      category: 'Integração',
    },
    {
      id: 'node-marketplace',
      title: 'Node Marketplace',
      description: 'Catálogo interno de nodes',
      icon: '🧩',
      path: '/node-marketplace',
      color: 'bg-sky-500',
      category: 'Plataforma',
    },
    {
      id: 'sso-scim',
      title: 'SSO / SCIM',
      description: 'Configurações de identidade e provisionamento',
      icon: '🔐',
      path: '/sso-scim',
      color: 'bg-slate-500',
      category: 'Administração',
    },
    {
      id: 'backup',
      title: 'Backup / DR',
      description: 'Exportar/importar flows e settings',
      icon: '🗄️',
      path: '/backup',
      color: 'bg-gray-500',
      category: 'Administração',
    },
    {
      id: 'dev-dashboard',
      title: 'Dashboard de Dev',
      description: 'Ferramentas, configurações e funcionalidades de desenvolvimento',
      icon: '🛠️',
      path: '/dev',
      color: 'bg-indigo-600',
      category: 'Desenvolvimento',
    },
    {
      id: 'config',
      title: 'Configurações',
      description: 'Configurações do sistema',
      icon: '⚙️',
      path: '/config',
      color: 'bg-slate-500',
      category: 'Administração',
    },
    {
      id: 'agents',
      title: 'Agentes',
      description: 'Gerencie agentes e permissões',
      icon: '👥',
      path: '/agents',
      color: 'bg-cyan-500',
      category: 'Administração',
    },
    {
      id: 'tenants',
      title: 'Tenants',
      description: 'Gerencie tenants/clientes e contexto cognitivo',
      icon: '🏢',
      path: '/tenants',
      color: 'bg-purple-500',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'rbac',
      title: 'RBAC',
      description: 'Gestão de roles e permissões',
      icon: '🔐',
      path: '/rbac',
      color: 'bg-slate-500',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'mfa',
      title: 'MFA',
      description: 'Configuração de autenticação em duas etapas',
      icon: '🛡️',
      path: '/mfa',
      color: 'bg-emerald-600',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'whatsapp-ivr',
      title: 'URA WhatsApp',
      description: 'Regras simples e departamentos para WhatsApp',
      icon: '💬',
      path: '/whatsapp-ivr',
      color: 'bg-green-600',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'whatsapp-qr',
      title: 'WhatsApp QR',
      description: 'Pareamento via QR e status de sessão',
      icon: '📱',
      path: '/whatsapp-connections',
      color: 'bg-emerald-700',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'developer-keys',
      title: 'API Keys',
      description: 'Chaves e uso da API pública',
      icon: '🔑',
      path: '/developer-keys',
      color: 'bg-indigo-700',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'automations',
      title: 'Automações',
      description: 'Builder low-code e execução',
      icon: '🧩',
      path: '/automations',
      color: 'bg-fuchsia-700',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'tasks',
      title: 'Tarefas',
      description: 'Lembretes e checklist operacional',
      icon: '✅',
      path: '/tasks',
      color: 'bg-teal-700',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'sla',
      title: 'SLA por Cliente',
      description: 'Políticas e violações de SLA',
      icon: '⏱️',
      path: '/sla-policies',
      color: 'bg-orange-700',
      category: 'Administração',
      requiresAdmin: true,
    },
    {
      id: 'audit',
      title: 'Auditoria',
      description: 'Logs e histórico de ações',
      icon: '📝',
      path: '/audit',
      color: 'bg-gray-500',
      category: 'Administração',
    },
    {
      id: 'knowledge-base',
      title: 'Base de Conhecimento',
      description: 'Gerencie artigos e FAQs para RAG',
      icon: '📚',
      path: '/knowledge-base',
      color: 'bg-blue-600',
      category: 'RAG',
    },
    {
      id: 'product-docs',
      title: 'Documentação de Produtos',
      description: 'Documentação técnica de produtos',
      icon: '📦',
      path: '/product-docs',
      color: 'bg-amber-600',
      category: 'RAG',
    },
    {
      id: 'rag-documents',
      title: 'Documentos RAG',
      description: 'Gerencie todos os documentos indexados',
      icon: '🔍',
      path: '/rag-documents',
      color: 'bg-violet-600',
      category: 'RAG',
    },
    {
      id: 'web-scraping',
      title: 'Raspagem de Sites',
      description: 'Extraia conteúdo de sites e indexe no RAG',
      icon: '🕷️',
      path: '/web-scraping',
      color: 'bg-emerald-600',
      category: 'RAG',
    },
    {
      id: 'system-status',
      title: 'Status do Sistema',
      description: 'Monitoramento de serviços e saúde do sistema',
      icon: '💚',
      path: '/system-status',
      color: 'bg-green-600',
      category: 'Monitoramento',
    },
    {
      id: 'editor',
      title: 'Editor de Fluxos',
      description: 'Crie e edite fluxos de conversação',
      icon: '🔀',
      path: '/editor',
      color: 'bg-purple-500',
      category: 'Desenvolvimento',
    },
    {
      id: 'rpa-seeds',
      title: 'Seeds RPA',
      description: 'Visualize e reproduza seeds de /tests/rpa/seeds/',
      icon: '🌱',
      path: '/rpa-seeds',
      color: 'bg-lime-600',
      category: 'RPA',
    },
    {
      id: 'chat',
      title: 'Chat de Teste',
      description: 'Teste fluxos através de interface de chat',
      icon: '💬',
      path: '/chat',
      color: 'bg-green-600',
      category: 'Testes',
    },
    {
      id: 'qa',
      title: 'Painel de Qualidade (QA)',
      description: 'Ferramentas de qualidade e validação',
      icon: '✅',
      path: '/qa',
      color: 'bg-teal-600',
      category: 'Qualidade',
    },
    {
      id: 'generate-system',
      title: 'Gerar Sistema',
      description: 'Gere fluxos, RPA e seeds automaticamente',
      icon: '🎯',
      path: '/generate-system',
      color: 'bg-indigo-600',
      category: 'Geração',
    },
  ];

  // Extrai categorias únicas
  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(features.map(f => f.category))];
    return uniqueCategories.sort();
  }, []);

  // Filtra features baseado na busca e categoria e ordena alfabeticamente
  const filteredFeatures = useMemo(() => {
    const filtered = features.filter(feature => {
      const matchesSearch = !searchTerm || 
        feature.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        feature.description.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = !selectedCategory || feature.category === selectedCategory;
      
      // Filtra por permissões (requiresAdmin)
      const matchesPermissions = !feature.requiresAdmin || agent?.role === 'admin';
      
      return matchesSearch && matchesCategory && matchesPermissions;
    });
    
    // Ordena alfabeticamente por título
    return filtered.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  }, [searchTerm, selectedCategory]);

  const backlogTop = useMemo(() => {
    const list = Array.isArray(queuesKpis?.queues) ? queuesKpis.queues : [];
    return list
      .map((q) => ({
        queueName: q.queueName,
        waiting: Number(q.waitingTickets) || 0,
        inProgress: Number(q.inProgressTickets) || 0,
      }))
      .sort((a, b) => (b.waiting + b.inProgress) - (a.waiting + a.inProgress))
      .slice(0, 5);
  }, [queuesKpis]);

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📊 Dashboard</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Bem-vindo, {agent?.name || agent?.username}! Acesse todas as funcionalidades do sistema.
        </p>

        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>

        <div
          className="bg-bg-elevated rounded-lg border border-border-default p-3 mt-3"
          style={{ fontSize: '0.85rem' }}
        >
          {versionError ? (
            <span className="text-status-error">{versionError}</span>
          ) : (
            <>
              <span className="text-text-secondary">Versões: </span>
              <span className="text-text-primary">
                server.js <strong>{versionInfo?.serverVersion || '-'}</strong>
              </span>
              <span className="text-text-secondary"> · package.json </span>
              <span className="text-text-primary">
                <strong>{versionInfo?.packageVersion || '-'}</strong>
              </span>
              {versionInfo?.versionMismatch ? (
                <span className="text-status-warning" style={{ marginLeft: 10 }}>
                  ⚠ divergentes
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* KPIs operacionais (Blip-like) */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Tickets abertos</div>
          <div className="text-2xl font-semibold text-text-primary">
            {kpiLoading ? '…' : (kpis?.openTickets ?? '-')}
          </div>
          <div className="text-xs text-text-secondary">waiting + in_progress</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Em atendimento</div>
          <div className="text-2xl font-semibold text-text-primary">
            {kpiLoading ? '…' : (kpis?.inProgressTickets ?? '-')}
          </div>
          <div className="text-xs text-text-secondary">in_progress</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">TME</div>
          <div className="text-2xl font-semibold text-text-primary">
            {kpiLoading ? '…' : formatSecondsCompact(kpis?.avgFirstResponseTimeSeconds)}
          </div>
          <div className="text-xs text-text-secondary">tempo médio 1ª resposta</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">TMA</div>
          <div className="text-2xl font-semibold text-text-primary">
            {kpiLoading ? '…' : formatSecondsCompact(kpis?.avgHandlingTimeSeconds)}
          </div>
          <div className="text-xs text-text-secondary">tempo médio atendimento</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Contenção</div>
          <div className="text-2xl font-semibold text-text-primary">
            {kpiLoading ? '…' : formatPct(kpis?.botContainmentRate)}
          </div>
          <div className="text-xs text-text-secondary">conversas sem ticket</div>
        </div>
      </div>

      {/* Backlog por fila (Blip-like) */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
          <span>📥</span>
          <span>Backlog por fila</span>
        </h3>
        {kpiLoading ? (
          <div className="text-sm text-text-secondary">Carregando…</div>
        ) : (backlogTop.length === 0 ? (
          <div className="text-sm text-text-secondary">Sem dados de filas para exibir.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {backlogTop.map((q) => (
              <div key={q.queueName} className="bg-bg-secondary rounded-lg border border-border-default p-4">
                <div className="text-xs text-text-tertiary truncate">{q.queueName}</div>
                <div className="text-lg font-semibold text-text-primary">{q.waiting + q.inProgress}</div>
                <div className="text-xs text-text-secondary">
                  waiting: {q.waiting} · in_progress: {q.inProgress}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {kpiError ? (
        <div className="mb-6 p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
          {kpiError}
        </div>
      ) : null}

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por título ou descrição..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Categoria
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todas as categorias</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Resumo dos filtros */}
        {(searchTerm || selectedCategory) && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-sm text-text-secondary">
              Mostrando <strong>{filteredFeatures.length}</strong> de <strong>{features.length}</strong> funcionalidade(s)
              {searchTerm && ` contendo "${searchTerm}"`}
              {selectedCategory && ` na categoria "${selectedCategory}"`}
            </p>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('');
              }}
              className="mt-2 text-sm text-accent-primary hover:text-accent-hover"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredFeatures.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
            <p className="text-text-secondary">Nenhuma funcionalidade encontrada com os filtros aplicados</p>
          </div>
        ) : (
          filteredFeatures.map((feature) => (
            <NavigationLink
              key={feature.id}
              to={feature.path}
              className="block"
            >
              <div className="bg-bg-elevated rounded-xl border border-border-default hover:shadow-lg transition-shadow p-6 cursor-pointer">
                <div className="flex items-start justify-between mb-3">
                  <div className={`${feature.color} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
                    {feature.icon}
                  </div>
                  <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">
                    {feature.category}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-text-primary mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-text-secondary">
                  {feature.description}
                </p>
              </div>
            </NavigationLink>
          ))
        )}
        </div>

        <div className="mt-12 bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            Funcionalidades Implementadas
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-text-primary mb-2">✅ Completas</h3>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• Respostas Rápidas (Quick Replies)</li>
                <li>• Departamentos</li>
                <li>• Disparos em Massa</li>
                <li>• Dashboard de Análise</li>
                <li>• Exportação de Dados</li>
                <li>• Sugestão de Resposta (IA)</li>
                <li>• Reescrita Inteligente (IA)</li>
                <li>• Transcrição de Áudio</li>
                <li>• Facebook Messenger</li>
                <li>• Instagram Direct</li>
                <li>• Segmentação Avançada</li>
                <li>• Templates WhatsApp Business API</li>
                <li>• Documentação da API</li>
                <li>• Base de Conhecimento (RAG)</li>
                <li>• Documentação de Produtos (RAG)</li>
                <li>• Gerenciamento de Documentos RAG</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-text-primary mb-2">🔗 Integrações</h3>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• WhatsApp Business API</li>
                <li>• Facebook Messenger</li>
                <li>• Instagram Direct</li>
                <li>• OpenAI (Whisper, GPT)</li>
                <li>• RAG Service (Python FastAPI)</li>
                <li>• PostgreSQL (pgvector) Vector Store</li>
              </ul>
            </div>
          </div>
        </div>
    </div>
  );
}
