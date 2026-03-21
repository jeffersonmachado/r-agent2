import React, { useEffect, useMemo, useState } from 'react';
import { listExtensions, listQueues, listRoutes, listTrunks, upsertRoute } from '../api/pbx';
import { Button } from '../styles/Button';
import { PlatformGrid, usePlatformGridState } from '../modules/platform-grid';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

const FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

const SELECT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover';

const EMPTY_FORM = {
  direction: 'outbound',
  name: '',
  priority: 100,
  enabled: true,
  matchMode: 'prefix_any',
  dialPrefix: '',
  exactExten: '',
  actionType: 'hangup',
  actionRef: '',
  stripPrefixLen: '',
  addPrefix: '',
};

function parseRouteToForm(route) {
  const match = route?.match || {};
  const hasExact = String(match.exten || '').trim().length > 0;
  const pattern = String(match.pattern || '').trim();
  const prefixMatch = /^_(\d*)X\.$/.exec(pattern);
  const action = Array.isArray(route?.actions) ? route.actions[0] : null;
  const actionType = String(action?.type || 'hangup');

  return {
    direction: String(route?.direction || 'outbound'),
    name: String(route?.name || ''),
    priority: Number(route?.priority || 100),
    enabled: route?.enabled !== false,
    matchMode: hasExact ? 'exact' : 'prefix_any',
    dialPrefix: hasExact ? '' : (prefixMatch?.[1] || ''),
    exactExten: hasExact ? String(match.exten || '') : '',
    actionType,
    actionRef: String(action?.ref || ''),
    stripPrefixLen: action?.stripPrefixLen == null ? '' : String(action.stripPrefixLen),
    addPrefix: String(action?.prefix || ''),
  };
}

function buildRoutePayload(form) {
  const mode = String(form.matchMode || 'prefix_any');
  const dialPrefix = String(form.dialPrefix || '').trim();
  const exactExten = String(form.exactExten || '').trim();

  let match = {};
  if (mode === 'exact') {
    match = { exten: exactExten };
  } else {
    const cleanPrefix = dialPrefix.replace(/[^0-9]/g, '');
    match = { pattern: `_${cleanPrefix || ''}X.` };
  }

  const actionType = String(form.actionType || 'hangup');
  const actionRef = String(form.actionRef || '').trim();
  const actions = [];

  if (actionType === 'hangup') {
    actions.push({ type: 'hangup' });
  }
  if (actionType === 'extension') {
    actions.push({ type: 'extension', ref: actionRef });
  }
  if (actionType === 'queue') {
    actions.push({ type: 'queue', ref: actionRef });
  }
  if (actionType === 'trunk') {
    const stripPrefixLen = String(form.stripPrefixLen || '').trim();
    const addPrefix = String(form.addPrefix || '').trim();
    const trunkAction = { type: 'trunk', ref: actionRef };
    if (stripPrefixLen !== '' && Number.isFinite(Number(stripPrefixLen))) {
      trunkAction.stripPrefixLen = Number(stripPrefixLen);
    }
    if (addPrefix) {
      trunkAction.prefix = addPrefix;
    }
    actions.push(trunkAction);
  }

  return {
    direction: String(form.direction || 'outbound'),
    name: String(form.name || '').trim(),
    enabled: !!form.enabled,
    priority: Number(form.priority || 100),
    match,
    actions,
  };
}

function routeToDialingLabel(route) {
  const exten = String(route?.match?.exten || '').trim();
  if (exten) return exten;
  const pattern = String(route?.match?.pattern || '').trim();
  if (!pattern) return '—';
  const prefixMatch = /^_(\d*)X\.$/.exec(pattern);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    return prefix ? `${prefix}...` : 'qualquer número';
  }
  return pattern;
}

function routeToDestinationLabel(route) {
  const action = Array.isArray(route?.actions) ? route.actions[0] : null;
  if (!action?.type) return '—';
  return `${action.type}${action.ref ? `: ${action.ref}` : ''}`;
}

