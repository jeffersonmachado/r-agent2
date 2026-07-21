import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { isSuperAdmin } from '../utils/menuPermissions';
import { fetchJson } from '../api/client';
import logger from '../utils/logger';
import { formatDateTime } from '../utils/dateFormatter';

// ============================================================
// Helpers
// ============================================================
const STATUS_PALETTE = {
  GO: 'bg-green-900 text-green-300 border-green-700',
  NO_GO: 'bg-red-900 text-red-300 border-red-700',
  passed: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
  skipped: 'bg-yellow-900 text-yellow-300',
  infra_error: 'bg-orange-900 text-orange-300',
  flaky: 'bg-purple-900 text-purple-300',
  active: 'bg-green-900 text-green-300',
  draft: 'bg-gray-700 text-gray-300',
  running: 'bg-blue-900 text-blue-300',
  queued: 'bg-slate-700 text-slate-300',
  completed: 'bg-green-900 text-green-300',
};

function StatusBadge({ value, className = '' }) {
  const colors = STATUS_PALETTE[value] || 'bg-slate-700 text-slate-300';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${colors} ${className}`}>
      {value || 'N/A'}
    </span>
  );
}

function MetricCard({ label, value, sub, color = 'text-text-primary' }) {
  return (
    <div className="bg-bg-surface rounded-lg p-4 border border-border-default">
      <div className="text-xs text-text-secondary mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-text-secondary mt-1">{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
    </div>
  );
}

// ============================================================
// QA Waves Audit Tab
// ============================================================
function QaWavesAuditTab() {
  const { showToast } = useToast();
  const [executions, setExecutions] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [journeyStatus, setJourneyStatus] = useState([]);
  const [waves, setWaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ wave: '', status: '', domain: '', dateStart: '', dateEnd: '' });
  const [selectedExec, setSelectedExec] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.wave) params.set('wave', filters.wave);
      if (filters.status) params.set('status', filters.status);
      if (filters.domain) params.set('domain', filters.domain);

      const [execData, scenData, journData, wavesData] = await Promise.all([
        fetchJson(`/api/qa-waves/executions?${params.toString()}&limit=100`, { suppressErrorLog: true }).catch(() => ({ items: [] })),
        fetchJson(`/api/qa-waves/scenarios?${params.toString()}`, { suppressErrorLog: true }).catch(() => ({ scenarios: [] })),
        fetchJson('/api/qa-waves/journey-status', { suppressErrorLog: true }).catch(() => []),
        fetchJson('/api/qa-waves/waves', { suppressErrorLog: true }).catch(() => ({ items: [] })),
      ]);

      setExecutions(execData.items || execData.executions || []);
      setScenarios(scenData.scenarios || scenData.items || []);
      setJourneyStatus(Array.isArray(journData) ? journData : (journData.items || []));
      setWaves(wavesData.items || wavesData.waves || []);
    } catch (err) {
      logger.error('QA Waves Audit load error', err);
      showToast('Erro ao carregar dados de auditoria QA Waves', 'error');
    }
    setLoading(false);
  }, [filters.wave, filters.status, filters.domain, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // Stats
  const stats = useMemo(() => {
    const total = executions.length;
    const passed = executions.filter(e => e.status === 'passed' || e.status === 'completed').length;
    const failed = executions.filter(e => e.status === 'failed').length;
    const goDecisions = executions.filter(e => e.goNoGo === 'GO').length;
    const noGoDecisions = executions.filter(e => e.goNoGo === 'NO_GO').length;
    return { total, passed, failed, goDecisions, noGoDecisions, passRate: total > 0 ? ((passed / total) * 100).toFixed(1) : '0' };
  }, [executions]);

  if (loading) return <div className="p-6 text-center text-text-secondary">Carregando auditoria QA Waves...</div>;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <MetricCard label="Total Execuções" value={stats.total} />
        <MetricCard label="Passaram" value={stats.passed} color="text-green-400" />
        <MetricCard label="Falharam" value={stats.failed} color="text-red-400" sub={stats.passRate + '%'} />
        <MetricCard label="GO" value={stats.goDecisions} color="text-green-400" />
        <MetricCard label="NO_GO" value={stats.noGoDecisions} color="text-red-400" />
        <MetricCard label="Cenários" value={scenarios.length} />
      </div>

      {/* Filters */}
      <div className="bg-bg-elevated border border-border-default rounded-lg p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Wave</label>
            <select value={filters.wave} onChange={e => setFilters({ ...filters, wave: e.target.value })}
              className="bg-bg-surface border border-border-default rounded px-3 py-1.5 text-sm text-text-primary">
              <option value="">Todas</option>
              {(waves || []).map(w => <option key={w.id || w} value={w.id || w}>{w.name || w.label || w}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Status</label>
            <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}
              className="bg-bg-surface border border-border-default rounded px-3 py-1.5 text-sm text-text-primary">
              <option value="">Todos</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
              <option value="running">Running</option>
            </select>
          </div>
          <button onClick={loadData} className="btn-default px-4 py-1.5 rounded text-sm">
            🔄 Atualizar
          </button>
        </div>
      </div>

      {/* Executions Table */}
      <SectionHeader title="Execuções QA Waves" subtitle={`${executions.length} registros`} />
      <div className="bg-bg-elevated border border-border-default rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-surface text-text-secondary">
              <tr>
                <th className="text-left px-4 py-2">ID</th>
                <th className="text-left px-4 py-2">Cenário</th>
                <th className="text-left px-4 py-2">Wave</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">GO/NO_GO</th>
                <th className="text-left px-4 py-2">Duração</th>
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-right px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              {executions.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-secondary">Nenhuma execução encontrada.</td></tr>
              )}
              {executions.slice(0, 100).map(exec => (
                <tr key={exec.id || exec.executionId} className="border-t border-border-default hover:bg-bg-surface cursor-pointer"
                  onClick={() => setSelectedExec(selectedExec?.id === exec.id ? null : exec)}>
                  <td className="px-4 py-2 font-mono text-xs text-text-secondary">{(exec.id || exec.executionId || '').substring(0, 12)}...</td>
                  <td className="px-4 py-2 max-w-xs truncate">{exec.scenarioId || exec.scenario || exec.label || '-'}</td>
                  <td className="px-4 py-2">{exec.wave || exec.waveId || '-'}</td>
                  <td className="px-4 py-2"><StatusBadge value={exec.status} /></td>
                  <td className="px-4 py-2"><StatusBadge value={exec.goNoGo || exec.decision || 'N/A'} /></td>
                  <td className="px-4 py-2 text-text-secondary">{exec.durationMs ? `${exec.durationMs}ms` : '-'}</td>
                  <td className="px-4 py-2 text-text-secondary text-xs">{formatDateTime(exec.executedAt || exec.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); setSelectedExec(exec); }}
                      className="text-blue-400 hover:text-blue-300 text-xs">Detalhes</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Execution Detail Modal */}
      {selectedExec && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedExec(null)}>
          <div className="bg-bg-elevated border border-border-default rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto m-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-semibold text-text-primary">Detalhes da Execução</h3>
              <button onClick={() => setSelectedExec(null)} className="text-text-secondary hover:text-text-primary text-lg">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-text-secondary">ID:</span> <span className="font-mono text-xs">{selectedExec.id || selectedExec.executionId}</span></div>
                <div><span className="text-text-secondary">Status:</span> <StatusBadge value={selectedExec.status} /></div>
                <div><span className="text-text-secondary">Cenário:</span> {selectedExec.scenarioId || '-'}</div>
                <div><span className="text-text-secondary">Wave:</span> {selectedExec.wave || '-'}</div>
                <div><span className="text-text-secondary">GO/NO_GO:</span> <StatusBadge value={selectedExec.goNoGo || 'N/A'} /></div>
                <div><span className="text-text-secondary">Duração:</span> {selectedExec.durationMs ? `${selectedExec.durationMs}ms` : '-'}</div>
                <div><span className="text-text-secondary">Origem:</span> {selectedExec.origin || selectedExec.executionOrigin || '-'}</div>
                <div><span className="text-text-secondary">Data:</span> {formatDateTime(selectedExec.executedAt || selectedExec.createdAt)}</div>
              </div>
              {selectedExec.errorMessage && (
                <div className="bg-red-900/30 border border-red-700 rounded p-3">
                  <div className="text-red-300 font-medium text-xs mb-1">Erro</div>
                  <div className="text-red-400 text-xs font-mono">{selectedExec.errorMessage}</div>
                </div>
              )}
              {selectedExec.steps && selectedExec.steps.length > 0 && (
                <div>
                  <div className="text-text-secondary font-medium mb-2">Passos ({selectedExec.steps.length})</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {selectedExec.steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-bg-surface rounded px-3 py-1.5">
                        <span className="text-text-secondary w-6">{i + 1}.</span>
                        <span className="flex-1">{step.type || step.name || step.stepType || `Step ${i + 1}`}</span>
                        <StatusBadge value={step.status || 'N/A'} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <details className="text-xs">
                <summary className="text-text-secondary cursor-pointer hover:text-text-primary">JSON completo</summary>
                <pre className="mt-2 bg-bg-surface rounded p-3 overflow-x-auto text-xs text-text-secondary max-h-64">
                  {JSON.stringify(selectedExec, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* Journey Status Summary */}
      <SectionHeader title="Status por Jornada" subtitle={`${journeyStatus.length} jornadas monitoradas`} />
      <div className="bg-bg-elevated border border-border-default rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-surface text-text-secondary">
            <tr>
              <th className="text-left px-4 py-2">Jornada</th>
              <th className="text-left px-4 py-2">Domínio</th>
              <th className="text-left px-4 py-2">Cenários</th>
              <th className="text-left px-4 py-2">Passaram</th>
              <th className="text-left px-4 py-2">Falharam</th>
              <th className="text-left px-4 py-2">Taxa</th>
              <th className="text-left px-4 py-2">Decisão</th>
            </tr>
          </thead>
          <tbody className="text-text-primary">
            {journeyStatus.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-text-secondary">Nenhuma jornada encontrada.</td></tr>
            )}
            {journeyStatus.map((j, i) => {
              const total = (j.total || j.scenarios || 0);
              const passed = (j.passed || 0);
              const failed = (j.failed || 0);
              const rate = total > 0 ? ((passed / total) * 100).toFixed(0) : '0';
              return (
                <tr key={j.id || j.journeyId || i} className="border-t border-border-default hover:bg-bg-surface">
                  <td className="px-4 py-2 font-medium">{j.name || j.label || j.journey || `Jornada ${i + 1}`}</td>
                  <td className="px-4 py-2 text-text-secondary">{j.domain || '-'}</td>
                  <td className="px-4 py-2">{total}</td>
                  <td className="px-4 py-2 text-green-400">{passed}</td>
                  <td className="px-4 py-2 text-red-400">{failed}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-bg-surface rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rate >= 90 ? 'bg-green-500' : rate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${rate}%` }} />
                      </div>
                      <span className="text-xs text-text-secondary">{rate}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2"><StatusBadge value={j.decision || j.goNoGo || (failed === 0 ? 'GO' : 'NO_GO')} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// QA Mesh Audit Tab
