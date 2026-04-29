import React, { useEffect, useMemo, useState } from 'react';
import { getGeneralMetrics, getQueueMetrics } from '../api/analytics';
import { fetchJson } from '../api/client';
import { useAuth } from '../context/authContext';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu, flattenNavigationLeaves } from '../navigation/menu';
import { NavigationLink } from '../components/NavigationLink';
import logger from '../utils/logger';

function KpiTile({ label, value, tone = 'default' }) {
  return (
    <div className={`rap-kpi-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

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

export function DashboardV2() {
  const { agent } = useAuth();
  const [general, setGeneral] = useState(null);
  const [queues, setQueues] = useState([]);
  const [versionInfo, setVersionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadError(null);
        const [generalData, queueData, versionData] = await Promise.all([
          getGeneralMetrics().catch(() => null),
          getQueueMetrics().catch(() => []),
          fetchJson('/version', { silent: true }).catch(() => null),
        ]);
        if (!mounted) return;
        setGeneral(generalData);
        setQueues(Array.isArray(queueData) ? queueData : []);
        setVersionInfo(versionData);
      } catch (error) {
        logger.error('[DashboardV2] Falha ao carregar cockpit', error);
        if (mounted) {
          setLoadError('Nao foi possivel carregar os sinais do cockpit.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleRoutes = useMemo(() => {
    const tree = filterNavigationTree(agent, navigationMenu);
    return flattenNavigationLeaves(tree)
      .filter((item) => item.path && !item.hiddenInSidebar)
      .slice(0, 5);
  }, [agent]);

  const backlogTop = useMemo(() => {
    return [...queues]
      .sort((a, b) => {
        const aOpen = (Number(a.waitingTickets) || 0) + (Number(a.inProgressTickets) || 0);
        const bOpen = (Number(b.waitingTickets) || 0) + (Number(b.inProgressTickets) || 0);
        return bOpen - aOpen;
      })
      .slice(0, 4);
  }, [queues]);

  const alerts = [
    {
      label: 'Tickets aguardando',
      value: general?.waitingTickets ?? '-',
      tone: (general?.waitingTickets || 0) > 0 ? 'warning' : 'default',
    },
    {
      label: 'Tickets fechados',
      value: general?.closedTickets ?? '-',
      tone: 'default',
    },
    {
      label: 'Versão ativa',
      value: versionInfo?.version || versionInfo?.tag || 'indisponível',
      tone: 'default',
    },
  ];

  const pulseItems = [
    { label: 'Tickets abertos', value: general?.openTickets ?? '-' },
    { label: 'TME', value: formatSecondsCompact(general?.avgFirstResponseTimeSeconds) },
    { label: 'TMA', value: formatSecondsCompact(general?.avgHandlingTimeSeconds) },
  ];

  return (
    <section className="rap-dashboard">
      <div className="rap-dashboard-hero">
        <div>
          <span className="rap-dashboard-kicker">Cockpit RAP</span>
          <h1>Estado do sistema, tarefas e capacidade operacional</h1>
          <p>
            O cockpit concentra sinais reais do atendimento, capacidade atual e atalhos relevantes para o seu perfil.
          </p>
        </div>
        <div className="rap-dashboard-status">
          <span className={`rap-dot ${loading ? 'is-loading' : 'is-online'}`}></span>
          <span>{loading ? 'Atualizando sinais...' : 'Sinais sincronizados'}</span>
        </div>
      </div>

      {loadError ? (
        <article className="rap-panel">
          <div className="rap-panel-header">
            <h2>Estado da carga</h2>
          </div>
          <div className="rap-command-empty">{loadError}</div>
        </article>
      ) : null}

      <div className="rap-dashboard-grid">
        <article className="rap-panel">
          <div className="rap-panel-header">
            <h2>Alertas</h2>
            <span>Prioridade imediata</span>
          </div>
          <div className="rap-kpi-grid">
            {alerts.map((item) => (
              <KpiTile key={item.label} label={item.label} value={item.value} tone={item.tone} />
            ))}
          </div>
        </article>

        <article className="rap-panel">
          <div className="rap-panel-header">
            <h2>Operação</h2>
            <span>Fila, throughput e ocupação</span>
          </div>
          <div className="rap-kpi-grid">
            <KpiTile label="Tickets abertos" value={general?.openTickets ?? '-'} />
            <KpiTile label="Em atendimento" value={general?.inProgressTickets ?? '-'} />
            <KpiTile label="Aguardando" value={general?.waitingTickets ?? '-'} />
            <KpiTile label="Mensagens" value={general?.totalMessages ?? '-'} />
          </div>
        </article>

        <article className="rap-panel">
          <div className="rap-panel-header">
            <h2>KPIs</h2>
            <span>Leitura executiva</span>
          </div>
          <div className="rap-kpi-grid">
            <KpiTile label="TME" value={formatSecondsCompact(general?.avgFirstResponseTimeSeconds)} />
            <KpiTile label="TMA" value={formatSecondsCompact(general?.avgHandlingTimeSeconds)} />
            <KpiTile label="Abandono" value={formatPct(general?.abandonmentRate)} tone={(general?.abandonmentRate || 0) > 0 ? 'warning' : 'default'} />
            <KpiTile label="Contenção" value={formatPct(general?.botContainmentRate)} />
          </div>
        </article>

        <article className="rap-panel">
          <div className="rap-panel-header">
            <h2>Filas</h2>
            <span>Backlog atual por fila</span>
          </div>
          <div className="rap-recent-list">
            {backlogTop.length > 0 ? backlogTop.map((item) => (
              <div key={item.queueName} className="rap-recent-item">
                <span>{item.queueName || 'Fila sem nome'}</span>
                <strong>{(Number(item.waitingTickets) || 0) + (Number(item.inProgressTickets) || 0)}</strong>
              </div>
            )) : (
              <div className="rap-command-empty">Sem dados de fila para exibir.</div>
            )}
          </div>
        </article>

        <article className="rap-panel">
          <div className="rap-panel-header">
            <h2>Pulso</h2>
            <span>Ultima leitura operacional</span>
          </div>
          <div className="rap-recent-list">
            {pulseItems.map((item) => (
              <div key={item.label} className="rap-recent-item">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="rap-panel">
          <div className="rap-panel-header">
            <h2>Atalhos</h2>
            <span>Entradas mais relevantes para o perfil atual</span>
          </div>
          <div className="rap-shortcuts">
            {visibleRoutes.map((item) => (
              <NavigationLink key={item.id} to={item.path} className="rap-shortcut-card">
                <strong>{item.label}</strong>
                <span>{item.path}</span>
              </NavigationLink>
            ))}
            <NavigationLink to="/dashboard-legacy" className="rap-shortcut-card">
              <strong>Dashboard Legado</strong>
              <span>/dashboard-legacy</span>
            </NavigationLink>
          </div>
        </article>
      </div>
    </section>
  );
}

export default DashboardV2;
