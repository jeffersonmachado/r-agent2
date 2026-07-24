import React, { useState, useEffect } from 'react';
import { listDepartments, createDepartment, updateDepartment, deleteDepartment } from '../api/departments';
import { listAgents } from '../api/auth';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { formatDateTime } from '../utils/dateFormatter';
import { CrudPageBase } from '../modules/crud-base';

export function DepartmentsPage() {
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
  
  const [departments, setDepartments] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    queueNames: '',
    color: '#3B82F6',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [deptsData, agentsData] = await Promise.all([
        listDepartments(),
        listAgents(),
      ]);
      
      setDepartments(deptsData.departments || []);
      setAgents(agentsData.agents || []);
    } catch (error) {
      logger.error('Erro ao carregar departamentos:', error);
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      const queueNames = formData.queueNames.split(',').map(q => q.trim()).filter(Boolean);
      await createDepartment({
        name: formData.name,
        description: formData.description,
        queueNames,
        color: formData.color,
      });
      
      showToast('Departamento criado com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      loadData();
    } catch (error) {
      logger.error('Erro ao criar departamento:', error);
      showToast('Erro ao criar departamento', 'error');
    }
  };

  const handleUpdate = async () => {
    try {
      const queueNames = formData.queueNames.split(',').map(q => q.trim()).filter(Boolean);
      await updateDepartment(editingDept.id, {
        name: formData.name,
        description: formData.description,
        queueNames,
        color: formData.color,
      });
      
      showToast('Departamento atualizado com sucesso!', 'success');
      setShowModal(false);
      setEditingDept(null);
      resetForm();
      loadData();
    } catch (error) {
      logger.error('Erro ao atualizar departamento:', error);
      showToast('Erro ao atualizar departamento', 'error');
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm('Tem certeza que deseja excluir este departamento?');
    if (!confirmed) return;
    
    try {
      await deleteDepartment(id);
      showToast('Departamento excluído com sucesso!', 'success');
      loadData();
    } catch (error) {
      logger.error('Erro ao excluir departamento:', error);
      showToast('Erro ao excluir departamento', 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      queueNames: '',
      color: '#3B82F6',
    });
    setEditingDept(null);
  };

  const openEditModal = (dept) => {
    setEditingDept(dept);
    setFormData({
      name: dept.name,
      description: dept.description || '',
      queueNames: dept.queueNames?.join(', ') || '',
      color: dept.color || '#3B82F6',
    });
    setShowModal(true);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>🏢 Departamentos</h1>
        </div>
        <div className="support-controls">
          <Button 
            onClick={openCreateModal}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Novo Departamento
          </Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-text-secondary">Carregando...</p>
          </div>
        ) : departments.length === 0 ? (
          <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
            <p className="text-text-secondary">Nenhum departamento encontrado</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {departments.map((dept) => (
              <div
                key={dept.id}
                className="bg-bg-elevated rounded-xl border border-border-default p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-white text-xl font-bold"
                      style={{ backgroundColor: dept.color }}
                    >
                      {dept.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary">
                        {dept.name}
                      </h3>
                      <p className="text-sm text-text-tertiary">
                        {dept.agentIds?.length || 0} agente(s)
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(dept)}
                      className="text-accent-primary hover:text-accent-hover"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(dept.id)}
                      className="text-status-error hover:opacity-80"
                      title="Excluir"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                
                {dept.description && (
                  <p className="text-text-secondary mb-3">
                    {dept.description}
                  </p>
                )}
                
                {dept.queueNames && dept.queueNames.length > 0 && (
                  <div className="mb-3">
                    <p className="text-sm font-medium text-text-primary mb-1">
                      Filas:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {dept.queueNames.map(queue => (
                        <span
                          key={queue}
                          className="px-2 py-1 bg-bg-secondary text-text-secondary text-xs rounded"
                        >
                          {queue}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {dept.createdAt && (
                  <div className="text-xs text-text-tertiary mt-2">
                    Criado em: {formatDateTime(dept.createdAt)}
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
            <h2 className="text-2xl font-bold text-text-primary mb-4">
              {editingDept ? 'Editar' : 'Novo'} Departamento
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Nome
                </label>
                <input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Suporte Técnico"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Descrição
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descrição do departamento..."
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Filas (separadas por vírgula)
                </label>
                <input
                  value={formData.queueNames}
                  onChange={(e) => setFormData({ ...formData, queueNames: e.target.value })}
                  placeholder="Ex: suporte, tecnico"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Cor
                </label>
                <div className="flex gap-3">
                  <input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-20 h-10 border border-border-default rounded-lg"
                  />
                  <input
                    type="text"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    placeholder="#3B82F6"
                    className="flex-1 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => { setShowModal(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={editingDept ? handleUpdate : handleCreate}>
                {editingDept ? 'Atualizar' : 'Criar'}
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
