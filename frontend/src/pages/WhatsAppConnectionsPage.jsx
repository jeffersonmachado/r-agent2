import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import {
  listWhatsAppConnections,
  createWhatsAppConnection,
  updateWhatsAppConnection,
  generateWhatsAppQr,
  disconnectWhatsAppConnection,
  deleteWhatsAppConnection,
  getWhatsAppConnectionStatus,
} from '../api/whatsappConnections';
import { listFlows } from '../api/flows';
import { getCurrentTenantPlanUsage } from '../api/tenants';
import { useWebSocketStatus } from '../utils/webSocketStatusConfig';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

const PROVIDER_OPTIONS = [
  { value: 'whatsapp-qr', label: 'WhatsApp QR' },
];

const EMPTY_QR_STATE = {
  connectionId: null,
  qr: null,
  pending: false,
  note: '',
};

function statusBadge(status) {
  const value = String(status || 'unknown').toLowerCase();
  if (value === 'connected') return { label: 'Conectado', className: 'bg-status-success/10 text-status-success border border-status-success/20' };
  if (value === 'pairing') return { label: 'Pareando', className: 'bg-status-warning/10 text-status-warning border border-status-warning/20' };
  if (value === 'disconnected') return { label: 'Desconectado', className: 'bg-status-error/10 text-status-error border border-status-error/20' };
  return { label: value, className: 'bg-bg-secondary text-text-secondary border border-border-default' };
}

function formatDisconnectDetails(connection) {
  const code = Number(connection?.lastDisconnectCode || 0) || null;
  const reason = String(connection?.lastDisconnectReason || '').trim();
  if (!code && !reason) return null;
  if (code && reason) return `[${code}] ${reason}`;
  if (code) return `[${code}]`;
  return reason;
}

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR');
}

