import React, { useMemo, useState, useEffect } from 'react';
import { listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply, getCategories, getTags } from '../api/quickReplies';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import { CrudPageBase, useCrudFilters } from '../modules/crud-base';
import logger from '../utils/logger';
import { formatDateTime } from '../utils/dateFormatter';

function slugify(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

function extractTemplateVars(text) {
  if (!text) return [];
  const vars = new Set();
  String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
    if (key) vars.add(String(key));
    return '';
  });
  return Array.from(vars.values()).sort();
}

function applyTemplateVariables(text, variables) {
  if (!text) return '';
  const vars = (variables && typeof variables === 'object') ? variables : {};
  return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch { return String(v); }
  });
}

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
      <CrudPageBase title="⚡ Respostas Rápidas">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
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
  const { filters, setFilter } = useCrudFilters({
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
  const [previewVarsText, setPreviewVarsText] = useState('{\n  "nome": "Cliente",\n  "protocolo": "12345"\n}');
  const previewVars = useMemo(() => {
    try {
      return JSON.parse(previewVarsText || '{}');
    } catch {
      return null;
    }
  }, [previewVarsText]);

  const templateVars = useMemo(() => extractTemplateVars(formData.message), [formData.message]);
  const shortcut = useMemo(() => (formData.title ? `/${slugify(formData.title)}` : ''), [formData.title]);
  const previewMessage = useMemo(() => {
    if (!formData.message) return '';
    if (!previewVars) return formData.message;
    return applyTemplateVariables(formData.message, previewVars);
  }, [formData.message, previewVars]);

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
    setPreviewVarsText('{\n  "nome": "Cliente",\n  "protocolo": "12345"\n}');
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
    <CrudPageBase
      title="⚡ Respostas Rápidas"
      actions={(
        <Button
          onClick={openCreateModal}
          style={{ backgroundColor: '#25D366', color: 'white' }}
        >
          ➕ Nova Resposta Rápida
        </Button>
      )}
      filters={(
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
                onChange={(e) => setFilter('category', e.target.value)}
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
                onChange={(e) => setFilter('tag', e.target.value)}
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
                onChange={(e) => setFilter('search', e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>
      )}
    >
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
                <div className="text-xs text-text-tertiary mb-2">
                  Atalho: <code>/{slugify(reply.title)}</code>
                </div>
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
                {formData.title ? (
                  <div className="text-xs text-text-tertiary mt-2">
                    Atalho sugerido para uso no atendimento: <code>{shortcut}</code>
                  </div>
                ) : null}
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Mensagem
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder={'Digite a mensagem...\nDica: use variáveis como {{nome}}'}
                  rows={4}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
                <div className="mt-2 text-xs text-text-tertiary">
                  Variáveis suportadas: <code>{'{{chave}}'}</code> (ex.: <code>{'{{nome}}'}</code>, <code>{'{{protocolo}}'}</code>)
                  {templateVars.length > 0 ? (
                    <div className="mt-1">
                      Detectadas nesta mensagem: {templateVars.map(v => <code key={v} style={{ marginRight: '6px' }}>{`{{${v}}}`}</code>)}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Preview com variáveis */}
              <div className="bg-bg-secondary border border-border-default rounded-lg p-4">
                <div className="text-sm font-medium text-text-primary mb-2">Preview (variáveis)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 text-xs font-medium text-text-secondary">
                      Variáveis (JSON)
                    </label>
                    <textarea
                      value={previewVarsText}
                      onChange={(e) => setPreviewVarsText(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 bg-bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y font-mono text-xs"
                    />
                    {!previewVars ? (
                      <div className="text-xs text-status-error mt-1">JSON inválido (o preview usará a mensagem original).</div>
                    ) : null}
                  </div>
                  <div>
                    <label className="block mb-2 text-xs font-medium text-text-secondary">
                      Resultado
                    </label>
                    <pre
                      className="w-full px-3 py-2 bg-bg-elevated border border-border-default rounded-lg text-text-primary whitespace-pre-wrap break-words text-xs"
                      style={{ minHeight: '140px' }}
                    >
                      {previewMessage || '—'}
                    </pre>
                    <div className="text-xs text-text-tertiary mt-2">
                      No atendimento, as variáveis são preenchidas automaticamente a partir do contexto do ticket (ex.: entidades extraídas).
                    </div>
                  </div>
                </div>
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
    </CrudPageBase>
  );
}
