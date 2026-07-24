import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { getCurrentTenantPlanUsage } from '../api/tenants';
import { CrudPageBase } from '../modules/crud-base';

function pct(current, limit) {
  const c = Number(current || 0);
  const l = Number(limit);
  if (!Number.isFinite(c) || !Number.isFinite(l) || l <= 0) return null;
  return Math.max(0, Math.min(1, c / l));
}

function formatLimit(v) {
  if (v === -1) return 'Ilimitado';
  if (v === null || v === undefined) return '-';
  return String(v);
}

function ProgressBar({ value }) {
  const v = typeof value === 'number' ? value : 0;
  const color =
    v >= 0.95 ? 'bg-status-error' :
    v >= 0.8 ? 'bg-status-warning' :
    'bg-status-success';

  return (
    <div className="w-full h-2 rounded-full bg-bg-secondary overflow-hidden border border-border-default">
      <div className={`h-2 ${color}`} style={{ width: `${Math.round(v * 100)}%` }} />
    </div>
  );
}

export function PlanUsagePage() {
  const { agent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [authLoading, isAuthenticated, navigate]);

  const canView = agent?.role === 'owner' || agent?.role === 'admin' || agent?.role === 'super_admin';

  const load = async () => {
    setLoading(true);
    try {
      setError(null);
      const resp = await getCurrentTenantPlanUsage();
      setData(resp);
    } catch (err) {
      logger.error('[PlanUsage] Erro ao carregar plano/uso', err);
      setError(err?.message || 'Erro ao carregar plano/uso');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && canView) load();
  }, [isAuthenticated, canView]);

  const items = useMemo(() => {
    const limits = data?.limits || {};
    const usage = data?.usage || {};
    const defs = [
      { key: 'max_agentes', label: 'Agentes' },
      { key: 'max_canais', label: 'Canais' },
      { key: 'max_conversas_mes', label: 'Conversas (tickets) / mês' },
      { key: 'documentos_rag', label: 'Documentos RAG' },
      { key: 'storage_mb', label: 'Armazenamento (MB)' },
    ];
    return defs.map(d => {
      const limit = limits[d.key];
      const current = usage[d.key] ?? 0;
      return {
        ...d,
        limit,
        current,
        progress: limit === -1 ? null : pct(current, limit),
      };
    });
  }, [data]);

  if (authLoading) {
    return (
      <CrudPageBase>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }
  if (!isAuthenticated) return null;

  if (!canView) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <h1>📦 Plano e Uso</h1>
        
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

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="text-text-secondary">
            Você não tem permissão para ver os limites do plano. (Somente <strong>owner/admin</strong>)
          </div>
          <div className="mt-4">
            <Button onClick={() => navigate('/dashboard')} style={{ width: 'auto' }}>
              Voltar
            </Button>
          </div>
        </div>
        <ToastContainer />
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>📦 Plano e Uso</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={load} style={{ width: 'auto' }}>
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-text-secondary">Carregando...</div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm text-text-tertiary">Tenant</div>
                <div className="text-lg font-semibold text-text-primary">{data?.tenantId || agent?.tenantId || '-'}</div>
              </div>
              <div>
                <div className="text-sm text-text-tertiary">Plano</div>
                <div className="text-lg font-semibold text-text-primary">{data?.plan || '-'}</div>
              </div>
              <div className="text-sm text-text-tertiary">
                Período: mensal
              </div>
            </div>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-xl font-semibold text-text-primary mb-4">Limites</div>
            <div className="space-y-4">
              {items.map((it) => {
                const limitLabel = formatLimit(it.limit);
                const currentLabel = it.limit === -1 ? String(it.current || 0) : `${it.current || 0} / ${limitLabel}`;
                const warn = typeof it.progress === 'number' && it.progress >= 0.8;
                const danger = typeof it.progress === 'number' && it.progress >= 0.95;
                return (
                  <div key={it.key} className="p-4 rounded-lg border border-border-default bg-bg-tertiary">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="text-sm font-semibold text-text-primary">{it.label}</div>
                      <div className={`text-sm ${danger ? 'text-status-error' : warn ? 'text-status-warning' : 'text-text-secondary'}`}>
                        {currentLabel}
                      </div>
                    </div>
                    {it.limit === -1 ? (
                      <div className="mt-2 text-xs text-text-tertiary">Sem limite para este recurso.</div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <ProgressBar value={it.progress || 0} />
                        <div className="text-xs text-text-tertiary">
                          {typeof it.progress === 'number' ? `${Math.round(it.progress * 100)}% utilizado` : '-'}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}

