import React, { useEffect, useMemo, useState } from 'react';
import { getProvisioningTokenOrNull, listAcls, listExtensions, upsertExtension } from '../api/pbx';
import { Button } from '../styles/Button';
import { PlatformGrid, usePlatformGridState } from '../modules/platform-grid';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

const FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

const SELECT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover';

const CONTEXT_OPTIONS = [
  ['senha', 'Senha'],
  ['ramal', 'Ramal'],
  ['local', 'Local'],
  ['local-cel', 'Local Celulares'],
  ['interurbano', 'Interurbano'],
  ['internacional', 'Internacional'],
];

const PROTOCOL_OPTIONS = [
  ['PJSIP', 'SIP (PJSIP)'],
  ['IAX2', 'IAX2'],
];

const TYPE_OPTIONS = [
  ['Livre', 'Livre'],
  ['Controle', 'Controle'],
  ['Senha', 'Senha'],
];

const EMPTY_FORM = {
  extension: '',
  displayName: '',
  authUsername: '',
  authPassword: '',
  calleridName: '',
  calleridNumber: '',
  calleridExternal: '',
  contexto: 'ramal',
  grupo: '',
  gsm: false,
  g729: false,
  correio: false,
  webfone: false,
  gravar: false,
  protocolo: 'PJSIP',
  bloqueio: '0.0.0.0/0',
  permissao: '0.0.0.0/0',
  tipo: 'Livre',
  senhad: '',
  chamadas: '10',
  tempo: '60',
  aclId: '',
  provisioningEnabled: false,
  provisioningVendor: 'grandstream',
  provisioningMac: '',
  provisioningModel: '',
};

