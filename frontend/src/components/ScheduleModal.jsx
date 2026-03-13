import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createSchedule, getScheduleAvailability } from '../api/scheduling';
import { useToast } from './Toast';
import { AutocompleteDropdown } from './AutocompleteDropdown';
import { listSchedulePurposes, searchScheduleTeams, searchScheduleUsers } from '../api/scheduleLookups';
import { getBasePath } from '../utils';
import {
  DEFAULT_SCHEDULING_PRESET_ID,
  getSchedulingPresetById,
  schedulingPresets,
  SCHEDULING_PRESET_IDS,
} from '../features/scheduling/schedulingPresets';
import { suggestSchedulingPreset } from '../features/scheduling/suggestPreset';

const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'voice', label: 'Voz' },
  { value: 'email', label: 'E-mail' },
  { value: 'internal', label: 'Interno' },
  { value: 'system', label: 'Sistema' },
];

const CONTEXT_TYPES = [
  { value: 'ticket', label: 'Ticket' },
  { value: 'crm', label: 'CRM' },
  { value: 'task', label: 'Tarefa' },
  { value: 'system', label: 'Sistema' },
  { value: 'custom', label: 'Customizado' },
];

const TIMEZONES = [
  'UTC',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
];

function toIsoFromLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function shouldApplyDefault(currentValue, baselineValue) {
  if (isEmptyValue(currentValue)) return true;
  return baselineValue !== undefined && currentValue === baselineValue;
}

function buildInitialForm({
  contextType,
  contextId,
  contactId,
  conversationId,
  defaultChannel,
  defaultTimezone,
  defaultPurpose,
  defaultNotes,
}) {
  return {
    contextType,
    contextId,
    contactId: contactId || '',
    conversationId: conversationId || '',
    channel: defaultChannel,
    mode: 'free',
    startLocal: '',
    durationMinutes: 30,
    timezone: defaultTimezone,
    requiresConfirmation: true,
    purpose: defaultPurpose,
    notes: defaultNotes,
    ownerId: '',
    teamId: '',
    origin: 'human',
    reminder24h: true,
    reminder1h: true,
    noShow10m: true,
    presetId: DEFAULT_SCHEDULING_PRESET_ID,
    confirmationTimeoutMinutes: '',
    timeWindowStart: '',
    timeWindowEnd: '',
    priority: 'normal',
    allowAutoReschedule: true,
    whenImmediate: false,
    metadata: {},
  };
}

function applyPresetDefaults(current, preset, baseline) {
  if (!preset) return current;

  const next = { ...current };
  Object.entries(preset.defaults || {}).forEach(([key, value]) => {
    if (shouldApplyDefault(next[key], baseline?.[key])) {
      next[key] = value;
    }
  });

  if (preset.metadataDefaults) {
    if (Object.prototype.hasOwnProperty.call(preset.metadataDefaults, 'confirmationTimeoutMinutes')) {
      if (shouldApplyDefault(next.confirmationTimeoutMinutes, baseline?.confirmationTimeoutMinutes)) {
        next.confirmationTimeoutMinutes = String(preset.metadataDefaults.confirmationTimeoutMinutes);
      }
    }
    if (Object.prototype.hasOwnProperty.call(preset.metadataDefaults, 'priority')) {
      if (shouldApplyDefault(next.priority, baseline?.priority)) {
        next.priority = preset.metadataDefaults.priority;
      }
    }
    if (Object.prototype.hasOwnProperty.call(preset.metadataDefaults, 'allowAutoReschedule')) {
      if (shouldApplyDefault(next.allowAutoReschedule, baseline?.allowAutoReschedule)) {
        next.allowAutoReschedule = !!preset.metadataDefaults.allowAutoReschedule;
      }
    }
  }

  if (
    preset.id === SCHEDULING_PRESET_IDS.INTELIGENTE_IA_DECIDE
    && !next.timeWindowStart
    && next.startLocal
  ) {
    next.timeWindowStart = next.startLocal;
  }

  if (
    preset.id === SCHEDULING_PRESET_IDS.INTELIGENTE_IA_DECIDE
    && !next.timeWindowEnd
    && next.startLocal
  ) {
    const startIso = toIsoFromLocal(next.startLocal);
    const duration = Math.max(5, Number(next.durationMinutes) || 30);
    if (startIso) {
      next.timeWindowEnd = new Date(new Date(startIso).getTime() + duration * 60 * 1000).toISOString().slice(0, 16);
    }
  }

  return next;
}

