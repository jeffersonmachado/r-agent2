import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { listNodeCatalog } from '../api/nodeMarketplace';
import { Button } from '../styles/Button';
import { PlatformGrid, usePlatformGridState } from '../modules/platform-grid';
import { CrudPageBase } from '../modules/crud-base';

export function NodeMarketplacePage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState([]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadCatalog();
    }
  }, [authLoading, isAuthenticated]);

  async function loadCatalog() {
    setLoading(true);
    try {
      const out = await listNodeCatalog();
      setCatalog(out?.items || []);
    } catch (err) {
      logger.error('Erro ao listar catálogo:', err);
      showToast('Erro ao carregar catálogo', 'error');
    } finally {
      setLoading(false);
    }
  }

  const columns = [
    { id: 'label', header: 'Node', accessor: (row) => row.label || '—' },
    { id: 'category', header: 'Categoria', accessor: (row) => row.category || '—' },
    { id: 'version', header: 'Versão', accessor: (row) => row.version || '—' },
    { id: 'id', header: 'ID', accessor: (row) => row.id || '—' },
  ];

  const grid = usePlatformGridState({
    rows: catalog,
    columns,
    initialSort: { columnId: 'label', direction: 'asc' },
    persistenceKey: 'node-marketplace-grid',
    getSearchText: (row) => [row?.label, row?.category, row?.version, row?.id].join(' '),
  });

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
      <ToastContainer />
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🧩 Mercado de Nós</h1>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        <PlatformGrid
          columns={columns}
          rows={grid.rows}
          loading={loading}
          searchTerm={grid.searchTerm}
          searchPlaceholder="Buscar node, categoria, versão..."
          onSearchTermChange={grid.setSearchTerm}
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
          toolbarActions={(
            <div className="flex items-center gap-3">
              <Button onClick={loadCatalog} style={{ backgroundColor: '#6366f1', color: 'white' }}>
                🔄 Atualizar
              </Button>
              <Button onClick={grid.clearFilters} disabled={!grid.searchTerm}>
                Limpar Busca
              </Button>
            </div>
          )}
          emptyState={{
            title: loading ? 'Carregando catálogo...' : 'Nenhum node disponível',
            description: loading ? 'Buscando itens publicados no catálogo.' : 'Ajuste a busca para localizar nodes disponíveis.',
          }}
        />
      </div>
    </CrudPageBase>
  );
}