function formatDateTime(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

function parseExtensionToForm(row) {
  const opts = row?.endpointOptions || {};
  const prov = row?.endpointOptions?.provisioning || row?.provisioning || null;
  const grupoVal = Array.isArray(opts?.grupo)
    ? opts.grupo.join(', ')
    : (opts?.grupo ? String(opts.grupo) : '');

  return {
    extension: String(row?.extension || ''),
    displayName: String(row?.displayName || ''),
    authUsername: String(row?.authUsername || ''),
    authPassword: '',
    calleridName: String(row?.calleridName || ''),
    calleridNumber: String(row?.calleridNumber || ''),
    calleridExternal: String(opts?.calleridExternal || ''),
    contexto: String(opts?.contexto || 'ramal'),
    grupo: String(grupoVal || ''),
    gsm: !!opts?.gsm,
    g729: !!opts?.g729,
    correio: !!opts?.correio,
    webfone: !!opts?.webfone,
    gravar: !!opts?.gravar,
    protocolo: String(opts?.protocolo || 'PJSIP'),
    bloqueio: String(opts?.bloqueio || '0.0.0.0/0'),
    permissao: String(opts?.permissao || '0.0.0.0/0'),
    tipo: String(opts?.tipo || 'Livre'),
    senhad: String(opts?.senhad || ''),
    chamadas: String(opts?.chamadas ?? '10'),
    tempo: String(opts?.tempo ?? '60'),
    aclId: String(opts?.aclId || ''),
    provisioningEnabled: !!prov?.enabled,
    provisioningVendor: String(prov?.vendor || 'grandstream'),
    provisioningMac: String(prov?.mac || ''),
    provisioningModel: String(prov?.model || ''),
  };
}

function buildExtensionPayload(form) {
  const parseIntOrNull = (v) => {
    const s = String(v || '').trim();
    if (!s) return null;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const grupo = String(form.grupo || '')
    .split(/[,\s;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const provisioning = form.provisioningEnabled
    ? {
        enabled: true,
        vendor: (form.provisioningVendor || '').trim().toLowerCase(),
        mac: (form.provisioningMac || '').trim(),
        model: (form.provisioningModel || '').trim() || null,
      }
    : null;

  return {
    extension: (form.extension || '').trim(),
    displayName: (form.displayName || '').trim() || null,
    authUsername: (form.authUsername || '').trim() || null,
    authPassword: (form.authPassword || '').trim() || null,
    calleridName: (form.calleridName || '').trim() || null,
    calleridNumber: (form.calleridNumber || '').trim() || null,
    endpointOptions: {
      aclId: (form.aclId || '').trim() || null,
      contexto: (form.contexto || '').trim() || 'ramal',
      grupo,
      gsm: !!form.gsm,
      g729: !!form.g729,
      correio: !!form.correio,
      webfone: !!form.webfone,
      gravar: !!form.gravar,
      protocolo: (form.protocolo || '').trim() || 'PJSIP',
      bloqueio: (form.bloqueio || '').trim() || null,
      permissao: (form.permissao || '').trim() || null,
      calleridExternal: (form.calleridExternal || '').trim() || null,
      tipo: (form.tipo || '').trim() || 'Livre',
      senhad: (form.senhad || '').trim() || null,
      chamadas: parseIntOrNull(form.chamadas),
      tempo: parseIntOrNull(form.tempo),
    },
    provisioning,
  };
}

function getExtensionAclLabel(row, acls) {
  const aclId = String(row?.endpointOptions?.aclId || '').trim();
  if (!aclId) return '—';
  const acl = (acls || []).find((item) => String(item?.id || '').trim() === aclId);
  if (!acl) return aclId;
  return `${acl.name || aclId}`;
}

export function PbxExtensionsPage() {
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [extensions, setExtensions] = useState([]);
  const [acls, setAcls] = useState([]);

  const [provisioningToken, setProvisioningToken] = useState('');
  const [provisioningTokenExpiresAt, setProvisioningTokenExpiresAt] = useState('');

  const [filters, setFilters] = useState({
    search: '',
    contexto: '',
    protocolo: '',
    status: '',
  });

  const [showForm, setShowForm] = useState(false);
  const [editingExtension, setEditingExtension] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canSave = useMemo(() => {
    const ext = String(form.extension || '').trim();
    const name = String(form.displayName || '').trim();
    const user = String(form.authUsername || '').trim();
    const pass = String(form.authPassword || '').trim();
    const context = String(form.contexto || '').trim();
    const protocol = String(form.protocolo || '').trim();
    const block = String(form.bloqueio || '').trim();
    const allow = String(form.permissao || '').trim();
    const type = String(form.tipo || '').trim();
    const senhad = String(form.senhad || '').trim();
    const chamadas = Number.parseInt(String(form.chamadas || '').trim(), 10);
    const tempo = Number.parseInt(String(form.tempo || '').trim(), 10);

    if (!ext || !name || !user || !context || !protocol || !block || !allow || !type) return false;
    if (!editingExtension && !pass) return false;
    if (type === 'Senha' && !senhad) return false;
    if (!Number.isFinite(chamadas) || chamadas < 1 || chamadas > 15) return false;
    if (!Number.isFinite(tempo) || tempo < 1) return false;

    if (!form.provisioningEnabled) return true;

    const provisioningVendor = String(form.provisioningVendor || '').trim().toLowerCase();
    const vendorOk = provisioningVendor === 'grandstream' || provisioningVendor === 'avaya';
    const mac = String(form.provisioningMac || '').trim().replace(/[^a-fA-F0-9]/g, '').toUpperCase();

    return vendorOk && mac.length === 12;
  }, [form, editingExtension]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [extensionsRes, aclsRes, tokenRes] = await Promise.all([
        listExtensions(),
        listAcls(),
        getProvisioningTokenOrNull(),
      ]);

      setExtensions(Array.isArray(extensionsRes?.items) ? extensionsRes.items : []);
      setAcls(Array.isArray(aclsRes?.items) ? aclsRes.items : []);
      setProvisioningToken(String(tokenRes?.token || ''));
      setProvisioningTokenExpiresAt(String(tokenRes?.expiresAt || ''));
    } catch (err) {
      logger.error('[PbxExtensionsPage] load failed', err);
      const message = err?.message || 'Erro ao carregar ramais.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredExtensions = useMemo(() => {
    const search = String(filters.search || '').trim().toLowerCase();

    return (extensions || []).filter((row) => {
      const contexto = String(row?.endpointOptions?.contexto || '').trim();
      const protocolo = String(row?.endpointOptions?.protocolo || '').trim();
      const status = String(row?.status || 'active').toLowerCase();

      if (filters.contexto && contexto !== filters.contexto) return false;
      if (filters.protocolo && protocolo !== filters.protocolo) return false;
      if (filters.status && status !== filters.status) return false;

      if (!search) return true;

      const haystack = [
        row?.extension,
        row?.displayName,
        row?.authUsername,
        row?.calleridName,
        row?.calleridNumber,
        row?.endpointOptions?.contexto,
        row?.endpointOptions?.protocolo,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');

      return haystack.includes(search);
    });
  }, [extensions, filters]);

  function clearFilters() {
    setFilters({ search: '', contexto: '', protocolo: '', status: '' });
  }

  function openCreate() {
    setEditingExtension(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(row) {
    setEditingExtension(row);
    setForm(parseExtensionToForm(row));
    setShowForm(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    setError('');
    try {
      const payload = buildExtensionPayload(form);
      await upsertExtension(payload);

      showToast(editingExtension ? 'Ramal atualizado com sucesso.' : 'Ramal criado com sucesso.', 'success');

      setShowForm(false);
      setEditingExtension(null);
      setForm(EMPTY_FORM);

      await loadData();
    } catch (err) {
      logger.error('[PbxExtensionsPage] save failed', err);
      const message = err?.message || 'Erro ao salvar ramal.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const hasActiveFilters = !!(filters.search || filters.contexto || filters.protocolo || filters.status);

  const columns = [
    {
      id: 'extension',
      header: 'Ramal',
      accessor: (row) => row.extension,
      render: (row) => (
        <div>
          <div className="font-medium text-text-primary">{row.extension}</div>
          <div className="text-xs text-text-tertiary">id: {row.id}</div>
        </div>
      ),
    },
    { id: 'displayName', header: 'Nome', accessor: (row) => row.displayName || '—' },
    { id: 'authUsername', header: 'Usuário', accessor: (row) => row.authUsername || '—' },
    { id: 'contexto', header: 'Contexto', accessor: (row) => row?.endpointOptions?.contexto || '—' },
    { id: 'protocolo', header: 'Protocolo', accessor: (row) => row?.endpointOptions?.protocolo || '—' },
    {
      id: 'acl',
      header: 'ACL',
      sortValue: (row) => getExtensionAclLabel(row, acls),
      render: (row) => getExtensionAclLabel(row, acls),
    },
    {
      id: 'provisioning',
      header: 'Provisionamento',
      sortable: false,
      render: (row) => {
        const provisioning = row?.endpointOptions?.provisioning || row?.provisioning;
        return provisioning?.enabled
          ? `${provisioning.vendor || '—'} / ${provisioning.mac || '—'}`
          : '—';
      },
    },
    {
      id: 'status',
      header: 'Status',
      render: (row) => {
        const inactive = String(row?.status || 'active').toLowerCase() === 'inactive';
        return inactive ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-status-error/20 text-status-error border border-status-error/30">
            Inativo
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-status-success/20 text-status-success border border-status-success/30">
            Ativo
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: 'Ações',
      sortable: false,
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" disabled>
            Reset Senha
          </Button>
          <Button size="sm" variant="danger" disabled>
            Remover
          </Button>
        </div>
      ),
    },
  ];

  const grid = usePlatformGridState({
    rows: filteredExtensions,
    columns,
    initialSort: { columnId: 'extension', direction: 'asc' },
    persistenceKey: 'pbx-extensions-grid',
    getSearchText: (row) => [row?.extension, row?.displayName, row?.authUsername, row?.calleridName, row?.calleridNumber].join(' '),
  });

  if (loading) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <div className="page-header">
            <h1>📞 PBX • Ramais</h1>
          </div>
        </div>
        <div className="flex-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando ramais...</p>
          </div>
        </div>
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>📞 PBX • Ramais</h1>
        </div>
        <div className="support-controls">
          <Button onClick={openCreate} style={{ backgroundColor: '#25D366', color: 'white', marginRight: '10px' }}>
            ➕ Incluir
          </Button>
          <Button onClick={loadData} style={{ backgroundColor: '#6366f1', color: 'white' }}>
            🔄 Atualizar
          </Button>
        </div>
      </div>

      {!!error && (
        <div className="bg-status-error/10 border border-status-error/30 text-status-error rounded-lg p-3 mb-6 text-sm">
          {error}
        </div>
      )}

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Buscar</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Ramal, nome, usuário ou caller ID..."
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Contexto</label>
            <select
              value={filters.contexto}
              onChange={(e) => setFilters((prev) => ({ ...prev, contexto: e.target.value }))}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {CONTEXT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Protocolo</label>
            <select
              value={filters.protocolo}
              onChange={(e) => setFilters((prev) => ({ ...prev, protocolo: e.target.value }))}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {PROTOCOL_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <Button onClick={clearFilters} variant="default" className="w-full" disabled={!hasActiveFilters}>
              Limpar Filtros
            </Button>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-sm text-text-secondary">
              Mostrando <strong>{filteredExtensions.length}</strong> de <strong>{extensions.length}</strong> ramal(is)
            </p>
          </div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-4 mb-6 shadow-lg">
        <div className="text-sm text-text-secondary">
          <strong>Token de provisionamento:</strong> {provisioningToken || '—'}
          {provisioningTokenExpiresAt ? (
            <span> · expira em {formatDateTime(provisioningTokenExpiresAt)}</span>
          ) : null}
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        <PlatformGrid
          columns={columns}
          rows={grid.rows}
          sort={grid.sort}
          onSortChange={grid.handleSortChange}
          pagination={{
            page: grid.page,
            pageSize: grid.pageSize,
            totalPages: grid.totalPages,
            totalRows: grid.totalRows,
            onPageChange: grid.handlePageChange,
            onPageSizeChange: grid.handlePageSizeChange,
          }}
          emptyState={{
            title: 'Nenhum ramal encontrado',
            description: 'Comece adicionando um novo ramal ao PBX.',
          }}
        />
      </div>

      {showForm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowForm(false);
            }
          }}
        >
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <h2 className="text-2xl font-bold text-text-primary mb-6">
              {editingExtension ? 'Editar Ramal' : 'Incluir Ramal'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Ramal *</label>
                  <input className={FIELD_CLASS} value={form.extension} disabled={!!editingExtension} onChange={(e) => setForm((prev) => ({ ...prev, extension: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Nome *</label>
                  <input className={FIELD_CLASS} value={form.displayName} onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Usuário *</label>
                  <input className={FIELD_CLASS} value={form.authUsername} onChange={(e) => setForm((prev) => ({ ...prev, authUsername: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Senha {editingExtension ? '(opcional)' : '*'}</label>
                  <input className={FIELD_CLASS} type="password" value={form.authPassword} onChange={(e) => setForm((prev) => ({ ...prev, authPassword: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">CallerID interno</label>
                  <input className={FIELD_CLASS} value={form.calleridName} onChange={(e) => setForm((prev) => ({ ...prev, calleridName: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">CallerID número</label>
                  <input className={FIELD_CLASS} value={form.calleridNumber} onChange={(e) => setForm((prev) => ({ ...prev, calleridNumber: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">CallerID externo</label>
                  <input className={FIELD_CLASS} value={form.calleridExternal} onChange={(e) => setForm((prev) => ({ ...prev, calleridExternal: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">ACL</label>
                  <select className={SELECT_CLASS} value={form.aclId} onChange={(e) => setForm((prev) => ({ ...prev, aclId: e.target.value }))}>
                    <option value="">(nenhuma)</option>
                    {(acls || []).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Contexto *</label>
                  <select className={SELECT_CLASS} value={form.contexto} onChange={(e) => setForm((prev) => ({ ...prev, contexto: e.target.value }))}>
                    {CONTEXT_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Protocolo *</label>
                  <select className={SELECT_CLASS} value={form.protocolo} onChange={(e) => setForm((prev) => ({ ...prev, protocolo: e.target.value }))}>
                    {PROTOCOL_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Tipo *</label>
                  <select className={SELECT_CLASS} value={form.tipo} onChange={(e) => setForm((prev) => ({ ...prev, tipo: e.target.value }))}>
                    {TYPE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Grupo(s)</label>
                  <input className={FIELD_CLASS} value={form.grupo} onChange={(e) => setForm((prev) => ({ ...prev, grupo: e.target.value }))} placeholder="Ex: 1,2" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Senha D</label>
                  <input className={FIELD_CLASS} value={form.senhad} onChange={(e) => setForm((prev) => ({ ...prev, senhad: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Chamadas *</label>
                  <input className={FIELD_CLASS} type="number" value={form.chamadas} onChange={(e) => setForm((prev) => ({ ...prev, chamadas: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Tempo *</label>
                  <input className={FIELD_CLASS} type="number" value={form.tempo} onChange={(e) => setForm((prev) => ({ ...prev, tempo: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Bloqueio *</label>
                  <input className={FIELD_CLASS} value={form.bloqueio} onChange={(e) => setForm((prev) => ({ ...prev, bloqueio: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Permissão *</label>
                  <input className={FIELD_CLASS} value={form.permissao} onChange={(e) => setForm((prev) => ({ ...prev, permissao: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <label className="flex items-center gap-2 text-sm text-text-primary"><input className="w-auto" type="checkbox" checked={!!form.gsm} onChange={(e) => setForm((prev) => ({ ...prev, gsm: e.target.checked }))} /> GSM</label>
                <label className="flex items-center gap-2 text-sm text-text-primary"><input className="w-auto" type="checkbox" checked={!!form.g729} onChange={(e) => setForm((prev) => ({ ...prev, g729: e.target.checked }))} /> G729</label>
                <label className="flex items-center gap-2 text-sm text-text-primary"><input className="w-auto" type="checkbox" checked={!!form.correio} onChange={(e) => setForm((prev) => ({ ...prev, correio: e.target.checked }))} /> Correio</label>
                <label className="flex items-center gap-2 text-sm text-text-primary"><input className="w-auto" type="checkbox" checked={!!form.webfone} onChange={(e) => setForm((prev) => ({ ...prev, webfone: e.target.checked }))} /> WebFone</label>
                <label className="flex items-center gap-2 text-sm text-text-primary"><input className="w-auto" type="checkbox" checked={!!form.gravar} onChange={(e) => setForm((prev) => ({ ...prev, gravar: e.target.checked }))} /> Gravar</label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <label className="h-[42px] px-3 border border-border-default rounded-lg bg-bg-secondary flex items-center gap-2 text-sm text-text-primary">
                  <input className="w-auto" type="checkbox" checked={!!form.provisioningEnabled} onChange={(e) => setForm((prev) => ({ ...prev, provisioningEnabled: e.target.checked }))} />
                  Provisionamento
                </label>
                <select className={SELECT_CLASS} value={form.provisioningVendor} disabled={!form.provisioningEnabled} onChange={(e) => setForm((prev) => ({ ...prev, provisioningVendor: e.target.value }))}>
                  <option value="grandstream">grandstream</option>
                  <option value="avaya">avaya</option>
                </select>
                <input className={FIELD_CLASS} placeholder="MAC (12 hex)" value={form.provisioningMac} disabled={!form.provisioningEnabled} onChange={(e) => setForm((prev) => ({ ...prev, provisioningMac: e.target.value }))} />
                <input className={FIELD_CLASS} placeholder="Modelo (opcional)" value={form.provisioningModel} disabled={!form.provisioningEnabled} onChange={(e) => setForm((prev) => ({ ...prev, provisioningModel: e.target.value }))} />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={!canSave || saving} variant="primary" className="flex-1">
                  {saving ? 'Salvando...' : 'Salvar'}
                </Button>
                <Button type="button" onClick={() => setShowForm(false)} variant="ghost" className="flex-1">
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}

export default PbxExtensionsPage;