function buildReferenceSnapshot({
  contextType,
  contextId,
  contactId,
  conversationId,
  defaultChannel,
}) {
  return {
    contextType: String(contextType || '').trim(),
    contextId: String(contextId || '').trim(),
    contactId: String(contactId || '').trim(),
    conversationId: String(conversationId || '').trim(),
    channel: String(defaultChannel || '').trim(),
  };
}

function mapScheduleApiErrorMessage(err) {
  const code = String(err?.body?.code || err?.code || '').trim().toLowerCase();
  if (code === 'owner_not_found') return 'Responsável não encontrado.';
  if (code === 'team_not_found') return 'Equipe não encontrada.';
  if (code === 'owner_not_allowed') return 'Você não tem permissão para atribuir este responsável.';
  if (code === 'team_not_allowed') return 'Você não tem permissão para atribuir esta equipe.';
  if (code === 'owner_not_allowed_for_bot') return 'Agendamento automático não pode definir responsável diretamente.';
  if (code === 'team_or_owner_required' || code === 'team_or_owner_required_for_team_based') return 'Informe ao menos Equipe ou Responsável.';
  return err?.message || 'Erro ao criar agendamento.';
}

export function ScheduleModal({
  isOpen,
  onClose,
  onCreated,
  contextType = 'custom',
  contextId = '',
  contactId = '',
  conversationId = '',
  defaultPurpose = 'retorno',
  defaultNotes = '',
  defaultChannel = 'internal',
  defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  title = 'Novo Agendamento',
  suggestionMessages = [],
  lockReferences = false,
}) {
  const { showToast } = useToast();
  const initialForm = useMemo(() => buildInitialForm({
    contextType,
    contextId,
    contactId,
    conversationId,
    defaultChannel,
    defaultTimezone,
    defaultPurpose,
    defaultNotes,
  }), [
    contextType,
    contextId,
    contactId,
    conversationId,
    defaultChannel,
    defaultTimezone,
    defaultPurpose,
    defaultNotes,
  ]);

  const [form, setForm] = useState(() => {
    const preset = getSchedulingPresetById(DEFAULT_SCHEDULING_PRESET_ID);
    return applyPresetDefaults(initialForm, preset, initialForm);
  });
  const [saving, setSaving] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [error, setError] = useState('');
  const [autoSuggestionApplied, setAutoSuggestionApplied] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [purposeSearch, setPurposeSearch] = useState('');
  const [manualOwnerId, setManualOwnerId] = useState(false);
  const [manualTeamId, setManualTeamId] = useState(false);
  const lockedRefsRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      lockedRefsRef.current = buildReferenceSnapshot({
        contextType,
        contextId,
        contactId,
        conversationId,
        defaultChannel,
      });
    } else if (!isOpen) {
      lockedRefsRef.current = null;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, contextType, contextId, contactId, conversationId, defaultChannel]);

  useEffect(() => {
    if (!isOpen) return;
    setOwnerSearch('');
    setTeamSearch('');
    setPurposeSearch(String(defaultPurpose || ''));
    setManualOwnerId(false);
    setManualTeamId(false);
  }, [isOpen, defaultPurpose]);

  const lockedRefs = useMemo(() => {
    if (!lockReferences) return null;
    return lockedRefsRef.current || buildReferenceSnapshot({
      contextType,
      contextId,
      contactId,
      conversationId,
      defaultChannel,
    });
  }, [lockReferences, contextType, contextId, contactId, conversationId, defaultChannel]);

  const selectedPreset = useMemo(
    () => getSchedulingPresetById(form.presetId),
    [form.presetId],
  );

  const suggestion = useMemo(() => suggestSchedulingPreset({
    messages: suggestionMessages,
    contextType,
    purpose: defaultPurpose,
    notes: defaultNotes,
    channel: defaultChannel,
  }), [suggestionMessages, contextType, defaultPurpose, defaultNotes, defaultChannel]);

  useEffect(() => {
    if (!isOpen || autoSuggestionApplied) return;
    if (!suggestion || Number(suggestion.confidence) < 0.7) return;
    const preset = getSchedulingPresetById(suggestion.suggestedPreset);
    if (!preset) return;

    setForm((prev) => applyPresetDefaults({ ...prev, presetId: preset.id }, preset, initialForm));
    setAutoSuggestionApplied(true);
  }, [isOpen, autoSuggestionApplied, suggestion, initialForm]);

  const isFieldVisible = (field) => {
    if (!selectedPreset) return true;
    return (selectedPreset.visibleFields || []).includes(field);
  };

  const isFieldRequired = (field) => {
    if (!selectedPreset) return false;
    return (selectedPreset.requiredFields || []).includes(field);
  };

  const endLocal = useMemo(() => {
    const start = toIsoFromLocal(form.startLocal);
    if (!start) return '';
    const endDate = new Date(new Date(start).getTime() + (Number(form.durationMinutes) || 0) * 60 * 1000);
    if (Number.isNaN(endDate.getTime())) return '';
    return endDate.toISOString();
  }, [form.startLocal, form.durationMinutes]);

  if (!isOpen) return null;

  function handlePresetChange(nextPresetId) {
    const nextPreset = getSchedulingPresetById(nextPresetId);
    setForm((prev) => applyPresetDefaults({ ...prev, presetId: nextPresetId }, nextPreset, initialForm));
    setAutoSuggestionApplied(true);
    setAvailability(null);
    setError('');
  }

  async function loadOwnerOptions(query) {
    return searchScheduleUsers(query, 10).then((items) => items.map((item) => ({
      id: String(item.id || ''),
      label: item.name || item.email || item.id,
      subLabel: [item.email, item.status].filter(Boolean).join(' • '),
      raw: item,
    })));
  }

  async function loadTeamOptions(query) {
    return searchScheduleTeams(query, 20).then((items) => items.map((item) => ({
      id: String(item.id || ''),
      label: item.name || item.id,
      subLabel: item.description || '',
      raw: item,
    })));
  }

  async function loadPurposeOptions(query) {
    return listSchedulePurposes(query, 20).then((items) => items.map((item) => ({
      value: String(item?.value || item?.label || '').trim(),
      label: String(item?.label || item?.value || '').trim(),
    })).filter((item) => item.value));
  }

  function resolveStartAtForSubmit() {
    if (form.presetId === SCHEDULING_PRESET_IDS.PROCESSO_AUTOMATICO && form.whenImmediate) {
      return new Date().toISOString();
    }

    if (isFieldVisible('timeWindowStart') && form.timeWindowStart) {
      return toIsoFromLocal(form.timeWindowStart);
    }

    return toIsoFromLocal(form.startLocal);
  }

  async function handleCheckAvailability() {
    setError('');
    setAvailability(null);

    const startAt = resolveStartAtForSubmit();
    if (!startAt) {
      setError('Informe uma data/hora válida.');
      return;
    }
    const duration = Math.max(5, Number(form.durationMinutes) || 30);
    const endAt = new Date(new Date(startAt).getTime() + duration * 60 * 1000).toISOString();

    setCheckingAvailability(true);
    try {
      const out = await getScheduleAvailability({
        mode: form.mode,
        startAt,
        endAt,
        ownerId: form.ownerId || undefined,
        teamId: form.teamId || undefined,
        timezone: form.timezone || 'UTC',
      });
      setAvailability(out);
    } catch (err) {
      setError(err?.message || 'Erro ao consultar disponibilidade.');
    } finally {
      setCheckingAvailability(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setAvailability(null);

    const refs = lockReferences ? (lockedRefs || {}) : form;
    const refsContextType = String(refs.contextType || '').trim();
    const refsContextId = String(refs.contextId || '').trim();
    const refsContactId = String(refs.contactId || '').trim();
    const refsConversationId = String(refs.conversationId || '').trim();
    const refsChannel = String(refs.channel || '').trim();

    const needsDateTime = isFieldRequired('date') || isFieldRequired('time');
    const needsWindow = isFieldRequired('timeWindowStart') || isFieldRequired('timeWindowEnd');

    if (lockReferences) {
      if (!refsContextType || !refsContextId) {
        const message = 'Contexto inválido.';
        setError(message);
        showToast(message, 'error');
        return;
      }
      if (!refsConversationId) {
        const message = 'Agendamento de conversa exige ID da conversa.';
        setError(message);
        showToast(message, 'error');
        return;
      }
      if (!refsChannel) {
        const message = 'Contexto inválido.';
        setError(message);
        showToast(message, 'error');
        return;
      }
    }

    if (!lockReferences && !refsContextId) {
      setError('ID do contexto é obrigatório.');
      return;
    }

    if (isFieldRequired('channel') && !refsChannel) {
      setError('Canal é obrigatório.');
      return;
    }

    if (needsWindow) {
      const wStart = toIsoFromLocal(form.timeWindowStart);
      const wEnd = toIsoFromLocal(form.timeWindowEnd);
      if (!wStart || !wEnd) {
        setError('Informe a janela de horário (início/fim).');
        return;
      }
      if (new Date(wEnd).getTime() <= new Date(wStart).getTime()) {
        setError('A janela deve ter fim maior que início.');
        return;
      }
    }

    if (needsDateTime && !(form.presetId === SCHEDULING_PRESET_IDS.PROCESSO_AUTOMATICO && form.whenImmediate)) {
      const startAtCheck = resolveStartAtForSubmit();
      if (!startAtCheck) {
        setError('Informe data/hora inicial.');
        return;
      }
    }

    if (isFieldRequired('durationMinutes')) {
      const durationCheck = Number(form.durationMinutes);
      if (!Number.isFinite(durationCheck) || durationCheck < 5) {
        setError('Duração deve ser maior ou igual a 5 minutos.');
        return;
      }
    }

    if (!manualOwnerId && ownerSearch.trim() && !form.ownerId.trim()) {
      const message = 'Selecione um item da lista.';
      setError(message);
      showToast(message, 'warning');
      return;
    }

    if (!manualTeamId && teamSearch.trim() && !form.teamId.trim()) {
      const message = 'Selecione um item da lista.';
      setError(message);
      showToast(message, 'warning');
      return;
    }

    if ((form.mode === 'team_based' || isFieldRequired('teamOrOwner')) && !form.ownerId.trim() && !form.teamId.trim()) {
      setError('Informe ao menos Equipe ou Responsável.');
      return;
    }

    if (isFieldRequired('purposeOrNotes') && !form.purpose.trim() && !form.notes.trim()) {
      setError('Informe finalidade ou notas para este tipo de agendamento.');
      return;
    }

    const startAt = resolveStartAtForSubmit();
    if (!startAt) {
      setError('Informe uma data/hora válida.');
      return;
    }

    const duration = Math.max(5, Number(form.durationMinutes) || 30);
    const endAt = new Date(new Date(startAt).getTime() + duration * 60 * 1000).toISOString();

    const reminders = [];
    if (form.reminder24h && form.requiresConfirmation) reminders.push({ offsetMinutes: -24 * 60, action: 'request_confirmation' });
    if (form.reminder1h) reminders.push({ offsetMinutes: -60, action: 'notify' });
    if (form.noShow10m) reminders.push({ offsetMinutes: 10, action: 'mark_no_show' });

    const metadata = {
      ...(form.metadata && typeof form.metadata === 'object' ? form.metadata : {}),
    };

    if (selectedPreset?.id) {
      metadata.schedulingPresetId = selectedPreset.id;
    }

    if (isFieldVisible('confirmationTimeout')) {
      const timeout = Number(form.confirmationTimeoutMinutes);
      if (Number.isFinite(timeout) && timeout > 0) {
        metadata.confirmationTimeoutMinutes = Math.trunc(timeout);
      }
    }

    const windowStart = toIsoFromLocal(form.timeWindowStart);
    const windowEnd = toIsoFromLocal(form.timeWindowEnd);
    if (windowStart || windowEnd) {
      metadata.window = {
        startAt: windowStart || null,
        endAt: windowEnd || null,
      };
    }

    if (isFieldVisible('priority') && form.priority) {
      metadata.priority = form.priority;
    }

    if (isFieldVisible('allowAutoReschedule')) {
      metadata.allowAutoReschedule = !!form.allowAutoReschedule;
    }

    setSaving(true);
    try {
      const payload = {
        contextType: refsContextType,
        contextId: refsContextId,
        contactId: refsContactId || null,
        conversationId: refsConversationId || null,
        channel: refsChannel,
        mode: form.mode,
        startAt,
        endAt,
        timezone: form.timezone || 'UTC',
        requiresConfirmation: !!form.requiresConfirmation,
        ownerId: form.mode === 'team_based' ? (form.ownerId.trim() || null) : null,
        teamId: form.mode === 'team_based' ? (form.teamId.trim() || null) : null,
        purpose: (purposeSearch || form.purpose).trim() || 'compromisso',
        notes: form.notes.trim() || null,
        origin: form.origin || 'human',
        reminders,
      };

      if (Object.keys(metadata).length > 0) {
        payload.metadata = metadata;
      }

      const out = await createSchedule(payload);
      if (onCreated) onCreated(out?.schedule || null, out);
      onClose();
    } catch (err) {
      const details = err?.body?.details;
      if (details && details.available === false) {
        setAvailability(details);
      }
      setError(mapScheduleApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const showDateTime = isFieldVisible('date') || isFieldVisible('time');
  const showTeamScope = form.mode === 'team_based' && (isFieldVisible('ownerId') || isFieldVisible('teamId'));
  const suggestionVisible = suggestion && Number(suggestion.confidence) >= 0.7;
  const timezoneOptions = useMemo(() => {
    const current = String(form.timezone || '').trim();
    if (!current || TIMEZONES.includes(current)) return TIMEZONES;
    return [current, ...TIMEZONES];
  }, [form.timezone]);
  const ownerAgendaUrl = useMemo(() => {
    const ownerId = String(form.ownerId || '').trim();
    if (!ownerId) return '';
    const basePath = getBasePath();
    return `${basePath}/agenda/${encodeURIComponent(ownerId)}`;
  }, [form.ownerId]);

  return (
    <div className="support-modal-overlay" onClick={onClose}>
      <div className="support-modal-content" onClick={(evt) => evt.stopPropagation()} style={{ maxWidth: '720px', width: '96%' }}>
        <h3 style={{ marginBottom: '12px', fontWeight: 700 }}>{title}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="support-form-group">
            <label className="support-form-label">Tipo de agendamento</label>
            <select
              className="support-form-select"
              value={form.presetId}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {schedulingPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
            {selectedPreset?.description ? (
              <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>
                {selectedPreset.description}
              </div>
            ) : null}
            {suggestionVisible ? (
              <div className="text-xs" style={{ marginTop: '6px', color: 'var(--color-status-success)' }}>
                Sugestão IA: {suggestion.reason} ({Math.round(Number(suggestion.confidence) * 100)}%)
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="support-form-group">
              <label className="support-form-label">Tipo de contexto</label>
              <select
                className="support-form-select"
                value={form.contextType}
                onChange={(e) => setForm((p) => ({ ...p, contextType: e.target.value }))}
                disabled={lockReferences}
              >
                {CONTEXT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {lockReferences ? <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>Campo definido pela conversa de origem.</div> : null}
            </div>
            <div className="support-form-group">
              <label className="support-form-label">ID do contexto</label>
              <input
                className="support-form-input"
                value={form.contextId}
                onChange={(e) => setForm((p) => ({ ...p, contextId: e.target.value }))}
                placeholder="ticket-123 / oportunidade-456 / tarefa-789"
                required
                readOnly={lockReferences}
              />
              {lockReferences ? <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>Campo definido pela conversa de origem.</div> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {isFieldVisible('channel') ? (
              <div className="support-form-group">
                <label className="support-form-label">Canal</label>
                <select
                  className="support-form-select"
                  value={form.channel}
                  onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value }))}
                  disabled={lockReferences}
                >
                  {CHANNELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {lockReferences ? <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>Campo definido pela conversa de origem.</div> : null}
              </div>
            ) : null}
            {isFieldVisible('purpose') ? (
              <div className="support-form-group">
                <label className="support-form-label">Finalidade</label>
                <AutocompleteDropdown
                  value={purposeSearch}
                  onInputChange={(value) => {
                    setPurposeSearch(value);
                    setForm((p) => ({ ...p, purpose: value }));
                  }}
                  onSelect={(item) => {
                    const value = String(item?.value || item?.label || '').trim();
                    setPurposeSearch(value);
                    setForm((p) => ({ ...p, purpose: value }));
                  }}
                  fetchOptions={loadPurposeOptions}
                  placeholder="Buscar finalidade..."
                  minChars={1}
                  ariaLabel="Finalidade"
                />
              </div>
            ) : null}
          </div>

          {showDateTime ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="support-form-group">
                <label className="support-form-label">Data/Hora inicial</label>
                <input
                  className="support-form-input"
                  type="datetime-local"
                  value={form.startLocal}
                  onChange={(e) => setForm((p) => ({ ...p, startLocal: e.target.value }))}
                  required={isFieldRequired('date') || isFieldRequired('time')}
                />
              </div>
              {isFieldVisible('durationMinutes') ? (
                <div className="support-form-group">
                  <label className="support-form-label">Duração (min)</label>
                  <input
                    className="support-form-input"
                    type="number"
                    min={5}
                    value={form.durationMinutes}
                    onChange={(e) => setForm((p) => ({ ...p, durationMinutes: e.target.value }))}
                  />
                </div>
              ) : <div />}
              <div className="support-form-group">
                <label className="support-form-label">Fuso horário</label>
                <select
                  className="support-form-select"
                  value={form.timezone}
                  onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                >
                  {timezoneOptions.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {isFieldVisible('when') ? (
            <div className="support-form-group">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.whenImmediate}
                  onChange={(e) => setForm((p) => ({ ...p, whenImmediate: e.target.checked }))}
                />
                Executar imediatamente (se desmarcado, usa data/hora)
              </label>
            </div>
          ) : null}

          {(isFieldVisible('timeWindowStart') || isFieldVisible('timeWindowEnd')) ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="support-form-group">
                <label className="support-form-label">Janela início</label>
                <input
                  className="support-form-input"
                  type="datetime-local"
                  value={form.timeWindowStart}
                  onChange={(e) => setForm((p) => ({ ...p, timeWindowStart: e.target.value }))}
                  required={isFieldRequired('timeWindowStart')}
                />
              </div>
              <div className="support-form-group">
                <label className="support-form-label">Janela fim</label>
                <input
                  className="support-form-input"
                  type="datetime-local"
                  value={form.timeWindowEnd}
                  onChange={(e) => setForm((p) => ({ ...p, timeWindowEnd: e.target.value }))}
                  required={isFieldRequired('timeWindowEnd')}
                />
              </div>
            </div>
          ) : null}

          {(isFieldVisible('mode') || isFieldVisible('requiresConfirmation') || isFieldVisible('origin')) ? (
            <div className="support-form-group">
              <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                {isFieldVisible('mode') ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.mode === 'team_based'}
                      onChange={(e) => setForm((p) => ({ ...p, mode: e.target.checked ? 'team_based' : 'free' }))}
                    />
                    Usar agenda da equipe
                  </label>
                ) : null}
                {isFieldVisible('requiresConfirmation') ? (
                  selectedPreset?.id === SCHEDULING_PRESET_IDS.COM_CONFIRMACAO ? (
                    <span className="text-sm text-text-secondary">Confirmação obrigatória (fixa)</span>
                  ) : (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!form.requiresConfirmation}
                        onChange={(e) => setForm((p) => ({ ...p, requiresConfirmation: e.target.checked }))}
                      />
                      Exigir confirmação
                    </label>
                  )
                ) : null}
                {isFieldVisible('origin') ? (
                  <label className="flex items-center gap-2 text-sm">
                    <span>Origem</span>
                    <select
                      className="support-form-select"
                      value={form.origin}
                      onChange={(e) => setForm((p) => ({ ...p, origin: e.target.value }))}
                      style={{ minWidth: '120px' }}
                    >
                      <option value="human">Humano</option>
                      <option value="bot">Bot</option>
                      <option value="system">Sistema</option>
                    </select>
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}

          {showTeamScope ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {isFieldVisible('ownerId') ? (
                <div className="support-form-group">
                  <label className="support-form-label">Responsável</label>
                  {!manualOwnerId ? (
                    <>
                      <AutocompleteDropdown
                        value={ownerSearch}
                        onInputChange={(value) => {
                          setOwnerSearch(value);
                          setForm((p) => ({ ...p, ownerId: '' }));
                        }}
                        onSelect={(item) => {
                          const id = String(item?.id || '').trim();
                          const label = String(item?.label || '').trim();
                          setOwnerSearch(label);
                          setForm((p) => ({ ...p, ownerId: id }));
                        }}
                        fetchOptions={loadOwnerOptions}
                        placeholder="Buscar por nome ou email"
                        ariaLabel="Responsável"
                      />
                      {form.ownerId ? (
                        <button
                          type="button"
                          className="btn-base btn-default"
                          style={{ marginTop: '6px', width: 'auto', padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => {
                            setOwnerSearch('');
                            setForm((p) => ({ ...p, ownerId: '' }));
                          }}
                        >
                          Limpar seleção
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <input
                      className="support-form-input"
                      value={form.ownerId}
                      onChange={(e) => setForm((p) => ({ ...p, ownerId: e.target.value }))}
                      placeholder="agent-uuid"
                    />
                  )}
                  <label className="flex items-center gap-2 text-xs" style={{ marginTop: '6px' }}>
                    <input
                      type="checkbox"
                      checked={manualOwnerId}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setManualOwnerId(checked);
                        if (!checked) {
                          setForm((p) => ({ ...p, ownerId: '' }));
                          setOwnerSearch('');
                        } else {
                          setOwnerSearch('');
                        }
                      }}
                    />
                    Digitar ID
                  </label>
                </div>
              ) : null}
              {isFieldVisible('teamId') ? (
                <div className="support-form-group">
                  <label className="support-form-label">Equipe</label>
                  {!manualTeamId ? (
                    <>
                      <AutocompleteDropdown
                        value={teamSearch}
                        onInputChange={(value) => {
                          setTeamSearch(value);
                          setForm((p) => ({ ...p, teamId: '' }));
                        }}
                        onSelect={(item) => {
                          const id = String(item?.id || '').trim();
                          const label = String(item?.label || '').trim();
                          setTeamSearch(label);
                          setForm((p) => ({ ...p, teamId: id }));
                        }}
                        fetchOptions={loadTeamOptions}
                        placeholder="Buscar equipe"
                        ariaLabel="Equipe"
                      />
                      {form.teamId ? (
                        <button
                          type="button"
                          className="btn-base btn-default"
                          style={{ marginTop: '6px', width: 'auto', padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => {
                            setTeamSearch('');
                            setForm((p) => ({ ...p, teamId: '' }));
                          }}
                        >
                          Limpar seleção
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <input
                      className="support-form-input"
                      value={form.teamId}
                      onChange={(e) => setForm((p) => ({ ...p, teamId: e.target.value }))}
                      placeholder="team-support"
                    />
                  )}
                  <label className="flex items-center gap-2 text-xs" style={{ marginTop: '6px' }}>
                    <input
                      type="checkbox"
                      checked={manualTeamId}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setManualTeamId(checked);
                        if (!checked) {
                          setForm((p) => ({ ...p, teamId: '' }));
                          setTeamSearch('');
                        } else {
                          setTeamSearch('');
                        }
                      }}
                    />
                    Digitar ID
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {(isFieldVisible('confirmationTimeout') || isFieldVisible('priority') || isFieldVisible('allowAutoReschedule')) ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {isFieldVisible('confirmationTimeout') ? (
                <div className="support-form-group">
                  <label className="support-form-label">Timeout confirmação (min)</label>
                  <input
                    className="support-form-input"
                    type="number"
                    min={1}
                    value={form.confirmationTimeoutMinutes}
                    onChange={(e) => setForm((p) => ({ ...p, confirmationTimeoutMinutes: e.target.value }))}
                  />
                </div>
              ) : null}
              {isFieldVisible('priority') ? (
                <div className="support-form-group">
                  <label className="support-form-label">Prioridade</label>
                  <select
                    className="support-form-select"
                    value={form.priority}
                    onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">Alta</option>
                    <option value="critical">Crítica</option>
                  </select>
                </div>
              ) : null}
              {isFieldVisible('allowAutoReschedule') ? (
                <div className="support-form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!form.allowAutoReschedule}
                      onChange={(e) => setForm((p) => ({ ...p, allowAutoReschedule: e.target.checked }))}
                    />
                    Permitir auto-reagendamento
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="support-form-group">
              <label className="support-form-label">ID do contato</label>
              <input
                className="support-form-input"
                value={form.contactId}
                onChange={(e) => setForm((p) => ({ ...p, contactId: e.target.value }))}
                placeholder="opcional"
                readOnly={lockReferences}
              />
              {lockReferences ? <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>Campo definido pela conversa de origem.</div> : null}
            </div>
            <div className="support-form-group">
              <label className="support-form-label">ID da conversa</label>
              <input
                className="support-form-input"
                value={form.conversationId}
                onChange={(e) => setForm((p) => ({ ...p, conversationId: e.target.value }))}
                placeholder="opcional"
                readOnly={lockReferences}
              />
              {lockReferences ? <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>Campo definido pela conversa de origem.</div> : null}
            </div>
          </div>

          {isFieldVisible('notes') ? (
            <div className="support-form-group">
              <label className="support-form-label">Notas</label>
              <textarea
                className="support-form-textarea"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          ) : null}

          {isFieldVisible('reminders') ? (
            <div className="support-form-group">
              <label className="support-form-label">Lembretes</label>
              <div className="flex items-center gap-3 text-sm" style={{ flexWrap: 'wrap' }}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.reminder24h}
                    onChange={(e) => setForm((p) => ({ ...p, reminder24h: e.target.checked }))}
                  />
                  -24h pedir confirmação
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.reminder1h}
                    onChange={(e) => setForm((p) => ({ ...p, reminder1h: e.target.checked }))}
                  />
                  -1h notificar
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.noShow10m}
                    onChange={(e) => setForm((p) => ({ ...p, noShow10m: e.target.checked }))}
                  />
                  +10m marcar falta
                </label>
              </div>
            </div>
          ) : null}

          {endLocal ? (
            <div className="text-xs text-text-tertiary">
              Fim previsto: {new Date(endLocal).toLocaleString('pt-BR')}
            </div>
          ) : null}

          {availability ? (
            <div
              style={{
                border: `1px solid ${availability.available ? 'var(--color-status-success)' : 'var(--color-status-error)'}`,
                borderRadius: '8px',
                padding: '10px',
                background: availability.available ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                fontSize: '12px',
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {availability.available ? 'Disponível' : 'Indisponível'}
              </div>
              {!availability.available && Array.isArray(availability.reasons) ? (
                <div style={{ marginTop: '6px' }}>
                  Motivos: {availability.reasons.join(', ')}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                border: '1px solid var(--color-status-error)',
                borderRadius: '8px',
                padding: '10px',
                background: 'rgba(239,68,68,0.08)',
                color: 'var(--color-status-error)',
                fontSize: '12px',
              }}
            >
              {error}
            </div>
          ) : null}

          <div className="flex gap-2 justify-end">
            {ownerAgendaUrl ? (
              <button
                type="button"
                className="btn-base btn-default"
                onClick={() => window.open(ownerAgendaUrl, '_blank', 'noopener,noreferrer')}
                disabled={saving || checkingAvailability}
              >
                Abrir agenda
              </button>
            ) : null}
            <button type="button" className="btn-base btn-default" onClick={onClose} disabled={saving || checkingAvailability}>
              Fechar
            </button>
            <button type="button" className="btn-base btn-default" onClick={handleCheckAvailability} disabled={saving || checkingAvailability}>
              {checkingAvailability ? 'Consultando...' : 'Validar disponibilidade'}
            </button>
            <button type="submit" className="btn-base btn-primary" disabled={saving || checkingAvailability}>
              {saving ? 'Salvando...' : 'Agendar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
