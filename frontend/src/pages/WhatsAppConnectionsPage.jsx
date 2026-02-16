import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import {
  listWhatsAppConnections,
  createWhatsAppConnection,
  generateWhatsAppQr,
  disconnectWhatsAppConnection,
  getWhatsAppConnectionStatus,
  updateWhatsAppConnectionStatus,
} from '../api/whatsappConnections';
import logger from '../utils/logger';

function statusBadge(status) {
  const value = String(status || 'unknown').toLowerCase();
  if (value === 'connected') return { label: 'Conectado', className: 'bg-status-success/10 text-status-success border border-status-success/20' };
  if (value === 'pairing') return { label: 'Pareando', className: 'bg-status-warning/10 text-status-warning border border-status-warning/20' };
  if (value === 'disconnected') return { label: 'Desconectado', className: 'bg-status-error/10 text-status-error border border-status-error/20' };
  return { label: value, className: 'bg-bg-secondary text-text-secondary border border-border-default' };
}

export function WhatsAppConnectionsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState([]);
  const [form, setForm] = useState({ name: '', provider: 'whatsapp-qr' });
  const [qrState, setQrState] = useState({ connectionId: null, qr: null });
  const [qrImageError, setQrImageError] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function loadConnections() {
    setLoading(true);
    try {
      const out = await listWhatsAppConnections();
      setConnections(Array.isArray(out?.connections) ? out.connections : []);
    } catch (err) {
      logger.error('[WhatsAppConnections] erro ao carregar', err);
      showToast('Erro ao carregar conexões', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadConnections();
    }
  }, [authLoading, isAuthenticated]);

  async function handleCreate() {
    if (!form.name.trim()) {
      showToast('Informe um nome para a conexão', 'warning');
      return;
    }
    setLoading(true);
    try {
      await createWhatsAppConnection({ name: form.name.trim(), provider: form.provider.trim() || 'whatsapp-qr' });
      setForm({ name: '', provider: 'whatsapp-qr' });
      await loadConnections();
      showToast('Conexão criada', 'success');
    } catch (err) {
      showToast('Erro ao criar conexão', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateQr(connectionId) {
    setBusyId(connectionId);
    try {
      const out = await generateWhatsAppQr(connectionId);
      setQrState({ connectionId, qr: out?.qr || null });
      setQrImageError(false);
      await loadConnections();
      showToast('QR gerado. Escaneie no WhatsApp.', 'success');
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
        setQrState({ connectionId: null, qr: null });
      }
      await loadConnections();
      showToast('Conexão desconectada', 'success');
    } catch (err) {
      showToast('Erro ao desconectar', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkConnected(connectionId) {
    setBusyId(connectionId);
    try {
      await updateWhatsAppConnectionStatus(connectionId, { status: 'connected' });
      if (qrState.connectionId === connectionId) {
        setQrState({ connectionId: null, qr: null });
      }
      await loadConnections();
      showToast('Conexão marcada como conectada', 'success');
    } catch (err) {
      showToast('Erro ao atualizar status da conexão', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefreshStatus(connectionId) {
    setBusyId(connectionId);
    try {
      const out = await getWhatsAppConnectionStatus(connectionId);
      setConnections((prev) => prev.map((c) => (c.id === connectionId ? { ...c, status: out?.status || c.status, updatedAt: out?.updatedAt || c.updatedAt } : c)));
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
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const waQrImageUrl = qrState?.qr?.text
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrState.qr.text)}`
    : null;

  return (
    <div className="support-page">
      <ToastContainer />
      <div className="support-header">
        <h1>📱 WhatsApp QR</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <Button onClick={loadConnections} disabled={loading} className="support-button">Atualizar</Button>
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
          <div className="support-details-title">Nova conexão</div>
          <div className="support-form-group">
            <label className="support-form-label">Nome</label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ex: Loja Centro" />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Provider</label>
            <Input value={form.provider} onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value }))} placeholder="whatsapp-qr" />
          </div>
          <Button onClick={handleCreate} className="support-button-full" disabled={loading}>Criar conexão</Button>
          <div className="text-xs text-text-tertiary" style={{ marginTop: '8px' }}>
            Use este fluxo para parear sessões via QR (WhatsApp Web/provedores externos).
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Conexões</div>
          {connections.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma conexão cadastrada.</div>
          ) : (
            <div className="space-y-4">
              {connections.map((conn) => {
                const badge = statusBadge(conn.status);
                return (
                  <div key={conn.id} className="p-4 rounded-lg border border-border-default bg-bg-tertiary">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{conn.name || conn.id}</div>
                        <div className="text-xs text-text-tertiary">{conn.provider || 'whatsapp-qr'}</div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>{badge.label}</span>
                    </div>
                    <div className="text-xs text-text-tertiary mt-2">
                      <div><strong>ID</strong>: {conn.id}</div>
                      <div><strong>Atualizado</strong>: {conn.updatedAt || '-'}</div>
                      <div><strong>Último QR</strong>: {conn.lastQrAt || '-'}</div>
                    </div>
                    <div className="flex gap-2 justify-end mt-4">
                      <Button onClick={() => handleMarkConnected(conn.id)} style={{ width: 'auto' }} disabled={busyId === conn.id}>
                        {busyId === conn.id ? 'Atualizando...' : 'Marcar conectado'}
                      </Button>
                      <Button onClick={() => handleRefreshStatus(conn.id)} style={{ width: 'auto' }} disabled={busyId === conn.id}>
                        {busyId === conn.id ? 'Atualizando...' : 'Status'}
                      </Button>
                      <Button onClick={() => handleGenerateQr(conn.id)} style={{ width: 'auto' }} disabled={busyId === conn.id}>
                        {busyId === conn.id ? 'Gerando...' : 'Gerar QR'}
                      </Button>
                      <Button onClick={() => handleDisconnect(conn.id)} className="support-button-danger" style={{ width: 'auto' }} disabled={busyId === conn.id}>
                        Desconectar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {qrState?.qr?.text && (
          <div className="support-details-panel">
            <div className="support-details-title">QR de pareamento</div>
            <div className="text-xs text-text-tertiary">
              Escaneie este código no WhatsApp. Expira em: {qrState.qr.expiresAt || 'n/a'}
            </div>
            {waQrImageUrl && !qrImageError && (
              <div style={{ marginTop: '12px', marginBottom: '8px' }}>
                <img
                  src={waQrImageUrl}
                  alt="QR code de pareamento WhatsApp"
                  width={240}
                  height={240}
                  onError={() => setQrImageError(true)}
                  style={{ border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff' }}
                />
              </div>
            )}
            {qrImageError && (
              <div className="text-xs text-status-warning" style={{ marginTop: '8px' }}>
                Não foi possível carregar o QR visual. Use o texto abaixo para cópia/debug.
              </div>
            )}
            <pre className="mt-3 p-3 bg-bg-secondary rounded-lg text-xs overflow-x-auto">{qrState.qr.text}</pre>
            <div className="flex justify-end gap-2 mt-3">
              <Button onClick={handleCopyQr} style={{ width: 'auto' }}>Copiar QR</Button>
              <Button onClick={() => setQrState({ connectionId: null, qr: null })} variant="ghost" style={{ width: 'auto' }}>Fechar</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
