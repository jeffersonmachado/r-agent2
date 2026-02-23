import React, { useEffect, useState } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput, CrmTextarea, CrmAlert } from '../../components/crm/CrmComponents';

export function ActivitiesPage() {
  const { activities, setActivities, error, setErrorMsg } = useCrm();
  const { listActivities, upsertActivity, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    opportunityId: '',
    type: 'call',
    subject: '',
    notes: '',
    duration: '',
    outcome: '',
  });

  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    try {
      const response = await listActivities();
      setActivities(response.data || []);
    } catch (err) {
      setErrorMsg(`Erro ao carregar atividades: ${err.message}`);
    }
  };

  const handleOpenModal = (activity = null) => {
    if (activity) {
      setFormData(activity);
    } else {
      setFormData({
        opportunityId: '',
        type: 'call',
        subject: '',
        notes: '',
        duration: '',
        outcome: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.subject.trim()) {
      setErrorMsg('Assunto é obrigatório');
      return;
    }

    try {
      await upsertActivity(formData);
      await loadActivities();
      setIsModalOpen(false);
      setErrorMsg('Atividade salva com sucesso!');
    } catch (err) {
      setErrorMsg(`Erro ao salvar: ${err.message}`);
    }
  };

  const columns = [
    { key: 'type', label: 'Tipo', render: (type) => {
      const icons = { call: '📞', meeting: '🤝', email: '📧', task: '✅', note: '📝' };
      return <span>{icons[type] || '📝'} {type}</span>;
    }},
    { key: 'subject', label: 'Assunto' },
    { key: 'duration', label: 'Duração', render: (d) => d ? `${d} min` : '-' },
    { key: 'outcome', label: 'Resultado' },
    { key: 'created_at', label: 'Data', render: (d) => new Date(d).toLocaleString('pt-BR') },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Atividades</h1>
        <CrmButton onClick={() => handleOpenModal()}>+ Nova Atividade</CrmButton>
      </div>
      {error && <CrmAlert message={error} variant="error" onDismiss={() => setErrorMsg(null)} />}
      <CrmCard>
        <CrmTable columns={columns} data={activities} onRowClick={handleOpenModal} isLoading={loading} />
      </CrmCard>
      <CrmModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Atividade" size="lg">
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <div className="grid grid-cols-2 gap-4">
            <CrmInput
              label="Assunto"
              value={formData.subject}
              onChange={(v) => setFormData({ ...formData, subject: v })}
              required
            />
            <CrmInput
              label="Tipo"
              value={formData.type}
              onChange={(v) => setFormData({ ...formData, type: v })}
            />
          </div>
          <CrmTextarea
            label="Notas"
            value={formData.notes}
            onChange={(v) => setFormData({ ...formData, notes: v })}
            rows={4}
          />
          <div className="grid grid-cols-2 gap-4">
            <CrmInput
              label="Duração (min)"
              type="number"
              value={formData.duration}
              onChange={(v) => setFormData({ ...formData, duration: v })}
            />
            <CrmInput
              label="Resultado"
              value={formData.outcome}
              onChange={(v) => setFormData({ ...formData, outcome: v })}
            />
          </div>
        </CrmForm>
      </CrmModal>
    </div>
  );
}
