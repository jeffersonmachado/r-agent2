import React, { useState, useEffect } from 'react';
import { listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply, getCategories, getTags, searchQuickReplies } from '../api/quickReplies';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { formatDateTime } from '../utils/dateFormatter';

export function QuickRepliesPage() {
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
  
  const [replies, setReplies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingReply, setEditingReply] = useState(null);
  const [filters, setFilters] = useState({
    category: '',
    tag: '',
    search: '',
  });
  
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    tags: '',
    category: 'geral',
  });

  useEffect(() => {
    loadData();
  }, [filters]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [repliesData, categoriesData, tagsData] = await Promise.all([
        listQuickReplies(filters),
        getCategories(),
        getTags(),
      ]);
      
      setReplies(repliesData.quickReplies || []);
      setCategories(categoriesData.categories || []);
      setTags(tagsData.tags || []);
    } catch (error) {
      logger.error('Erro ao carregar respostas rápidas:', error);
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      await createQuickReply({
        title: formData.title,
        message: formData.message,
        tags: tagsArray,
        category: formData.category,
      });
      
      showToast('Resposta rápida criada com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      loadData();
    } catch (error) {
      logger.error('Erro ao criar resposta rápida:', error);
      showToast('Erro ao criar resposta rápida', 'error');
    }
  };

  const handleUpdate = async () => {
    try {
      const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      await updateQuickReply(editingReply.id, {
        title: formData.title,
        message: formData.message,
        tags: tagsArray,
        category: formData.category,
      });
      
      showToast('Resposta rápida atualizada com sucesso!', 'success');
      setShowModal(false);
      setEditingReply(null);
      resetForm();
      loadData();
    } catch (error) {
      logger.error('Erro ao atualizar resposta rápida:', error);
      showToast('Erro ao atualizar resposta rápida', 'error');
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm('Tem certeza que deseja excluir esta resposta rápida?');
    if (!confirmed) return;
    
    try {
      await deleteQuickReply(id);
      showToast('Resposta rápida excluída com sucesso!', 'success');
      loadData();
    } catch (error) {
      logger.error('Erro ao excluir resposta rápida:', error);
      showToast('Erro ao excluir resposta rápida', 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      message: '',
      tags: '',
      category: 'geral',
    });
    setEditingReply(null);
  };

  const openEditModal = (reply) => {
    setEditingReply(reply);
    setFormData({
      title: reply.title,
      message: reply.message,
      tags: reply.tags?.join(', ') || '',
      category: reply.category || 'geral',
    });
    setShowModal(true);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>⚡ Respostas Rápidas</h1>
        </div>
        <div className="support-controls">
          <Button 
            onClick={openCreateModal}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Nova Resposta Rápida
          </Button>
        </div>
      </div>

        {/* Filtros */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
            <span>🔍</span>
            <span>Filtros</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Categoria
              </label>
              <select
                value={filters.category}
                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
              >
                <option value="">Todas</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Tag
              </label>
              <select
                value={filters.tag}
                onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
              >
                <option value="">Todas</option>
                {tags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Buscar
              </label>
              <input
                type="text"
                placeholder="Buscar por título ou mensagem..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-text-secondary">Carregando...</p>
          </div>
        ) : replies.length === 0 ? (
          <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
            <p className="text-text-secondary">Nenhuma resposta rápida encontrada</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {replies.map((reply) => (
              <div
                key={reply.id}
                className="bg-bg-elevated rounded-xl border border-border-default p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-semibold text-text-primary">
                    {reply.title}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(reply)}
                      className="text-accent-primary hover:text-accent-hover"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(reply.id)}
                      className="text-status-error hover:opacity-80"
                      title="Excluir"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                <p className="text-text-secondary mb-3">
                  {reply.message}
                </p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {reply.tags?.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-accent-light text-accent-primary text-xs rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-text-tertiary">
                  <span className="bg-bg-secondary px-2 py-1 rounded">
                    {reply.category}
                  </span>
                  <span className="ml-2">Usado {reply.usageCount || 0} vezes</span>
                </div>
                {reply.createdAt && (
                  <div className="text-xs text-text-tertiary mt-2">
                    Criado em: {formatDateTime(reply.createdAt)}
                  </div>
                )}
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
              {editingReply ? 'Editar' : 'Nova'} Resposta Rápida
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Título
                </label>
                <input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ex: Saudação Inicial"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Mensagem
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Digite a mensagem..."
                  rows={4}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Tags (separadas por vírgula)
                </label>
                <input
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="Ex: saudacao, inicio, boas-vindas"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Categoria
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
                >
                  <option value="geral">Geral</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => { setShowModal(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={editingReply ? handleUpdate : handleCreate}>
                {editingReply ? 'Atualizar' : 'Criar'}
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
