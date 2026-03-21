import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { Dialog } from '../components/Dialog';
import logger from '../utils/logger';
import { listChannelAccounts, createChannelAccount, updateChannelAccount, deleteChannelAccount, testChannelAccount } from '../api/channelAccounts';
import { CrudPageBase } from '../modules/crud-base';

function safeJsonParse(text) {
  if (!text) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function configTemplateForType(type, externalId = '') {
  const t = String(type || '').toLowerCase();
  if (t === 'whatsapp') {
    return JSON.stringify({
      accessToken: 'SEU_TOKEN_DO_META',
      phone_number_id: externalId || 'PHONE_NUMBER_ID',
      apiUrl: 'https://graph.facebook.com/v18.0',
    }, null, 2);
  }
  if (t === 'instagram') {
    return JSON.stringify({
      pageAccessToken: 'SEU_PAGE_ACCESS_TOKEN',
      pageId: externalId || 'PAGE_ID',
      apiUrl: 'https://graph.facebook.com/v18.0',
    }, null, 2);
  }
  if (t === 'webchat') {
    return JSON.stringify({
      // Exemplo: qualquer config extra do webchat futuro
    }, null, 2);
  }
  return JSON.stringify({}, null, 2);
}

function validateByType(type, { externalId, configObj } = {}) {
  const t = String(type || '').toLowerCase();
  const cfg = configObj && typeof configObj === 'object' ? configObj : null;

  if (t === 'webchat') return { ok: true, missing: [] };

  if (t === 'whatsapp') {
    const token = cfg?.accessToken || cfg?.token || cfg?.whatsappAccessToken || cfg?.pageAccessToken;
    const phoneNumberId = externalId || cfg?.phone_number_id || cfg?.phoneNumberId || cfg?.phone_numberId;
    const missing = [];
    if (!token) missing.push('config.accessToken (ou config.token)');
    if (!phoneNumberId) missing.push('externalId (phone_number_id) ou config.phone_number_id');
    return { ok: missing.length === 0, missing };
  }

  if (t === 'instagram') {
    const token = cfg?.pageAccessToken || cfg?.accessToken || cfg?.token;
    const pageId = externalId || cfg?.pageId || cfg?.page_id;
    const missing = [];
    if (!token) missing.push('config.pageAccessToken (ou config.accessToken)');
    if (!pageId) missing.push('externalId (pageId) ou config.pageId');
    return { ok: missing.length === 0, missing };
  }

  return { ok: true, missing: [] };
}

export function ChannelAccountsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);

  const [form, setForm] = useState({
    type: 'whatsapp',
    status: 'active',
    externalId: '',
    configJson: '',
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [authLoading, isAuthenticated, navigate]);

  const load = async () => {
    setLoading(true);
    try {
      setError(null);
      const resp = await listChannelAccounts({ includeConfig: false });
      setAccounts(resp?.accounts || []);
    } catch (err) {
      logger.error('[ChannelAccounts] Erro ao listar', err);
      setError(err?.message || 'Erro ao carregar canais');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ type: 'whatsapp', status: 'active', externalId: '', configJson: configTemplateForType('whatsapp', '') });
    setIsModalOpen(true);
  };

  const openEdit = async (acct) => {
    setEditing(acct);
    // Para editar config, precisamos buscar includeConfig=true
    try {
      const resp = await listChannelAccounts({ includeConfig: true });
      const full = (resp?.accounts || []).find(a => a.id === acct.id) || acct;
      setForm({
        type: full.type || 'whatsapp',
        status: full.status || 'active',
        externalId: full.externalId || '',
        configJson: full.config ? JSON.stringify(full.config, null, 2) : configTemplateForType(full.type, full.externalId || ''),
      });
      setIsModalOpen(true);
    } catch (err) {
      logger.error('[ChannelAccounts] Erro ao carregar config', err);
      showToast('Erro ao carregar config do canal', 'error');
    }
  };

  const handleSave = async () => {
    const parsed = safeJsonParse(form.configJson);
    if (!parsed.ok) {
      showToast(`JSON inválido: ${parsed.error}`, 'error');
      return;
    }

    const validation = validateByType(form.type, { externalId: form.externalId, configObj: parsed.value });
    if (!validation.ok) {
      showToast(`Config incompleta: ${validation.missing.join(', ')}`, 'error');
      return;
    }

    setSaving(true);
    try {
      if (editing?.id) {
        await updateChannelAccount(editing.id, {
          type: form.type,
          status: form.status,
          externalId: form.externalId || null,
          config: parsed.value,
        });
        showToast('Canal atualizado com sucesso', 'success');
      } else {
        await createChannelAccount({
          type: form.type,
          status: form.status,
          externalId: form.externalId || null,
          config: parsed.value,
        });
        showToast('Canal criado com sucesso', 'success');
      }
      setIsModalOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      logger.error('[ChannelAccounts] Erro ao salvar', err);
      showToast(err?.message || 'Erro ao salvar canal', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (acct) => {
    setTestingId(acct.id);
    try {
      const resp = await testChannelAccount(acct.id);
      if (resp?.success) {
        showToast('✅ Conexão OK', 'success');
      } else {
        showToast(resp?.message || 'Falha ao testar conexão', 'error');
      }
    } catch (err) {
      const msg = err?.message || 'Falha ao testar conexão';
      showToast(msg, 'error');
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (acct) => {
    const ok = await confirm({
      title: 'Remover canal',
      message: `Tem certeza que deseja remover o canal "${acct.type}" (${acct.id})?`,
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await deleteChannelAccount(acct.id);
      showToast('Canal removido com sucesso', 'success');
      await load();
    } catch (err) {
      logger.error('[ChannelAccounts] Erro ao remover', err);
      showToast(err?.message || 'Erro ao remover canal', 'error');
    }
  };

  const grouped = useMemo(() => {
    const byType = {};
    for (const a of accounts) {
      const t = a.type || 'unknown';
      if (!byType[t]) byType[t] = [];
      byType[t].push(a);
    }
    return byType;
  }, [accounts]);

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
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🔌 Canais</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={() => navigate('/channel-health')} style={{ width: 'auto' }}>
              Ver Saúde
            </Button>
            <Button onClick={openCreate} style={{ width: 'auto' }}>
              + Novo Canal
            </Button>
          </div>
        </div>
      
        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-text-secondary">Carregando...</div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="text-text-secondary">Nenhum canal configurado ainda.</div>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-xl font-semibold text-text-primary mb-4">{type}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {items.map((a) => (
                  <div key={a.id} className="p-4 rounded-lg border border-border-default bg-bg-tertiary">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-text-primary">{a.id}</div>
                      <span className="text-xs text-text-tertiary">{a.status}</span>
                    </div>
                    <div className="text-sm text-text-secondary mt-2">
                      <div><strong>externalId</strong>: {a.externalId || '-'}</div>
                      <div><strong>updatedAt</strong>: {a.updatedAt || '-'}</div>
                    </div>
                    <div className="flex gap-2 justify-end mt-4">
                      <Button
                        onClick={() => handleTest(a)}
                        style={{ width: 'auto' }}
                        disabled={testingId === a.id}
                        title="Faz uma chamada best-effort ao Graph API"
                      >
                        {testingId === a.id ? 'Testando...' : 'Testar'}
                      </Button>
                      <Button onClick={() => openEdit(a)} style={{ width: 'auto' }}>
                        Editar
                      </Button>
                      <Button onClick={() => handleDelete(a)} className="support-button-danger" style={{ width: 'auto' }}>
                        Remover
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        isOpen={isModalOpen}
        onClose={() => { if (!saving) setIsModalOpen(false); }}
        title={editing ? 'Editar Canal' : 'Novo Canal'}
        size="lg"
        draggable={!saving}
        resizable={!saving}
        showCloseButton={!saving}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">Tipo</div>
              <select
                value={form.type}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setForm((p) => {
                    const next = { ...p, type: nextType };
                    // se não tem config, preenche com template
                    if (!p.configJson || String(p.configJson).trim() === '') {
                      next.configJson = configTemplateForType(nextType, p.externalId || '');
                    }
                    return next;
                  });
                }}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                disabled={saving}
              >
                <option value="whatsapp">whatsapp</option>
                <option value="instagram">instagram</option>
                <option value="webchat">webchat</option>
              </select>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">Status</div>
              <select
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                disabled={saving}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">External ID</div>
            <Input
              type="text"
              value={form.externalId}
              onChange={(e) => setForm((p) => ({ ...p, externalId: e.target.value }))}
              placeholder="Ex: phone_number_id (WA) / pageId (IG)"
              className="w-full font-mono text-xs"
              disabled={saving}
            />
            <div className="text-xs text-text-tertiary">
              {form.type === 'whatsapp' ? 'WhatsApp: use o phone_number_id (Meta).' :
               form.type === 'instagram' ? 'Instagram: use o pageId (Meta).' :
               'Webchat: opcional.'}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">Config (JSON)</div>
            <textarea
              value={form.configJson}
              onChange={(e) => setForm((p) => ({ ...p, configJson: e.target.value }))}
              placeholder='Ex: {"token":"...","phone_number_id":"..."}'
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-xs"
              rows={10}
              disabled={saving}
            />
            <div className="text-xs text-text-tertiary">
              Observação: o backend armazena este JSON criptografado (AES-256-GCM).
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setForm((p) => ({ ...p, configJson: configTemplateForType(p.type, p.externalId || '') }))}
                style={{ width: 'auto' }}
                disabled={saving}
              >
                Preencher exemplo
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </Dialog>

      <ToastContainer />
      <ConfirmDialog />
    </CrudPageBase>
  );
}

