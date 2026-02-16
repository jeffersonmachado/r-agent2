import React, { useMemo, useState } from 'react';
import { useRouter } from '../hooks/useRouter';

export function QueuePhysicalDashboardPage() {
  const { navigate } = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const features = [
    { id: 'kiosk', title: 'Kiosk', description: 'Entrada de senha e abertura da jornada', icon: '🎫', path: '/kiosk', color: 'bg-cyan-500', category: 'Operação Base' },
    { id: 'station', title: 'Station', description: 'Operação de atendimento por estação', icon: '🧑‍💼', path: '/station', color: 'bg-blue-500', category: 'Operação Base' },
    { id: 'panel', title: 'Panel', description: 'Painel público de chamada de senhas', icon: '📺', path: '/panel', color: 'bg-indigo-500', category: 'Operação Base' },
    { id: 'supervisor', title: 'Painel Supervisor', description: 'Visão de carga por fila e performance', icon: '🧭', path: '/supervisor', color: 'bg-teal-500', category: 'Monitoramento' },
    { id: 'maintenance', title: 'Manutenção de Tickets', description: 'Correções operacionais e ajustes manuais', icon: '🛠️', path: '/maintenance', color: 'bg-orange-500', category: 'Suporte' },
    { id: 'inbox', title: 'Inbox', description: 'Backlog e fila de atendimento em tempo real', icon: '📥', path: '/inbox', color: 'bg-sky-500', category: 'Suporte' },
    { id: 'support', title: 'Atendimento', description: 'Tratamento da jornada após entrada na fila', icon: '💬', path: '/support', color: 'bg-emerald-500', category: 'Suporte' },
    { id: 'analytics', title: 'Analytics', description: 'Métricas consolidadas por fila e operação', icon: '📊', path: '/analytics', color: 'bg-rose-500', category: 'Monitoramento' },
    { id: 'audit', title: 'Auditoria', description: 'Rastro operacional para compliance e incidentes', icon: '📋', path: '/audit', color: 'bg-slate-500', category: 'Governança' },
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
        <h1>Dashboard Fila Física</h1>
        <p>Pilar 2: operação fast-service de ponta a ponta (kiosk, station e panel).</p>
      
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
          <div className="text-xs text-text-tertiary">Núcleo</div>
          <div className="text-2xl font-semibold text-text-primary">Kiosk + Station + Panel</div>
          <div className="text-xs text-text-secondary">fluxo principal</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Módulos</div>
          <div className="text-2xl font-semibold text-text-primary">{features.length}</div>
          <div className="text-xs text-text-secondary">atalhos operacionais</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Categorias</div>
          <div className="text-2xl font-semibold text-text-primary">{categories.length}</div>
          <div className="text-xs text-text-secondary">grupos funcionais</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Controle</div>
          <div className="text-2xl font-semibold text-text-primary">Supervisor + Audit</div>
          <div className="text-xs text-text-secondary">monitoramento e governança</div>
        </div>
      </div>

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
