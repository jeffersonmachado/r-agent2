import React, { useEffect, useMemo, useState } from 'react';
import {
  listAccessDevices,
  createAccessDevice,
  listAccessCredentials,
  createAccessCredential,
  listAccessPolicies,
  createAccessPolicy,
  listAccessDecisions,
  getAccessControlHealth,
  listAccessEvents,
  createVisitorAccessQr,
} from '../api/accessControl';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';

import { CrudPageBase, showCrudError, showCrudSuccess, useCrudList } from '../modules/crud-base';

const TABS = [
  { id: 'devices', label: 'Dispositivos' },
  { id: 'credentials', label: 'Credenciais' },
  { id: 'policies', label: 'Políticas' },
  { id: 'decisions', label: 'Decisões' },
  { id: 'events', label: 'Eventos' },
];

const pillStyle = {
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--color-border-default)',
  borderRadius: 999,
  background: 'var(--color-bg-primary)',
  color: 'var(--color-text-primary)',
};

const cardStyle = {
  border: '1px solid var(--color-border-default)',
  borderRadius: 10,
  padding: '0.75rem',
  background: 'var(--color-bg-primary)',
};

const mutedStyle = {
  color: 'var(--color-text-secondary)',
};

function Panel({ title, children, action = null }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 className="text-xl font-semibold text-text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function AccessControlPage() {
  const { showToast, ToastContainer } = useToast();
  const initialSearch = (() => {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_) {
      return new URLSearchParams();
    }
  })();
  const [tab, setTab] = useState('devices');
  const [decisionStatusFilter, setDecisionStatusFilter] = useState(initialSearch.get('acDecisionStatus') || '');
  const [decisionDeviceFilter, setDecisionDeviceFilter] = useState(initialSearch.get('acDecisionDevice') || '');
  const [decisionSubjectFilter, setDecisionSubjectFilter] = useState(initialSearch.get('acDecisionSubject') || '');
  const [pendingCriticalOnly, setPendingCriticalOnly] = useState(initialSearch.get('acDecisionCritical') === '1');
  const [operationError, setOperationError] = useState(null);
  const [visitorQr, setVisitorQr] = useState(null);

  const decisionParams = useMemo(() => ({
    decisionStatusFilter,
    decisionDeviceFilter,
    decisionSubjectFilter,
    pendingCriticalOnly,
  }), [decisionStatusFilter, decisionDeviceFilter, decisionSubjectFilter, pendingCriticalOnly]);

  const {
    allItems,
    loading,
    error: loadError,
    reload: reloadAll,
  } = useCrudList(async (params = {}) => {
    const [deviceResp, credentialResp, policyResp, decisionResp, eventResp, healthResp] = await Promise.all([
      listAccessDevices(),
      listAccessCredentials(),
      listAccessPolicies(),
      listAccessDecisions({
        limit: 20,
        include_status: true,
        execution_status: params.decisionStatusFilter || undefined,
        device_id: params.decisionDeviceFilter || undefined,
        subject_id: params.decisionSubjectFilter || undefined,
        pending_critical_only: params.pendingCriticalOnly ? true : undefined,
      }),
      listAccessEvents({ limit: 50 }),
      getAccessControlHealth({ limit: 50 }),
    ]);

    return [{
      devices: deviceResp?.items || [],
      credentials: credentialResp?.items || [],
      policies: policyResp?.items || [],
      decisions: decisionResp?.items || [],
      decisionSummary: decisionResp?.summary || null,
      healthSnapshot: healthResp || null,
      events: eventResp?.items || [],
    }];
  }, {
    params: decisionParams,
    loadOnMount: true,
    reloadOnParamsChange: true,
  });

  const aggregate = allItems[0] || {};
  const devices = aggregate.devices || [];
  const credentials = aggregate.credentials || [];
  const policies = aggregate.policies || [];
  const decisions = aggregate.decisions || [];
  const decisionSummary = aggregate.decisionSummary || null;
  const healthSnapshot = aggregate.healthSnapshot || null;
  const events = aggregate.events || [];
  const error = operationError || loadError;

  useEffect(() => {
    if (loadError) {
      showCrudError(showToast, loadError, 'Erro ao carregar Access Control');
    }
  }, [loadError, showToast]);

  const visitorQrImageUrl = visitorQr?.qr_payload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(visitorQr.qr_payload)}`
    : null;

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (decisionStatusFilter) params.set('acDecisionStatus', decisionStatusFilter);
      else params.delete('acDecisionStatus');
      if (decisionDeviceFilter) params.set('acDecisionDevice', decisionDeviceFilter);
      else params.delete('acDecisionDevice');
      if (decisionSubjectFilter) params.set('acDecisionSubject', decisionSubjectFilter);
      else params.delete('acDecisionSubject');
      if (pendingCriticalOnly) params.set('acDecisionCritical', '1');
      else params.delete('acDecisionCritical');
      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
      window.history.replaceState(null, '', nextUrl);
    } catch (_) {
      // best-effort only
    }
  }, [decisionStatusFilter, decisionDeviceFilter, decisionSubjectFilter, pendingCriticalOnly]);

  const quickCreateDevice = async () => {
    try {
      setOperationError(null);
      await createAccessDevice({
        name: `Catraca ${devices.length + 1}`,
        type: 'turnstile',
        vendor: 'generic',
        status: 'active',
        integration_mode: 'backend_decides',
      });
      await reloadAll();
      showCrudSuccess(showToast, 'Dispositivo criado com sucesso');
    } catch (err) {
      const message = showCrudError(showToast, err, 'Erro ao criar dispositivo');
      setOperationError(message);
    }
  };

  const quickCreateCredential = async () => {
    try {
      setOperationError(null);
      await createAccessCredential({
        type: 'qrcode',
        customer_id: `customer-${credentials.length + 1}`,
        subject_metadata: { source: 'access_control_ui' },
        vertical: 'fitness',
        billing_status: 'active',
        credential_value: `qr-${Date.now()}`,
      });
      await reloadAll();
      showCrudSuccess(showToast, 'Credencial criada com sucesso');
    } catch (err) {
      const message = showCrudError(showToast, err, 'Erro ao criar credencial');
      setOperationError(message);
    }
  };

  const quickCreatePolicy = async () => {
    try {
      setOperationError(null);
      await createAccessPolicy({
        name: `Fitness Default ${policies.length + 1}`,
        vertical: 'fitness',
        applies_to: {
          vertical_profiles: ['fitness'],
          membership_statuses: ['active', 'grace_period', 'trial', 'visitor'],
          device_types: ['turnstile', 'door', 'reader'],
          actions: ['enter', 'exit'],
        },
        days_allowed: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        time_start: '05:00',
        time_end: '23:00',
        anti_passback_mode: 'strict',
        grace_policy: { allowGracePeriod: true },
        metadata: { pending_critical_age_ms: 180000 },
      });
      await reloadAll();
      showCrudSuccess(showToast, 'Politica criada com sucesso');
    } catch (err) {
      const message = showCrudError(showToast, err, 'Erro ao criar politica');
      setOperationError(message);
    }
  };

  const quickCreateVisitorQr = async () => {
    try {
      setOperationError(null);
      const result = await createVisitorAccessQr({
        vertical: 'fitness',
        name: 'Visitante Experimental',
        customer_id: `visitor-${Date.now()}`,
        unit_scope: devices[0]?.unit_id ? [devices[0].unit_id] : [],
      });
      setVisitorQr(result);
      setTab('events');
      await reloadAll();
      showCrudSuccess(showToast, 'QR visitante emitido com sucesso');
    } catch (err) {
      const message = showCrudError(showToast, err, 'Erro ao emitir QR visitante');
      setOperationError(message);
    }
  };

  const clearDecisionFilters = () => {
    setDecisionStatusFilter('');
    setDecisionDeviceFilter('');
    setDecisionSubjectFilter('');
    setPendingCriticalOnly(false);
  };

  return (
    <CrudPageBase
      title="Access Control"
      actions={(
        <>
          <Button
            onClick={() => {
              setOperationError(null);
              reloadAll();
            }}
            disabled={loading}
          >
            Atualizar
          </Button>
          <Button onClick={quickCreateVisitorQr}>QR Visitante</Button>
        </>
      )}
    >
      <ToastContainer />

      <Panel title="MVP Operacional">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              style={{
                padding: '0.6rem 0.9rem',
                borderRadius: 999,
                border: '1px solid var(--color-border-default)',
                background: tab === item.id ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)',
                color: tab === item.id ? 'var(--qa-on-accent)' : 'var(--color-text-primary)',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-text-secondary">
          Fitness está pronto como perfil inicial obrigatório, com política de horário, billing, unidade, anti-passback e QR temporário.
          Beauty entra via policy/profile e leitura de agendamentos válidos.
        </p>
      </Panel>

      {error ? (
        <div className="mb-4 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-text-primary">
          <strong>Erro:</strong> {error}
        </div>
      ) : null}

      {healthSnapshot ? (
        <Panel title="Saúde Operacional">
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div style={pillStyle}>
              Threshold pending crítico {Math.round((healthSnapshot.threshold_ms || 0) / 60000)} min
            </div>
            <div style={pillStyle}>
              Escopo {healthSnapshot.threshold_scope || 'environment_default'}
            </div>
            <div style={{
              ...pillStyle,
              border: healthSnapshot.has_incidents ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(16, 185, 129, 0.35)',
              background: healthSnapshot.has_incidents ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            }}>
              {healthSnapshot.has_incidents ? 'Ação necessária' : 'Saudável'}
            </div>
            <div style={pillStyle}>
              Pendências críticas {healthSnapshot.summary?.pending_critical || 0}
            </div>
          </div>
          {healthSnapshot.pending_critical_items?.length ? (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {healthSnapshot.pending_critical_items.slice(0, 5).map((item) => (
                <div key={item.id} style={{ ...cardStyle, border: '1px solid rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.08)' }}>
                  <strong>{item.id}</strong> · {item.reason_code || '-'} · device {item.device_id || '-'} · subject {item.subject_id || '-'}
                  <div style={{ ...mutedStyle, marginTop: '0.35rem' }}>
                    Critério {Math.round((item.pending_critical_threshold_ms || healthSnapshot.threshold_ms || 0) / 60000)} min · {item.pending_critical_threshold_source || healthSnapshot.threshold_scope || 'environment_default'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>Nenhuma decisão pendente crítica no recorte atual.</p>
          )}
          {healthSnapshot.failed_items?.length ? (
            <div style={{ display: 'grid', gap: '0.5rem', marginTop: '1rem' }}>
              {healthSnapshot.failed_items.slice(0, 5).map((item) => (
                <div key={`failed-${item.id}`} style={{ ...cardStyle, border: '1px solid rgba(245, 158, 11, 0.35)', background: 'rgba(245, 158, 11, 0.10)' }}>
                  <strong>Falha {item.id}</strong> · {item.reason_code || '-'} · device {item.device_id || '-'} · subject {item.subject_id || '-'}
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {visitorQr ? (
        <Panel title="QR Visitante Emitido">
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(180px, 220px) 1fr' }}>
            <div>
              {visitorQrImageUrl ? (
                <img src={visitorQrImageUrl} alt="QR de acesso temporário" width={220} height={220} />
              ) : (
                <div dangerouslySetInnerHTML={{ __html: visitorQr.qr_svg }} />
              )}
            </div>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <div><strong>Expira em:</strong> {visitorQr.expires_at || '-'}</div>
              <div><strong>Payload:</strong></div>
              <textarea readOnly value={visitorQr.qr_payload || ''} rows={8} style={{ width: '100%' }} />
            </div>
          </div>
        </Panel>
      ) : null}

      {tab === 'devices' ? (
        <Panel title="Dispositivos" action={<Button onClick={quickCreateDevice}>Novo dispositivo</Button>}>
          {loading ? <p>Carregando...</p> : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {devices.map((item) => (
                <div key={item.id} style={cardStyle}>
                  <div><strong>{item.name}</strong> · {item.type}</div>
                  <div style={mutedStyle}>{item.vendor || 'vendor genérico'} · unidade {item.unit_id || '-'}</div>
                </div>
              ))}
              {devices.length === 0 ? <p>Nenhum dispositivo.</p> : null}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === 'credentials' ? (
        <Panel title="Credenciais" action={<Button onClick={quickCreateCredential}>Nova credencial</Button>}>
          {loading ? <p>Carregando...</p> : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {credentials.map((item) => (
                <div key={item.id} style={cardStyle}>
                  <div><strong>{item.type}</strong> · subject {item.subject_id}</div>
                  <div style={mutedStyle}>status {item.status} · ref {item.credential_ref || '-'}</div>
                </div>
              ))}
              {credentials.length === 0 ? <p>Nenhuma credencial.</p> : null}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === 'policies' ? (
        <Panel title="Políticas" action={<Button onClick={quickCreatePolicy}>Nova politica</Button>}>
          {loading ? <p>Carregando...</p> : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {policies.map((item) => (
                <div key={item.id} style={cardStyle}>
                  <div><strong>{item.name}</strong> · {item.vertical}</div>
                  <div style={mutedStyle}>
                    {item.time_start || '--:--'} - {item.time_end || '--:--'} · anti-passback {item.anti_passback_mode} · pending crítico {Math.round(((item.metadata?.pending_critical_age_ms || item.metadata?.pendingCriticalAgeMs || healthSnapshot?.threshold_ms || 0) / 60000))} min
                  </div>
                </div>
              ))}
              {policies.length === 0 ? <p>Nenhuma política.</p> : null}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === 'events' ? (
        <Panel title="Eventos de Acesso">
          {loading ? <p>Carregando...</p> : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {events.map((item) => (
                <div key={item.id} style={cardStyle}>
                  <div><strong>{item.event_type}</strong> · {item.reason_code || '-'}</div>
                  <div style={mutedStyle}>{item.subject_id || '-'} · {item.device_id || '-'} · {item.occurred_at}</div>
                </div>
              ))}
              {events.length === 0 ? <p>Nenhum evento.</p> : null}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === 'decisions' ? (
        <Panel
          title="Decisões de Acesso"
          action={(
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={decisionStatusFilter} onChange={(e) => setDecisionStatusFilter(e.target.value)}>
                <option value="">Todos status</option>
                <option value="pending">Pending</option>
                <option value="executed">Executed</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
                <option value="unknown">Unknown</option>
              </select>
              <input
                type="text"
                value={decisionDeviceFilter}
                onChange={(e) => setDecisionDeviceFilter(e.target.value)}
                placeholder="Filtrar por device"
                style={{ minWidth: 160 }}
              />
              <input
                type="text"
                value={decisionSubjectFilter}
                onChange={(e) => setDecisionSubjectFilter(e.target.value)}
                placeholder="Filtrar por subject"
                style={{ minWidth: 160 }}
              />
              <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={pendingCriticalOnly}
                  onChange={(e) => setPendingCriticalOnly(e.target.checked)}
                />
                Só críticos
              </label>
              <Button type="button" variant="secondary" onClick={clearDecisionFilters}>
                Limpar filtros
              </Button>
            </div>
          )}
        >
          {decisionSummary ? (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={pillStyle}>
                Total {decisionSummary.total || 0}
              </div>
              <div style={pillStyle}>
                Pending {decisionSummary.pending || 0}
              </div>
              <div style={{ ...pillStyle, border: '1px solid rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.12)' }}>
                Pending crítico {decisionSummary.pending_critical || 0}
              </div>
              <div style={pillStyle}>
                Executed {decisionSummary.executed || 0}
              </div>
              <div style={pillStyle}>
                Failed {decisionSummary.failed || 0}
              </div>
              <div style={pillStyle}>
                Expired {decisionSummary.expired || 0}
              </div>
            </div>
          ) : null}
          {loading ? <p>Carregando...</p> : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {decisions.map((item) => (
                <div
                  key={item.id}
                  style={{
                    ...cardStyle,
                    border: item.pending_critical ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid var(--color-border-default)',
                    background: item.pending_critical ? 'rgba(239, 68, 68, 0.08)' : 'var(--color-bg-primary)',
                    borderRadius: 10,
                    padding: '0.75rem',
                  }}
                >
                  <div>
                    <strong>{item.decision}</strong> · {item.reason_code || '-'} · status {item.execution_status || 'pending'}
                    {item.pending_critical ? ' · pendente crítico' : ''}
                  </div>
                  <div style={mutedStyle}>
                    device {item.device_id || '-'} · subject {item.subject_id || '-'} · {item.issued_at || item.created_at || '-'}
                  </div>
                  <div style={mutedStyle}>
                    threshold {Math.round(((item.pending_critical_threshold_ms || healthSnapshot?.threshold_ms || 0) / 60000))} min · {item.pending_critical_threshold_source || healthSnapshot?.threshold_scope || 'environment_default'}
                  </div>
                </div>
              ))}
              {decisions.length === 0 ? <p>Nenhuma decisão.</p> : null}
            </div>
          )}
        </Panel>
      ) : null}
    </CrudPageBase>
  );
}
