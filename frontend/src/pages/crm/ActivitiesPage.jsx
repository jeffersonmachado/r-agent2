import React, { useEffect, useState } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput, CrmTextarea } from '../../components/crm/CrmComponents';

export function ActivitiesPage() {
  const { activities, setActivities } = useCrm();
  const { listActivities, upsertActivity, loading } = useCrmApi();
  const { showToast, ToastContainer } = useToast();
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
      setActivities(response.items || []);
    } catch (err) {
      showToast(`Erro ao carregar atividades: ${err.message}`, 'error');
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
      showToast('Assunto é obrigatório', 'error');
      return;
    }

    try {
      await upsertActivity(formData);
      await loadActivities();
      setIsModalOpen(false);
      showToast('Atividade salva com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
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
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📝 Atividades</h1>
        </div>
        <div className="support-controls">
          <CrmButton onClick={() => handleOpenModal()}>+ Nova Atividade</CrmButton>
        </div>
      </div>
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
      <ToastContainer />
    </div>
  );
}
