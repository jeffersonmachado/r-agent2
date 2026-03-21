import React from 'react';
import { CrmCard } from '../../components/crm/CrmComponents';
import { CrudPageBase } from '../../modules/crud-base';

export function RbacPage() {
  const roles = [
    { name: 'Admin', permissions: ['crm:*'], users: 3 },
    { name: 'Gerente Comercial', permissions: ['crm:accounts:*', 'crm:opportunities:*'], users: 8 },
    { name: 'Representante Comercial', permissions: ['crm:accounts:read', 'crm:opportunities:write'], users: 25 },
    { name: 'Marketing', permissions: ['crm:leads:*', 'crm:campaigns:*'], users: 5 },
  ];

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>🔐 Permissões CRM (RBAC)</h1>
        <p>Controle de acesso e roles do CRM.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {roles.map((role, idx) => (
          <CrmCard key={idx}>
            <h3 className="text-lg font-semibold mb-3">{role.name}</h3>
            <div className="text-sm text-text-secondary mb-3">
              <span className="font-semibold">{role.users}</span> usuários com esta role
            </div>
            <div className="bg-bg-hover rounded-lg p-3 border border-border-default">
              <div className="text-xs font-semibold text-text-secondary mb-2">Permissões:</div>
              <div className="space-y-1">
                {role.permissions.map((perm, i) => (
                  <div key={i} className="text-xs font-mono text-text-secondary">
                    ✓ {perm}
                  </div>
                ))}
              </div>
            </div>
          </CrmCard>
        ))}
      </div>

      <CrmCard className="mt-6">
        <h2 className="text-xl font-semibold mb-4">Permissões por recurso</h2>
        <p className="text-sm text-text-secondary mb-4">
          Além das permissões gerais, o sistema suporta controle granular por recurso individual.
        </p>
        <div className="bg-bg-hover border border-border-default rounded-lg p-4 text-sm">
          <div className="font-semibold mb-2">Exemplo:</div>
          <div className="space-y-1 text-text-secondary">
            <div>• João pode <strong>ver</strong> a conta "Acme Corp"</div>
            <div>• Maria pode <strong>editar</strong> oportunidades do pipeline "Enterprise"</div>
            <div>• Pedro tem <strong>permissão total</strong> em suas próprias contas</div>
          </div>
        </div>
      </CrmCard>
    </CrudPageBase>
  );
}
