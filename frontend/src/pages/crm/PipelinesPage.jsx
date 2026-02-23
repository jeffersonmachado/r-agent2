import React, { useEffect, useState, useMemo } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput, CrmTextarea, CrmAlert } from '../../components/crm/CrmComponents';

export function PipelinesPage() {
  const { pipelines, setPipelines, error, setErrorMsg } = useCrm();
  const { listPipelines, upsertPipeline, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isDefault: false,
    stages: '',
  });

  useEffect(() => {
    loadPipelines();
  }, []);

  const loadPipelines = async () => {
    try {
      const response = await listPipelines();
      setPipelines(response.data || []);
    } catch (err) {
      setErrorMsg(`Erro ao carregar: ${err.message}`);
    }
  };

  const handleOpenModal = (pipeline = null) => {
    if (pipeline) {
      setFormData({
        ...pipeline,
        stages: JSON.stringify(pipeline.stages || [], null, 2),
      });
    } else {
      setFormData({
        name: '',
        description: '',
        isDefault: false,
        stages: JSON.stringify(
          [
            { id: 'qualificacao', name: 'Qualificação' },
            { id: 'proposta', name: 'Proposta' },
            { id: 'fechamento', name: 'Fechamento' },
          ],
          null,
          2
        ),
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setErrorMsg('Nome é obrigatório');
      return;
    }

    try {
      const stages = JSON.parse(formData.stages);
      await upsertPipeline({
        ...formData,
        stages,
      });
      await loadPipelines();
      setIsModalOpen(false);
      setErrorMsg('Pipeline salvo com sucesso!');
    } catch (err) {
      if (err instanceof SyntaxError) {
        setErrorMsg('JSON de stages inválido');
      } else {
        setErrorMsg(`Erro ao salvar: ${err.message}`);
      }
    }
  };

  const columns = useMemo(
    () => [
      { key: 'name', label: 'Nome' },
      { key: 'description', label: 'Descrição' },
      {
        key: 'stages',
        label: 'Stages',
        render: (stages) => <span className="text-xs">{stages?.length || 0} stages</span>,
      },
      {
        key: 'is_default',
        label: 'Padrão',
        render: (isDefault) => (isDefault ? '✓' : ''),
      },
    ],
    []
  );

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Pipelines</h1>
        <CrmButton onClick={() => handleOpenModal()}>+ Novo Pipeline</CrmButton>
      </div>
      {error && <CrmAlert message={error} variant="error" onDismiss={() => setErrorMsg(null)} />}
      <CrmCard>
        <CrmTable columns={columns} data={pipelines} onRowClick={handleOpenModal} isLoading={loading} />
      </CrmCard>
      <CrmModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Pipeline" size="lg">
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <CrmInput
            label="Nome"
            value={formData.name}
            onChange={(v) => setFormData({ ...formData, name: v })}
            placeholder="Ex: Pipeline de Vendas"
            required
          />
          <CrmTextarea
            label="Descrição"
            value={formData.description}
            onChange={(v) => setFormData({ ...formData, description: v })}
            placeholder="Descreva o propósito deste pipeline..."
          />
          <CrmTextarea
            label="Stages (JSON)"
            value={formData.stages}
            onChange={(v) => setFormData({ ...formData, stages: v })}
            rows={6}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.isDefault}
              onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
            />
            <span className="text-sm font-medium text-gray-700">Definir como padrão</span>
          </label>
        </CrmForm>
      </CrmModal>
    </div>
  );
}
