import React, { useState } from 'react';
import { CrmCard, CrmButton, CrmModal, CrmForm, CrmInput, CrmTextarea } from '../../components/crm/CrmComponents';

export function CampaignsPage() {
  const [campaigns] = useState([
    { id: 1, name: 'Q1 Outreach', status: 'active', leads: 45, converted: 12 },
    { id: 2, name: 'Product Launch', status: 'scheduled', leads: 0, converted: 0 },
    { id: 3, name: 'Reactivation', status: 'completed', leads: 89, converted: 23 },
  ]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Campanhas</h1>
        <CrmButton onClick={() => setIsModalOpen(true)}>+ Nova Campanha</CrmButton>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {campaigns.map((campaign) => (
          <CrmCard key={campaign.id}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold">{campaign.name}</h3>
              <span className={`px-2 py-1 text-xs rounded ${
                campaign.status === 'active' ? 'bg-green-200 text-green-800' :
                campaign.status === 'scheduled' ? 'bg-blue-200 text-blue-800' :
                'bg-gray-200 text-gray-800'
              }`}>
                {campaign.status}
              </span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Leads Gerados:</span>
                <span className="font-semibold">{campaign.leads}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Convertidos:</span>
                <span className="font-semibold">{campaign.converted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Taxa:</span>
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
    </div>
  );
}
