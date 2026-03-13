import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { listNodeCatalog } from '../api/nodeMarketplace';
import { Button } from '../styles/Button';
import { DataGrid } from '../components/DataGrid';

const FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

export function NodeMarketplacePage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [search, setSearch] = useState('');

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

  const filteredCatalog = (catalog || []).filter((item) => {
    const term = String(search || '').trim().toLowerCase();
    if (!term) return true;
    const haystack = [item?.label, item?.category, item?.version, item?.id]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(term);
  });

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

  return (
    <div className="support-page">
      <ToastContainer />
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🧩 Node Marketplace</h1>
        </div>
        <div className="support-controls">
          <Button onClick={loadCatalog} style={{ backgroundColor: '#6366f1', color: 'white' }}>
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={FIELD_CLASS}
              placeholder="Node, categoria, versão..."
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => setSearch('')} className="w-full" disabled={!search}>
              Limpar Filtro
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        <DataGrid
          rows={filteredCatalog}
          emptyText={loading ? 'Carregando catálogo...' : 'Nenhum node disponível.'}
          defaultSort={{ id: 'label', dir: 'asc' }}
          columns={[
            { id: 'label', header: 'Node', accessor: (r) => r.label || '—' },
            { id: 'category', header: 'Categoria', accessor: (r) => r.category || '—' },
            { id: 'version', header: 'Versão', accessor: (r) => r.version || '—' },
            { id: 'id', header: 'ID', accessor: (r) => r.id || '—' },
          ]}
        />
      </div>
    </div>
  );
}
