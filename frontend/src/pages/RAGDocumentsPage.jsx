import React, { useState, useEffect } from 'react';
import { listDocuments, getDocumentsStats, deleteDocument, reindexDocument } from '../api/ragDocuments';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

export function RAGDocumentsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  const [documents, setDocuments] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    source: '',
    status: '',
    search: '',
  });

  useEffect(() => {
    loadData();
  }, [filters]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [docs, statsData] = await Promise.all([
        listDocuments(filters),
        getDocumentsStats(),
      ]);
      // Garante que docs seja sempre um array
      const documentsArray = Array.isArray(docs) ? docs : [];
      setDocuments(documentsArray);
      setStats(statsData);
    } catch (error) {
      logger.error('Erro ao carregar dados:', error);
      showToast('Erro ao carregar dados', 'error');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (doc) => {
    const confirmed = await confirm(
      'Confirmar exclusão',
      `Tem certeza que deseja excluir o documento "${doc.title}"?`
    );

    if (!confirmed) return;

    try {
      await deleteDocument(doc.id);
      showToast('Documento excluído com sucesso!', 'success');
      loadData();
    } catch (error) {
      logger.error('Erro ao excluir documento:', error);
      showToast('Erro ao excluir documento', 'error');
    }
  };

  const handleReindex = async (doc) => {
    try {
      setLoading(true);
      const result = await reindexDocument(doc.id);
      showToast(`Documento reindexado! ${result.chunksCreated} chunks criados.`, 'success');
      loadData();
    } catch (error) {
      logger.error('Erro ao reindexar:', error);
      showToast('Erro ao reindexar documento', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Garante que documents seja sempre um array antes de usar filter/map
  const documentsArray = Array.isArray(documents) ? documents : [];
  
  const filteredDocs = documentsArray.filter(doc => {
    if (filters.source && doc.metadata?.source !== filters.source) {
      return false;
    }
    if (filters.status && doc.status !== filters.status) {
      return false;
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return (
        doc.title?.toLowerCase().includes(searchLower) ||
        doc.content?.toLowerCase().includes(searchLower) ||
        doc.id?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const sources = [...new Set(documentsArray.map(doc => doc.metadata?.source).filter(Boolean))];

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📚 Gerenciamento de Documentos RAG</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Gerencie todos os documentos indexados no sistema RAG
        </p>
      </div>

      {/* Estatísticas */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-text-primary mb-2">{stats.total || 0}</div>
            <div className="text-sm text-text-secondary">Total de Documentos</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-status-success mb-2">{stats.indexed || 0}</div>
            <div className="text-sm text-text-secondary">Indexados</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-status-error mb-2">{stats.notIndexed || 0}</div>
            <div className="text-sm text-text-secondary">Não Indexados</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-text-primary mb-2">{stats.totalChunks || 0}</div>
            <div className="text-sm text-text-secondary">Total de Chunks</div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar
            </label>
            <input
              type="text"
              placeholder="Buscar por título, conteúdo ou ID..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Fonte
            </label>
            <select
              value={filters.source}
              onChange={(e) => setFilters({ ...filters, source: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todas as fontes</option>
              {sources.map(source => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos os status</option>
              <option value="active">Ativo</option>
              <option value="archived">Arquivado</option>
              <option value="deleted">Deletado</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista */}
      {loading && documentsArray.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-secondary">Carregando...</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
          <p className="text-text-secondary">Nenhum documento encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDocs.map(doc => (
            <div
              key={doc.id}
              className="bg-bg-elevated rounded-xl border border-border-default p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-text-primary">
                      {doc.title}
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded ${
                      doc.metadata?.source === 'knowledge_base' ? 'bg-status-info/20 text-status-info' :
                      doc.metadata?.source === 'product_docs' ? 'bg-status-warning/20 text-status-warning' :
                      doc.metadata?.source === 'tickets' ? 'bg-accent-light text-accent-primary' :
                      'bg-bg-secondary text-text-secondary'
                    }`}>
                      {doc.metadata?.source || 'unknown'}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      doc.status === 'active' ? 'bg-status-success/20 text-status-success' :
                      doc.status === 'archived' ? 'bg-status-warning/20 text-status-warning' :
                      'bg-status-error/20 text-status-error'
                    }`}>
                      {doc.status}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary mb-3 line-clamp-3">
                    {doc.content.substring(0, 200)}...
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2 text-xs">
                    <span className="text-text-tertiary">ID: {doc.id.substring(0, 8)}...</span>
                    {doc.metadata?.category && (
                      <span className="px-2 py-1 bg-accent-light text-accent-primary rounded">
                        {doc.metadata.category}
                      </span>
                    )}
                    {doc.metadata?.productId && (
                      <span className="px-2 py-1 bg-status-warning/20 text-status-warning rounded">
                        Produto: {doc.metadata.productId}
                      </span>
                    )}
                    {doc.metadata?.tags?.map(tag => (
                      <span key={tag} className="px-2 py-1 bg-bg-secondary text-text-secondary rounded">
                        {tag}
                      </span>
                    ))}
                    <span className={`px-2 py-1 rounded ${
                      doc.indexed ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'
                    }`}>
                      {doc.indexed ? '✓ Indexado' : '✗ Não indexado'}
                    </span>
                    {doc.chunksCount > 0 && (
                      <span className="text-text-tertiary">
                        {doc.chunksCount} chunks
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                {!doc.indexed && (
                  <button
                    onClick={() => handleReindex(doc)}
                    className="text-accent-primary hover:text-accent-hover"
                    title="Indexar"
                  >
                    🔍
                  </button>
                )}
                {doc.indexed && (
                  <button
                    onClick={() => handleReindex(doc)}
                    className="text-accent-primary hover:text-accent-hover"
                    title="Reindexar"
                  >
                    🔄
                  </button>
                )}
                <button
                  onClick={() => handleDelete(doc)}
                  className="text-status-error hover:opacity-80"
                  title="Excluir"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
