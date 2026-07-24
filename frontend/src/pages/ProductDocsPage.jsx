import React, { useState, useEffect } from 'react';
import { listDocuments, createDocument, updateDocument, deleteDocument, reindexDocument } from '../api/ragDocuments';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

export function ProductDocsPage() {
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
      <CrudPageBase>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);
  const [filters, setFilters] = useState({
    productId: '',
    search: '',
  });

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    productId: '',
    tags: '',
    autoIndex: true,
  });

  useEffect(() => {
    loadDocuments();
  }, [filters]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const docs = await listDocuments({
        source: 'product_docs',
        ...filters,
      });
      // Garante que docs seja sempre um array
      const documentsArray = Array.isArray(docs) ? docs : [];
      setDocuments(documentsArray);
    } catch (error) {
      logger.error('Erro ao carregar documentos:', error);
      showToast('Erro ao carregar documentos', 'error');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.title || !formData.content) {
      showToast('Título e conteúdo são obrigatórios', 'error');
      return;
    }

    if (!formData.productId) {
      showToast('ID do produto é obrigatório', 'error');
      return;
    }

    try {
      const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      await createDocument({
        title: formData.title,
        content: formData.content,
        metadata: {
          source: 'product_docs',
          productId: formData.productId,
          tags: tagsArray,
        },
        autoIndex: formData.autoIndex,
      });

      showToast('Documentação criada com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      loadDocuments();
    } catch (error) {
      logger.error('Erro ao criar documentação:', error);
      showToast('Erro ao criar documentação', 'error');
    }
  };

  const handleUpdate = async () => {
    if (!formData.title || !formData.content) {
      showToast('Título e conteúdo são obrigatórios', 'error');
      return;
    }

    try {
      const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      await updateDocument(editingDoc.id, {
        title: formData.title,
        content: formData.content,
        metadata: {
          productId: formData.productId || editingDoc.metadata?.productId,
          tags: tagsArray,
        },
        reindex: formData.autoIndex,
      });

      showToast('Documentação atualizada com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      loadDocuments();
    } catch (error) {
      logger.error('Erro ao atualizar documentação:', error);
      showToast('Erro ao atualizar documentação', 'error');
    }
  };

  const handleDelete = async (doc) => {
    const confirmed = await confirm(
      'Confirmar exclusão',
      `Tem certeza que deseja excluir a documentação "${doc.title}"?`
    );

    if (!confirmed) return;

    try {
      await deleteDocument(doc.id);
      showToast('Documentação excluída com sucesso!', 'success');
      loadDocuments();
    } catch (error) {
      logger.error('Erro ao excluir documentação:', error);
      showToast('Erro ao excluir documentação', 'error');
    }
  };

  const handleReindex = async (doc) => {
    try {
      setLoading(true);
      const result = await reindexDocument(doc.id);
      showToast(`Documento reindexado! ${result.chunksCreated} chunks criados.`, 'success');
      loadDocuments();
    } catch (error) {
      logger.error('Erro ao reindexar:', error);
      showToast('Erro ao reindexar documento', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      productId: '',
      tags: '',
      autoIndex: true,
    });
    setEditingDoc(null);
  };

  const openEditModal = (doc) => {
    setEditingDoc(doc);
    setFormData({
      title: doc.title || '',
      content: doc.content || '',
      productId: doc.metadata?.productId || '',
      tags: (doc.metadata?.tags || []).join(', '),
      autoIndex: false,
    });
    setShowModal(true);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  // Detecta ação de criar via URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'create') {
      openCreateModal();
      // Remove o parâmetro da URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const documentsArray = Array.isArray(documents) ? documents : [];
  const filteredDocs = documentsArray.filter(doc => {
    if (filters.productId && doc.metadata?.productId !== filters.productId) {
      return false;
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return (
        doc.title?.toLowerCase().includes(searchLower) ||
        doc.content?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const productIds = [...new Set(documentsArray.map(doc => doc.metadata?.productId).filter(Boolean))];

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>📖 Documentação de Produtos</h1>
        </div>
        <div className="support-controls">
          <Button 
            onClick={openCreateModal}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Nova Documentação
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar
            </label>
            <input
              type="text"
              placeholder="Buscar por título ou conteúdo..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Produto
            </label>
            <select
              value={filters.productId}
              onChange={(e) => setFilters({ ...filters, productId: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos os produtos</option>
              {productIds.map(pid => (
                <option key={pid} value={pid}>{pid}</option>
              ))}
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
          <p className="text-text-secondary">Nenhuma documentação encontrada</p>
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
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    {doc.title}
                  </h3>
                  <p className="text-sm text-text-secondary mb-3 line-clamp-3">
                    {doc.content.substring(0, 200)}...
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {doc.metadata?.productId && (
                      <span className="px-2 py-1 bg-status-warning/20 text-status-warning text-xs rounded">
                        Produto: {doc.metadata.productId}
                      </span>
                    )}
                    {doc.metadata?.tags?.map(tag => (
                      <span key={tag} className="px-2 py-1 bg-bg-secondary text-text-secondary text-xs rounded">
                        {tag}
                      </span>
                    ))}
                    <span className={`text-xs px-2 py-1 rounded ${doc.indexed ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'}`}>
                      {doc.indexed ? '✓ Indexado' : '✗ Não indexado'}
                    </span>
                    {doc.chunksCount > 0 && (
                      <span className="text-xs text-text-tertiary">
                        {doc.chunksCount} chunks
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => openEditModal(doc)}
                  className="text-accent-primary hover:text-accent-hover"
                  title="Editar"
                >
                  ✏️
                </button>
                {!doc.indexed && (
                  <button
                    onClick={() => handleReindex(doc)}
                    className="text-accent-primary hover:text-accent-hover"
                    title="Indexar"
                  >
                    🔍
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

      {/* Modal */}
      {showModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowModal(false);
            }
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-6">
              {editingDoc ? 'Editar' : 'Nova'} Documentação
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Título *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ex: Manual do Usuário"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  ID do Produto *
                </label>
                <input
                  type="text"
                  value={formData.productId}
                  onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
                  placeholder="Ex: produto-123"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Conteúdo *
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Digite o conteúdo da documentação..."
                  rows={8}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Tags (separadas por vírgula)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="Ex: manual, tutorial, api"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={formData.autoIndex}
                    onChange={(e) => setFormData({ ...formData, autoIndex: e.target.checked })}
                    className="w-4 h-4"
                  />
                  {editingDoc ? 'Reindexar após atualizar' : 'Indexar automaticamente após criar'}
                </label>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => { setShowModal(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={editingDoc ? handleUpdate : handleCreate}>
                {editingDoc ? 'Atualizar' : 'Criar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
      <ConfirmDialog />
    </CrudPageBase>
  );
}
