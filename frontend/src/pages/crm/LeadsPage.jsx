import React, { useEffect, useState } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput, CrmSelect, CrmBadge, CrmAlert } from '../../components/crm/CrmComponents';

export function LeadsPage() {
  const { leads, setLeads, error, setErrorMsg } = useCrm();
  const { listLeads, upsertLead, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    accountId: '',
    contactId: '',
    source: 'website',
    status: 'new',
    score: 0,
    notes: '',
  });

  useEffect(() => {
    loadLeads();
  }, []);

  const loadLeads = async () => {
    try {
      const response = await listLeads();
      setLeads(response.data || []);
    } catch (err) {
      setErrorMsg(`Erro ao carregar: ${err.message}`);
    }
  };

  const handleOpenModal = (lead = null) => {
    if (lead) {
      setFormData(lead);
    } else {
      setFormData({ accountId: '', contactId: '', source: 'website', status: 'new', score: 0, notes: '' });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      await upsertLead(formData);
      await loadLeads();
      setIsModalOpen(false);
      setErrorMsg('Lead salvo com sucesso!');
    } catch (err) {
      setErrorMsg(`Erro ao salvar: ${err.message}`);
    }
  };

  const columns = [
    { key: 'source', label: 'Fonte' },
    { key: 'status', label: 'Status', render: (s) => <CrmBadge label={s} /> },
    { key: 'score', label: 'Score', render: (score) => <span className="font-bold">{score}</span> },
    { key: 'created_at', label: 'Criado em', render: (d) => new Date(d).toLocaleDateString('pt-BR') },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Leads</h1>
        <CrmButton onClick={() => handleOpenModal()}>+ Novo Lead</CrmButton>
      </div>
      {error && <CrmAlert message={error} variant="error" onDismiss={() => setErrorMsg(null)} />}
      <CrmCard>
        <CrmTable columns={columns} data={leads} onRowClick={handleOpenModal} isLoading={loading} />
      </CrmCard>
      <CrmModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Lead" size="md">
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <CrmSelect
            label="Fonte"
            value={formData.source}
            onChange={(v) => setFormData({ ...formData, source: v })}
            options={[
              { value: 'website', label: 'Website' },
              { value: 'email', label: 'Email' },
              { value: 'phone', label: 'Telefone' },
              { value: 'social', label: 'Social Media' },
              { value: 'referral', label: 'Indicação' },
            ]}
          />
          <CrmSelect
            label="Status"
            value={formData.status}
            onChange={(v) => setFormData({ ...formData, status: v })}
            options={[
              { value: 'new', label: 'Novo' },
              { value: 'contacted', label: 'Contactado' },
              { value: 'qualified', label: 'Qualificado' },
              { value: 'lost', label: 'Perdido' },
            ]}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Score: {formData.score}</label>
            <input
              type="range"
              min="0"
              max="100"
              value={formData.score}
              onChange={(e) => setFormData({ ...formData, score: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
          <CrmInput
            label="Notas"
            value={formData.notes}
            onChange={(v) => setFormData({ ...formData, notes: v })}
            placeholder="Observações sobre o lead..."
          />
        </CrmForm>
      </CrmModal>
    </div>
  );
}
