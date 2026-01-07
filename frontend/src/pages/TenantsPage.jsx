/**
 * Página de gerenciamento de Tenants.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import * as tenantsApi from '../api/tenants';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { PlanSelectionModal } from '../components/PlanSelectionModal';
import logger from '../utils/logger';

export function TenantsPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const [allTenants, setAllTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showContextForm, setShowContextForm] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [editingContextTenantId, setEditingContextTenantId] = useState(null);
  const [planChangeTenant, setPlanChangeTenant] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    site: '',
    ramo_atividade: '',
    objetivo: '',
    plan: 'trial',
    active: true,
  });
  const [contextFormData, setContextFormData] = useState({
    ramo_atividade: '',
    objetivo: '',
    site_oficial: '',
    prioridade: 'HIGH',
    escopo: ['rag', 'chatbot', 'classificacao_intencao'],
  });
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    plan: '',
  });

  // Apenas super-admin (role super_admin OU owner do tenant system) pode gerenciar tenants
  const isSuperAdmin = currentAgent?.role === 'super_admin' || 
                       (currentAgent?.role === 'owner' && currentAgent?.tenantId === 'system');
  const canManageTenants = isSuperAdmin;

  useEffect(() => {
    if (isAuthenticated && canManageTenants) {
      loadTenants();
    }
  }, [isAuthenticated, canManageTenants]);

  const loadTenants = async () => {
    try {
      setLoading(true);
      const result = await tenantsApi.listTenants();
      const tenantsList = result.tenants || [];
      setAllTenants(tenantsList);
    } catch (err) {
      logger.error('Erro ao carregar tenants', err);
      showToast('Erro ao carregar tenants', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadTenantContext = async (tenantId) => {
    try {
      const result = await tenantsApi.getTenantContext(tenantId);
      if (result.context) {
        setContextFormData({
          ramo_atividade: result.context.ramo_atividade || '',
          objetivo: result.context.objetivo || '',
          site_oficial: result.context.site_oficial || '',
          prioridade: result.context.prioridade || 'HIGH',
          escopo: result.context.escopo || ['rag', 'chatbot', 'classificacao_intencao'],
        });
      }
    } catch (err) {
      logger.error('Erro ao carregar contexto do tenant', err);
      showToast('Erro ao carregar contexto', 'error');
    }
  };

  // Aplica filtros usando useMemo para performance
  const tenants = useMemo(() => {
    let filtered = [...allTenants];

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(
        (tenant) =>
          tenant.name?.toLowerCase().includes(searchLower) ||
          tenant.site?.toLowerCase().includes(searchLower) ||
          tenant.ramo_atividade?.toLowerCase().includes(searchLower) ||
          tenant.objetivo?.toLowerCase().includes(searchLower)
      );
    }

    if (filters.status) {
      filtered = filtered.filter((tenant) => {
        if (filters.status === 'active') return tenant.status === 'active' || tenant.active === true;
        if (filters.status === 'suspended') return tenant.status === 'suspended';
        if (filters.status === 'trial') return tenant.status === 'trial';
        if (filters.status === 'terminated') return tenant.status === 'terminated';
        return true;
      });
    }

    if (filters.plan) {
      filtered = filtered.filter((tenant) => tenant.plan === filters.plan);
    }

    return filtered;
  }, [allTenants, filters]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ search: '', status: '', plan: '' });
  };

  const resetForm = () => {
    setFormData({
      name: '',
      site: '',
      ramo_atividade: '',
      objetivo: '',
      plan: 'trial',
      active: true,
    });
    setEditingTenant(null);
  };

  const handleCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const handleEdit = (tenant) => {
    setFormData({
      name: tenant.name || '',
      site: tenant.site || '',
      ramo_atividade: tenant.ramo_atividade || '',
      objetivo: tenant.objetivo || '',
      plan: tenant.plan || 'trial',
      active: tenant.active !== false,
    });
    setEditingTenant(tenant);
    setShowForm(true);
  };

  const handleEditContext = async (tenant) => {
    setEditingContextTenantId(tenant.id);
    await loadTenantContext(tenant.id);
    setShowContextForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      if (editingTenant) {
        await tenantsApi.updateTenant(editingTenant.id, formData);
        showToast('Tenant atualizado com sucesso', 'success');
      } else {
        await tenantsApi.createTenant(formData);
        showToast('Tenant criado com sucesso', 'success');
      }
      setShowForm(false);
      await loadTenants();
      resetForm();
    } catch (err) {
      const errorMessage = err.body?.message || err.message || 'Erro ao salvar tenant';
      showToast(errorMessage, 'error');
      logger.error('Erro ao salvar tenant', err);
    }
  };

  const handleContextSubmit = async (e) => {
    e.preventDefault();

    try {
      await tenantsApi.updateTenantContext(editingContextTenantId, contextFormData);
      showToast('Contexto do tenant atualizado com sucesso', 'success');
      setShowContextForm(false);
      setEditingContextTenantId(null);
      await loadTenants();
    } catch (err) {
      const errorMessage = err.body?.message || err.message || 'Erro ao salvar contexto';
      showToast(errorMessage, 'error');
      logger.error('Erro ao salvar contexto', err);
    }
  };

  const handleDelete = async (tenantToDelete) => {
    const confirmed = await confirm({
      title: 'Confirmar exclusão',
      message: `Tem certeza que deseja remover o tenant "${tenantToDelete.name}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });

    if (!confirmed) return;

    try {
      await tenantsApi.deleteTenant(tenantToDelete.id);
      showToast('Tenant removido com sucesso', 'success');
      await loadTenants();
    } catch (err) {
      const errorMessage = err.body?.message || err.message || 'Erro ao remover tenant';
      showToast(errorMessage, 'error');
      logger.error('Erro ao remover tenant', err);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
          <p className="text-text-secondary">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!canManageTenants) {
    return (
      <div className="support-page">
        <div className="support-header">
          <h1>🏢 Gerenciamento de Tenants</h1>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-center">
          <p className="text-text-secondary">
            Você não tem permissão para gerenciar tenants. Apenas super-admins podem acessar esta página.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="support-page">
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>🏢 Gerenciamento de Tenants</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando tenants...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🏢 Gerenciamento de Tenants</h1>
        </div>
        <div className="support-controls">
          <Button 
            onClick={handleCreate} 
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Novo Tenant
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="Nome, site, ramo ou objetivo..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos</option>
              <option value="trial">Trial</option>
              <option value="active">Ativo</option>
              <option value="suspended">Suspenso</option>
              <option value="terminated">Encerrado</option>
            </select>
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Plano
            </label>
            <select
              value={filters.plan}
              onChange={(e) => handleFilterChange('plan', e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos</option>
              <option value="free">Free</option>
              <option value="trial">Trial</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={clearFilters}
              variant="secondary"
              className="w-full"
              disabled={!filters.search && !filters.status && !filters.plan}
            >
              Limpar Filtros
            </Button>
          </div>
        </div>

        {(filters.search || filters.status) && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-sm text-text-secondary">
              Mostrando <strong>{tenants.length}</strong> de <strong>{allTenants.length}</strong> tenant(s)
              {filters.search && ` contendo "${filters.search}"`}
              {filters.status && ` com status "${filters.status === 'active' ? 'Ativo' : 'Inativo'}"`}
            </p>
          </div>
        )}
      </div>

      {/* Modal do Formulário de Tenant */}
      {showForm && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowForm(false);
              resetForm();
            }
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-6">
              {editingTenant ? 'Editar Tenant' : 'Novo Tenant'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Nome *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Site (URL) *
                </label>
                <input
                  type="url"
                  value={formData.site}
                  onChange={(e) => setFormData({ ...formData, site: e.target.value })}
                  required
                  placeholder="https://exemplo.com"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
                <p className="mt-1 text-xs text-text-secondary">URL oficial do cliente (http:// ou https://)</p>
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Ramo de Atividade *
                </label>
                <textarea
                  value={formData.ramo_atividade}
                  onChange={(e) => setFormData({ ...formData, ramo_atividade: e.target.value })}
                  required
                  rows={3}
                  placeholder="Ex: E-commerce e Varejo Online - Venda de produtos físicos e digitais"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-none"
                />
                <p className="mt-1 text-xs text-text-secondary">Descrição textual do segmento de negócio</p>
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Objetivo Estratégico *
                </label>
                <textarea
                  value={formData.objetivo}
                  onChange={(e) => setFormData({ ...formData, objetivo: e.target.value })}
                  required
                  rows={3}
                  placeholder="Ex: Melhorar a experiência de compra online e aumentar conversão"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-none"
                />
                <p className="mt-1 text-xs text-text-secondary">Objetivo estratégico do cliente com o uso da plataforma</p>
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Plano *
                </label>
                <select
                  value={formData.plan}
                  onChange={(e) => setFormData({ ...formData, plan: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
                >
                  <option value="free">Free</option>
                  <option value="trial">Trial (14 dias)</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
                <p className="mt-1 text-xs text-text-secondary">Plano inicial do tenant</p>
              </div>

              <div>
                <label className="flex items-center gap-3 p-4 bg-bg-secondary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary cursor-pointer"
                  />
                  <span className="text-text-primary font-medium">Ativo</span>
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="submit" variant="primary" className="flex-1">
                  {editingTenant ? 'Atualizar' : 'Criar'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal do Formulário de Contexto */}
      {showContextForm && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowContextForm(false);
              setEditingContextTenantId(null);
            }
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-6">
              Editar Contexto Cognitivo do Tenant
            </h2>

            <form onSubmit={handleContextSubmit} className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Ramo de Atividade
                </label>
                <textarea
                  value={contextFormData.ramo_atividade}
                  onChange={(e) => setContextFormData({ ...contextFormData, ramo_atividade: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-none"
                />
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Objetivo Estratégico
                </label>
                <textarea
                  value={contextFormData.objetivo}
                  onChange={(e) => setContextFormData({ ...contextFormData, objetivo: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-none"
                />
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Site Oficial
                </label>
                <input
                  type="url"
                  value={contextFormData.site_oficial}
                  onChange={(e) => setContextFormData({ ...contextFormData, site_oficial: e.target.value })}
                  placeholder="https://exemplo.com"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Prioridade
                </label>
                <select
                  value={contextFormData.prioridade}
                  onChange={(e) => setContextFormData({ ...contextFormData, prioridade: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
                >
                  <option value="HIGH">Alta</option>
                  <option value="MEDIUM">Média</option>
                  <option value="LOW">Baixa</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="submit" variant="primary" className="flex-1">
                  Atualizar Contexto
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowContextForm(false);
                    setEditingContextTenantId(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tabela de Tenants */}
      <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg-secondary border-b border-border-default">
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Nome
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Site
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Ramo de Atividade
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Plano
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-text-primary">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-3 text-sm text-text-primary font-medium">{tenant.name}</td>
                  <td className="px-4 py-3 text-sm text-text-primary">
                    <a 
                      href={tenant.site} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-accent-primary hover:underline"
                    >
                      {tenant.site}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-primary">
                    <div className="max-w-md truncate" title={tenant.ramo_atividade}>
                      {tenant.ramo_atividade}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                      tenant.plan === 'enterprise' 
                        ? 'bg-purple-500/20 text-purple-500 border border-purple-500/30'
                        : tenant.plan === 'pro'
                        ? 'bg-blue-500/20 text-blue-500 border border-blue-500/30'
                        : tenant.plan === 'trial'
                        ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
                        : 'bg-gray-500/20 text-gray-500 border border-gray-500/30'
                    }`}>
                      {tenant.plan ? tenant.plan.toUpperCase() : 'TRIAL'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                      tenant.status === 'active' || (tenant.active && !tenant.status)
                        ? 'bg-status-success/20 text-status-success border border-status-success/30' 
                        : tenant.status === 'suspended'
                        ? 'bg-status-error/20 text-status-error border border-status-error/30'
                        : tenant.status === 'trial'
                        ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
                        : 'bg-gray-500/20 text-gray-500 border border-gray-500/30'
                    }`}>
                      {tenant.status === 'trial' ? 'Trial' : 
                       tenant.status === 'suspended' ? 'Suspenso' :
                       tenant.status === 'terminated' ? 'Encerrado' :
                       tenant.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(tenant)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditContext(tenant)}
                      >
                        Contexto
                      </Button>
                      {tenant.status === 'suspended' ? (
                        <Button
                          variant="success"
                          size="sm"
                          onClick={async () => {
                            try {
                              await tenantsApi.reactivateTenant(tenant.id);
                              showToast('Tenant reativado com sucesso', 'success');
                              await loadTenants();
                            } catch (err) {
                              showToast(err.body?.message || 'Erro ao reativar tenant', 'error');
                            }
                          }}
                        >
                          Reativar
                        </Button>
                      ) : (
                        <Button
                          variant="warning"
                          size="sm"
                          onClick={async () => {
                            const confirmed = await confirm({
                              title: 'Suspender Tenant',
                              message: `Tem certeza que deseja suspender o tenant "${tenant.name}"?`,
                              confirmLabel: 'Suspender',
                              cancelLabel: 'Cancelar',
                              variant: 'warning',
                            });
                            if (confirmed) {
                              try {
                                await tenantsApi.suspendTenant(tenant.id);
                                showToast('Tenant suspenso com sucesso', 'success');
                                await loadTenants();
                              } catch (err) {
                                showToast(err.body?.message || 'Erro ao suspender tenant', 'error');
                              }
                            }
                          }}
                        >
                          Suspender
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPlanChangeTenant(tenant);
                          setShowPlanModal(true);
                        }}
                      >
                        Plano
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(tenant)}
                      >
                        Remover
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tenants.length === 0 && (
          <div className="py-20 text-center text-text-secondary">
            Nenhum tenant encontrado
          </div>
        )}
      </div>

      {/* Modal de Seleção de Plano */}
      {showPlanModal && planChangeTenant && (
        <PlanSelectionModal
          isOpen={showPlanModal}
          onClose={() => {
            setShowPlanModal(false);
            setPlanChangeTenant(null);
          }}
          currentPlan={planChangeTenant.plan || 'trial'}
          tenantName={planChangeTenant.name}
          onSelectPlan={async (newPlan) => {
            try {
              await tenantsApi.changeTenantPlan(planChangeTenant.id, newPlan);
              showToast('Plano alterado com sucesso', 'success');
              await loadTenants();
            } catch (err) {
              const errorMessage = err.body?.message || err.message || 'Erro ao alterar plano';
              showToast(errorMessage, 'error');
              logger.error('Erro ao alterar plano', err);
              throw err;
            }
          }}
        />
      )}

      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}

