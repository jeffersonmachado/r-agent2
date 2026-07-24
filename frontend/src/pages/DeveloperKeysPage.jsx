import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { createDeveloperKey, getDeveloperUsage, listDeveloperKeys } from '../api/developerKeys';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

export function DeveloperKeysPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState([]);
  const [usage, setUsage] = useState(null);
  const [includeToken, setIncludeToken] = useState(false);

  const [form, setForm] = useState({ name: '', description: '', expiresInSec: '' });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function loadAll() {
    setLoading(true);
    try {
      const [keysResp, usageResp] = await Promise.all([
        listDeveloperKeys({ includeToken }),
        getDeveloperUsage(),
      ]);
      setKeys(Array.isArray(keysResp?.items) ? keysResp.items : []);
      setUsage(usageResp || null);
    } catch (err) {
      logger.error('[DeveloperKeys] erro ao carregar', err);
      showToast('Erro ao carregar chaves', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadAll();
    }
  }, [authLoading, isAuthenticated, includeToken]);

  async function handleCreate() {
    if (!form.name.trim()) {
      showToast('Informe um nome para a chave', 'warning');
      return;
    }
    setLoading(true);
    try {
      const expiresInSec = form.expiresInSec ? Number(form.expiresInSec) : null;
      await createDeveloperKey({
        name: form.name.trim(),
        description: form.description.trim(),
        expiresInSec: Number.isNaN(expiresInSec) ? null : expiresInSec,
      });
      setForm({ name: '', description: '', expiresInSec: '' });
      await loadAll();
      showToast('Chave criada', 'success');
    } catch (err) {
      showToast('Erro ao criar chave', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(token) {
    if (!token) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(String(token)).then(() => showToast('Token copiado', 'success')).catch(() => showToast('Falha ao copiar', 'error'));
    } else {
      showToast('Clipboard indisponível', 'warning');
    }
  }

  const usageTotals = useMemo(() => usage?.totals || null, [usage]);
  const usageRoutes = useMemo(() => (Array.isArray(usage?.routes) ? usage.routes : []), [usage]);
  const consumptionAlerts = useMemo(() => {
    const alerts = [];
    const topRoute = usageRoutes[0] || null;
    if (topRoute && Number(topRoute.count || 0) >= 100) {
      alerts.push({
        level: 'high',
        title: 'Pico de consumo por rota',
        detail: `${topRoute.route}: ${topRoute.count} requisições`,
      });
    }
    const recentErrorRoute = usageRoutes.find((route) => {
      const code = Number(route?.lastStatusCode || 0);
      return code >= 400;
    });
    if (recentErrorRoute) {
      alerts.push({
        level: 'medium',
        title: 'Erro recente em rota pública',
        detail: `${recentErrorRoute.route} (último status: ${recentErrorRoute.lastStatusCode || '-'})`,
      });
    }
    if (usageTotals && Number(usageTotals.expired || 0) > 0) {
      alerts.push({
        level: 'low',
        title: 'Chaves expiradas detectadas',
        detail: `${usageTotals.expired} chave(s) expirada(s) ainda listada(s); revisar rotação.`,
      });
    }
    return alerts;
  }, [usageRoutes, usageTotals]);

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

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>🔑 Chaves de API</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeToken} onChange={(e) => setIncludeToken(e.target.checked)} />
            <span>Exibir tokens</span>
          </label>
          <Button onClick={loadAll} disabled={loading} className="support-button">Atualizar</Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr', gap: '16px' }}>
        <div className="support-details-panel">
          <div className="support-details-title">Nova chave</div>
          <div className="support-form-group">
            <label className="support-form-label">Nome</label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ex: Integração ERP" />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Descrição</label>
            <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Uso interno/externo" />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Expira em (segundos)</label>
            <Input value={form.expiresInSec} onChange={(e) => setForm((p) => ({ ...p, expiresInSec: e.target.value }))} placeholder="Ex: 2592000 (30 dias)" />
          </div>
          <Button onClick={handleCreate} className="support-button-full" disabled={loading}>Criar chave</Button>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Uso (resumo)</div>
          {usageTotals ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg border border-border-default bg-bg-tertiary">
                <div className="text-text-tertiary text-xs">Total</div>
                <div className="text-text-primary font-semibold">{usageTotals.total}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-tertiary">
                <div className="text-text-tertiary text-xs">Ativas</div>
                <div className="text-text-primary font-semibold">{usageTotals.active}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-tertiary">
                <div className="text-text-tertiary text-xs">Revogadas</div>
                <div className="text-text-primary font-semibold">{usageTotals.revoked}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-tertiary">
                <div className="text-text-tertiary text-xs">Expiradas</div>
                <div className="text-text-primary font-semibold">{usageTotals.expired}</div>
              </div>
            </div>
          ) : (
            <div className="text-text-tertiary">Sem dados de uso.</div>
          )}
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Alertas de consumo</div>
          {consumptionAlerts.length === 0 ? (
            <div className="text-text-tertiary">Sem alertas no momento.</div>
          ) : (
            <div className="space-y-2">
              {consumptionAlerts.map((alert, idx) => (
                <div
                  key={`${alert.title}-${idx}`}
                  className="p-3 rounded-lg border border-border-default bg-bg-tertiary"
                  style={{
                    borderLeft: `4px solid ${
                      alert.level === 'high'
                        ? 'var(--status-error)'
                        : alert.level === 'medium'
                          ? 'var(--status-warning)'
                          : 'var(--status-info)'
                    }`,
                  }}
                >
                  <div className="text-sm font-semibold text-text-primary">{alert.title}</div>
                  <div className="text-xs text-text-tertiary">{alert.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Relatório por rota</div>
          {usageRoutes.length === 0 ? (
            <div className="text-text-tertiary">Sem dados de rota ainda. Gere tráfego via `/public/*` para popular.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="support-table">
                <thead>
                  <tr>
                    <th>Rota</th>
                    <th>Requisições</th>
                    <th>Chaves</th>
                    <th>Último uso</th>
                    <th>Último status</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRoutes.map((route) => (
                    <tr key={route.route}>
                      <td className="font-mono text-xs">{route.route}</td>
                      <td>{route.count || 0}</td>
                      <td>{route.keys || 0}</td>
                      <td>{route.lastUsedAt || '-'}</td>
                      <td>{route.lastStatusCode || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Chaves</div>
          {keys.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma chave cadastrada.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="support-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Token</th>
                    <th>Último uso</th>
                    <th>Expira</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td>{k.meta?.name || '-'}</td>
                      <td>{k.id}</td>
                      <td>{k.active ? 'ativa' : 'inativa'}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{k.token || '***'}</span>
                          {includeToken && k.token && (
                            <Button onClick={() => handleCopy(k.token)} style={{ width: 'auto' }}>Copiar</Button>
                          )}
                        </div>
                      </td>
                      <td>{k.lastUsedAt || '-'}</td>
                      <td>{k.expiresAt || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </CrudPageBase>
  );
}
