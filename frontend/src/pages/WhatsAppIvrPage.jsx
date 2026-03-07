import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { getWhatsAppIvr, updateWhatsAppIvr } from '../api/whatsappIvr';
import { useWebSocketStatus } from '../utils/webSocketStatusConfig';
import logger from '../utils/logger';

const DAYS = [
  { key: 'mon', label: 'Seg' },
  { key: 'tue', label: 'Ter' },
  { key: 'wed', label: 'Qua' },
  { key: 'thu', label: 'Qui' },
  { key: 'fri', label: 'Sex' },
  { key: 'sat', label: 'Sab' },
  { key: 'sun', label: 'Dom' },
];

const DEFAULT_CONFIG = {
  enabled: false,
  aiEnabled: false,
  fallbackMode: 'rules_then_menu',
  defaultDepartmentId: null,
  defaultQueueStrategy: 'department_default',
  businessHours: {
    enabled: false,
    timezone: 'America/Sao_Paulo',
    schedule: {
      mon: [{ start: '09:00', end: '18:00' }],
      tue: [{ start: '09:00', end: '18:00' }],
      wed: [{ start: '09:00', end: '18:00' }],
      thu: [{ start: '09:00', end: '18:00' }],
      fri: [{ start: '09:00', end: '18:00' }],
      sat: [{ start: '09:00', end: '13:00' }],
      sun: [],
    },
    holidays: [],
    offHoursPolicy: 'create_ticket',
  },
  departmentBindings: [],
  rules: [],
  menu: {
    enabled: true,
    timeoutSeconds: 600,
    maxAttempts: 3,
    showOnlyBoundDepartments: true,
    allowTextAliases: true,
    greetingTemplate: 'Oi! Para te atender melhor, escolha uma opcao:',
    retryTemplate: 'Nao entendi. Responda com o numero da opcao.',
    confirmationTemplate: 'Perfeito! Vou te direcionar para {{department}}.',
  },
  migration: {
    pendingDepartments: [],
    warnings: [],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConfig(value = {}) {
  const merged = {
    ...clone(DEFAULT_CONFIG),
    ...(value || {}),
    businessHours: {
      ...clone(DEFAULT_CONFIG.businessHours),
      ...(value?.businessHours || {}),
      schedule: {
        ...clone(DEFAULT_CONFIG.businessHours.schedule),
        ...(value?.businessHours?.schedule || {}),
      },
    },
    menu: {
      ...clone(DEFAULT_CONFIG.menu),
      ...(value?.menu || {}),
    },
    migration: {
      ...clone(DEFAULT_CONFIG.migration),
      ...(value?.migration || {}),
    },
  };
  merged.departmentBindings = Array.isArray(value?.departmentBindings) ? value.departmentBindings : [];
  merged.rules = Array.isArray(value?.rules) ? value.rules : [];
  return merged;
}

function normalizeAliases(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function aliasesToText(aliases) {
  return Array.isArray(aliases) ? aliases.join(', ') : '';
}

function buildEmptyRule() {
  return { keyword: '', departmentId: '', priority: 100, enabled: true };
}

function ensureBinding(config, department) {
  const existing = (config.departmentBindings || []).find((item) => item.departmentId === department.id);
  if (existing) return existing;

  const queueNames = Array.isArray(department.queueNames) ? department.queueNames : [];
  return {
    departmentId: department.id,
    enabled: false,
    defaultQueueName: queueNames.length === 1 ? queueNames[0] : '',
    queueStrategy: 'default',
    menuLabel: department.name,
    menuDescription: '',
    menuOrder: (config.departmentBindings || []).length + 1,
    aliases: [],
    businessHoursOverride: null,
  };
}

function updateBindingState(config, department, updater) {
  const current = ensureBinding(config, department);
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...(updater || {}) };
  const bindings = Array.isArray(config.departmentBindings) ? config.departmentBindings.slice() : [];
  const index = bindings.findIndex((item) => item.departmentId === department.id);
  if (index >= 0) bindings[index] = next;
  else bindings.push(next);
  return { ...config, departmentBindings: bindings };
}

function emptyRange() {
  return { start: '09:00', end: '18:00' };
}

function toHolidayText(holidays) {
  return Array.isArray(holidays)
    ? holidays.map((item) => (typeof item === 'string' ? item : item?.date)).filter(Boolean).join(', ')
    : '';
}

function getInvalidReason(invalidBindings = [], departmentId) {
  const hit = invalidBindings.find((item) => item.departmentId === departmentId);
  if (!hit) return '';
  switch (hit.reason) {
    case 'department_without_queues':
      return 'Departamento sem fila operacional vinculada';
    case 'default_queue_required':
      return 'Defina uma fila padrao para este departamento';
    case 'default_queue_not_in_department':
      return 'A fila padrao nao pertence ao department.queueNames';
    case 'default_queue_not_found':
      return 'A fila padrao nao existe nas filas oficiais';
    default:
      return 'Binding invalido';
  }
}

function InfoBadge({ tone = 'neutral', children }) {
  const palette = {
    neutral: { background: 'rgba(15, 23, 42, 0.04)', border: 'rgba(15, 23, 42, 0.12)', color: 'var(--color-text-secondary)' },
    warning: { background: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.26)', color: '#92400e' },
    error: { background: 'rgba(220, 38, 38, 0.10)', border: 'rgba(220, 38, 38, 0.22)', color: '#991b1b' },
  };
  const style = palette[tone] || palette.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '999px', border: `1px solid ${style.border}`, background: style.background, color: style.color, fontSize: '12px', fontWeight: 600 }}>
      {children}
    </span>
  );
}

