import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CrudPageBase } from '../modules/crud-base';
import { useToast } from '../components/Toast';
import {
  getOperatorPanelSnapshot,
  setOperatorAgentStatus,
  setOperatorAgentPauseQueue,
  operatorTransfer,
  operatorCallback,
} from '../api/pbx';
import { usePbxOperatorPanelSSE } from '../hooks/usePbxOperatorPanelSSE';
import logger from '../utils/logger';

function formatDateTime(value, fallback = '-') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('pt-BR');
}

function callBadgeClass(disposition) {
  const value = String(disposition || '').toUpperCase();
  if (!value) return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
  if (value === 'ANSWERED') return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  if (value === 'NO ANSWER' || value === 'BUSY' || value === 'FAILED' || value === 'CONGESTION') {
    return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
  }
  return 'bg-text-tertiary/20 text-text-secondary border border-text-tertiary/40';
}

function directionLabel(direction) {
  const value = String(direction || 'external').toLowerCase();
  if (value === 'inbound') return 'entrada';
  if (value === 'outbound') return 'saida';
  if (value === 'internal') return 'interna';
  return 'externa';
}

function KpiCard({ title, value, detail }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
      <div className="text-xs text-text-secondary mb-1">{title}</div>
      <div className="text-2xl font-semibold text-text-primary">{value}</div>
      {detail ? <div className="text-xs text-text-secondary mt-1">{detail}</div> : null}
    </div>
  );
}

