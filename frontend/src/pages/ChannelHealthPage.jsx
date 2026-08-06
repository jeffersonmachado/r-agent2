import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';
import logger from '../utils/logger';
import { Button } from '../styles/Button';
import { getChannelHealth } from '../api/channelHealth';
import { CrudPageBase } from '../modules/crud-base';

function formatPct(x) {
  if (!Number.isFinite(x)) return '-';
  return `${(x * 100).toFixed(1)}%`;
}

function formatSeconds(x) {
  if (x === null || x === undefined) return '-';
  const n = Number(x);
  if (!Number.isFinite(n)) return '-';
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}m ${s}s`;
}

function formatNumber(x, digits = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '-';
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

function badgeClass(status) {
  switch (status) {
    case 'healthy':
      return 'text-status-success bg-status-success/10 border-status-success/30';
    case 'degraded':
      return 'text-status-warning bg-status-warning/10 border-status-warning/30';
    case 'unhealthy':
      return 'text-status-error bg-status-error/10 border-status-error/30';
    default:
      return 'text-text-secondary bg-bg-secondary border-border-default';
  }
}

export function ChannelHealthPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const fetchHealth = useCallback(async () => {
    try {
      setError(null);
      const data = await getChannelHealth({ windowMinutes: 10 });
      setHealth(data);
    } catch (err) {
      logger.error('[ChannelHealth] Erro ao buscar health', err);
      setError(err?.message || 'Erro ao buscar saúde de canais');
      showToast('Erro ao buscar saúde de canais', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // Refresh sob demanda via WebSocket: o backend emite `channel.health.alert`.
  const handleWebSocketEvent = useCallback((event) => {
    if (event === 'channel.health.alert') {
      fetchHealth();
    }
  }, [fetchHealth]);

  useWebSocketContext({
    enabled: isAuthenticated,
    onEvent: handleWebSocketEvent,
    subscribeEvents: ['channel.health.alert'],
  });

  // Poll reduzido para 120s: atua como fallback caso o evento WS não chegue.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => fetchHealth(), 120000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchHealth]);

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

  const channels = health?.channels ? Object.values(health.channels) : [];
  const alerts = health?.alerts || [];
  const outbound = health?.outbound || null;
  const waCredsOk = health?.whatsapp?.areCredentialsValid;

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>📡 Saúde de Canais</h1>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={() => navigate('/channel-accounts')} style={{ width: 'auto' }}>
              Gerenciar Canais
            </Button>
            <Button onClick={fetchHealth} style={{ width: 'auto' }}>
              Atualizar
            </Button>
          </div>
        </div>
      
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

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-secondary">Status geral</div>
            <div className="text-xl font-semibold text-text-primary">
              {health?.overall?.status || 'unknown'}
            </div>
            <div className="text-xs text-text-tertiary">
              Janela: {health?.windowMinutes || 10} min • Tenant: {health?.tenantId || '-'}
            </div>
          </div>
          <div className={`px-3 py-2 rounded-lg border ${badgeClass(health?.overall?.status)}`}>
            {health?.overall?.status || 'unknown'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="text-sm text-text-secondary">Credenciais WhatsApp</div>
          <div className="text-xl font-semibold text-text-primary">
            {waCredsOk === true ? 'Válidas' : waCredsOk === false ? 'Inválidas' : 'Desconhecido'}
          </div>
          <div className="text-xs text-text-tertiary">
            {waCredsOk === true
              ? 'Envio habilitado'
              : waCredsOk === false
                ? 'Configure credenciais reais'
                : 'Sem dados'}
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="text-sm text-text-secondary">Outbound em fila (DB)</div>
          <div className="text-xl font-semibold text-text-primary">
            {outbound?.queuedCount ?? 0}
          </div>
          <div className="text-xs text-text-tertiary">Itens com status <code>pending</code> ou <code>failed</code></div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="text-sm text-text-secondary">Outbound falhas (DB)</div>
          <div className="text-xl font-semibold text-text-primary">
            {outbound?.failedCount ?? 0}
          </div>
          <div className="text-xs text-text-tertiary">Itens com status <code>failed</code></div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm mb-6">
          {error}
        </div>
      )}

      {loading && !health ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-text-secondary">Carregando...</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {(channels.length ? channels : [
              { channelType: 'whatsapp', status: 'unknown' },
              { channelType: 'instagram', status: 'unknown' },
              { channelType: 'webchat', status: 'unknown' },
            ]).map((c) => (
              <div key={c.channelType} className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-lg font-semibold text-text-primary">
                    {c.channelType}
                  </div>
                  <div className={`px-2 py-1 rounded-md border text-xs ${badgeClass(c.status)}`}>
                    {c.status}
                  </div>
                </div>

                <div className="text-sm text-text-secondary space-y-1">
                  <div>
                    <strong>Contas</strong>: {c.accounts?.active ?? 0} ativas / {c.accounts?.total ?? 0} total
                    {c.diagnostics ? (
                      <span className="text-xs text-text-tertiary">
                        {' '}• config OK: {c.diagnostics.configOkActive ?? 0}/{c.diagnostics.active ?? c.accounts?.active ?? 0}
                      </span>
                    ) : null}
                  </div>
                  {(c.channelType === 'whatsapp' && c.diagnostics?.whatsappQualityRatings && c.diagnostics.whatsappQualityRatings.length > 0) ? (
                    <div className="text-xs text-text-tertiary">
                      <strong>WABA quality</strong>: {c.diagnostics.whatsappQualityRatings.join(', ')}
                    </div>
                  ) : null}
                  <div>
                    <strong>Outbound (janela)</strong>: {c.delivery?.outFailed ?? 0} falhas / {c.delivery?.outTotal ?? 0} envios ({formatPct(c.delivery?.failRate || 0)})
                  </div>
                  <div>
                    <strong>Fila outbound</strong>: {c.outboundQueue?.pending ?? 0} em fila • {c.outboundQueue?.dueNow ?? 0} vencidos • retrying {c.outboundQueue?.retrying ?? 0} • oldest {formatSeconds(c.outboundQueue?.oldestPendingSeconds)}
                  </div>
                  <div className="text-xs text-text-tertiary">
                    attempts: max {c.outboundQueue?.maxAttempts ?? 0} • avg {formatNumber(c.outboundQueue?.avgAttempts, 1)} • overdue max {formatSeconds(c.outboundQueue?.overdueMaxSeconds)} • sending {c.outboundQueue?.sending ?? 0}
                    {c.outboundQueue?.sendingAgeMaxSeconds ? (
                      <span> • sending age max {formatSeconds(c.outboundQueue?.sendingAgeMaxSeconds)}</span>
                    ) : null}
                  </div>
                  {c.reason ? (
                    <div className="text-xs text-text-tertiary">Motivo: {c.reason}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mb-6">
            <div className="text-xl font-semibold text-text-primary mb-2">Fila Outbound (total)</div>
            <div className="text-sm text-text-secondary">
              Em fila: <strong>{health?.outboundQueue?.totals?.pending ?? 0}</strong> • Vencidos: <strong>{health?.outboundQueue?.totals?.dueNow ?? 0}</strong> • Oldest: <strong>{formatSeconds(health?.outboundQueue?.totals?.oldestPendingSeconds)}</strong>
            </div>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mb-6">
            <div className="text-xl font-semibold text-text-primary mb-2">Erros recentes (outbound)</div>
            {(outbound?.recentErrors && outbound.recentErrors.length > 0) ? (
              <div className="space-y-2">
                {outbound.recentErrors.map((e) => (
                  <div key={e.id} className="p-3 rounded-md border border-border-default bg-bg-tertiary">
                    <div className="text-sm text-text-primary font-medium">
                      {e.channel_type} • attempts: {e.attempts ?? 0}
                    </div>
                    <div className="text-xs text-text-secondary" style={{ whiteSpace: 'pre-wrap' }}>
                      {e.last_error || '-'}
                    </div>
                    <div className="text-xs text-text-tertiary">
                      next: {e.next_attempt_at ? String(e.next_attempt_at) : '-'} • updated: {e.updated_at ? String(e.updated_at) : '-'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-text-secondary text-sm">Nenhum erro recente.</div>
            )}
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xl font-semibold text-text-primary">Alertas (última janela)</div>
              <label className="text-sm text-text-secondary flex items-center gap-2">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                Auto-refresh
              </label>
            </div>
            {alerts.length === 0 ? (
              <div className="text-text-secondary text-sm">Nenhum alerta.</div>
            ) : (
              <div className="space-y-2">
                {alerts.map((a, idx) => (
                  <div key={`${a.type}-${a.channelType}-${idx}`} className="p-3 rounded-md border border-border-default bg-bg-tertiary">
                    <div className="text-sm text-text-primary font-medium">
                      [{a.severity}] {a.channelType} — {a.type}
                    </div>
                    <div className="text-xs text-text-secondary">{a.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}