export function PbxRoutesPage() {
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routes, setRoutes] = useState([]);
  const [trunks, setTrunks] = useState([]);
  const [queues, setQueues] = useState([]);
  const [extensions, setExtensions] = useState([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    direction: '',
    status: '',
  });
  const [showForm, setShowForm] = useState(false);
  const [editingRoute, setEditingRoute] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canSave = useMemo(() => {
    if (!(form.name || '').trim()) return false;
    if (String(form.matchMode || 'prefix_any') === 'exact' && !(form.exactExten || '').trim()) return false;
    const actionType = String(form.actionType || 'hangup');
    if (actionType !== 'hangup' && !(form.actionRef || '').trim()) return false;
    return true;
  }, [form]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [routesRes, trunksRes, queuesRes, extensionsRes] = await Promise.all([
        listRoutes(),
        listTrunks(),
        listQueues(),
        listExtensions(),
      ]);

      setRoutes(Array.isArray(routesRes?.items) ? routesRes.items : []);
      setTrunks(Array.isArray(trunksRes?.items) ? trunksRes.items : []);
      setQueues(Array.isArray(queuesRes?.items) ? queuesRes.items : []);
      setExtensions(Array.isArray(extensionsRes?.items) ? extensionsRes.items : []);
    } catch (err) {
      logger.error('[PbxRoutesPage] load failed', err);
      const message = err?.message || 'Erro ao carregar rotas.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredRoutes = useMemo(() => {
    const search = String(filters.search || '').trim().toLowerCase();
    return (routes || []).filter((route) => {
      if (filters.direction && route.direction !== filters.direction) return false;
      if (filters.status === 'active' && route.enabled === false) return false;
      if (filters.status === 'inactive' && route.enabled !== false) return false;

      if (!search) return true;

      const haystack = [
        route.name,
        route.direction,
        route?.match?.exten,
        route?.match?.pattern,
        routeToDestinationLabel(route),
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');

      return haystack.includes(search);
    });
  }, [routes, filters]);

  function openCreate() {
    setEditingRoute(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(route) {
    setEditingRoute(route);
    setForm(parseRouteToForm(route));
    setShowForm(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    setError('');
    try {
      await upsertRoute(buildRoutePayload(form));
      showToast(editingRoute ? 'Rota atualizada com sucesso.' : 'Rota criada com sucesso.', 'success');
      setShowForm(false);
      setEditingRoute(null);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (err) {
      logger.error('[PbxRoutesPage] save failed', err);
      const message = err?.message || 'Erro ao salvar rota.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(route) {
    const accepted = await confirm({
      title: 'Excluir rota',
      message: `Deseja excluir a rota "${route?.name}"? Esta ação desativa a rota.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!accepted) return;

    setSaving(true);
    setError('');
    try {
      const payload = {
        direction: String(route?.direction || 'outbound'),
        name: String(route?.name || ''),
        enabled: false,
        priority: Number(route?.priority || 100),
        match: route?.match && typeof route.match === 'object' ? route.match : {},
        actions: Array.isArray(route?.actions) ? route.actions : [],
      };
      await upsertRoute(payload);
      showToast('Rota desativada com sucesso.', 'success');
      await loadData();
    } catch (err) {
      logger.error('[PbxRoutesPage] delete failed', err);
      const message = err?.message || 'Erro ao excluir rota.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setFilters({ search: '', direction: '', status: '' });
  }

  const hasActiveFilters = !!(filters.search || filters.direction || filters.status);
  const extensionOptions = (extensions || []).map((item) => ({
    value: String(item?.extension || ''),
    label: `${item?.extension || ''}${item?.displayName ? ` — ${item.displayName}` : ''}`,
  }));

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
    {
      id: 'direction',
      header: 'Direção',
      accessor: (row) => (row.direction === 'inbound' ? 'Entrada' : 'Saída'),
    },
    {
      id: 'dialing',
      header: 'Discagem',
      sortValue: (row) => routeToDialingLabel(row),
      render: (row) => routeToDialingLabel(row),
    },
    {
      id: 'destination',
      header: 'Destino',
      sortValue: (row) => routeToDestinationLabel(row),
      render: (row) => routeToDestinationLabel(row),
    },
    {
      id: 'priority',
      header: 'Prioridade',
      accessor: (row) => row.priority ?? 100,
      sortValue: (row) => Number(row.priority ?? 100),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => (row.enabled === false ? 0 : 1),
      render: (row) =>
        row.enabled === false ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-status-error/20 text-status-error border border-status-error/30">
            Inativo
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-status-success/20 text-status-success border border-status-success/30">
            Ativo
          </span>
        ),
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
          <Button size="sm" variant="danger" onClick={() => handleDelete(row)} disabled={saving || row.enabled === false}>
            Excluir
          </Button>
        </div>
      ),
    },
  ];

  const grid = usePlatformGridState({
    rows: filteredRoutes,
    columns,
    initialSort: { columnId: 'priority', direction: 'asc' },
    persistenceKey: 'pbx-routes-grid',
    getSearchText: (row) => [row?.name, row?.direction, routeToDialingLabel(row), routeToDestinationLabel(row)].join(' '),
  });

  if (loading) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>🧭 PBX • Rotas</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando rotas...</p>
          </div>
        </div>
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🧭 PBX • Rotas</h1>
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
              placeholder="Nome, direção, padrão ou destino..."
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Direção</label>
            <select
              value={filters.direction}
              onChange={(e) => setFilters((prev) => ({ ...prev, direction: e.target.value }))}
              className={SELECT_CLASS}
            >
              <option value="">Todas</option>
              <option value="inbound">Entrada</option>
              <option value="outbound">Saída</option>
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
              Mostrando <strong>{filteredRoutes.length}</strong> de <strong>{routes.length}</strong> rota(s)
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
            pageSize: grid.pageSize,
            totalPages: grid.totalPages,
            totalRows: grid.totalRows,
            onPageChange: grid.handlePageChange,
            onPageSizeChange: grid.handlePageSizeChange,
          }}
          emptyState={{
            title: 'Nenhuma rota encontrada',
            description: 'Comece criando uma nova rota de entrada ou saída.',
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
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <h2 className="text-2xl font-bold text-text-primary mb-6">
              {editingRoute ? 'Editar Rota' : 'Incluir Rota'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Direção *</label>
                  <select className={SELECT_CLASS} value={form.direction} onChange={(e) => setForm((prev) => ({ ...prev, direction: e.target.value }))}>
                    <option value="inbound">Entrada</option>
                    <option value="outbound">Saída</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Nome *</label>
                  <input className={FIELD_CLASS} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Ex: Saída Operadora A" />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Prioridade</label>
                  <input className={FIELD_CLASS} type="number" value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Tipo de Discagem *</label>
                  <select className={SELECT_CLASS} value={form.matchMode} onChange={(e) => setForm((prev) => ({ ...prev, matchMode: e.target.value }))}>
                    <option value="prefix_any">Discagem com prefixo</option>
                    <option value="exact">Número exato</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    {form.matchMode === 'exact' ? 'Número exato *' : 'Prefixo da discagem'}
                  </label>
                  {form.matchMode === 'exact' ? (
                    <input className={FIELD_CLASS} value={form.exactExten} onChange={(e) => setForm((prev) => ({ ...prev, exactExten: e.target.value }))} placeholder="Ex: 011" />
                  ) : (
                    <input className={FIELD_CLASS} value={form.dialPrefix} onChange={(e) => setForm((prev) => ({ ...prev, dialPrefix: e.target.value }))} placeholder="Ex: 9" />
                  )}
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Ativo</label>
                  <label className="h-[42px] px-3 border border-border-default rounded-lg bg-bg-secondary flex items-center gap-2 text-sm text-text-primary">
                    <input className="w-auto h-auto" type="checkbox" checked={!!form.enabled} onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))} />
                    Sim
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Destino *</label>
                  <select className={SELECT_CLASS} value={form.actionType} onChange={(e) => setForm((prev) => ({ ...prev, actionType: e.target.value, actionRef: '' }))}>
                    <option value="hangup">Desligar</option>
                    <option value="trunk">Tronco</option>
                    <option value="extension">Ramal</option>
                    <option value="queue">Fila</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Referência</label>
                  {form.actionType === 'trunk' ? (
                    <select className={SELECT_CLASS} value={form.actionRef} onChange={(e) => setForm((prev) => ({ ...prev, actionRef: e.target.value }))}>
                      <option value="">Selecione...</option>
                      {trunks.map((trunk) => (
                        <option key={trunk.id} value={trunk.name}>
                          {trunk.name}
                        </option>
                      ))}
                    </select>
                  ) : form.actionType === 'queue' ? (
                    <select className={SELECT_CLASS} value={form.actionRef} onChange={(e) => setForm((prev) => ({ ...prev, actionRef: e.target.value }))}>
                      <option value="">Selecione...</option>
                      {queues.map((queue) => (
                        <option key={queue.id} value={queue.name}>
                          {queue.name}
                        </option>
                      ))}
                    </select>
                  ) : form.actionType === 'extension' ? (
                    <select className={SELECT_CLASS} value={form.actionRef} onChange={(e) => setForm((prev) => ({ ...prev, actionRef: e.target.value }))}>
                      <option value="">Selecione...</option>
                      {extensionOptions.map((extension) => (
                        <option key={extension.value} value={extension.value}>
                          {extension.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className={FIELD_CLASS} value="(não se aplica)" disabled />
                  )}
                </div>
              </div>

              {form.actionType === 'trunk' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 text-sm font-medium text-text-primary">Remover prefixo (dígitos)</label>
                    <input className={FIELD_CLASS} type="number" value={form.stripPrefixLen} onChange={(e) => setForm((prev) => ({ ...prev, stripPrefixLen: e.target.value }))} placeholder="Ex: 1" />
                  </div>
                  <div>
                    <label className="block mb-2 text-sm font-medium text-text-primary">Adicionar prefixo</label>
                    <input className={FIELD_CLASS} value={form.addPrefix} onChange={(e) => setForm((prev) => ({ ...prev, addPrefix: e.target.value }))} placeholder="Ex: 0" />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" className="flex-1" disabled={!canSave || saving}>
                  {saving ? 'Salvando...' : 'Salvar'}
                </Button>
                <Button type="button" variant="ghost" className="flex-1" disabled={saving} onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer />
      <ConfirmDialog />
    </CrudPageBase>
  );
}
