import React from 'react';
import { CrmCard } from '../../components/crm/CrmComponents';

export function RbacPage() {
  const roles = [
    { name: 'Admin', permissions: ['crm:*'], users: 3 },
    { name: 'Sales Manager', permissions: ['crm:accounts:*', 'crm:opportunities:*'], users: 8 },
    { name: 'Sales Rep', permissions: ['crm:accounts:read', 'crm:opportunities:write'], users: 25 },
    { name: 'Marketing', permissions: ['crm:leads:*', 'crm:campaigns:*'], users: 5 },
  ];

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Permissões CRM (RBAC)</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {roles.map((role, idx) => (
          <CrmCard key={idx}>
            <h3 className="text-lg font-semibold mb-3">{role.name}</h3>
            <div className="text-sm text-gray-600 mb-3">
              <span className="font-semibold">{role.users}</span> usuários com esta role
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">Permissões:</div>
              <div className="space-y-1">
                {role.permissions.map((perm, i) => (
                  <div key={i} className="text-xs font-mono text-gray-600">
                    ✓ {perm}
                  </div>
                ))}
              </div>
            </div>
          </CrmCard>
        ))}
      </div>

      <CrmCard className="mt-6">
        <h2 className="text-xl font-semibold mb-4">Resource-Level Permissions</h2>
        <p className="text-sm text-gray-600 mb-4">
          Além das permissões gerais, o sistema suporta controle granular por recurso individual.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
          <div className="font-semibold mb-2">Exemplo:</div>
          <div className="space-y-1 text-gray-700">
            <div>• João pode <strong>ver</strong> a conta "Acme Corp"</div>
            <div>• Maria pode <strong>editar</strong> oportunidades do pipeline "Enterprise"</div>
            <div>• Pedro tem <strong>permissão total</strong> em suas próprias contas</div>
          </div>
        </div>
      </CrmCard>
    </div>
  );
}
