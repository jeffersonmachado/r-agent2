/**
 * Página de Super Admin - Gerenciamento Global
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import * as superAdminApi from '../api/superAdmin';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { PlanSelectionModal } from '../components/PlanSelectionModal';
import logger from '../utils/logger';

export function SuperAdminPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planChangeTenant, setPlanChangeTenant] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    plan: '',
  });

  // Verifica se é Super Admin
  const isSuperAdmin = currentAgent?.role === 'super_admin' || 
    (currentAgent?.role === 'owner' && currentAgent?.tenantId === 'system');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (isAuthenticated && isSuperAdmin) {
      loadTenants();
    }
  }, [isAuthenticated, isSuperAdmin]);

  const loadTenants = async () => {
    try {
      setLoading(true);
      const result = await superAdminApi.listAllTenants(filters);
      setTenants(result.tenants || []);
    } catch (err) {
      logger.error('Erro ao carregar tenants (Super Admin)', err);
      showToast('Erro ao carregar tenants', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadMetrics = async (tenantId) => {
    try {
      const result = await superAdminApi.getTenantMetrics(tenantId);
      setMetrics(result.metrics);
      setSelectedTenant(tenantId);
    } catch (err) {
      logger.error('Erro ao carregar métricas', err);
      showToast('Erro ao carregar métricas', 'error');
    }
  };

  const handleBlock = async (tenant) => {
    const confirmed = await confirm({
      title: 'Bloquear Tenant',
      message: `Tem certeza que deseja bloquear o tenant "${tenant.name}"?`,
      confirmLabel: 'Bloquear',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });

    if (!confirmed) return;

    try {
      await superAdminApi.blockTenant(tenant.id, 'Bloqueado por Super Admin');
      showToast('Tenant bloqueado com sucesso', 'success');
      await loadTenants();
    } catch (err) {
      showToast(err.body?.message || 'Erro ao bloquear tenant', 'error');
    }
  };

  const handleUnblock = async (tenant) => {
    try {
      await superAdminApi.unblockTenant(tenant.id);
      showToast('Tenant desbloqueado com sucesso', 'success');
      await loadTenants();
    } catch (err) {
      showToast(err.body?.message || 'Erro ao desbloquear tenant', 'error');
    }
  };

  const handleAdjustPlan = (tenant) => {
    setPlanChangeTenant(tenant);
    setShowPlanModal(true);
  };

  const handleImpersonate = async (tenant) => {
    // TODO: Implementar seleção de usuário para impersonar
    showToast('Funcionalidade de impersonação em desenvolvimento', 'info');
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

  if (!isSuperAdmin) {
    return (
      <div className="support-page">
        <div className="support-header">
          <h1>🔐 Super Admin</h1>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-center">
          <p className="text-text-secondary">
            Apenas Super Admin pode acessar esta área.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="support-page">
        <div className="support-header">
          <h1>🔐 Super Admin</h1>
        </div>
        <div className="flex items-center justify-center min-h-60vh">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>🔐 Super Admin - Gerenciamento Global</h1>
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <h3 className="text-xl font-semibold text-text-primary mb-4">🔍 Filtros</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Buscar</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Nome ou site..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
            >
              <option value="">Todos</option>
              <option value="trial">Trial</option>
              <option value="active">Ativo</option>
              <option value="suspended">Suspenso</option>
            </select>
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Plano</label>
            <select
              value={filters.plan}
              onChange={(e) => setFilters({ ...filters, plan: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
            >
              <option value="">Todos</option>
              <option value="free">Free</option>
              <option value="trial">Trial</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <Button
            onClick={loadTenants}
            variant="primary"
          >
            Aplicar Filtros
          </Button>
        </div>
      </div>

      {/* Lista de Tenants */}
      <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg-secondary border-b border-border-default">
                <th className="px-4 py-3 text-left text-sm font-semibold">Nome</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Plano</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Métricas</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-border-default hover:bg-bg-hover">
                  <td className="px-4 py-3 text-sm font-medium">{tenant.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      tenant.plan === 'enterprise' ? 'bg-purple-500/20 text-purple-500' :
                      tenant.plan === 'pro' ? 'bg-blue-500/20 text-blue-500' :
                      tenant.plan === 'trial' ? 'bg-yellow-500/20 text-yellow-500' :
                      'bg-gray-500/20 text-gray-500'
                    }`}>
                      {tenant.plan?.toUpperCase() || 'TRIAL'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      tenant.status === 'active' ? 'bg-green-500/20 text-green-500' :
                      tenant.status === 'suspended' ? 'bg-red-500/20 text-red-500' :
                      tenant.status === 'trial' ? 'bg-yellow-500/20 text-yellow-500' :
                      'bg-gray-500/20 text-gray-500'
                    }`}>
                      {tenant.status || 'active'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => loadMetrics(tenant.id)}
                    >
                      Ver Métricas
                    </Button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      {tenant.status === 'suspended' ? (
                        <Button variant="success" size="sm" onClick={() => handleUnblock(tenant)}>
                          Desbloquear
                        </Button>
                      ) : (
                        <Button variant="warning" size="sm" onClick={() => handleBlock(tenant)}>
                          Bloquear
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => handleAdjustPlan(tenant)}>
                        Ajustar Plano
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleImpersonate(tenant)}>
                        Impersonar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Métricas */}
      {metrics && selectedTenant && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setMetrics(null);
            setSelectedTenant(null);
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold mb-4">Métricas do Tenant</h2>
            {metrics.tenant && (
              <div className="mb-4">
                <p><strong>Nome:</strong> {metrics.tenant.name}</p>
                <p><strong>Plano:</strong> {metrics.tenant.plan}</p>
                <p><strong>Status:</strong> {metrics.tenant.status}</p>
              </div>
            )}
            {metrics.usage && (
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">Uso</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>Usuários: {metrics.usage.usuarios || 0}</div>
                  <div>Agentes IA: {metrics.usage.agentes_ia || 0}</div>
                  <div>Execuções RPA: {metrics.usage.execucoes_rpa || 0}</div>
                  <div>Tokens IA: {metrics.usage.tokens_ia || 0}</div>
                </div>
              </div>
            )}
            {metrics.agents && (
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">Agentes</h3>
                <p>Total: {metrics.agents.total}</p>
                <pre className="bg-bg-secondary p-2 rounded text-xs overflow-auto">
                  {JSON.stringify(metrics.agents.byRole, null, 2)}
                </pre>
              </div>
            )}
            <Button onClick={() => { setMetrics(null); setSelectedTenant(null); }}>
              Fechar
            </Button>
          </div>
        </div>
      )}

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
              await superAdminApi.adjustTenantPlan(planChangeTenant.id, newPlan);
              showToast('Plano ajustado com sucesso', 'success');
              await loadTenants();
            } catch (err) {
              const errorMessage = err.body?.message || err.message || 'Erro ao ajustar plano';
              showToast(errorMessage, 'error');
              logger.error('Erro ao ajustar plano', err);
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