export function WhatsAppConnectionsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState([]);
  const [form, setForm] = useState({ name: '', provider: 'whatsapp-qr', botEnabled: false, botFlowId: null });
  const [availableFlows, setAvailableFlows] = useState([]);
  const [planAllowsWhatsAppBot, setPlanAllowsWhatsAppBot] = useState(false);
  const [qrState, setQrState] = useState(EMPTY_QR_STATE);
  const [qrImageError, setQrImageError] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const syncQrStateFromConnections = useCallback((items, previousState = EMPTY_QR_STATE) => {
    const list = Array.isArray(items) ? items : [];
    const liveQrConnection = list.find((item) => (
      String(item?.status || '').toLowerCase() === 'pairing' && String(item?.qr?.text || '').trim()
    ));

    if (liveQrConnection) {
      return {
        connectionId: liveQrConnection.id,
        qr: liveQrConnection.qr,
        pending: false,
        note: '',
      };
    }

    if (previousState?.connectionId) {
      const activeConnection = list.find((item) => item?.id === previousState.connectionId);
      if (!activeConnection) return EMPTY_QR_STATE;

      if (String(activeConnection?.status || '').toLowerCase() === 'pairing') {
        return {
          connectionId: activeConnection.id,
          qr: null,
          pending: previousState.pending === true,
          note: previousState.note || '',
        };
      }
    }

    return EMPTY_QR_STATE;
  }, []);

  const describePendingQr = useCallback((response) => {
    const syncError = String(response?.providerSync?.error || '').trim();
    const syncMessage = String(response?.providerSync?.message || '').trim();
    if (syncMessage) {
      const normalized = syncMessage
        .split(/\n+/)
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .filter((line) => !/^Require stack:/i.test(line));
      if (normalized.length > 0) {
        return normalized.slice(0, 2).join(' ');
      }
    }
    if (syncError === 'bridge_library_missing') {
      return 'A biblioteca whatsapp-web.js não foi instalada. Contate o administrador.';
    }
    if (syncError === 'bridge_initialize_failed') {
      return 'A bridge não entregou um QR válido do provedor.';
    }
    return 'QR aguardando confirmação do provedor.';
  }, []);

  const handleWebSocketEvent = useCallback((event, data) => {
    if (event !== 'whatsapp.connection.updated') return;

    const connection = data?.connection;
    if (!connection?.id) return;

    setConnections((prev) => {
      const index = prev.findIndex((item) => item.id === connection.id);
      if (index < 0) return [connection, ...prev];

      const next = [...prev];
      next[index] = { ...next[index], ...connection };
      return next;
    });

    setQrState((prev) => {
      if (prev.connectionId === connection.id && connection.status === 'connected') {
        return { connectionId: null, qr: null };
      }
      if (
        String(connection.status || '').toLowerCase() === 'pairing' &&
        connection?.qr?.text
      ) {
        return { connectionId: connection.id, qr: connection.qr };
      }
      return prev;
    });
  }, []);

  const { connected: wsConnected, authenticated: wsAuthenticated, authFailed } = useWebSocketContext({
    enabled: isAuthenticated,
    onEvent: handleWebSocketEvent,
    subscribeEvents: ['whatsapp.connection.updated'],
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function loadConnections() {
    setLoading(true);
    try {
      const out = await listWhatsAppConnections();
      const nextConnections = Array.isArray(out?.connections) ? out.connections : [];
      const normalizedConnections = nextConnections.map((conn) => ({
        ...conn,
        botEnabled: conn?.botEnabled === true,
        botFlowId: conn?.botEnabled === true && conn?.botFlowId ? String(conn.botFlowId) : null,
      }));
      setConnections(normalizedConnections);
      setQrState((prev) => syncQrStateFromConnections(normalizedConnections, prev));
    } catch (err) {
      logger.error('[WhatsAppConnections] erro ao carregar', err);
      showToast('Erro ao carregar conexões', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadDependencies() {
    try {
      const [flowsResult, planResult] = await Promise.all([
        listFlows().catch(() => []),
        getCurrentTenantPlanUsage().catch(() => null),
      ]);

      const list = Array.isArray(flowsResult)
        ? flowsResult
        : (Array.isArray(flowsResult?.flows) ? flowsResult.flows : []);
      setAvailableFlows(list);

      const allows = planResult?.limits?.features?.whatsapp_bot === true;
      setPlanAllowsWhatsAppBot(allows);
    } catch (_) {
      setAvailableFlows([]);
      setPlanAllowsWhatsAppBot(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadDependencies();
      loadConnections();
    }
  }, [authLoading, isAuthenticated]);

  const wsStatus = useWebSocketStatus({
    connected: wsConnected,
    authenticated: wsAuthenticated,
    authFailed,
  });

  async function handleCreate() {
    if (!form.name.trim()) {
      showToast('Informe um nome para a conexão', 'warning');
      return;
    }

    if (form.botEnabled && !planAllowsWhatsAppBot) {
      showToast('Seu plano não suporta bot no WhatsApp', 'warning');
      return;
    }

    if (form.botEnabled && !form.botFlowId) {
      showToast('Selecione um Flow para esta conexão', 'warning');
      return;
    }

    setLoading(true);
    try {
      await createWhatsAppConnection({
        name: form.name.trim(),
        provider: form.provider.trim() || 'whatsapp-qr',
        botEnabled: !!form.botEnabled,
        botFlowId: form.botEnabled ? String(form.botFlowId) : null,
      });
      setForm({ name: '', provider: 'whatsapp-qr', botEnabled: false, botFlowId: null });
      await loadConnections();
      showToast('Conexão criada', 'success');
    } catch (err) {
      showToast('Erro ao criar conexão', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveConnectionBot(conn) {
    if (conn?.botEnabled && !planAllowsWhatsAppBot) {
      showToast('Seu plano não suporta bot no WhatsApp', 'warning');
      return;
    }
    if (conn?.botEnabled && !conn?.botFlowId) {
      showToast('Selecione um Flow para esta conexão', 'warning');
      return;
    }

    setBusyId(conn.id);
    try {
      await updateWhatsAppConnection(conn.id, {
        name: conn.name,
        provider: conn.provider,
        botEnabled: conn?.botEnabled === true,
        botFlowId: conn?.botEnabled === true ? conn.botFlowId : null,
      });
      await loadConnections();
      showToast('Configuração da conexão atualizada', 'success');
    } catch (err) {
      showToast('Erro ao salvar configuração da conexão', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleGenerateQr(connectionId) {
    setBusyId(connectionId);
    try {
      const out = await generateWhatsAppQr(connectionId);
      const hasRealQr = Boolean(String(out?.qr?.text || '').trim()) && !out?.isTestQr;
      const isTestQr = out?.isTestQr === true;
      const nextState = hasRealQr || isTestQr
        ? { connectionId, qr: out.qr, pending: !hasRealQr, note: isTestQr ? '(QR de teste para desenvolvimento)' : '' }
        : {
            connectionId,
            qr: null,
            pending: true,
            note: describePendingQr(out),
          };
      setQrState(nextState);
      setQrImageError(false);
      await loadConnections();
      if (hasRealQr) {
        showToast('QR real gerado. Escaneie no WhatsApp.', 'success');
      } else if (isTestQr) {
        showToast('QR de teste gerado (para desenvolvimento).', 'info');
      } else {
        const syncMessage = String(out?.providerSync?.message || '').trim();
        if (syncMessage) {
          const compactSyncMessage = syncMessage
            .split(/\n+/)
            .map((line) => String(line || '').trim())
            .filter(Boolean)
            .filter((line) => !/^Require stack:/i.test(line))
            .slice(0, 2)
            .join(' ');
          showToast(compactSyncMessage || 'Erro ao inicializar a integração WhatsApp QR.', 'error');
        } else {
          showToast('QR solicitado. Aguardando o código real do provedor.', 'warning');
        }
      }
    } catch (err) {
      showToast('Erro ao gerar QR', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(connectionId) {
    setBusyId(connectionId);
    try {
      await disconnectWhatsAppConnection(connectionId);
      if (qrState.connectionId === connectionId) {
        setQrState(EMPTY_QR_STATE);
      }
      await loadConnections();
      showToast('Conexão desconectada', 'success');
    } catch (err) {
      showToast('Erro ao desconectar', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(connectionId) {
    setBusyId(connectionId);
    try {
      await deleteWhatsAppConnection(connectionId);
      if (qrState.connectionId === connectionId) {
        setQrState(EMPTY_QR_STATE);
      }
      await loadConnections();
      showToast('Conexão removida', 'success');
    } catch (err) {
      showToast('Erro ao remover conexão', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefreshStatus(connectionId) {
    setBusyId(connectionId);
    try {
      const out = await getWhatsAppConnectionStatus(connectionId);
      setConnections((prev) => prev.map((c) => (
        c.id === connectionId
          ? {
              ...c,
              status: String(out?.status || c.status || '').trim() || 'disconnected',
              updatedAt: out?.updatedAt || c.updatedAt,
              runtimeStatus: out?.runtimeStatus || c.runtimeStatus,
              lastDisconnectCode: out?.lastDisconnectCode ?? c.lastDisconnectCode,
              lastDisconnectReason: String(out?.lastDisconnectReason || c.lastDisconnectReason || '').trim() || null,
              lastDisconnectedAt: out?.lastDisconnectedAt || c.lastDisconnectedAt,
            }
          : c
      )));
      if (String(out?.status || '').toLowerCase() === 'connected' && qrState.connectionId === connectionId) {
        setQrState(EMPTY_QR_STATE);
      }
      showToast('Status atualizado', 'success');
    } catch (err) {
      showToast('Erro ao atualizar status', 'error');
    } finally {
      setBusyId(null);
    }
  }

  function handleCopyQr() {
    const text = qrState?.qr?.text || '';
    if (!text) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast('QR copiado', 'success')).catch(() => showToast('Falha ao copiar', 'error'));
    } else {
      showToast('Clipboard indisponível', 'warning');
    }
  }

  if (authLoading) {
    return (
      <CrudPageBase hideHeader>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }
  if (!isAuthenticated) return null;

  const connectedCount = connections.filter((conn) => String(conn.status || '').toLowerCase() === 'connected').length;
  const pairingCount = connections.filter((conn) => String(conn.status || '').toLowerCase() === 'pairing').length;
  const disconnectedCount = connections.filter((conn) => String(conn.status || '').toLowerCase() === 'disconnected').length;
  const formProviderOptions = PROVIDER_OPTIONS.some((option) => option.value === form.provider)
    ? PROVIDER_OPTIONS
    : [{ value: form.provider, label: `${form.provider} (atual)` }, ...PROVIDER_OPTIONS];

  const waQrImageUrl = qrState?.qr?.text
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrState.qr.text)}`
    : null;

  return (
    <CrudPageBase hideHeader>
      <ToastContainer />

      <div className="support-header">
        <div className="page-header">
          <h1>📱 WhatsApp QR</h1>
        </div>
        <div className="support-controls">
          <div className="flex items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-3 py-1.5" title={wsStatus.title}>
            <span className={`inline-block h-2 w-2 rounded-full ${wsStatus.indicatorDotClassName}`} />
            <span className="text-sm text-text-secondary">{wsStatus.label}</span>
          </div>
          <Button onClick={loadConnections} disabled={loading} className="support-button">Atualizar</Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border-default bg-bg-secondary p-3">
          <div className="text-xs text-text-secondary">Total de conexões</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">{connections.length}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-bg-secondary p-3">
          <div className="text-xs text-text-secondary">Conectadas</div>
          <div className="mt-1 text-2xl font-semibold text-status-success">{connectedCount}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-bg-secondary p-3">
          <div className="text-xs text-text-secondary">Pareando</div>
          <div className="mt-1 text-2xl font-semibold text-status-warning">{pairingCount}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-bg-secondary p-3">
          <div className="text-xs text-text-secondary">Desconectadas</div>
          <div className="mt-1 text-2xl font-semibold text-status-error">{disconnectedCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="support-details-panel rounded-lg border border-border-default xl:col-span-4">
          <div className="support-details-title">Nova conexão</div>
          <div className="support-form-group">
            <label className="support-form-label">Nome</label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ex: Loja Centro" />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Provider</label>
            <select
              className="support-form-select"
              value={form.provider}
              onChange={(e) => setForm((prev) => ({ ...prev, provider: e.target.value }))}
            >
              {formProviderOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="support-form-group">
            <label className="inline-flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={!!form.botEnabled}
                disabled={!planAllowsWhatsAppBot}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((prev) => ({
                    ...prev,
                    botEnabled: checked,
                    botFlowId: checked ? prev.botFlowId : null,
                  }));
                }}
              />
              Ativar Bot nesta conexão
            </label>
            {!planAllowsWhatsAppBot && (
              <div className="mt-1 text-xs text-status-warning">Seu plano não suporta bot no WhatsApp</div>
            )}
          </div>
          {form.botEnabled && (
            <div className="support-form-group">
              <label className="support-form-label">Flow do Bot</label>
              <select
                className="support-form-select"
                value={form.botFlowId || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, botFlowId: e.target.value || null }))}
              >
                <option value="">Selecione um flow</option>
                {availableFlows.map((flow) => (
                  <option key={flow.id} value={flow.id}>{flow.name || flow.id}</option>
                ))}
              </select>
            </div>
          )}
          <Button onClick={handleCreate} className="support-button-full" disabled={loading}>Criar conexão</Button>
          <div className="text-xs text-text-tertiary" style={{ marginTop: '8px' }}>
            Esta tela conecta números via WhatsApp Web (QR Code). Se você usa API oficial (Cloud API), gerencie em Canal/Contas em vez deste fluxo.
          </div>
        </div>

        <div className="support-details-panel rounded-lg border border-border-default xl:col-span-8">
          <div className="support-details-title">Conexões</div>
          {connections.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma conexão cadastrada.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {connections.map((conn) => {
                const badge = statusBadge(conn.status);
                const isDisconnected = String(conn.status || '').toLowerCase() === 'disconnected';
                const disconnectDetails = formatDisconnectDetails(conn);
                const disconnectedAtLabel = formatDateTime(conn.lastDisconnectedAt);
                return (
                  <div key={conn.id} className="rounded-lg border border-border-default bg-bg-tertiary p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">{conn.name || conn.id}</div>
                        <div className="text-xs text-text-tertiary">{conn.provider || 'whatsapp-qr'}</div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>{badge.label}</span>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-text-tertiary sm:grid-cols-2">
                      <div><strong>ID</strong>: {conn.id}</div>
                      <div><strong>Atualizado</strong>: {conn.updatedAt || '-'}</div>
                      <div><strong>Último QR</strong>: {conn.lastQrAt || '-'}</div>
                    </div>

                    {String(conn.status || '').toLowerCase() === 'disconnected' && disconnectDetails && (
                      <div className="mt-2 text-xs text-status-error">
                        <strong>Última desconexão:</strong> {disconnectDetails}
                      </div>
                    )}

                    {String(conn.status || '').toLowerCase() === 'disconnected' && disconnectedAtLabel && (
                      <div className="mt-1 text-xs text-text-tertiary">
                        <strong>Quando:</strong> {disconnectedAtLabel}
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => handleRefreshStatus(conn.id)} style={{ width: 'auto' }} disabled={busyId === conn.id} size="sm">
                        {busyId === conn.id ? 'Atualizando...' : 'Status'}
                      </Button>
                      <Button onClick={() => handleGenerateQr(conn.id)} style={{ width: 'auto' }} disabled={busyId === conn.id} size="sm">
                        {busyId === conn.id ? 'Gerando...' : 'Gerar QR'}
                      </Button>
                      <Button onClick={() => handleDisconnect(conn.id)} className="support-button-danger" style={{ width: 'auto' }} disabled={busyId === conn.id || isDisconnected} size="sm">
                        {isDisconnected ? 'Desconectado' : 'Desconectar'}
                      </Button>
                      <Button onClick={() => handleRemove(conn.id)} className="support-button-danger" style={{ width: 'auto' }} disabled={busyId === conn.id} size="sm">
                        Remover
                      </Button>
                    </div>

                    <div className="mt-4 rounded-md border border-border-default bg-bg-secondary p-3">
                      <label className="inline-flex items-center gap-2 text-xs text-text-primary">
                        <input
                          type="checkbox"
                          checked={conn?.botEnabled === true}
                          disabled={!planAllowsWhatsAppBot}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setConnections((prev) => prev.map((item) => (
                              item.id === conn.id
                                ? { ...item, botEnabled: checked, botFlowId: checked ? item.botFlowId : null }
                                : item
                            )));
                          }}
                        />
                        Ativar Bot nesta conexão
                      </label>
                      {!planAllowsWhatsAppBot && (
                        <div className="mt-1 text-xs text-status-warning">Seu plano não suporta bot no WhatsApp</div>
                      )}

                      {conn?.botEnabled === true && (
                        <div className="mt-2">
                          <select
                            className="support-form-select"
                            value={conn?.botFlowId || ''}
                            onChange={(e) => {
                              const value = e.target.value || null;
                              setConnections((prev) => prev.map((item) => (
                                item.id === conn.id
                                  ? { ...item, botFlowId: value }
                                  : item
                              )));
                            }}
                          >
                            <option value="">Selecione um flow</option>
                            {availableFlows.map((flow) => (
                              <option key={flow.id} value={flow.id}>{flow.name || flow.id}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          style={{ width: 'auto' }}
                          onClick={() => handleSaveConnectionBot(conn)}
                          disabled={busyId === conn.id}
                        >
                          {busyId === conn.id ? 'Salvando...' : 'Salvar Bot'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {qrState?.connectionId && (qrState?.qr?.text || qrState?.pending) && (
          <div className="support-details-panel rounded-lg border border-border-default xl:col-span-12">
            <div className="support-details-title">QR de pareamento</div>
            <div className="text-xs text-text-tertiary">
              {qrState?.qr?.text
                ? `Escaneie este código no WhatsApp. Expira em: ${qrState.qr.expiresAt || 'n/a'}`
                : 'Solicitação enviada. Aguardando o QR real do provedor.'}
            </div>
            {qrState?.pending && !qrState?.qr?.text && (
              <div className="mt-3 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-text-primary">
                {qrState.note || 'Aguardando o QR real do provedor.'}
              </div>
            )}
            {waQrImageUrl && !qrImageError && (
              <div style={{ marginTop: '12px', marginBottom: '8px' }}>
                <img
                  src={waQrImageUrl}
                  alt="QR code de pareamento WhatsApp"
                  width={240}
                  height={240}
                  onError={() => setQrImageError(true)}
                  className="rounded-lg border border-border-default bg-bg-elevated"
                />
              </div>
            )}
            {qrImageError && (
              <div className="text-xs text-status-warning" style={{ marginTop: '8px' }}>
                Não foi possível carregar o QR visual. Use o texto abaixo para cópia/debug.
              </div>
            )}
            {qrState?.qr?.text && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-bg-secondary p-3 text-xs">{qrState.qr.text}</pre>
            )}
            <div className="mt-3 flex justify-end gap-2">
              {qrState?.qr?.text ? <Button onClick={handleCopyQr} style={{ width: 'auto' }}>Copiar QR</Button> : null}
              <Button onClick={() => setQrState(EMPTY_QR_STATE)} variant="ghost" style={{ width: 'auto' }}>Fechar</Button>
            </div>
          </div>
        )}
      </div>
    </CrudPageBase>
  );
}
