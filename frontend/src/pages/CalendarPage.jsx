import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from '../hooks/useRouter';
import { useAuth } from '../context/authContext';
import { useToast } from '../components/Toast';
import {
  createResourceBlock,
  deleteResourceBlock,
  getMyCalendar,
  getResourceCalendar,
} from '../api/calendar';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toLocalInputValue(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const delta = day === 0 ? -6 : (1 - day);
  d.setDate(d.getDate() + delta);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function mapCalendarError(err) {
  const code = String(err?.body?.code || err?.code || '').trim().toLowerCase();
  if (code === 'block_conflict') return 'Já existe bloqueio no período informado.';
  if (code === 'schedule_conflict') return 'Há agendamento no período informado.';
  if (code === 'calendar_forbidden') return 'Você não tem permissão para esta agenda.';
  if (code === 'invalid_time_range') return 'Período inválido.';
  return err?.message || 'Erro ao processar agenda.';
}

export function CalendarPage() {
  const { currentPath } = useRouter();
  const { agent } = useAuth();
  const { showToast, ToastContainer } = useToast();

  const pathParts = useMemo(
    () => String(currentPath || '').split('?')[0].split('/').filter(Boolean),
    [currentPath],
  );
  const routeResourceId = pathParts[0] === 'agenda' && pathParts[1] ? decodeURIComponent(pathParts[1]) : '';
  const isSelfRoute = !routeResourceId;
  const targetResourceId = routeResourceId || String(agent?.id || '').trim();

  const [viewMode, setViewMode] = useState('week');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [creatingBlock, setCreatingBlock] = useState(false);
  const [removingBlockId, setRemovingBlockId] = useState('');
  const [blockForm, setBlockForm] = useState(() => {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    return {
      startAt: toLocalInputValue(now),
      endAt: toLocalInputValue(end),
      reason: '',
    };
  });

  const range = useMemo(() => {
    const base = viewMode === 'day' ? startOfDay(cursorDate) : startOfWeek(cursorDate);
    const end = addDays(base, viewMode === 'day' ? 1 : 7);
    return {
      start: base,
      end,
      startIso: base.toISOString(),
      endIso: end.toISOString(),
    };
  }, [cursorDate, viewMode]);

  const groupedItems = useMemo(() => {
    const byDay = new Map();
    items.forEach((item) => {
      const start = new Date(item?.startAt || '');
      if (Number.isNaN(start.getTime())) return;
      const key = start.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(item);
    });

    const keys = Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b));
    return keys.map((key) => ({
      day: key,
      items: byDay.get(key).sort((a, b) => (Date.parse(a.startAt || '') || 0) - (Date.parse(b.startAt || '') || 0)),
    }));
  }, [items]);

  const loadCalendar = useCallback(async () => {
    if (!targetResourceId) return;
    setLoading(true);
    setError('');
    try {
      const params = { start: range.startIso, end: range.endIso };
      const out = isSelfRoute
        ? await getMyCalendar(params)
        : await getResourceCalendar(targetResourceId, params);
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (err) {
      const message = mapCalendarError(err);
      setError(message);
      showToast(message, 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [targetResourceId, range.startIso, range.endIso, isSelfRoute, showToast]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  function moveRange(direction) {
    setCursorDate((prev) => addDays(prev, direction * (viewMode === 'day' ? 1 : 7)));
  }

  function resetBlockForm() {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    setBlockForm({
      startAt: toLocalInputValue(now),
      endAt: toLocalInputValue(end),
      reason: '',
    });
  }

  async function handleCreateBlock(e) {
    e.preventDefault();
    if (!targetResourceId) {
      showToast('Recurso inválido.', 'error');
      return;
    }

    const startAt = new Date(blockForm.startAt || '');
    const endAt = new Date(blockForm.endAt || '');
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      showToast('Início e fim são obrigatórios.', 'warning');
      return;
    }
    if (endAt.getTime() <= startAt.getTime()) {
      showToast('O fim deve ser maior que o início.', 'warning');
      return;
    }

    setCreatingBlock(true);
    try {
      await createResourceBlock(targetResourceId, {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        reason: String(blockForm.reason || '').trim() || null,
      });
      showToast('Bloqueio criado.', 'success');
      setShowBlockModal(false);
      resetBlockForm();
      await loadCalendar();
    } catch (err) {
      showToast(mapCalendarError(err), 'error');
    } finally {
      setCreatingBlock(false);
    }
  }

  async function handleRemoveBlock(blockId) {
    if (!targetResourceId || !blockId) return;
    setRemovingBlockId(blockId);
    try {
      await deleteResourceBlock(targetResourceId, blockId);
      showToast('Bloqueio removido.', 'success');
      await loadCalendar();
    } catch (err) {
      showToast(mapCalendarError(err), 'error');
    } finally {
      setRemovingBlockId('');
    }
  }

  const pageTitle = isSelfRoute ? 'Minha agenda' : `Agenda de: ${targetResourceId}`;

  return (
    <div className="space-y-4" style={{ padding: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>{pageTitle}</h2>
          <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>
            Recurso: {targetResourceId || '-'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="support-form-select"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            aria-label="Visão"
            style={{ minWidth: '110px' }}
          >
            <option value="day">Dia</option>
            <option value="week">Semana</option>
          </select>
          <button type="button" className="btn-base btn-default" onClick={() => moveRange(-1)}>Anterior</button>
          <button type="button" className="btn-base btn-default" onClick={() => setCursorDate(new Date())}>Hoje</button>
          <button type="button" className="btn-base btn-default" onClick={() => moveRange(1)}>Próximo</button>
          <button type="button" className="btn-base btn-primary" onClick={() => setShowBlockModal(true)}>Criar bloqueio</button>
        </div>
      </div>

      <div className="text-xs text-text-tertiary">
        Período: {range.start.toLocaleString('pt-BR')} até {range.end.toLocaleString('pt-BR')}
      </div>

      {loading ? <div style={{ fontSize: '13px' }}>Carregando agenda...</div> : null}
      {error ? <div style={{ color: 'var(--color-status-error)', fontSize: '13px' }}>{error}</div> : null}

      {!loading && groupedItems.length === 0 ? (
        <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)' }}>Sem eventos no período.</div>
      ) : null}

      <div className="space-y-3">
        {groupedItems.map((group) => (
          <div key={group.day} style={{ border: '1px solid var(--color-border)', borderRadius: '10px', padding: '10px' }}>
            <div style={{ fontWeight: 700, marginBottom: '8px' }}>
              {new Date(`${group.day}T00:00:00`).toLocaleDateString('pt-BR', {
                weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
              })}
            </div>
            <div className="space-y-2">
              {group.items.map((item, itemIndex) => {
                const startAt = item?.startAt ? new Date(item.startAt).toLocaleString('pt-BR') : '-';
                const endAt = item?.endAt ? new Date(item.endAt).toLocaleString('pt-BR') : '-';
                const isBlock = item?.type === 'block';
                return (
                  <div
                    key={`${item?.type || 'item'}-${item?.id || itemIndex}`}
                    style={{
                      border: `1px solid ${isBlock ? 'var(--color-status-warning)' : 'var(--color-border)'}`,
                      borderRadius: '8px',
                      padding: '8px',
                      background: isBlock ? 'rgba(234,179,8,0.08)' : 'var(--color-bg-secondary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                      <div>
                        <div className="font-semibold">{item?.title || (isBlock ? 'Indisponível' : 'Agendamento')}</div>
                        <div className="text-xs text-text-tertiary">{startAt} - {endAt}</div>
                        {isBlock ? (
                          <div className="text-xs text-text-tertiary">Motivo: {item?.reason || 'não informado'}</div>
                        ) : (
                          <div className="text-xs text-text-tertiary">
                            Contexto: {item?.contextType || '-'} / {item?.contextId || '-'}
                          </div>
                        )}
                      </div>
                      {isBlock ? (
                        <button
                          type="button"
                          className="btn-base btn-default"
                          onClick={() => handleRemoveBlock(item.id)}
                          disabled={removingBlockId === item.id}
                          style={{ width: 'auto', padding: '4px 10px', fontSize: '12px' }}
                        >
                          {removingBlockId === item.id ? 'Removendo...' : 'Remover'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {showBlockModal ? (
        <div className="support-modal-overlay" onClick={() => setShowBlockModal(false)}>
          <div className="support-modal-content" style={{ maxWidth: '520px', width: '96%' }} onClick={(evt) => evt.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Criar bloqueio de indisponibilidade</h3>
            <form onSubmit={handleCreateBlock} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="support-form-group">
                  <label className="support-form-label">Início</label>
                  <input
                    className="support-form-input"
                    type="datetime-local"
                    value={blockForm.startAt}
                    onChange={(e) => setBlockForm((prev) => ({ ...prev, startAt: e.target.value }))}
                    required
                  />
                </div>
                <div className="support-form-group">
                  <label className="support-form-label">Fim</label>
                  <input
                    className="support-form-input"
                    type="datetime-local"
                    value={blockForm.endAt}
                    onChange={(e) => setBlockForm((prev) => ({ ...prev, endAt: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="support-form-group">
                <label className="support-form-label">Motivo</label>
                <textarea
                  className="support-form-textarea"
                  rows={3}
                  value={blockForm.reason}
                  onChange={(e) => setBlockForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="Ex.: atendimento externo"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-base btn-default" onClick={() => setShowBlockModal(false)} disabled={creatingBlock}>
                  Fechar
                </button>
                <button type="submit" className="btn-base btn-primary" disabled={creatingBlock}>
                  {creatingBlock ? 'Salvando...' : 'Criar bloqueio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ToastContainer />
    </div>
  );
}
