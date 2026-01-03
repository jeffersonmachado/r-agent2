import React, { useState, useEffect } from 'react';
import { listDocuments, createDocument, updateDocument, deleteDocument, reindexDocument } from '../api/ragDocuments';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

export function KnowledgeBasePage() {
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
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);
  const [filters, setFilters] = useState({
    category: '',
    search: '',
  });

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: '',
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
        source: 'knowledge_base',
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

    try {
      const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      await createDocument({
        title: formData.title,
        content: formData.content,
        metadata: {
          source: 'knowledge_base',
          category: formData.category || null,
          tags: tagsArray,
        },
        autoIndex: formData.autoIndex,
      });

      showToast('Artigo criado com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      loadDocuments();
    } catch (error) {
      logger.error('Erro ao criar artigo:', error);
      showToast('Erro ao criar artigo', 'error');
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
          category: formData.category || null,
          tags: tagsArray,
        },
        reindex: formData.autoIndex,
      });

      showToast('Artigo atualizado com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      loadDocuments();
    } catch (error) {
      logger.error('Erro ao atualizar artigo:', error);
      showToast('Erro ao atualizar artigo', 'error');
    }
  };

  const handleDelete = async (doc) => {
    const confirmed = await confirm(
      'Confirmar exclusão',
      `Tem certeza que deseja excluir o artigo "${doc.title}"?`
    );

    if (!confirmed) return;

    try {
      await deleteDocument(doc.id);
      showToast('Artigo excluído com sucesso!', 'success');
      loadDocuments();
    } catch (error) {
      logger.error('Erro ao excluir artigo:', error);
      showToast('Erro ao excluir artigo', 'error');
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
      category: '',
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
      category: doc.metadata?.category || '',
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
    if (filters.category && doc.metadata?.category !== filters.category) {
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

  const categories = [...new Set(documentsArray.map(doc => doc.metadata?.category).filter(Boolean))];

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>Base de Conhecimento</h1>
        </div>
        <div className="support-controls">
          <Button 
            onClick={openCreateModal}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Novo Artigo
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
              Categoria
            </label>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todas as categorias</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
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
          <p className="text-text-secondary">Nenhum artigo encontrado</p>
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
                    {doc.metadata?.category && (
                      <span className="px-2 py-1 bg-accent-light text-accent-primary text-xs rounded">
                        {doc.metadata.category}
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
              {editingDoc ? 'Editar' : 'Novo'} Artigo
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
                  placeholder="Ex: Como fazer login"
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
                  placeholder="Digite o conteúdo do artigo..."
                  rows={8}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Categoria
                </label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="Ex: FAQ, Tutorial, Guia"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
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
                  placeholder="Ex: suporte, inicial, pagamento"
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
    </div>
  );
}