function SectionCard({ title, description, children, actions = null }) {
  return (
    <section className="support-details-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
        <div>
          <div className="support-details-title">{title}</div>
          {description ? <p className="text-sm text-text-secondary" style={{ marginTop: '6px' }}>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function WhatsAppIvrPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(clone(DEFAULT_CONFIG));
  const [availableDepartments, setAvailableDepartments] = useState([]);
  const [availableQueues, setAvailableQueues] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [invalidBindings, setInvalidBindings] = useState([]);
  const [invalidRules, setInvalidRules] = useState([]);
  const [ruleDraft, setRuleDraft] = useState(buildEmptyRule());

  const applyPayload = useCallback((payload = {}) => {
    const value = normalizeConfig(payload?.value || payload || {});
    setConfig(value);
    setAvailableDepartments(Array.isArray(payload?.departments) ? payload.departments : []);
    setAvailableQueues(Array.isArray(payload?.queues) ? payload.queues : []);
    setWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
    setInvalidBindings(Array.isArray(payload?.invalidBindings) ? payload.invalidBindings : []);
    setInvalidRules(Array.isArray(payload?.invalidRules) ? payload.invalidRules : []);
  }, []);

  const handleWebSocketEvent = useCallback((event, data) => {
    if (event !== 'whatsapp.ivr.updated') return;
    applyPayload(data || {});
  }, [applyPayload]);

  const { connected: wsConnected, authenticated: wsAuthenticated, authFailed } = useWebSocketContext({
    enabled: isAuthenticated,
    onEvent: handleWebSocketEvent,
    subscribeEvents: ['whatsapp.ivr.updated'],
  });

  const wsStatus = useWebSocketStatus({
    connected: wsConnected,
    authenticated: wsAuthenticated,
    authFailed,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [authLoading, isAuthenticated, navigate]);

  const loadIvr = useCallback(async () => {
    setLoading(true);
    try {
      const out = await getWhatsAppIvr();
      applyPayload(out || {});
    } catch (err) {
      logger.error('[WhatsAppIVR] erro ao carregar', err);
      showToast('Erro ao carregar configuracao da URA', 'error');
    } finally {
      setLoading(false);
    }
  }, [applyPayload, showToast]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) loadIvr();
  }, [authLoading, isAuthenticated, loadIvr]);

  const departmentsById = useMemo(
    () => new Map(availableDepartments.map((item) => [item.id, item])),
    [availableDepartments],
  );

  const bindingMap = useMemo(
    () => new Map((config.departmentBindings || []).map((item) => [item.departmentId, item])),
    [config.departmentBindings],
  );

  const validDefaultDepartments = useMemo(
    () => availableDepartments.filter((item) => Array.isArray(item.queueNames) && item.queueNames.length > 0),
    [availableDepartments],
  );

  async function handleSave() {
    setSaving(true);
    try {
      const out = await updateWhatsAppIvr(config);
      applyPayload(out || {});
      showToast('Configuracao da URA atualizada', 'success');
    } catch (err) {
      const message = err?.details?.[0] || 'Falha ao salvar configuracao';
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function updateRule(index, patch) {
    setConfig((prev) => {
      const rules = Array.isArray(prev.rules) ? prev.rules.slice() : [];
      rules[index] = { ...rules[index], ...patch };
      return { ...prev, rules };
    });
  }

  function removeRule(index) {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.filter((_, idx) => idx !== index),
    }));
  }

  function addRule() {
    if (!ruleDraft.keyword || !ruleDraft.departmentId) {
      showToast('Informe keyword e departamento oficial', 'warning');
      return;
    }
    setConfig((prev) => ({
      ...prev,
      rules: [
        ...(prev.rules || []),
        { ...ruleDraft, id: `ui-rule-${Date.now()}` },
      ],
    }));
    setRuleDraft(buildEmptyRule());
  }

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="support-page">
      <ToastContainer />

      <div className="support-header">
        <div>
          <h1>URA WhatsApp</h1>
          <p className="text-sm text-text-secondary" style={{ marginTop: '8px', maxWidth: '780px' }}>
            A URA agora usa departamentos e filas oficiais da plataforma. Bindings operacionais sao validados contra <code>/departments</code>, <code>department.queueNames</code> e <code>/queues</code>.
          </p>
        </div>
        <div className="support-controls" style={{ gap: '12px', flexWrap: 'wrap' }}>
          <div className="flex items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-3 py-1.5" title={wsStatus.title}>
            <span className={`inline-block h-2 w-2 rounded-full ${wsStatus.indicatorDotClassName}`} />
            <span className="text-sm text-text-secondary">{wsStatus.label}</span>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            <span>{config.enabled ? 'URA habilitada' : 'URA desabilitada'}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.aiEnabled}
              onChange={(e) => setConfig((prev) => ({ ...prev, aiEnabled: e.target.checked }))}
            />
            <span>IA antes do fallback</span>
          </label>
          <Button onClick={loadIvr} disabled={loading || saving} className="support-button">Atualizar</Button>
          <Button onClick={handleSave} disabled={loading || saving} className="support-button">
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </div>

      {(warnings.length > 0 || (config.migration?.pendingDepartments || []).length > 0) && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mb-6 shadow-lg" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="support-details-title">Warnings e pendencias</div>
          {warnings.map((warning, index) => (
            <InfoBadge key={`${warning}-${index}`} tone="warning">{warning}</InfoBadge>
          ))}
          {(config.migration?.pendingDepartments || []).map((item, index) => (
            <InfoBadge key={`${item.legacyId || item.name || 'pending'}-${index}`} tone="error">
              Pendencia de migracao: {item.name || item.legacyId || 'departamento legado'}{item.queue ? ` / fila ${item.queue}` : ''}
            </InfoBadge>
          ))}
        </div>
      )}

      <div className="support-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <SectionCard
          title="Politica operacional"
          description="Fallback, departamento padrao e horario de funcionamento por tenant."
        >
          <div className="support-form-group">
            <label className="support-form-label">Fallback mode</label>
            <select
              className="support-form-select"
              value={config.fallbackMode}
              onChange={(e) => setConfig((prev) => ({ ...prev, fallbackMode: e.target.value }))}
            >
              <option value="rules">rules</option>
              <option value="menu">menu</option>
              <option value="rules_then_menu">rules_then_menu</option>
            </select>
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Departamento padrao</label>
            <select
              className="support-form-select"
              value={config.defaultDepartmentId || ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, defaultDepartmentId: e.target.value || null }))}
            >
              <option value="">Sem departamento padrao</option>
              {validDefaultDepartments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Strategia de fila padrao</label>
            <select
              className="support-form-select"
              value={config.defaultQueueStrategy}
              onChange={(e) => setConfig((prev) => ({ ...prev, defaultQueueStrategy: e.target.value }))}
            >
              <option value="department_default">department_default</option>
              <option value="default">default</option>
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.businessHours.enabled}
              onChange={(e) => setConfig((prev) => ({ ...prev, businessHours: { ...prev.businessHours, enabled: e.target.checked } }))}
            />
            <span>Controlar horario de atendimento</span>
          </label>
          <div className="support-form-group">
            <label className="support-form-label">Timezone</label>
            <input
              className="support-form-input"
              value={config.businessHours.timezone}
              onChange={(e) => setConfig((prev) => ({ ...prev, businessHours: { ...prev.businessHours, timezone: e.target.value } }))}
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Politica fora do horario</label>
            <select
              className="support-form-select"
              value={config.businessHours.offHoursPolicy}
              onChange={(e) => setConfig((prev) => ({ ...prev, businessHours: { ...prev.businessHours, offHoursPolicy: e.target.value } }))}
            >
              <option value="create_ticket">create_ticket</option>
              <option value="collect_info">collect_info</option>
              <option value="route_to_oncall">route_to_oncall</option>
            </select>
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Feriados (YYYY-MM-DD, separados por virgula)</label>
            <input
              className="support-form-input"
              value={toHolidayText(config.businessHours.holidays)}
              onChange={(e) => setConfig((prev) => ({
                ...prev,
                businessHours: {
                  ...prev.businessHours,
                  holidays: e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                },
              }))}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {DAYS.map((day) => {
              const ranges = Array.isArray(config.businessHours.schedule?.[day.key]) ? config.businessHours.schedule[day.key] : [];
              return (
                <div key={day.key} style={{ border: '1px solid var(--color-border-default)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{day.label}</strong>
                    <Button
                      className="support-button"
                      onClick={() => setConfig((prev) => ({
                        ...prev,
                        businessHours: {
                          ...prev.businessHours,
                          schedule: {
                            ...prev.businessHours.schedule,
                            [day.key]: [...ranges, emptyRange()],
                          },
                        },
                      }))}
                    >
                      Adicionar faixa
                    </Button>
                  </div>
                  {ranges.length === 0 ? (
                    <span className="text-sm text-text-secondary">Sem atendimento neste dia.</span>
                  ) : ranges.map((range, index) => (
                    <div key={`${day.key}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'center' }}>
                      <input
                        className="support-form-input"
                        value={range.start}
                        onChange={(e) => setConfig((prev) => {
                          const nextRanges = prev.businessHours.schedule[day.key].slice();
                          nextRanges[index] = { ...nextRanges[index], start: e.target.value };
                          return {
                            ...prev,
                            businessHours: {
                              ...prev.businessHours,
                              schedule: { ...prev.businessHours.schedule, [day.key]: nextRanges },
                            },
                          };
                        })}
                      />
                      <input
                        className="support-form-input"
                        value={range.end}
                        onChange={(e) => setConfig((prev) => {
                          const nextRanges = prev.businessHours.schedule[day.key].slice();
                          nextRanges[index] = { ...nextRanges[index], end: e.target.value };
                          return {
                            ...prev,
                            businessHours: {
                              ...prev.businessHours,
                              schedule: { ...prev.businessHours.schedule, [day.key]: nextRanges },
                            },
                          };
                        })}
                      />
                      <Button
                        className="support-button"
                        onClick={() => setConfig((prev) => ({
                          ...prev,
                          businessHours: {
                            ...prev.businessHours,
                            schedule: {
                              ...prev.businessHours.schedule,
                              [day.key]: prev.businessHours.schedule[day.key].filter((_, rangeIndex) => rangeIndex !== index),
                            },
                          },
                        }))}
                      >
                        Remover
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Menu e experiencia"
          description="Controle do menu dinamico, anti-spam e comportamento quando a IA nao classifica."
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.menu.enabled}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, enabled: e.target.checked } }))}
            />
            <span>Menu habilitado</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.menu.showOnlyBoundDepartments}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, showOnlyBoundDepartments: e.target.checked } }))}
            />
            <span>Exibir apenas departments com binding ativo</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.menu.allowTextAliases}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, allowTextAliases: e.target.checked } }))}
            />
            <span>Aceitar aliases em texto</span>
          </label>
          <div className="support-form-group">
            <label className="support-form-label">Timeout do menu (segundos)</label>
            <input
              className="support-form-input"
              type="number"
              min="30"
              value={config.menu.timeoutSeconds}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, timeoutSeconds: Number(e.target.value) || 0 } }))}
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Tentativas maximas</label>
            <input
              className="support-form-input"
              type="number"
              min="1"
              value={config.menu.maxAttempts}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, maxAttempts: Number(e.target.value) || 1 } }))}
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Greeting template</label>
            <textarea
              className="support-form-textarea"
              rows={3}
              value={config.menu.greetingTemplate}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, greetingTemplate: e.target.value } }))}
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Retry template</label>
            <textarea
              className="support-form-textarea"
              rows={3}
              value={config.menu.retryTemplate}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, retryTemplate: e.target.value } }))}
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Confirmation template</label>
            <textarea
              className="support-form-textarea"
              rows={3}
              value={config.menu.confirmationTemplate}
              onChange={(e) => setConfig((prev) => ({ ...prev, menu: { ...prev.menu, confirmationTemplate: e.target.value } }))}
            />
          </div>
        </SectionCard>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr', gap: '16px', marginTop: '16px' }}>
        <SectionCard
          title="Departamentos oficiais"
          description="Cada binding usa um departamento real da plataforma. Nao existe mais cadastro manual de nome/fila dentro da URA."
          actions={<InfoBadge>{availableDepartments.length} departments ativos</InfoBadge>}
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="support-table">
              <thead>
                <tr>
                  <th>Departamento</th>
                  <th>Filas oficiais</th>
                  <th>Binding URA</th>
                </tr>
              </thead>
              <tbody>
                {availableDepartments.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                      Nenhum departamento oficial ativo encontrado.
                    </td>
                  </tr>
                )}
                {availableDepartments.map((department) => {
                  const binding = bindingMap.get(department.id) || ensureBinding(config, department);
                  const invalidReason = getInvalidReason(invalidBindings, department.id);
                  const queueNames = Array.isArray(department.queueNames) ? department.queueNames : [];
                  return (
                    <tr key={department.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <strong>{department.name}</strong>
                          <span className="text-xs text-text-secondary">{department.id}</span>
                          {invalidReason ? <InfoBadge tone="error">{invalidReason}</InfoBadge> : null}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px' }}>
                          {queueNames.length === 0 ? (
                            <InfoBadge tone="warning">Departamento sem fila operacional vinculada</InfoBadge>
                          ) : (
                            <>
                              <span className="text-sm text-text-secondary">{queueNames.join(', ')}</span>
                              <select
                                className="support-form-select"
                                value={binding.defaultQueueName || ''}
                                onChange={(e) => setConfig((prev) => updateBindingState(prev, department, { defaultQueueName: e.target.value }))}
                              >
                                <option value="">Selecione a fila padrao da URA</option>
                                {queueNames.map((queueName) => (
                                  <option key={queueName} value={queueName}>{queueName}</option>
                                ))}
                              </select>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', minWidth: '430px' }}>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={binding.enabled === true}
                              disabled={queueNames.length === 0}
                              onChange={(e) => setConfig((prev) => updateBindingState(prev, department, { enabled: e.target.checked }))}
                            />
                            <span>Habilitado na URA</span>
                          </label>
                          <input
                            className="support-form-input"
                            placeholder="Rotulo do menu"
                            value={binding.menuLabel || ''}
                            onChange={(e) => setConfig((prev) => updateBindingState(prev, department, { menuLabel: e.target.value }))}
                          />
                          <input
                            className="support-form-input"
                            placeholder="Descricao do menu"
                            value={binding.menuDescription || ''}
                            onChange={(e) => setConfig((prev) => updateBindingState(prev, department, { menuDescription: e.target.value }))}
                          />
                          <input
                            className="support-form-input"
                            type="number"
                            placeholder="Ordem"
                            value={binding.menuOrder ?? ''}
                            onChange={(e) => setConfig((prev) => updateBindingState(prev, department, { menuOrder: Number(e.target.value) || 0 }))}
                          />
                          <input
                            className="support-form-input"
                            placeholder="Aliases separados por virgula"
                            value={aliasesToText(binding.aliases)}
                            onChange={(e) => setConfig((prev) => updateBindingState(prev, department, { aliases: normalizeAliases(e.target.value) }))}
                          />
                          <select
                            className="support-form-select"
                            value={binding.queueStrategy || 'default'}
                            onChange={(e) => setConfig((prev) => updateBindingState(prev, department, { queueStrategy: e.target.value }))}
                          >
                            <option value="default">default</option>
                            <option value="department_default">department_default</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="Regras por keyword"
          description="As regras apontam para departmentId oficial. Matching usa texto normalizado e ordenacao por prioridade decrescente."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <input
              className="support-form-input"
              placeholder="Keyword"
              value={ruleDraft.keyword}
              onChange={(e) => setRuleDraft((prev) => ({ ...prev, keyword: e.target.value }))}
            />
            <select
              className="support-form-select"
              value={ruleDraft.departmentId}
              onChange={(e) => setRuleDraft((prev) => ({ ...prev, departmentId: e.target.value }))}
            >
              <option value="">Selecione um departamento</option>
              {availableDepartments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
            <input
              className="support-form-input"
              type="number"
              value={ruleDraft.priority}
              onChange={(e) => setRuleDraft((prev) => ({ ...prev, priority: Number(e.target.value) || 0 }))}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={ruleDraft.enabled}
                onChange={(e) => setRuleDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              <span>Ativa</span>
            </label>
            <Button onClick={addRule} className="support-button">Adicionar regra</Button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="support-table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Departamento</th>
                  <th>Prioridade</th>
                  <th>Status</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {(config.rules || []).length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                      Nenhuma regra configurada.
                    </td>
                  </tr>
                )}
                {(config.rules || []).map((rule, index) => {
                  const invalid = invalidRules.find((item) => item.id === rule.id);
                  return (
                    <tr key={rule.id || `${rule.keyword}-${index}`}>
                      <td>
                        <input
                          className="support-form-input"
                          value={rule.keyword}
                          onChange={(e) => updateRule(index, { keyword: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="support-form-select"
                          value={rule.departmentId}
                          onChange={(e) => updateRule(index, { departmentId: e.target.value })}
                        >
                          <option value="">Selecione</option>
                          {availableDepartments.map((department) => (
                            <option key={department.id} value={department.id}>{department.name}</option>
                          ))}
                        </select>
                        {invalid ? <div style={{ marginTop: '8px' }}><InfoBadge tone="error">Departamento invalido ou inativo</InfoBadge></div> : null}
                      </td>
                      <td>
                        <input
                          className="support-form-input"
                          type="number"
                          value={rule.priority}
                          onChange={(e) => updateRule(index, { priority: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={rule.enabled !== false}
                            onChange={(e) => updateRule(index, { enabled: e.target.checked })}
                          />
                          <span>{rule.enabled !== false ? 'Ativa' : 'Inativa'}</span>
                        </label>
                      </td>
                      <td>
                        <Button onClick={() => removeRule(index)} className="support-button">Remover</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mt-6 shadow-lg" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <strong>Queues oficiais carregadas:</strong>{' '}
          <span className="text-sm text-text-secondary">{availableQueues.length > 0 ? availableQueues.join(', ') : 'nenhuma fila oficial disponivel'}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <InfoBadge>{(config.departmentBindings || []).filter((item) => item.enabled).length} bindings ativos</InfoBadge>
          <InfoBadge>{(config.rules || []).filter((item) => item.enabled !== false).length} regras ativas</InfoBadge>
          {(loading || saving) ? <InfoBadge tone="warning">{saving ? 'salvando' : 'carregando'}</InfoBadge> : null}
        </div>
      </div>
    </div>
  );
}
