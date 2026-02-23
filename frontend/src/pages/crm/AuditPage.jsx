import React, { useState, useEffect } from 'react';
import { CrmCard, CrmTable } from '../../components/crm/CrmComponents';

export function AuditPage() {
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuditLogs();
  }, []);

  const loadAuditLogs = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/crm/audit', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setAuditLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Error loading audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { key: 'timestamp', label: 'Data/Hora', render: (t) => new Date(t).toLocaleString('pt-BR') },
    { key: 'user_id', label: 'Usuário' },
    { key: 'action', label: 'Ação', render: (a) => <span className="font-semibold">{a}</span> },
    { key: 'entity_type', label: 'Entidade' },
    { key: 'entity_id', label: 'ID', render: (id) => <span className="font-mono text-xs">{id?.substring(0, 8)}</span> },
  ];

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Auditoria CRM</h1>

      <CrmCard>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Log de Atividades</h2>
          <div className="text-sm text-gray-600">
            Total: {auditLogs.length} eventos
          </div>
        </div>
        <CrmTable columns={columns} data={auditLogs} isLoading={loading} />
      </CrmCard>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <CrmCard>
          <h3 className="font-semibold mb-2">📝 Eventos Rastreados</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Criação de registros</li>
            <li>• Atualizações</li>
            <li>• Exclusões</li>
            <li>• Mudanças de estágio</li>
          </ul>
        </CrmCard>
        <CrmCard>
          <h3 className="font-semibold mb-2">🔍 Compliance</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Rastro completo de ações</li>
            <li>• Identificação de usuário</li>
            <li>• Timestamp UTC</li>
            <li>• Imutável após criação</li>
          </ul>
        </CrmCard>
        <CrmCard>
          <h3 className="font-semibold mb-2">💾 Retenção</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• 90 dias em hot storage</li>
            <li>• 2 anos em archive</li>
            <li>• Exportação sob demanda</li>
            <li>• Criptografia em repouso</li>
          </ul>
        </CrmCard>
      </div>
    </div>
  );
}