export function PbxOperatorPanelPage() {
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [snapshot, setSnapshot] = useState(null);

  const [filters, setFilters] = useState({
    queueId: '',
    memberRef: '',
    cdrLimit: 60,
    callWindowMinutes: 120,
    activeCallWindowMinutes: 15,
  });

  const [useSSE, setUseSSE] = useState(true);
  const [refreshEverySec, setRefreshEverySec] = useState(10);

  const [busyAgentKey, setBusyAgentKey] = useState('');

  // Modais de ações avançadas
  const [transferModal, setTransferModal] = useState(null); // { agent }
  const [callbackModal, setCallbackModal] = useState(null); // { agent }
  const [transferForm, setTransferForm] = useState({ to: '', context: '' });
  const [callbackForm, setCallbackForm] = useState({ phone: '', note: '' });
  const [actionBusy, setActionBusy] = useState(false);

  // Filtros aplicados (separado de rascunho para estabilizar SSE)
  const [appliedFilters, setAppliedFilters] = useState({
    queueId: '',
    memberRef: '',
    cdrLimit: 60,
    callWindowMinutes: 120,
    activeCallWindowMinutes: 15,
  });

  const handleSnapshot = useCallback((data) => {
    setSnapshot(data || null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  const handleSSEError = useCallback((err) => {
    logger.warn('[PbxOperatorPanelPage] SSE error', err);
  }, []);

  const sseFilters = useMemo(() => ({
    queueId: (appliedFilters.queueId || '').trim() || undefined,
    memberRef: (appliedFilters.memberRef || '').trim() || undefined,
    cdrLimit: Number(appliedFilters.cdrLimit || 60),
    callWindowMinutes: Number(appliedFilters.callWindowMinutes || 120),
    activeCallWindowMinutes: Number(appliedFilters.activeCallWindowMinutes || 15),
  }), [appliedFilters]);

  const { connected: sseConnected, lastUpdated: sseLastUpdated, reconnect: sseReconnect } = usePbxOperatorPanelSSE({
    enabled: useSSE,
    filters: sseFilters,
    intervalSec: Math.max(5, Number(refreshEverySec || 10)),
    maxDurationSec: 300,
    onSnapshot: handleSnapshot,
    onError: handleSSEError,
  });

  const loadSnapshot = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    if (!silent) setError('');

    try {
      const data = await getOperatorPanelSnapshot({
        queueId: (appliedFilters.queueId || '').trim() || undefined,
        memberRef: (appliedFilters.memberRef || '').trim() || undefined,
        cdrLimit: Number(appliedFilters.cdrLimit || 60),
        callWindowMinutes: Number(appliedFilters.callWindowMinutes || 120),
        activeCallWindowMinutes: Number(appliedFilters.activeCallWindowMinutes || 15),
      });

      setSnapshot(data || null);
    } catch (err) {
      logger.error('[PbxOperatorPanelPage] snapshot load failed', err);
      const message = err?.message || 'Erro ao carregar painel operador.';
      if (!silent) {
        setError(message);
        showToast(message, 'error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appliedFilters, showToast]);

  // Polling fallback quando SSE desativado
  useEffect(() => {
    if (useSSE) return undefined;
    loadSnapshot();
  }, [useSSE, loadSnapshot]);

  useEffect(() => {
    if (useSSE) return undefined;
    const ms = Math.max(5, Number(refreshEverySec || 10)) * 1000;
    const timer = setInterval(() => {
      loadSnapshot({ silent: true });
    }, ms);
    return () => clearInterval(timer);
  }, [useSSE, refreshEverySec, loadSnapshot]);

  const summary = snapshot?.summary || {};
  const queues = Array.isArray(snapshot?.queues) ? snapshot.queues : [];
  const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  const calls = Array.isArray(snapshot?.calls) ? snapshot.calls : [];

  const queueOptions = useMemo(() => {
    return queues
      .map((q) => ({
        id: q.queueId,
        label: q.displayName ? `${q.name} - ${q.displayName}` : String(q.name || q.queueId),
      }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [queues]);

  // Pausa/retoma em TODAS as filas
  async function handleToggleAgent(agent) {
    if (!agent?.memberRef) return;
    const nextPaused = !agent.isPaused;
    setBusyAgentKey(String(agent.agentKey || agent.memberRef));

    try {
      await setOperatorAgentStatus({
        memberRef: agent.memberRef,
        memberType: agent.memberType,
        paused: nextPaused,
      });
      showToast(nextPaused ? 'Operador pausado em todas as filas.' : 'Operador retomado em todas as filas.', 'success');
      if (useSSE) sseReconnect(); else await loadSnapshot({ silent: true });
    } catch (err) {
      logger.error('[PbxOperatorPanelPage] update agent status failed', err);
      showToast(err?.message || 'Erro ao atualizar status do operador.', 'error');
    } finally {
      setBusyAgentKey('');
    }
  }

  // Pausa/retoma em fila específica
  async function handlePauseQueue(agent, queue, nextPaused) {
    if (!agent?.memberRef || !queue?.queueId) return;
    setBusyAgentKey(`${agent.agentKey}-${queue.queueId}`);
    try {
      await setOperatorAgentPauseQueue({
        memberRef: agent.memberRef,
        memberType: agent.memberType,
        queueId: queue.queueId,
        paused: nextPaused,
      });
      showToast(nextPaused ? `Pausado na fila ${queue.queueName || queue.queueId}.` : `Retomado na fila ${queue.queueName || queue.queueId}.`, 'success');
      if (useSSE) sseReconnect(); else await loadSnapshot({ silent: true });
    } catch (err) {
      showToast(err?.message || 'Erro ao atualizar fila.', 'error');
    } finally {
      setBusyAgentKey('');
    }
  }

  // Abre modal de transferência
  function openTransfer(agent) {
    setTransferForm({ to: '', context: '' });
    setTransferModal({ agent });
  }

  // Executa transferência assistida
  async function handleTransfer() {
    if (!transferModal?.agent) return;
    if (!transferForm.to.trim()) { showToast('Informe o ramal de destino.', 'error'); return; }
    setActionBusy(true);
    try {
      await operatorTransfer({
        from: transferModal.agent.memberRef,
        to: transferForm.to.trim(),
        context: transferForm.context.trim() || undefined,
      });
      showToast(`Transferência originada: ${transferModal.agent.memberRef} → ${transferForm.to}`, 'success');
      setTransferModal(null);
    } catch (err) {
      showToast(err?.message || 'Erro ao originar transferência.', 'error');
    } finally {
      setActionBusy(false);
    }
  }

  // Abre modal de callback
  function openCallback(agent) {
    setCallbackForm({ phone: '', note: '' });
    setCallbackModal({ agent });
  }

  // Executa callback rápido
  async function handleCallback() {
    if (!callbackForm.phone.trim()) { showToast('Informe o telefone para retorno.', 'error'); return; }
    setActionBusy(true);
    try {
      await operatorCallback({
        phone: callbackForm.phone.trim(),
        target: callbackModal?.agent?.memberRef || callbackForm.phone.trim(),
        note: callbackForm.note || undefined,
      });
      showToast(`Callback agendado para ${callbackForm.phone}.`, 'success');
      setCallbackModal(null);
    } catch (err) {
      showToast(err?.message || 'Erro ao agendar callback.', 'error');
    } finally {
      setActionBusy(false);
    }
  }

  const lastUpdatedLabel = sseLastUpdated
    ? sseLastUpdated.toLocaleTimeString('pt-BR')
    : (snapshot?.generatedAt ? formatDateTime(snapshot.generatedAt) : null);

  return (
    <CrudPageBase
      title="PBX - Painel de Operador"
      actions={(
        <>
          <button
            className="btn-default px-4 py-2 text-sm"
            onClick={() => { if (useSSE) sseReconnect(); else loadSnapshot({ silent: true }); }}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Atualizando...' : 'Atualizar agora'}
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={useSSE}
              onChange={(e) => setUseSSE(e.target.checked)}
            />
            Tempo real (SSE)
          </label>
          {useSSE && (
            <span
              className={`ml-2 inline-block w-2 h-2 rounded-full ${sseConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}
              title={sseConnected ? 'SSE conectado' : 'SSE reconectando...'}
            />
          )}
        </>
      )}
      filters={(
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 mb-4">
          <div className="grid gap-3 md:grid-cols-6">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Fila</label>
              <select
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                value={filters.queueId}
                onChange={(e) => setFilters((prev) => ({ ...prev, queueId: e.target.value }))}
              >
                <option value="">todas</option>
                {queueOptions.map((q) => (
                  <option key={q.id} value={q.id}>{q.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Ramal</label>
              <input
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                value={filters.memberRef}
                placeholder="1001"
                onChange={(e) => setFilters((prev) => ({ ...prev, memberRef: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Limite chamadas</label>
              <input
                type="number"
                min={10}
                max={250}
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                value={filters.cdrLimit}
                onChange={(e) => setFilters((prev) => ({ ...prev, cdrLimit: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Janela CDR (min)</label>
              <input
                type="number"
                min={15}
                max={1440}
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                value={filters.callWindowMinutes}
                onChange={(e) => setFilters((prev) => ({ ...prev, callWindowMinutes: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Janela ativa (min)</label>
              <input
                type="number"
                min={1}
                max={120}
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                value={filters.activeCallWindowMinutes}
                onChange={(e) => setFilters((prev) => ({ ...prev, activeCallWindowMinutes: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Refresh (seg)</label>
              <input
                type="number"
                min={5}
                max={60}
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                value={refreshEverySec}
                onChange={(e) => setRefreshEverySec(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={() => setAppliedFilters({ ...filters })}
              disabled={loading || refreshing}
            >
              Aplicar filtros
            </button>
          </div>
          {lastUpdatedLabel ? (
            <div className="text-xs text-text-secondary mt-3">
              Ultima atualizacao: {lastUpdatedLabel}
            </div>
          ) : null}
        </div>
      )}
    >
      <ToastContainer />

      {/* Modal Transferência */}
      {transferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-bg-elevated border border-border-default rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-semibold mb-4">Transferência assistida</h3>
            <p className="text-xs text-text-secondary mb-3">
              Ramal origem: <strong>{transferModal.agent.memberRef}</strong>
            </p>
            <div className="mb-3">
              <label className="block text-xs text-text-secondary mb-1">Ramal destino *</label>
              <input
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                placeholder="1002"
                value={transferForm.to}
                onChange={(e) => setTransferForm((p) => ({ ...p, to: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1">Contexto AMI (opcional)</label>
              <input
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                placeholder="from-internal"
                value={transferForm.context}
                onChange={(e) => setTransferForm((p) => ({ ...p, context: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-default px-4 py-2 text-sm" onClick={() => setTransferModal(null)} disabled={actionBusy}>Cancelar</button>
              <button className="btn-primary px-4 py-2 text-sm" onClick={handleTransfer} disabled={actionBusy}>
                {actionBusy ? 'Originando...' : 'Transferir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Callback */}
      {callbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-bg-elevated border border-border-default rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-semibold mb-4">Callback rapido</h3>
            {callbackModal.agent && (
              <p className="text-xs text-text-secondary mb-3">
                Operador: <strong>{callbackModal.agent.displayName || callbackModal.agent.memberRef}</strong>
              </p>
            )}
            <div className="mb-3">
              <label className="block text-xs text-text-secondary mb-1">Telefone para retorno *</label>
              <input
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                placeholder="11999990000"
                value={callbackForm.phone}
                onChange={(e) => setCallbackForm((p) => ({ ...p, phone: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1">Observacao (opcional)</label>
              <input
                className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
                placeholder="Cliente solicitou retorno"
                value={callbackForm.note}
                onChange={(e) => setCallbackForm((p) => ({ ...p, note: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-default px-4 py-2 text-sm" onClick={() => setCallbackModal(null)} disabled={actionBusy}>Cancelar</button>
              <button className="btn-primary px-4 py-2 text-sm" onClick={handleCallback} disabled={actionBusy}>
                {actionBusy ? 'Agendando...' : 'Agendar callback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error ? (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-rose-200 mb-4">{error}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4 mb-4">
        <KpiCard title="Filas" value={summary.totalQueues || 0} />
        <KpiCard title="Operadores" value={summary.totalAgents || 0} detail={`ativos: ${summary.activeAgents || 0} | pausados: ${summary.pausedAgents || 0}`} />
        <KpiCard title="Chamadas ativas" value={summary.activeCalls || 0} detail="heuristica por CDR sem disposition" />
        <KpiCard title="Chamadas" value={(summary.answeredCalls || 0) + (summary.missedCalls || 0)} detail={`atendidas: ${summary.answeredCalls || 0} | perdidas: ${summary.missedCalls || 0}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
          <h3 className="text-sm font-semibold mb-3">Operadores por fila</h3>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary">
                  <th className="py-2">Operador</th>
                  <th className="py-2">Filas</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const isBusyAll = busyAgentKey === String(agent.agentKey || agent.memberRef);
                  return (
                    <tr key={agent.agentKey} className="border-t border-border-default">
                      <td className="py-2 align-top">
                        <div className="font-medium">{agent.displayName || agent.memberRef}</div>
                        <div className="text-xs text-text-secondary">{agent.memberType} {agent.extension ? `| ramal ${agent.extension}` : ''}</div>
                      </td>
                      <td className="py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {(agent.queues || []).map((q) => {
                            const qBusyKey = `${agent.agentKey}-${q.queueId}`;
                            const qBusy = busyAgentKey === qBusyKey;
                            return (
                              <button
                                key={`${agent.agentKey}-${q.queueId}`}
                                title={q.paused ? `Clique para retomar na fila ${q.queueName || q.queueId}` : `Clique para pausar na fila ${q.queueName || q.queueId}`}
                                disabled={qBusy}
                                onClick={() => handlePauseQueue(agent, q, !q.paused)}
                                className={`inline-block px-2 py-1 rounded text-xs border cursor-pointer ${q.paused ? 'bg-rose-500/20 text-rose-200 border-rose-500/40 hover:bg-rose-500/40' : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40 hover:bg-emerald-500/40'}`}
                              >
                                {qBusy ? '...' : (q.queueName || q.queueId)}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-2 align-top">
                        <span className={`inline-block px-2 py-1 rounded text-xs border ${agent.isPaused ? 'bg-rose-500/20 text-rose-200 border-rose-500/40' : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40'}`}>
                          {agent.isPaused ? 'pausado' : 'ativo'}
                        </span>
                      </td>
                      <td className="py-2 align-top">
                        <div className="flex gap-1 flex-wrap">
                          <button
                            className={agent.isPaused ? 'btn-default px-2 py-1 text-xs' : 'btn-danger px-2 py-1 text-xs'}
                            onClick={() => handleToggleAgent(agent)}
                            disabled={isBusyAll}
                            title="Pausar/retomar em todas as filas"
                          >
                            {isBusyAll ? '...' : agent.isPaused ? 'Retomar' : 'Pausar'}
                          </button>
                          <button
                            className="btn-default px-2 py-1 text-xs"
                            onClick={() => openTransfer(agent)}
                            title="Transferencia assistida"
                          >
                            Transf.
                          </button>
                          <button
                            className="btn-default px-2 py-1 text-xs"
                            onClick={() => openCallback(agent)}
                            title="Callback rapido"
                          >
                            Callback
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!agents.length ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-text-secondary">Nenhum operador encontrado para os filtros selecionados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
          <h3 className="text-sm font-semibold mb-3">Filas</h3>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary">
                  <th className="py-2">Fila</th>
                  <th className="py-2">Membros</th>
                  <th className="py-2">Ativos</th>
                  <th className="py-2">Pausados</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.queueId} className="border-t border-border-default">
                    <td className="py-2">{q.displayName ? `${q.name} - ${q.displayName}` : (q.name || q.queueId)}</td>
                    <td className="py-2">{q.totalMembers || 0}</td>
                    <td className="py-2">{q.activeMembers || 0}</td>
                    <td className="py-2">{q.pausedMembers || 0}</td>
                  </tr>
                ))}
                {!queues.length ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-text-secondary">Nenhuma fila encontrada para os filtros selecionados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-4 mt-4">
        <h3 className="text-sm font-semibold mb-3">Chamadas recentes</h3>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary">
                <th className="py-2">Data</th>
                <th className="py-2">Origem</th>
                <th className="py-2">Destino</th>
                <th className="py-2">Direcao</th>
                <th className="py-2">Status</th>
                <th className="py-2">Duracao</th>
                <th className="py-2">Acao</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.uniqueid} className="border-t border-border-default">
                  <td className="py-2">{formatDateTime(call.calldate)}</td>
                  <td className="py-2">{call.src || '-'}</td>
                  <td className="py-2">{call.dst || '-'}</td>
                  <td className="py-2">{directionLabel(call.direction)}</td>
                  <td className="py-2">
                    <span className={`inline-block px-2 py-1 rounded text-xs ${callBadgeClass(call.disposition)}`}>
                      {call.disposition || 'EM ANDAMENTO'}
                    </span>
                  </td>
                  <td className="py-2">{Number(call.billsec || call.duration || 0)}s</td>
                  <td className="py-2">
                    {(call.disposition === 'NO ANSWER' || call.disposition === 'BUSY' || call.disposition === 'FAILED') && call.src && (
                      <button
                        className="btn-default px-2 py-1 text-xs"
                        title="Callback para este numero"
                        onClick={() => { setCallbackForm({ phone: call.src, note: `Retorno CDR ${call.uniqueid}` }); setCallbackModal({ agent: null }); }}
                      >
                        Callback
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!calls.length ? (
                <tr>
                  <td colSpan={7} className="py-4 text-text-secondary">Sem chamadas no periodo selecionado.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </CrudPageBase>
  );
}

export default PbxOperatorPanelPage;
