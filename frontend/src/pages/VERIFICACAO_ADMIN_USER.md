import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import logger from '../utils/logger';
import {
  listChannelAccounts,
  createChannelAccount,
  updateChannelAccount,
  deleteChannelAccount,
} from '../api/channelAccounts';
import {
  listWhatsAppConnections,
  createWhatsAppConnection,
  generateWhatsAppQr,
  disconnectWhatsAppConnection,
  getWhatsAppConnectionStatus,
  deleteWhatsAppConnection,
} from '../api/whatsappConnections';
// ...existing code...

// ...existing code...

function statusBadge(status) {
  const value = String(status || 'unknown').toLowerCase();
  if (value === 'connected') return { label: 'Conectado', className: 'bg-status-success/10 text-status-success border border-status-success/20' };
  if (value === 'pairing') return { label: 'Pareando', className: 'bg-status-warning/10 text-status-warning border border-status-warning/20' };
  if (value === 'disconnected') return { label: 'Desconectado', className: 'bg-status-error/10 text-status-error border border-status-error/20' };
  return { label: value, className: 'bg-bg-secondary text-text-secondary border border-border-default' };
}

export function WhatsAppConnectionsPage() {
  // Estados principais
  const [connectionType, setConnectionType] = useState('cloud'); // 'cloud' ou 'qr'
  const [cloudAccounts, setCloudAccounts] = useState([]);
  const [waConnections, setWaConnections] = useState([]);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);
  const [error, setError] = useState(null);
  const [qrState, setQrState] = useState({ connectionId: null, qr: null });
  const [qrImageError, setQrImageError] = useState(false);
  const [form, setForm] = useState({
    label: '',
    phone_number_id: '',
    access_token: '',
    verify_token: '',
    active: true,
    id: null,
  });
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(false);
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  // Fetch Cloud API accounts
  async function fetchCloudAccounts() {
    setLoadingCloud(true);
    setError(null);
    try {
      const out = await listChannelAccounts({ includeConfig: true });
      setCloudAccounts(Array.isArray(out) ? out.filter(a => a.type === 'cloud') : []);
    } catch (err) {
      logger.error('[WhatsAppConnections] erro ao carregar Cloud API', err);
      setError('Erro ao carregar Cloud API');
      showToast('Erro ao carregar Cloud API', 'error');
    } finally {
      setLoadingCloud(false);
    }
  }

  // Fetch WhatsApp QR connections
  async function fetchWhatsAppConnections() {
    setLoadingQr(true);
    setError(null);
    try {
      const out = await listWhatsAppConnections();
      setWaConnections(Array.isArray(out?.connections) ? out.connections : []);
    } catch (err) {
      logger.error('[WhatsAppConnections] erro ao carregar WhatsApp QR', err);
      setError('Erro ao carregar WhatsApp QR');
      showToast('Erro ao carregar WhatsApp QR', 'error');
    } finally {
      setLoadingQr(false);
    }
  }

    // Polling de status QR
    useEffect(() => {
      let interval;
      if (qrState.connectionId) {
        interval = setInterval(async () => {
          try {
            const status = await getWhatsAppConnectionStatus(qrState.connectionId);
            if (status?.status === 'connected') {
              setQrState({ connectionId: null, qr: null });
              showToast('Conectado com sucesso!', 'success');
              loadWaConnections();
            }
          } catch {}
        }, 2500);
      }
      return () => interval && clearInterval(interval);
    }, [qrState.connectionId]);
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    label: '',
    phone_number_id: '',
    access_token: '',
    verify_token: '',
    active: true,
    id: null,
  });


  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(false);
  // Atualiza tipo ao editar
  useEffect(() => {
    if (editing) {
      if (form.access_token || form.verify_token) {
        setConnectionType('cloud');
      } else {
        setConnectionType('qr');
      }
    }
  }, [editing, form.access_token, form.verify_token]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      if (window.location.pathname !== '/login') {
        navigate('/login');
      }
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Carrega Cloud e QR ao autenticar
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchCloudAccounts();
      fetchWhatsAppConnections();
    }
  }, [authLoading, isAuthenticated]);

  async function loadAccounts() {
    setLoading(true);
    try {
      const out = await listChannelAccounts({ includeConfig: true });
      setAccounts(Array.isArray(out) ? out.filter(a => a.type === 'whatsapp' || a.type === 'cloud') : []);
    } catch (err) {
      logger.error('[WhatsAppConnections] erro ao carregar', err);
      showToast('Erro ao carregar conexões', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadAccounts();
    }
  }, [authLoading, isAuthenticated]);

  async function handleSaveCloud() {
    // Validação dos campos obrigatórios para Cloud
    if (!form.label.trim() || !form.phone_number_id.trim() || !form.access_token.trim() || !form.verify_token.trim()) {
      showToast('Preencha todos os campos obrigatórios', 'warning');
      return;
    }
    setLoadingCloud(true);
    try {
      const payload = {
        tenantId: undefined, // será resolvido no backend
        type: 'cloud',
        status: form.active ? 'active' : 'inactive',
        externalId: form.phone_number_id.trim(),
        config: {
          label: form.label.trim(),
          phone_number_id: form.phone_number_id.trim(),
          access_token: form.access_token.trim(),
          verify_token: form.verify_token.trim(),
        },
      };
      if (editing && form.id) {
        await updateChannelAccount(form.id, payload);
        showToast('Conexão atualizada', 'success');
      } else {
        await createChannelAccount(payload);
        showToast('Conexão criada', 'success');
      }
      setForm({ label: '', phone_number_id: '', access_token: '', verify_token: '', active: true, id: null });
      setEditing(false);
      await fetchCloudAccounts();
    } catch (err) {
      showToast('Erro ao salvar conexão', 'error');
    } finally {
      setLoadingCloud(false);
    }
  }

  async function handleCreateQrConnection() {
    // Validação dos campos obrigatórios para QR
    if (!form.label.trim() || !form.phone_number_id.trim()) {
      showToast('Preencha todos os campos obrigatórios', 'warning');
      return;
    }
    setLoadingQr(true);
    try {
      const payload = {
        name: form.phone_number_id.trim(),
        label: form.label.trim(),
      };
      const created = await createWhatsAppConnection(payload);
      showToast('Conexão QR criada', 'success');
      setForm({ label: '', phone_number_id: '', access_token: '', verify_token: '', active: true, id: null });
      setEditing(false);
      await fetchWhatsAppConnections();
      // Gera QR automaticamente após criar
      if (created && created.id) {
        await handleGenerateQr(created.id);
      }
    } catch (err) {
      showToast('Erro ao criar conexão QR', 'error');
    } finally {
      setLoadingQr(false);
    }
  }

  function handleEditCloud(account) {
    setForm({
      label: account.config?.label || '',
      phone_number_id: account.config?.phone_number_id || account.externalId || '',
      access_token: account.config?.access_token || '',
      verify_token: account.config?.verify_token || '',
      active: account.status === 'active',
      id: account.id,
    });
    setEditing(true);
  }

  async function handleDeleteCloudAccount(id) {
    setBusyId(id);
    try {
      await deleteChannelAccount(id);
      await fetchCloudAccounts();
      showToast('Conexão removida', 'success');
    } catch (err) {
      showToast('Erro ao remover conexão', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteQrConnection(id) {
    setBusyId(id);
    try {
      await deleteWhatsAppConnection(id);
      await fetchWhatsAppConnections();
      showToast('Conexão QR removida', 'success');
    } catch (err) {
      showToast('Erro ao remover conexão QR', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(account) {
    setBusyId(account.id);
    try {
      await updateChannelAccount(account.id, { status: account.status === 'active' ? 'inactive' : 'active' });
      await loadAccounts();
      showToast('Status atualizado', 'success');
    } catch (err) {
      showToast('Erro ao atualizar status', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleGenerateQr(connectionId) {
    setBusyId(connectionId);
    try {
      const out = await generateWhatsAppQr(connectionId);
      setQrState({ connectionId, qr: out?.qr || null });
      setQrImageError(false);
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
      showToast('Conexão desconectada', 'success');
      await fetchWhatsAppConnections();
    } catch (err) {
      showToast('Erro ao desconectar', 'error');
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
        <h1>📱 WhatsApp Cloud API & QR</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <Button onClick={fetchCloudAccounts} disabled={loadingCloud} className="support-button">Atualizar Cloud</Button>
          <Button onClick={fetchWhatsAppConnections} disabled={loadingQr} className="support-button">Atualizar QR</Button>
        </div>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
        <div className="support-details-panel">
          <div className="support-details-title">{editing ? 'Editar conexão Cloud' : 'Nova conexão'}</div>
          <div className="support-form-group">
            <label className="support-form-label">Tipo de conexão <span style={{color:'#e11d48'}}>*</span></label>
            <select value={connectionType} onChange={e => setConnectionType(e.target.value)} style={{width:'100%',padding:'8px',borderRadius:'4px',border:'1px solid #ccc'}}>
              <option value="cloud">Cloud API</option>
              <option value="qr">QR Code (Baileys)</option>
            </select>
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Label <span style={{color:'#e11d48'}}>*</span></label>
            <Input value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="Ex: Loja Centro" />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Phone Number ID <span style={{color:'#e11d48'}}>*</span></label>
            <Input value={form.phone_number_id} onChange={(e) => setForm((p) => ({ ...p, phone_number_id: e.target.value }))} placeholder="Ex: 1234567890" />
          </div>
          {connectionType === 'cloud' && (
            <>
              <div className="support-form-group">
                <label className="support-form-label">Access Token <span style={{color:'#e11d48'}}>*</span></label>
                <Input value={form.access_token} onChange={(e) => setForm((p) => ({ ...p, access_token: e.target.value }))} placeholder="Access Token" type="password" />
              </div>
              <div className="support-form-group">
                <label className="support-form-label">Verify Token <span style={{color:'#e11d48'}}>*</span></label>
                <Input value={form.verify_token} onChange={(e) => setForm((p) => ({ ...p, verify_token: e.target.value }))} placeholder="Verify Token" />
              </div>
            </>
          )}
          <div className="support-form-group flex items-center gap-2">
            <input type="checkbox" checked={form.active} onChange={e => setForm((p) => ({ ...p, active: e.target.checked }))} id="active" />
            <label htmlFor="active" className="support-form-label">Ativo</label>
          </div>
          <div className="flex gap-2 mt-4">
            {connectionType === 'cloud' ? (
              <Button onClick={handleSaveCloud} className="support-button-full" disabled={loadingCloud}>{editing ? 'Salvar' : 'Criar'}</Button>
            ) : (
              <Button onClick={handleCreateQrConnection} className="support-button-full" disabled={loadingQr}>Criar QR</Button>
            )}
            {editing && (
              <Button onClick={() => { setForm({ label: '', phone_number_id: '', access_token: '', verify_token: '', active: true, id: null }); setEditing(false); }} variant="ghost">Cancelar</Button>
            )}
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Conexões Cloud API</div>
          {loadingCloud ? (
            <div className="text-text-tertiary">Carregando...</div>
          ) : cloudAccounts.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma conexão cadastrada.</div>
          ) : (
            <div className="space-y-4">
              {cloudAccounts.map((acc) => (
                <div key={acc.id} className="p-4 rounded-lg border border-border-default bg-bg-tertiary">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{acc.config?.label || acc.externalId}</div>
                      <div className="text-xs text-text-tertiary">Phone ID: {acc.externalId}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${acc.status === 'active' ? 'bg-status-success/10 text-status-success border border-status-success/20' : 'bg-status-error/10 text-status-error border border-status-error/20'}`}>{acc.status === 'active' ? 'Ativo' : 'Inativo'}</span>
                  </div>
                  <div className="text-xs text-text-tertiary mt-2">
                    <div><strong>ID</strong>: {acc.id}</div>
                    <div><strong>Atualizado</strong>: {acc.updatedAt || '-'}</div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <Button onClick={() => handleEditCloud(acc)} style={{ width: 'auto' }} disabled={busyId === acc.id}>Editar</Button>
                    <Button onClick={() => handleDeleteCloudAccount(acc.id)} className="support-button-danger" style={{ width: 'auto' }} disabled={busyId === acc.id}>Remover</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Conexões WhatsApp QR (Baileys)</div>
          {loadingQr ? (
            <div className="text-text-tertiary">Carregando...</div>
          ) : waConnections.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma conexão QR cadastrada.</div>
          ) : (
            <div className="space-y-4">
              {waConnections.map((wa) => (
                <div key={wa.id} className="p-4 rounded-lg border border-border-default bg-bg-tertiary">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{wa.label || wa.id}</div>
                      <div className="text-xs text-text-tertiary">ID: {wa.id}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${wa.status === 'connected' ? 'bg-status-success/10 text-status-success border border-status-success/20' : wa.status === 'pairing' ? 'bg-status-warning/10 text-status-warning border border-status-warning/20' : 'bg-status-error/10 text-status-error border border-status-error/20'}`}>{statusBadge(wa.status).label}</span>
                  </div>
                  <div className="text-xs text-text-tertiary mt-2">
                    <div><strong>Atualizado</strong>: {wa.updatedAt || '-'}</div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <Button onClick={() => handleGenerateQr(wa.id)} style={{ width: 'auto' }} disabled={busyId === wa.id || wa.status === 'connected'}>Gerar QR</Button>
                    <Button onClick={() => handleDisconnect(wa.id)} style={{ width: 'auto' }} disabled={busyId === wa.id || wa.status !== 'connected'}>Desconectar</Button>
                    <Button onClick={() => handleDeleteQrConnection(wa.id)} className="support-button-danger" style={{ width: 'auto' }} disabled={busyId === wa.id}>Remover</Button>
                  </div>
                  {qrState.connectionId === wa.id && waQrImageUrl && (
                    <div className="mt-4 flex flex-col items-center">
                      <img src={waQrImageUrl} alt="QR Code" width={240} height={240} onError={() => setQrImageError(true)} />
                      <div className="text-xs text-text-tertiary mt-2">Escaneie o QR no WhatsApp</div>
                      <Button onClick={handleCopyQr} className="mt-2">Copiar QR</Button>
                      {qrImageError && <div className="text-status-error mt-2">Erro ao carregar QR</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
