import React, { useEffect, useState } from 'react';
import * as superAdminApi from '../api/superAdmin';
import logger from '../utils/logger';

function riskTone(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'red') return 'border-red-500 bg-red-50 text-red-700';
  if (normalized === 'yellow') return 'border-amber-500 bg-amber-50 text-amber-700';
  return 'border-emerald-500 bg-emerald-50 text-emerald-700';
}

function MetricCard({ title, value, subtitle }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
      <div className="text-sm text-text-secondary">{title}</div>
      <div className="text-2xl font-semibold text-text-primary mt-1">{value}</div>
      {subtitle ? <div className="text-xs text-text-secondary mt-1">{subtitle}</div> : null}
    </div>
  );
}

export function OperationalControlCenter() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [tenantMetrics, setTenantMetrics] = useState(null);
  const [tenantAlerts, setTenantAlerts] = useState([]);
  const [tenantAudit, setTenantAudit] = useState([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const out = await superAdminApi.getOccTenantsHealth();
        if (!mounted) return;
        setSummary(out);
        const firstTenant = out.items?.[0]?.tenantId || '';
        setSelectedTenant(firstTenant);
      } catch (err) {
        logger.error('Erro ao carregar OCC', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadTenantDetail() {
      if (!selectedTenant) return;
      try {
        const [metricsOut, alertsOut, auditOut] = await Promise.all([
          superAdminApi.getOccTenantMetrics(selectedTenant),
          superAdminApi.getOccTenantAlerts(selectedTenant, { limit: 20 }),
          superAdminApi.getOccTenantUraAudit(selectedTenant, { limit: 20 }),
        ]);
        if (!mounted) return;
        setTenantMetrics(metricsOut.item || null);
        setTenantAlerts(alertsOut.items || []);
        setTenantAudit(auditOut.items || []);
      } catch (err) {
        logger.error('Erro ao carregar detalhe OCC', err);
      }
    }
    loadTenantDetail();
    return () => { mounted = false; };
  }, [selectedTenant]);

  const snapshot = tenantMetrics?.snapshot_payload_json || null;

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Operational Control Center</h1>
      </div>

      {loading ? (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-text-secondary">
          Carregando OCC...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <MetricCard title="Tenants ativos" value={summary?.summary?.tenantsActive || 0} />
            <MetricCard title="Tenants com alertas" value={summary?.summary?.tenantsWithAlerts || 0} />
            <MetricCard title="URA degradada" value={summary?.summary?.tenantsWithUraDegraded || 0} />
            <MetricCard title="Scheduling degradado" value={summary?.summary?.tenantsWithSchedulingDegraded || 0} />
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <label className="text-sm font-medium text-text-primary">Tenant</label>
              <select className="input-field max-w-sm" value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)}>
                <option value="">Selecione</option>
                {(summary?.items || []).map((item) => (
                  <option key={item.tenantId} value={item.tenantId}>
                    {item.tenantName || item.tenantId}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {(summary?.items || []).map((item) => (
                <button
                  key={item.tenantId}
                  type="button"
                  onClick={() => setSelectedTenant(item.tenantId)}
                  className={`text-left rounded-xl border p-4 transition ${selectedTenant === item.tenantId ? 'border-accent-primary' : 'border-border-default'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-text-primary">{item.tenantName || item.tenantId}</div>
                      <div className="text-xs text-text-secondary">{item.tenantId}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full border ${riskTone(item.snapshot?.health?.schedulingStatus)}`}>
                      sched {item.snapshot?.health?.schedulingStatus || 'green'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                    <div className="text-text-secondary">Fallback URA</div>
                    <div className="text-text-primary text-right">{item.snapshot?.ura?.fallbackCount || 0}</div>
                    <div className="text-text-secondary">Conflitos</div>
                    <div className="text-text-primary text-right">{item.snapshot?.scheduling?.conflictsDetected || 0}</div>
                    <div className="text-text-secondary">Bookings Beauty</div>
                    <div className="text-text-primary text-right">{item.snapshot?.beauty?.bookingsToday || 0}</div>
                    <div className="text-text-secondary">Ocupação Fitness</div>
                    <div className="text-text-primary text-right">{item.snapshot?.fitness?.occupancyRate || 0}%</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Snapshot atual</h2>
              {snapshot ? (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-text-secondary">Confidence média URA</span><span>{snapshot.ura?.averageConfidence || 0}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Fallback URA</span><span>{snapshot.ura?.fallbackCount || 0}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Schedules hoje</span><span>{snapshot.scheduling?.schedulesToday || 0}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Bookings Beauty</span><span>{snapshot.beauty?.bookingsToday || 0}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Janelas livres Beauty</span><span>{snapshot.beauty?.freeWindowsDetected || 0}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Classes Fitness</span><span>{snapshot.fitness?.classesToday || 0}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Recursos ociosos</span><span>{snapshot.fitness?.resourceIdleRate || 0}%</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Latência IA</span><span>{snapshot.ai?.averageLatency || 0} ms</span></div>
                </div>
              ) : (
                <div className="text-text-secondary">Sem snapshot para o tenant selecionado.</div>
              )}
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Alertas operacionais</h2>
              <div className="space-y-3">
                {tenantAlerts.length === 0 ? (
                  <div className="text-text-secondary">Nenhum alerta ativo.</div>
                ) : tenantAlerts.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border-default p-3">
                    <div className="flex justify-between gap-3">
                      <strong className="text-text-primary">{item.alertType}</strong>
                      <span className={`text-xs px-2 py-1 rounded-full border ${riskTone(item.severity === 'high' ? 'red' : item.severity === 'medium' ? 'yellow' : 'green')}`}>
                        {item.severity}
                      </span>
                    </div>
                    <div className="text-sm text-text-secondary mt-2">{item.description}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Auditoria URA</h2>
              <div className="space-y-3">
                {tenantAudit.length === 0 ? (
                  <div className="text-text-secondary">Sem auditoria recente.</div>
                ) : tenantAudit.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border-default p-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <strong className="text-text-primary">{item.intent || 'fallback'}</strong>
                      <span className="text-text-secondary">{item.providerStatus || 'disabled'}</span>
                    </div>
                    <div className="text-text-secondary mt-2">
                      dept {item.departmentId || 'n/a'} • queue {item.queueName || 'n/a'} • conf {item.confidence ?? 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
