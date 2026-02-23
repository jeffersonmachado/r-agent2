import React, { useState, useEffect } from 'react';
import { CrmCard, CrmButton, CrmTable, CrmBadge } from '../../components/crm/CrmComponents';

export function WebhooksPage() {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWebhooks();
  }, []);

  const loadWebhooks = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/crm/webhooks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setWebhooks(data.webhooks || []);
      }
    } catch (err) {
      console.error('Error loading webhooks:', err);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { key: 'event', label: 'Evento' },
    { key: 'url', label: 'URL', render: (url) => <span className="font-mono text-xs">{url}</span> },
    { 
      key: 'enabled', 
      label: 'Status', 
      render: (enabled) => <CrmBadge label={enabled ? 'Ativo' : 'Inativo'} variant={enabled ? 'success' : 'default'} />
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Webhooks</h1>
        <CrmButton>+ Novo Webhook</CrmButton>
      </div>

      <CrmCard>
        <h2 className="text-xl font-semibold mb-4">Eventos Disponíveis</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="font-semibold mb-2">🏢 Accounts</div>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• account.created</li>
              <li>• account.updated</li>
              <li>• account.deleted</li>
            </ul>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="font-semibold mb-2">💼 Opportunities</div>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• opportunity.created</li>
              <li>• opportunity.stage_changed</li>
              <li>• opportunity.won</li>
              <li>• opportunity.lost</li>
            </ul>
          </div>
        </div>

        <h2 className="text-xl font-semibold mb-4">Webhooks Configurados</h2>
        <CrmTable columns={columns} data={webhooks} isLoading={loading} />
      </CrmCard>
    </div>
  );
}
