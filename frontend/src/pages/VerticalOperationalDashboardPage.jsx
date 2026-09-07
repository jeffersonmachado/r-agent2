import React, { useEffect, useState } from 'react';
import { getFitnessDashboard, getBeautyDashboard, getFitnessIntelligence, getBeautyIntelligence, getClinicDashboard, getClinicRecall } from '../api/verticalOperations';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';
import { verticalWorkspaces } from '../navigation/menu';

const VERTICAL_WS_EVENTS = [
  'vertical.attendance.updated',
  'vertical.schedule.updated',
  'vertical.bundles.updated',
  'vertical.memberships.updated',
];

export function VerticalOperationalDashboardPage({ workspaceKeys = [], isSuperAdmin = false }) {
  const { showToast, ToastContainer } = useToast();
  const [fitness, setFitness] = useState(null);
  const [beauty, setBeauty] = useState(null);
  const [clinic, setClinic] = useState(null);
  const [subjectId, setSubjectId] = useState('');
  const [fitnessIntel, setFitnessIntel] = useState(null);
  const [beautyIntel, setBeautyIntel] = useState(null);
  const [clinicIntel, setClinicIntel] = useState(null);
  const resolvedWorkspaces = workspaceKeys
    .map((key) => verticalWorkspaces[key])
    .filter(Boolean);
  const visibleWorkspaceIds = new Set(resolvedWorkspaces.map((workspace) => workspace.id));
  const showFitness = isSuperAdmin || visibleWorkspaceIds.has('fitness') || resolvedWorkspaces.length === 0;
  const showBeauty = isSuperAdmin || visibleWorkspaceIds.has('beauty') || resolvedWorkspaces.length === 0;
  const showClinic = isSuperAdmin || visibleWorkspaceIds.has('saude') || resolvedWorkspaces.length === 0;

  async function loadData() {
    try {
      const [f, b, c] = await Promise.all([
        getFitnessDashboard({ windowDays: 30 }),
        getBeautyDashboard({ windowDays: 30 }),
        getClinicDashboard({ windowDays: 30 }).catch(() => null),
      ]);
      setFitness(f || null);
      setBeauty(b || null);
      setClinic(c || null);
    } catch (_) {
      showToast('Erro ao carregar dashboards verticais', 'error');
    }
  }

  async function runIntelligence() {
    if (!subjectId) {
      showToast('Informe o subjectId', 'warning');
      return;
    }
    try {
      const [fi, bi, ci] = await Promise.all([
        getFitnessIntelligence(subjectId).catch(() => null),
        getBeautyIntelligence(subjectId).catch(() => null),
        getClinicRecall(subjectId).catch(() => null),
      ]);
      setFitnessIntel(fi);
      setBeautyIntel(bi);
      setClinicIntel(ci);
    } catch (_) {
      showToast('Erro ao carregar inteligência', 'error');
    }
  }

  // Refresh sob demanda via WebSocket: qualquer evento operacional vertical
  // (presença, agenda, bundles, memberships) dispara refetch do painel.
  useWebSocketContext({
    onEvent: (event) => {
      if (VERTICAL_WS_EVENTS.includes(event)) {
        loadData();
      }
    },
    subscribeEvents: VERTICAL_WS_EVENTS,
  });

  useEffect(() => {
    loadData();
    // Poll de 120s: fallback caso os eventos WS não cheguem
    const timer = setInterval(loadData, 120000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Painel Operacional Vertical</h1>
        {resolvedWorkspaces.length > 0 && (
          <div className="rap-vertical-dashboard-meta">
            <span className="rap-vertical-dashboard-meta-label">
              {isSuperAdmin ? 'Modo Super Admin' : 'Vertical efetiva'}
            </span>
            <div className="rap-vertical-dashboard-badges">
              {resolvedWorkspaces.map((workspace) => (
                <span
                  key={workspace.id}
                  className="rap-vertical-dashboard-badge"
                  style={{ '--rap-vertical-badge-color': workspace.color }}
                >
                  {workspace.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="support-grid" style={{ gridTemplateColumns: [showFitness, showBeauty, showClinic].filter(Boolean).length > 1 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', gap: '1rem' }}>
        {showFitness && (
          <div className="support-details-panel">
            <h3>Fitness</h3>
            <p><strong>Churn risk:</strong> {fitness?.kpis?.churnRiskSubjects ?? '-'}</p>
            <p><strong>Presença hoje:</strong> {fitness?.kpis?.attendanceToday ?? '-'}</p>
            <p><strong>Receita:</strong> {fitness?.kpis?.revenue ?? '-'}</p>
          </div>
        )}
        {showBeauty && (
          <div className="support-details-panel">
            <h3>Beauty</h3>
            <p><strong>No-show:</strong> {beauty?.kpis?.noShow ?? '-'}</p>
            <p><strong>Reativação:</strong> {beauty?.kpis?.reactivation ?? '-'}</p>
            <p><strong>Fidelidade:</strong> {beauty?.kpis?.loyaltyCompleted ?? '-'}</p>
            <p><strong>Receita:</strong> {beauty?.kpis?.revenue ?? '-'}</p>
          </div>
        )}
        {showClinic && (
          <div className="support-details-panel">
            <h3>Clínica</h3>
            <p><strong>Consultas hoje:</strong> {clinic?.kpis?.consultationsToday ?? '-'}</p>
            <p><strong>Risco de falta:</strong> {clinic?.kpis?.noShowRiskPatients ?? '-'}</p>
            <p><strong>Recalls enviados:</strong> {clinic?.kpis?.recallsSent ?? '-'}</p>
            <p><strong>Receita:</strong> {clinic?.kpis?.revenue ?? '-'}</p>
          </div>
        )}
      </div>

      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        <h3>Inteligência Vertical</h3>
        <div className="support-controls" style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="support-input" placeholder="subjectId" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} />
          <button className="support-button" onClick={runIntelligence}>Analisar</button>
        </div>
        <div className="support-grid" style={{ gridTemplateColumns: [showFitness, showBeauty, showClinic].filter(Boolean).length > 1 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', gap: '1rem', marginTop: '1rem' }}>
          {showFitness && (
            <div>
              <h4>Fitness</h4>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{fitnessIntel ? JSON.stringify(fitnessIntel, null, 2) : '-'}</pre>
            </div>
          )}
          {showBeauty && (
            <div>
              <h4>Beauty</h4>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{beautyIntel ? JSON.stringify(beautyIntel, null, 2) : '-'}</pre>
            </div>
          )}
          {showClinic && (
            <div>
              <h4>Clínica (recall)</h4>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{clinicIntel ? JSON.stringify(clinicIntel, null, 2) : '-'}</pre>
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
