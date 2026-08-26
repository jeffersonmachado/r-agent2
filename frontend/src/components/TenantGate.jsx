import React, { useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { isSuperAdmin as checkIsSuperAdmin } from '../utils/menuPermissions';
import { TenantSelectorModal } from './TenantSelectorModal';

/**
 * Tenant Gate (super-admin):
 * - Se a sessão estiver autenticada mas o tenant efetivo estiver ausente ou "system",
 *   bloqueia a UI e exige seleção explícita de um tenant.
 *
 * Motivação: após restart do backend, /auth/me pode voltar com tenantId="system".
 *
 * A função `shouldBlockPageForTenant` é a fonte única da decisão: quando true,
 * o shell pode existir, mas o CONTEÚDO da página não deve ser renderizado até
 * que o tenant seja escolhido (requisito: página só abre com agente + tenant).
 */
export function shouldBlockPageForTenant({ isAuthenticated, agent }) {
  if (!isAuthenticated) return false;
  if (!agent) return false;
  const isSuperAdmin = checkIsSuperAdmin(agent);
  if (!isSuperAdmin) return false;
  // O gate só deve abrir quando ainda não existe tenant efetivo confirmado.
  // Isso permite que o super-admin opere no tenant "system" caso o selecione explicitamente.
  try {
    const effective = localStorage.getItem('auth_effective_tenant_id');
    if (effective && typeof effective === 'string' && effective.trim()) {
      return false;
    }
  } catch {
    // se localStorage falhar, cai na regra antiga por segurança
  }
  return !agent.tenantId || agent.tenantId === 'system';
}

export function TenantGate() {
  const { isAuthenticated, agent, updateAgent } = useAuth();

  const shouldShowTenantGate = useMemo(
    () => shouldBlockPageForTenant({ isAuthenticated, agent }),
    [isAuthenticated, agent]
  );

  if (!shouldShowTenantGate) return null;

  return (
    <TenantSelectorModal
      isOpen={true}
      requireExplicitSelection={true}
      autoConfirmOnTenantClick={true}
      onSelect={(tenant) => {
        if (!tenant?.id) return;
        // Sem tenant de origem não assumimos 'system': bloqueia a troca e o
        // gate permanece aberto, sinalizando a ausência de tenant efetivo.
        const baseOriginalTenantId = agent?.originalTenantId || agent?.tenantId;
        if (!baseOriginalTenantId) return;
        updateAgent({
          ...agent,
          tenantId: tenant.id,
          originalTenantId: baseOriginalTenantId,
        });
      }}
      // Não permite cancelar: precisa selecionar um tenant.
      onClose={() => {}}
    />
  );
}

