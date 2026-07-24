import React, { useEffect, useMemo, useState } from 'react';
import { listTrunks, upsertTrunk } from '../api/pbx';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { PlatformGrid, usePlatformGridState } from '../modules/platform-grid';
import { CrudPageBase } from '../modules/crud-base';

const FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

const SELECT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover';

const EMPTY_FORM = {
  name: '',
  type: 'pjsip',
  transport: '',
  authUsername: '',
  authPassword: '',
  aorContact: '',
  endpointAllow: 'ulaw,alaw',
};

function parseTrunkToForm(row) {
  return {
    name: String(row?.name || ''),
    type: String(row?.type || 'pjsip'),
    transport: String(row?.transport || ''),
    authUsername: String(row?.auth?.username || row?.authUsername || ''),
    authPassword: '',
    aorContact: String(row?.aor?.contact || row?.aorContact || ''),
    endpointAllow: String(row?.endpoint?.allow || row?.endpointAllow || 'ulaw,alaw'),
  };
}

function buildPayload(form) {
  return {
    name: (form.name || '').trim(),
    type: (form.type || 'pjsip').trim(),
    transport: (form.transport || '').trim() || null,
    auth: {
      username: (form.authUsername || '').trim() || null,
      password: (form.authPassword || '').trim() || null,
    },
    aor: {
      contact: (form.aorContact || '').trim() || null,
      maxContacts: 1,
    },
    endpoint: {
      allow: (form.endpointAllow || '').trim() || null,
      disallow: 'all',
      direct_media: 'no',
    },
  };
}

export function PbxTrunksPage() {
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [trunks, setTrunks] = useState([]);

  const [filters, setFilters] = useState({
    search: '',
    type: '',
    status: '',
  });

  const [showForm, setShowForm] = useState(false);
  const [editingTrunk, setEditingTrunk] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canSave = useMemo(() => {
    const name = String(form.name || '').trim();
    const type = String(form.type || '').trim();
    return !!name && !!type;
  }, [form]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await listTrunks();
      setTrunks(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      logger.error('[PbxTrunksPage] load failed', err);
      const message = err?.message || 'Erro ao carregar troncos.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredTrunks = useMemo(() => {
    const search = String(filters.search || '').trim().toLowerCase();

    return (trunks || []).filter((row) => {
      if (filters.type && String(row?.type || '').toLowerCase() !== String(filters.type).toLowerCase()) return false;
      if (filters.status && String(row?.status || '').toLowerCase() !== String(filters.status).toLowerCase()) return false;

      if (!search) return true;

      const haystack = [
        row?.name,
        row?.type,
        row?.transport,
        row?.status,
        row?.auth?.username,
        row?.aor?.contact,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');

      return haystack.includes(search);
    });
  }, [trunks, filters]);

  function clearFilters() {
    setFilters({ search: '', type: '', status: '' });
  }

  function openCreate() {
    setEditingTrunk(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(row) {
    setEditingTrunk(row);
    setForm(parseTrunkToForm(row));
    setShowForm(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    setError('');
    try {
      await upsertTrunk(buildPayload(form));
      showToast(editingTrunk ? 'Tronco atualizado com sucesso.' : 'Tronco criado com sucesso.', 'success');
      setShowForm(false);
      setEditingTrunk(null);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (err) {
      logger.error('[PbxTrunksPage] save failed', err);
      const message = err?.message || 'Erro ao salvar tronco.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const hasActiveFilters = !!(filters.search || filters.type || filters.status);

  const columns = [
    {
      id: 'name',
      header: 'Nome',
      accessor: (row) => row.name,
      render: (row) => (
        <div>
          <div className="font-medium text-text-primary">{row.name}</div>
          <div className="text-xs text-text-tertiary">id: {row.id}</div>
        </div>
      ),
    },
    { id: 'type', header: 'Tipo', accessor: (row) => row.type || '-' },
    { id: 'transport', header: 'Transport', accessor: (row) => row.transport || '-' },
    { id: 'auth', header: 'Auth User', accessor: (row) => row?.auth?.username || '-' },
    { id: 'aor', header: 'AOR Contact', accessor: (row) => row?.aor?.contact || '-' },
    {
      id: 'status',
      header: 'Status',
      accessor: (row) => row?.status || 'active',
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
      header: 'Acoes',
      sortable: false,
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
            Editar
          </Button>
          <Button size="sm" variant="danger" disabled>
            Excluir
          </Button>
        </div>
      ),
    },
  ];

  const grid = usePlatformGridState({
    rows: filteredTrunks,
    columns,
    initialSort: { columnId: 'name', direction: 'asc' },
    persistenceKey: 'pbx-trunks-grid',
    getSearchText: (row) => [
      row?.name,
      row?.type,
      row?.transport,
      row?.status,
      row?.auth?.username,
      row?.aor?.contact,
    ].join(' '),
  });

  if (loading) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <div className="page-header">
            <h1>🌐 PBX • Troncos</h1>
          </div>
        </div>
        <div className="flex-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando troncos...</p>
          </div>
        </div>
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>🌐 PBX • Troncos</h1>
        </div>
        <div className="support-controls">
          <Button onClick={openCreate} variant="success" className="mr-2.5">
            ➕ Incluir
          </Button>
          <Button onClick={loadData} variant="primary">
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
              placeholder="Nome, auth username, contato, status..."
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Tipo</label>
            <select
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              <option value="pjsip">pjsip</option>
              <option value="iax">iax</option>
            </select>
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
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
              Mostrando <strong>{filteredTrunks.length}</strong> de <strong>{trunks.length}</strong> tronco(s)
            </p>
          </div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        <PlatformGrid
          columns={columns}
          rows={grid.rows}
          sort={grid.sort}
          onSortChange={grid.handleSortChange}
          pagination={{
            page: grid.page,
            totalPages: grid.totalPages,
            pageSize: grid.pageSize,
            totalItems: grid.totalItems,
            pageSizeOptions: grid.pageSizeOptions,
            onPageChange: grid.setPage,
            onPageSizeChange: grid.setPageSize,
          }}
          emptyState={{
            title: 'Nenhum tronco encontrado.',
            description: 'Ajuste os filtros para visualizar troncos PBX.',
          }}
        />
      </div>

      {showForm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowForm(false);
          }}
        >
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <h2 className="text-2xl font-bold text-text-primary mb-6">
              {editingTrunk ? 'Editar Tronco' : 'Incluir Tronco'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Nome *</label>
                  <input className={FIELD_CLASS} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Tipo *</label>
                  <select className={SELECT_CLASS} value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}>
                    <option value="pjsip">pjsip</option>
                    <option value="iax">iax</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Transport</label>
                  <input className={FIELD_CLASS} value={form.transport} onChange={(e) => setForm((prev) => ({ ...prev, transport: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Auth Username</label>
                  <input className={FIELD_CLASS} value={form.authUsername} onChange={(e) => setForm((prev) => ({ ...prev, authUsername: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Auth Password</label>
                  <input className={FIELD_CLASS} type="password" value={form.authPassword} onChange={(e) => setForm((prev) => ({ ...prev, authPassword: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">AOR Contact</label>
                  <input className={FIELD_CLASS} placeholder="sip:provider.com" value={form.aorContact} onChange={(e) => setForm((prev) => ({ ...prev, aorContact: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Allow codecs</label>
                  <input className={FIELD_CLASS} value={form.endpointAllow} onChange={(e) => setForm((prev) => ({ ...prev, endpointAllow: e.target.value }))} />
                </div>
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

export default PbxTrunksPage;
