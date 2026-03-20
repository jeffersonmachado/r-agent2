import React, { useMemo } from 'react';
import { useRouter } from '../hooks/useRouter';
import { DashboardKpiCard, DashboardFeatureGrid } from '../components/DashboardBase';

export function QueuePhysicalDashboardPage() {
  const { navigate } = useRouter();

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

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Dashboard Fila Física</h1>
        <p>Pilar 2: operação fast-service de ponta a ponta (kiosk, station e panel).</p>
        <div className="support-controls">
          <button type="button" className="btn-default px-4 py-2 text-sm" onClick={() => window.location.reload()}>
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <DashboardKpiCard label="Núcleo" value="Kiosk + Station + Panel" subtitle="fluxo principal" />
        <DashboardKpiCard label="Módulos" value={features.length} subtitle="atalhos operacionais" />
        <DashboardKpiCard label="Categorias" value={categories.length} subtitle="grupos funcionais" />
        <DashboardKpiCard label="Controle" value="Supervisor + Audit" subtitle="monitoramento e governança" />
      </div>

      <DashboardFeatureGrid features={features} onNavigate={navigate} />
    </div>
  );
}
