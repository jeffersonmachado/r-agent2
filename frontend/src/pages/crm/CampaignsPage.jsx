import React, { useState } from 'react';
import { CrmCard, CrmButton, CrmModal, CrmForm, CrmInput, CrmTextarea, CrmBadge } from '../../components/crm/CrmComponents';
import { CrudPageBase } from '../../modules/crud-base';

export function CampaignsPage() {
  const statusLabel = (status) => {
    const map = {
      active: 'ativo',
      scheduled: 'agendado',
      completed: 'concluído',
    };
    return map[status] || status;
  };
  const [campaigns] = useState([
    { id: 1, name: 'Prospeccao T1', status: 'active', leads: 45, converted: 12 },
    { id: 2, name: 'Lancamento de Produto', status: 'scheduled', leads: 0, converted: 0 },
    { id: 3, name: 'Reativacao', status: 'completed', leads: 89, converted: 23 },
  ]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <CrudPageBase>
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📢 Campanhas</h1>
        </div>
        <div className="support-controls">
          <CrmButton onClick={() => setIsModalOpen(true)}>+ Nova Campanha</CrmButton>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {campaigns.map((campaign) => (
          <CrmCard key={campaign.id}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold">{campaign.name}</h3>
              <CrmBadge
                label={statusLabel(campaign.status)}
                variant={campaign.status === 'active' ? 'success' : campaign.status === 'scheduled' ? 'warning' : 'default'}
              />
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">Leads Gerados:</span>
                <span className="font-semibold">{campaign.leads}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Convertidos:</span>
                <span className="font-semibold">{campaign.converted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Taxa:</span>
                <span className="font-semibold">
                  {campaign.leads > 0 ? ((campaign.converted / campaign.leads) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          </CrmCard>
        ))}
      </div>

      <CrmModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nova Campanha">
        <CrmForm onSubmit={() => setIsModalOpen(false)}>
          <CrmInput label="Nome da Campanha" value="" onChange={() => {}} required />
          <CrmTextarea label="Descrição" value="" onChange={() => {}} />
          <CrmInput label="Público-alvo" value="" onChange={() => {}} />
        </CrmForm>
      </CrmModal>
    </CrudPageBase>
  );
}
