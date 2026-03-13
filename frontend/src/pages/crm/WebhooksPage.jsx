import React, { useState, useEffect } from 'react';
import { CrmCard, CrmButton, CrmTable, CrmBadge } from '../../components/crm/CrmComponents';
import { buildApiUrl } from '../../api/client';

export function WebhooksPage() {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWebhooks();
  }, []);

  const loadWebhooks = async () => {
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('authToken');
      const response = await fetch(buildApiUrl('/api/crm/webhooks'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setWebhooks(data.webhooks || []);
      } else {
        console.error('Error loading webhooks:', response.status);
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
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🔗 Webhooks</h1>
        </div>
        <p>Integrações e notificações em tempo real.</p>
        <div className="support-controls">
          <CrmButton>+ Novo Webhook</CrmButton>
        </div>
      </div>

      <CrmCard>
        <h2 className="text-xl font-semibold mb-4">Eventos disponíveis</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-bg-hover p-4 rounded-lg border border-border-default">
            <div className="font-semibold mb-2">🏢 Contas</div>
            <ul className="text-sm text-text-secondary space-y-1">
              <li>• account.created</li>
              <li>• account.updated</li>
              <li>• account.deleted</li>
            </ul>
          </div>
          <div className="bg-bg-hover p-4 rounded-lg border border-border-default">
            <div className="font-semibold mb-2">💼 Oportunidades</div>
            <ul className="text-sm text-text-secondary space-y-1">
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
