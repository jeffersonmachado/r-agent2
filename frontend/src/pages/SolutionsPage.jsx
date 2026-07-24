import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { listSolutionPacks, installSolutionPack } from '../api/solutions';
import { Button } from '../styles/Button';
import { PlatformGrid, usePlatformGridState } from '../modules/platform-grid';
import { CrudPageBase } from '../modules/crud-base';

const FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

const SELECT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover';

export function SolutionsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [packs, setPacks] = useState([]);
  const [filters, setFilters] = useState({ search: '', segment: '' });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadPacks();
    }
  }, [authLoading, isAuthenticated]);

  async function loadPacks() {
    setLoading(true);
    try {
      const out = await listSolutionPacks();
      setPacks(out?.items || out || []);
    } catch (err) {
      logger.error('Erro ao listar packs:', err);
      showToast('Erro ao listar packs', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleInstall(segment) {
    setLoading(true);
    try {
      const out = await installSolutionPack(segment);
      if (!out?.ok && out?.error) {
        showToast(`Falha ao instalar: ${out.error}`, 'error');
        return;
      }
      showToast('Pack instalado com sucesso!', 'success');
    } catch (err) {
      logger.error('Erro ao instalar pack:', err);
      showToast('Erro ao instalar pack', 'error');
    } finally {
      setLoading(false);
    }
  }

  const filteredPacks = useMemo(() => {
    return (packs || []).filter((p) => {
      const segment = String(p?.segment || '');
      if (filters.segment && segment !== filters.segment) return false;
      const search = String(filters.search || '').trim().toLowerCase();
      if (!search) return true;
      const haystack = [p?.name, p?.description, p?.segment]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return haystack.includes(search);
    });
  }, [packs, filters]);

  const segments = Array.from(new Set((packs || []).map((p) => String(p?.segment || '')).filter(Boolean)));

  const columns = useMemo(() => [
    { id: 'name', header: 'Nome', accessor: (r) => r.name || '—' },
    { id: 'description', header: 'Descrição', accessor: (r) => r.description || '—' },
    { id: 'segment', header: 'Segmento', accessor: (r) => r.segment || '—' },
    {
      id: 'checklist',
      header: 'Checklist',
      sortable: false,
      render: (r) => (Array.isArray(r.operationsChecklist) ? r.operationsChecklist.join(', ') : '—'),
    },
    {
      id: 'actions',
      header: 'Ações',
      sortable: false,
      render: (r) => (
        <Button onClick={() => handleInstall(r.segment)} disabled={loading || !r.segment} size="sm" variant="primary">
          Instalar pack
        </Button>
      ),
    },
  ], [loading]);

  const grid = usePlatformGridState({
    rows: filteredPacks,
    columns,
    initialSort: { columnId: 'name', direction: 'asc' },
    persistenceKey: 'solutions-grid',
    getSearchText: (row) => [row?.name, row?.description, row?.segment].join(' '),
  });

  if (authLoading) {
    return (
      <CrudPageBase>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
        </CrudPageBase>
    );
  }

  if (!isAuthenticated) return null;

  return (
      <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <div className="page-header">
          <h1>📦 Solutions Packs</h1>
        </div>
        <div className="support-controls">
          <Button onClick={loadPacks} style={{ backgroundColor: '#6366f1', color: 'white' }}>
            🔄 Atualizar
          </Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Buscar</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className={FIELD_CLASS}
              placeholder="Nome, descrição ou segmento..."
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Segmento</label>
            <select
              value={filters.segment}
              onChange={(e) => setFilters((prev) => ({ ...prev, segment: e.target.value }))}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {segments.map((segment) => (
                <option key={segment} value={segment}>{segment}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={() => setFilters({ search: '', segment: '' })} className="w-full" disabled={!filters.search && !filters.segment}>
              Limpar Filtros
            </Button>
          </div>
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
            title: loading ? 'Carregando packs' : 'Nenhum pack disponível',
            description: '',
          }}
        />
      </div>
    </CrudPageBase>
  );
}
