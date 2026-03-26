/**
 * Página de gerenciamento de agentes.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import * as authApi from '../api/auth';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { NavigationLink } from '../components/NavigationLink';
import logger from '../utils/logger';
import { isSuperAdmin } from '../utils/menuPermissions';
import { formatDateTime } from '../utils/dateFormatter';
import { CrudPageBase, useCrudFilters, useCrudList } from '../modules/crud-base';

export function AgentsPage() {
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

  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'operator', // 'agent' migra para 'operator'
    name: '',
    active: true,
  });
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [showResetPasswordForm, setShowResetPasswordForm] = useState(false);
  const [inviteFormData, setInviteFormData] = useState({
    email: '',
    role: 'operator',
    name: '',
  });
  const [resetPasswordEmail, setResetPasswordEmail] = useState('');
  const { filters, setFilter, resetFilters } = useCrudFilters({
    search: '',
    role: '',
    status: '',
  });
  const fetchAgents = useCallback(async () => {
    const result = await authApi.listAgents();
    return result?.agents || [];
  }, []);
  const {
    allItems: allAgents,
    loading,
    error: agentsLoadError,
    loadItems: loadAgents,
  } = useCrudList(fetchAgents);

  // Verifica se pode gerenciar agentes: super-admin, admin ou supervisor
  const canManageAgents = isSuperAdmin(currentAgent) || currentAgent?.role === 'admin' || currentAgent?.role === 'supervisor';

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (agentsLoadError) {
      logger.error('Erro ao carregar agentes', agentsLoadError);
      showToast(agentsLoadError, 'error');
    }
  }, [agentsLoadError, showToast]);

  // Aplica filtros usando useMemo para performance
  const agents = useMemo(() => {
    let filtered = [...allAgents];

    // Filtro de busca (nome, username, email)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(
        (agent) =>
          agent.name?.toLowerCase().includes(searchLower) ||
          agent.username?.toLowerCase().includes(searchLower) ||
          agent.email?.toLowerCase().includes(searchLower)
      );
    }

    // Filtro por papel
    if (filters.role) {
      filtered = filtered.filter((agent) => agent.role === filters.role);
    }

    // Filtro por status
    if (filters.status !== '') {
      const isActive = filters.status === 'active';
      filtered = filtered.filter((agent) => agent.active === isActive);
    }

    return filtered;
  }, [allAgents, filters]);

  const handleCreate = () => {
    if (!canManageAgents) {
      showToast('Você não tem permissão para criar agentes', 'error');
      return;
    }
    setEditingAgent(null);
    setFormData({
      username: '',
      email: '',
      password: '',
      role: 'operator', // 'agent' migra para 'operator'
      name: '',
      active: true,
    });
    setShowForm(true);
  };

  const handleEdit = (agent) => {
    setEditingAgent(agent);
    setFormData({
      username: agent.username,
      email: agent.email,
      password: '',
      role: agent.role,
      name: agent.name,
      active: agent.active,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      if (editingAgent) {
        const updates = { ...formData };
        if (!updates.password) {
          delete updates.password;
        }
        await authApi.updateAgent(editingAgent.id, updates);
        showToast('Agente atualizado com sucesso', 'success');
      } else {
        await authApi.createAgent(formData);
        showToast('Agente criado com sucesso', 'success');
      }
      setShowForm(false);
      await loadAgents();
    } catch (err) {
      const errorMessage = err.body?.message || err.message || 'Erro ao salvar agente';
      showToast(errorMessage, 'error');
      logger.error('Erro ao salvar agente', err);
    }
  };

  const handleDelete = async (agentToDelete) => {
    const confirmed = await confirm({
      title: 'Confirmar exclusão',
      message: `Tem certeza que deseja remover o agente "${agentToDelete.username}"?`,
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });

    if (!confirmed) return;

    try {
      await authApi.deleteAgent(agentToDelete.id);
      showToast('Agente removido com sucesso', 'success');
      await loadAgents();
    } catch (err) {
      const errorMessage = err.body?.message || err.message || 'Erro ao remover agente';
      showToast(errorMessage, 'error');
      logger.error('Erro ao remover agente', err);
    }
  };

  const getRoleLabel = (role) => {
    const labels = {
      owner: 'Proprietário',
      admin: 'Administrador',
      manager: 'Gerente',
      operator: 'Operador',
      auditor: 'Auditor',
      readonly: 'Somente Leitura',
      // Compatibilidade com roles antigos
      supervisor: 'Supervisor',
      agent: 'Agente',
    };
    return labels[role] || role;
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
    return null; // Será redirecionado pelo useEffect
  }

  if (loading) {
    return (
      <CrudPageBase title="👥 Gerenciamento de Agentes">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando agentes...</p>
          </div>
        </div>
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase
      title="👥 Gerenciamento de Agentes"
      actions={(
        <>
          <Button
            onClick={handleCreate}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Novo Agente
          </Button>
          <Button
            onClick={() => setShowInviteForm(true)}
            style={{ backgroundColor: '#6366f1', color: 'white' }}
          >
            ✉️ Convidar Usuário
          </Button>
        </>
      )}
    >

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
              onChange={(e) => setFilter('search', e.target.value)}
              placeholder="Nome, username ou email..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Papel
            </label>
            <select
              value={filters.role}
              onChange={(e) => setFilter('role', e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos</option>
              <option value="owner">Proprietário</option>
              <option value="admin">Administrador</option>
              <option value="manager">Gerente</option>
              <option value="operator">Operador</option>
              <option value="auditor">Auditor</option>
              <option value="readonly">Somente Leitura</option>
              {/* Compatibilidade */}
              <option value="supervisor">Supervisor</option>
              <option value="agent">Agente</option>
            </select>
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos</option>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={resetFilters}
              variant="secondary"
              className="w-full"
              disabled={!filters.search && !filters.role && !filters.status}
            >
              Limpar Filtros
            </Button>
          </div>
        </div>

        {/* Resumo dos filtros aplicados */}
        {(filters.search || filters.role || filters.status) && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-sm text-text-secondary">
              Mostrando <strong>{agents.length}</strong> de <strong>{allAgents.length}</strong> agente(s)
              {filters.search && ` contendo "${filters.search}"`}
              {filters.role && ` com papel "${getRoleLabel(filters.role)}"`}
              {filters.status && ` com status "${filters.status === 'active' ? 'Ativo' : 'Inativo'}"`}
            </p>
          </div>
        )}
      </div>

        {/* Modal do Formulário */}
        {showForm && (
          <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowForm(false);
              }
            }}
          >
            <div 
              className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold text-text-primary mb-6">
                {editingAgent ? 'Editar Agente' : 'Novo Agente'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Username *
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                    disabled={!!editingAgent}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                  />
                </div>

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
                    {editingAgent ? 'Nova Senha (deixe em branco para manter)' : 'Senha *'}
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required={!editingAgent}
                    minLength={6}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                  />
                </div>

                {canManageAgents && (
                  <>
                    <div>
                      <label className="block mb-2 text-sm font-medium text-text-primary">
                        Papel
                      </label>
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
                      >
                        <option value="operator">Operador</option>
                        <option value="manager">Gerente</option>
                        <option value="admin">Administrador</option>
                        <option value="auditor">Auditor</option>
                        <option value="readonly">Somente Leitura</option>
                        {/* Compatibilidade */}
                        <option value="supervisor">Supervisor</option>
                        <option value="agent">Agente</option>
                      </select>
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
                  </>
                )}

                <div className="flex gap-3 pt-4">
                  <Button type="submit" variant="primary" className="flex-1">
                    {editingAgent ? 'Atualizar' : 'Criar'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowForm(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Tabela de Agentes */}
      <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg-secondary border-b border-border-default">
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Username
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Nome
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Papel
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                  Criado em
                </th>
                {canManageAgents && (
                  <th className="px-4 py-3 text-right text-sm font-semibold text-text-primary">
                    Ações
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-3 text-sm text-text-primary font-medium">{agent.username}</td>
                  <td className="px-4 py-3 text-sm text-text-primary">{agent.name}</td>
                  <td className="px-4 py-3 text-sm text-text-primary">{agent.email}</td>
                  <td className="px-4 py-3 text-sm text-text-primary">{getRoleLabel(agent.role)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                      agent.active 
                        ? 'bg-status-success/20 text-status-success border border-status-success/30' 
                        : 'bg-status-error/20 text-status-error border border-status-error/30'
                    }`}>
                      {agent.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-secondary">
                    {formatDateTime(agent.createdAt)}
                  </td>
                  {canManageAgents && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-w-[84px]"
                          onClick={() => handleEdit(agent)}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-w-[110px]"
                          onClick={() => {
                            setResetPasswordEmail(agent.email);
                            setShowResetPasswordForm(true);
                          }}
                        >
                          Reset Senha
                        </Button>
                        {agent.id !== currentAgent?.id ? (
                          <Button
                            variant="danger"
                            size="sm"
                            className="min-w-[92px]"
                            onClick={() => handleDelete(agent)}
                          >
                            Remover
                          </Button>
                        ) : (
                          <span className="inline-flex min-w-[92px] px-3 py-1.5 text-xs opacity-0 select-none pointer-events-none">
                            Remover
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {agents.length === 0 && (
          <div className="py-20 text-center text-text-secondary">
            Nenhum agente encontrado
          </div>
        )}
      </div>

      {/* Modal de Convite */}
      {showInviteForm && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowInviteForm(false);
              setInviteFormData({ email: '', role: 'operator', name: '' });
            }
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-6">✉️ Convidar Usuário</h2>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await authApi.inviteUser({
                  ...inviteFormData,
                  tenantId: currentAgent?.tenantId,
                });
                showToast('Convite enviado com sucesso!', 'success');
                setShowInviteForm(false);
                setInviteFormData({ email: '', role: 'operator', name: '' });
                await loadAgents();
              } catch (err) {
                showToast(err.body?.message || 'Erro ao enviar convite', 'error');
              }
            }} className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Email *</label>
                <input
                  type="email"
                  value={inviteFormData.email}
                  onChange={(e) => setInviteFormData({ ...inviteFormData, email: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Nome</label>
                <input
                  type="text"
                  value={inviteFormData.name}
                  onChange={(e) => setInviteFormData({ ...inviteFormData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Papel *</label>
                <select
                  value={inviteFormData.role}
                  onChange={(e) => setInviteFormData({ ...inviteFormData, role: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                >
                  <option value="operator">Operador</option>
                  <option value="manager">Gerente</option>
                  <option value="admin">Administrador</option>
                  <option value="auditor">Auditor</option>
                  <option value="readonly">Somente Leitura</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <Button type="submit" variant="primary" className="flex-1">Enviar Convite</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowInviteForm(false);
                    setInviteFormData({ email: '', role: 'operator', name: '' });
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Reset de Senha */}
      {showResetPasswordForm && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowResetPasswordForm(false);
              setResetPasswordEmail('');
            }
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-6">🔐 Reset de Senha</h2>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await authApi.requestPasswordReset(resetPasswordEmail);
                showToast('Link de reset enviado por email!', 'success');
                setShowResetPasswordForm(false);
                setResetPasswordEmail('');
              } catch (err) {
                showToast(err.body?.message || 'Erro ao solicitar reset', 'error');
              }
            }} className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Email *</label>
                <input
                  type="email"
                  value={resetPasswordEmail}
                  onChange={(e) => setResetPasswordEmail(e.target.value)}
                  required
                  placeholder="email@exemplo.com"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                />
                <p className="mt-1 text-xs text-text-secondary">Um link de reset será enviado para este email</p>
              </div>
              <div className="flex gap-3 pt-4">
                <Button type="submit" variant="primary" className="flex-1">Enviar Link</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowResetPasswordForm(false);
                    setResetPasswordEmail('');
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer />
      <ConfirmDialog />
    </CrudPageBase>
  );
}