// ============================================================
function QaMeshAuditTab() {
  const { showToast } = useToast();
  const [history, setHistory] = useState([]);
  const [currentMesh, setCurrentMesh] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [histData, currentData] = await Promise.all([
        fetchJson('/api/qa-mesh/history?limit=50', { suppressErrorLog: true }).catch(() => ({ history: [] })),
        fetchJson('/api/qa-mesh/status', { suppressErrorLog: true }).catch(() => null),
      ]);
      setHistory(histData.history || histData.items || []);
      setCurrentMesh(currentData);
    } catch (err) {
      logger.error('QA Mesh Audit load error', err);
      showToast('Erro ao carregar auditoria QA Mesh', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = useMemo(() => {
    const latest = history[0] || currentMesh || {};
    return {
      total: latest.total || latest.registryTotal || 0,
      passed: latest.passed || 0,
      failed: latest.failed || 0,
      skipped: latest.skipped || 0,
      infraErrors: latest.infraErrors || latest.infra_errors || 0,
      flaky: latest.flaky || 0,
      coverage: latest.executionCoverage ? `${(latest.executionCoverage * 100).toFixed(0)}%` : 'N/A',
      decision: latest.goNoGo || latest.decision || (latest.status === 'GO' ? 'GO' : 'NO_GO'),
    };
  }, [history, currentMesh]);

  if (loading) return <div className="p-6 text-center text-text-secondary">Carregando auditoria QA Mesh...</div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <MetricCard label="Total Cenários" value={stats.total} />
        <MetricCard label="Passaram" value={stats.passed} color="text-green-400" />
        <MetricCard label="Falharam" value={stats.failed} color="text-red-400" />
        <MetricCard label="Skipped" value={stats.skipped} color="text-yellow-400" />
        <MetricCard label="Infra Errors" value={stats.infraErrors} color="text-orange-400" />
        <MetricCard label="Flaky" value={stats.flaky} color="text-purple-400" />
        <MetricCard label="Decisão" value={stats.decision} color={stats.decision === 'GO' ? 'text-green-400' : 'text-red-400'} sub={`Coverage: ${stats.coverage}`} />
      </div>

      {/* Current Mesh Status */}
      {currentMesh && (
        <div className="bg-bg-elevated border border-border-default rounded-lg p-4">
          <h4 className="font-medium text-text-primary mb-3">Mesh Atual: {currentMesh.executionId || currentMesh.id || 'N/A'}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-text-secondary">Origem:</span> <span className="text-text-primary">{currentMesh.executionOrigin || currentMesh.origin || '-'}</span></div>
            <div><span className="text-text-secondary">Timestamp:</span> <span className="text-text-primary">{formatDateTime(currentMesh.timestamp || currentMesh.startedAt)}</span></div>
            <div><span className="text-text-secondary">Qualidade:</span> <span className="text-text-primary">{currentMesh.executionQuality || '-'}</span></div>
            <div><span className="text-text-secondary">Canônico:</span> <StatusBadge value={currentMesh.isCanonicalExecution ? 'Sim' : 'Não'} /></div>
          </div>
          {currentMesh.domains && (
            <div className="mt-4">
              <div className="text-xs text-text-secondary mb-2">Domínios</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(currentMesh.domains).map(([domain, data]) => (
                  <div key={domain} className="bg-bg-surface rounded p-2 text-xs">
                    <div className="font-medium text-text-primary">{domain}</div>
                    <div className="text-text-secondary">
                      <span className="text-green-400">{data.passed || 0}P</span>{' '}
                      <span className="text-red-400">{data.failed || 0}F</span>{' '}
                      <span className="text-yellow-400">{data.skipped || 0}S</span>
                      {data.flaky > 0 && <span className="text-purple-400"> {data.flaky}FL</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mesh Execution History */}
      <SectionHeader title="Histórico de Execuções QA Mesh" subtitle={`${history.length} execuções`} />
      <div className="bg-bg-elevated border border-border-default rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-surface text-text-secondary">
              <tr>
                <th className="text-left px-4 py-2">Execução</th>
                <th className="text-left px-4 py-2">Origem</th>
                <th className="text-left px-4 py-2">Total</th>
                <th className="text-left px-4 py-2">P</th>
                <th className="text-left px-4 py-2">F</th>
                <th className="text-left px-4 py-2">S</th>
                <th className="text-left px-4 py-2">FL</th>
                <th className="text-left px-4 py-2">IE</th>
                <th className="text-left px-4 py-2">Decisão</th>
                <th className="text-left px-4 py-2">Data</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              {history.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-text-secondary">Nenhum histórico de mesh encontrado.</td></tr>
              )}
              {history.map((h, i) => (
                <tr key={h.executionId || h.id || i} className="border-t border-border-default hover:bg-bg-surface">
                  <td className="px-4 py-2 font-mono text-xs text-text-secondary">
                    {(h.executionId || h.id || '').substring(0, 20)}...
                  </td>
                  <td className="px-4 py-2 text-xs">{h.executionOrigin || h.origin || '-'}</td>
                  <td className="px-4 py-2">{h.total || h.registryTotal || 0}</td>
                  <td className="px-4 py-2 text-green-400 font-medium">{h.passed || 0}</td>
                  <td className="px-4 py-2 text-red-400 font-medium">{h.failed || 0}</td>
                  <td className="px-4 py-2 text-yellow-400">{h.skipped || 0}</td>
                  <td className="px-4 py-2 text-purple-400">{h.flaky || 0}</td>
                  <td className="px-4 py-2 text-orange-400">{h.infraErrors || h.infra_errors || 0}</td>
                  <td className="px-4 py-2"><StatusBadge value={h.goNoGo || h.decision || (h.status === 'GO' ? 'GO' : 'NO_GO')} /></td>
                  <td className="px-4 py-2 text-text-secondary text-xs">{formatDateTime(h.timestamp || h.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Governance Audit Tab
// ============================================================
function GovernanceAuditTab() {
  const { showToast } = useToast();
  const [trail, setTrail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ eventType: '', limit: 50 });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.eventType) params.set('eventTypes', filters.eventType);
      params.set('limit', String(filters.limit));

      const data = await fetchJson(`/api/ai-governance/audit-trail?${params.toString()}`, { suppressErrorLog: true }).catch(() => ({ auditTrail: [] }));
      setTrail(data.auditTrail || []);
    } catch (err) {
      logger.error('Governance Audit load error', err);
    }
    setLoading(false);
  }, [filters.eventType, filters.limit, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = useMemo(() => {
    const byType = {};
    for (const r of trail) {
      byType[r.eventType] = (byType[r.eventType] || 0) + 1;
    }
    return { total: trail.length, byType };
  }, [trail]);

  if (loading) return <div className="p-6 text-center text-text-secondary">Carregando trilha de auditoria...</div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Total Eventos" value={stats.total} />
        {Object.entries(stats.byType).slice(0, 4).map(([type, count]) => (
          <MetricCard key={type} label={type} value={count} color="text-blue-400" />
        ))}
      </div>

      {/* Filters */}
      <div className="bg-bg-elevated border border-border-default rounded-lg p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Tipo de Evento</label>
            <select value={filters.eventType} onChange={e => setFilters({ ...filters, eventType: e.target.value })}
              className="bg-bg-surface border border-border-default rounded px-3 py-1.5 text-sm text-text-primary">
              <option value="">Todos</option>
              <option value="create">create</option>
              <option value="approve">approve</option>
              <option value="reject">reject</option>
              <option value="publish">publish</option>
              <option value="execute">execute</option>
              <option value="decision">decision</option>
              <option value="audit">audit</option>
              <option value="deprecate">deprecate</option>
              <option value="archive">archive</option>
            </select>
          </div>
          <button onClick={loadData} className="btn-default px-4 py-1.5 rounded text-sm">
            🔄 Atualizar
          </button>
        </div>
      </div>

      {/* Audit Trail Table */}
      <SectionHeader title="Trilha de Auditoria IA" subtitle={`${trail.length} registros`} />
      <div className="bg-bg-elevated border border-border-default rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-surface text-text-secondary">
              <tr>
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Evento</th>
                <th className="text-left px-4 py-2">Ator</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">Descrição</th>
                <th className="text-left px-4 py-2">Risco</th>
                <th className="text-left px-4 py-2">Custo</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              {trail.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-text-secondary">Nenhum evento de governança encontrado.</td></tr>
              )}
              {trail.map((r, i) => (
                <tr key={r.id || i} className="border-t border-border-default hover:bg-bg-surface">
                  <td className="px-4 py-2 text-text-secondary text-xs whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="px-4 py-2"><StatusBadge value={r.eventType} /></td>
                  <td className="px-4 py-2">{r.actor || '-'}</td>
                  <td className="px-4 py-2 text-text-secondary text-xs">{r.actorRole || '-'}</td>
                  <td className="px-4 py-2 max-w-xs truncate text-text-secondary">{r.description || '-'}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      r.riskLevel === 'critical' ? 'bg-red-900 text-red-300' :
                      r.riskLevel === 'high' ? 'bg-orange-900 text-orange-300' :
                      r.riskLevel === 'medium' ? 'bg-yellow-900 text-yellow-300' :
                      'bg-green-900 text-green-300'
                    }`}>{r.riskLevel || 'low'}</span>
                  </td>
                  <td className="px-4 py-2 text-text-secondary">${(r.cost || 0).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Audit Page
// ============================================================
const TABS = [
  { key: 'qa-waves', label: 'QA Waves Audit', component: QaWavesAuditTab },
  { key: 'qa-mesh', label: 'QA Mesh Audit', component: QaMeshAuditTab },
  { key: 'governance', label: 'Governança IA', component: GovernanceAuditTab },
];

export function QaAuditPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const [activeTab, setActiveTab] = useState('qa-waves');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen text-text-secondary">Carregando...</div>;
  }

  if (!isAuthenticated) return null;

  if (!isSuperAdmin(currentAgent)) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-semibold text-text-primary mb-2">Acesso Restrito</h2>
        <p className="text-text-secondary">Área reservada para Super Administradores.</p>
      </div>
    );
  }

  const ActiveComponent = TABS.find(t => t.key === activeTab)?.component || QaWavesAuditTab;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">QA & Governance Audit</h1>
        <p className="text-sm text-text-secondary mt-1">
          Auditoria completa de QA Waves, QA Mesh e Governança de IA.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-default">
        {TABS.map(tab => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <ActiveComponent />
    </div>
  );
}

export default QaAuditPage;
