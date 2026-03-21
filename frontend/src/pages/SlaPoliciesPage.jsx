import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { listSlaPolicies, upsertSlaPolicy, listSlaBreaches } from '../api/sla';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return '-';
  return date.toLocaleString('pt-BR');
}

function resolveCustomerKey(breach) {
  if (!breach || typeof breach !== 'object') return 'sem-cliente';
  const raw =
    breach.customerId ||
    breach.customer ||
    breach.contactId ||
    breach.contact ||
    breach.accountId ||
    breach.ticketId ||
    breach.ticket_id ||
    'sem-cliente';
  return String(raw).trim() || 'sem-cliente';
}

export function SlaPoliciesPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [breaches, setBreaches] = useState([]);
  const [customerFilter, setCustomerFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    customerSegment: 'default',
    responseTimeMin: '',
    resolutionTimeMin: '',
    enabled: true,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function load() {
    setLoading(true);
    try {
      const [pResp, bResp] = await Promise.all([listSlaPolicies(), listSlaBreaches()]);
      setPolicies(Array.isArray(pResp?.policies) ? pResp.policies : []);
      setBreaches(Array.isArray(bResp?.breaches) ? bResp.breaches : []);
    } catch (err) {
      logger.error('[SLA] erro ao carregar', err);
      showToast('Erro ao carregar SLA', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      load();
    }
  }, [authLoading, isAuthenticated]);

  const policyById = useMemo(() => {
    const map = new Map();
    for (const policy of policies) {
      if (policy?.id) map.set(String(policy.id), policy);
    }
    return map;
  }, [policies]);

  const breachesWithMeta = useMemo(
    () =>
      breaches.map((breach) => {
        const policy = breach?.policyId ? policyById.get(String(breach.policyId)) : null;
        const atDate = parseDate(breach?.at);
        return {
          ...breach,
          _customerKey: resolveCustomerKey(breach),
          _atDate: atDate,
          _policy: policy,
        };
      }),
    [breaches, policyById],
  );

  const customerRows = useMemo(() => {
    const grouped = new Map();
    for (const breach of breachesWithMeta) {
      const key = breach._customerKey;
      const current = grouped.get(key) || {
        customerKey: key,
        totalBreaches: 0,
        lastAt: null,
        kinds: new Set(),
        policyIds: new Set(),
      };
      current.totalBreaches += 1;
      if (breach.kind) current.kinds.add(String(breach.kind));
      if (breach.policyId) current.policyIds.add(String(breach.policyId));
      if (breach._atDate && (!current.lastAt || breach._atDate > current.lastAt)) {
        current.lastAt = breach._atDate;
      }
      grouped.set(key, current);
    }
    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        kinds: Array.from(row.kinds),
        policyIds: Array.from(row.policyIds),
      }))
      .sort((a, b) => {
        if (b.totalBreaches !== a.totalBreaches) return b.totalBreaches - a.totalBreaches;
        const atA = a.lastAt ? a.lastAt.getTime() : 0;
        const atB = b.lastAt ? b.lastAt.getTime() : 0;
        return atB - atA;
      });
  }, [breachesWithMeta]);

  const filteredCustomerRows = useMemo(() => {
    const q = customerFilter.trim().toLowerCase();
    if (!q) return customerRows;
    return customerRows.filter((row) => row.customerKey.toLowerCase().includes(q));
  }, [customerRows, customerFilter]);

  const proactiveAlerts = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    const last24h = breachesWithMeta.filter((b) => b._atDate && now - b._atDate.getTime() <= dayMs).length;
    const last7d = breachesWithMeta.filter((b) => b._atDate && now - b._atDate.getTime() <= weekMs);
    const byCustomerRecent = new Map();
    for (const breach of last7d) {
      const key = breach._customerKey;
      byCustomerRecent.set(key, (byCustomerRecent.get(key) || 0) + 1);
    }
    const recurrent = Array.from(byCustomerRecent.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);
    const disabledPolicies = policies.filter((p) => p && p.enabled === false).length;

    const alerts = [];
    if (last24h >= 3) {
      alerts.push({ level: 'high', title: 'Pico de violações (24h)', detail: `${last24h} breaches nas últimas 24h` });
    }
    if (recurrent.length > 0) {
      alerts.push({
        level: 'medium',
        title: 'Clientes recorrentes em violação',
        detail: recurrent.slice(0, 3).map(([customer, count]) => `${customer}: ${count}`).join(' | '),
      });
    }
    if (disabledPolicies > 0) {
      alerts.push({
        level: 'low',
        title: 'Policies inativas',
        detail: `${disabledPolicies} policy(s) inativa(s); valide cobertura por segmento.`,
      });
    }
    return alerts;
  }, [breachesWithMeta, policies]);

  async function handleSave() {
    if (!form.name.trim()) {
      showToast('Informe um nome para a policy', 'warning');
      return;
    }
    setLoading(true);
    try {
      await upsertSlaPolicy({
        id: editingId,
        name: form.name.trim(),
        description: form.description.trim(),
        customerSegment: form.customerSegment.trim() || 'default',
        responseTimeMin: form.responseTimeMin ? Number(form.responseTimeMin) : null,
        resolutionTimeMin: form.resolutionTimeMin ? Number(form.resolutionTimeMin) : null,
        enabled: form.enabled,
      });
      setEditingId(null);
      setForm({
        name: '',
        description: '',
        customerSegment: 'default',
        responseTimeMin: '',
        resolutionTimeMin: '',
        enabled: true,
      });
      await load();
      showToast('Policy salva', 'success');
    } catch (err) {
      showToast('Erro ao salvar policy', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(item) {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      description: item.description || '',
      customerSegment: item.customerSegment || 'default',
      responseTimeMin: item.responseTimeMin ?? '',
      resolutionTimeMin: item.resolutionTimeMin ?? '',
      enabled: item.enabled !== false,
    });
  }

  if (authLoading) {
    return (
      <CrudPageBase>
        <div style={{ padding: '40px', textAlign: 'center' }}>
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
        <h1>⏱️ SLA por Cliente</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <Button onClick={load} disabled={loading} className="support-button">Atualizar</Button>
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
          <div className="support-details-title">Alertas proativos</div>
          {proactiveAlerts.length === 0 ? (
            <div className="text-text-tertiary">Sem alertas no momento.</div>
          ) : (
            <div className="space-y-2">
              {proactiveAlerts.map((alert, idx) => (
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
          <div className="support-details-title">{editingId ? 'Editar policy' : 'Nova policy'}</div>
          <div className="support-form-group">
            <label className="support-form-label">Nome</label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Descrição</label>
            <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Segmento</label>
            <Input value={form.customerSegment} onChange={(e) => setForm((p) => ({ ...p, customerSegment: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="support-form-group">
              <label className="support-form-label">Tempo de resposta (min)</label>
              <Input type="number" value={form.responseTimeMin} onChange={(e) => setForm((p) => ({ ...p, responseTimeMin: e.target.value }))} />
            </div>
            <div className="support-form-group">
              <label className="support-form-label">Tempo de resolução (min)</label>
              <Input type="number" value={form.resolutionTimeMin} onChange={(e) => setForm((p) => ({ ...p, resolutionTimeMin: e.target.value }))} />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
            <span>Ativo</span>
          </label>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} className="support-button-full" disabled={loading}>
              {editingId ? 'Salvar alterações' : 'Criar policy'}
            </Button>
            {editingId && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingId(null);
                  setForm({ name: '', description: '', customerSegment: 'default', responseTimeMin: '', resolutionTimeMin: '', enabled: true });
                }}
                disabled={loading}
              >
                Cancelar
              </Button>
            )}
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Policies</div>
          {policies.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma policy cadastrada.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="support-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Segmento</th>
                    <th>Resposta (min)</th>
                    <th>Resolução (min)</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.customerSegment}</td>
                      <td>{p.responseTimeMin ?? '-'}</td>
                      <td>{p.resolutionTimeMin ?? '-'}</td>
                      <td>{p.enabled ? 'ativo' : 'inativo'}</td>
                      <td>
                        <Button onClick={() => handleEdit(p)} style={{ width: 'auto' }}>Editar</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Visão por cliente</div>
          <div className="support-form-group">
            <label className="support-form-label">Filtro de cliente</label>
            <Input
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              placeholder="ex.: ticket-123 / customerId"
            />
          </div>
          {filteredCustomerRows.length === 0 ? (
            <div className="text-text-tertiary">Sem dados de cliente para o filtro atual.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="support-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Breaches</th>
                    <th>Última violação</th>
                    <th>Tipos</th>
                    <th>Policies</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomerRows.map((row) => (
                    <tr key={row.customerKey}>
                      <td>{row.customerKey}</td>
                      <td>{row.totalBreaches}</td>
                      <td>{row.lastAt ? row.lastAt.toLocaleString('pt-BR') : '-'}</td>
                      <td>{row.kinds.length ? row.kinds.join(', ') : '-'}</td>
                      <td>{row.policyIds.length ? row.policyIds.join(', ') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Breaches</div>
          {breaches.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma violação registrada.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="support-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Policy</th>
                    <th>Ticket</th>
                    <th>Tipo</th>
                    <th>Em</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.map((b) => (
                    <tr key={b.id || `${b.policyId}-${b.ticketId}-${b.at}`}>
                      <td>{b.id || '-'}</td>
                      <td>{b.policyId || '-'}</td>
                      <td>{b.ticketId || '-'}</td>
                      <td>{b.kind || '-'}</td>
                      <td>{formatDate(b.at)}</td>
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
