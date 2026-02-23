import React, { useEffect, useState } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import {
  CrmCard,
  CrmButton,
  CrmModal,
  CrmForm,
  CrmInput,
  CrmSelect,
  CrmTextarea,
  CrmBadge,
  CrmAlert,
} from '../../components/crm/CrmComponents';

export function OpportunitiesPage() {
  const { opportunities, setOpportunities, pipelines, setPipelines, error, setErrorMsg } = useCrm();
  const { listOpportunities, listPipelines, upsertOpportunity, moveOpportunityStage, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' ou 'table'
  const [selectedPipeline, setSelectedPipeline] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    pipelineId: '',
    stageId: '',
    accountId: '',
    contactId: '',
    value: '',
    probability: 50,
    expectedClosureDate: '',
    description: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [oppsResponse, pipelinesResponse] = await Promise.all([
        listOpportunities(),
        listPipelines(),
      ]);
      setOpportunities(oppsResponse.data || []);
      setPipelines(pipelinesResponse.data || []);
      if (pipelinesResponse.data?.length > 0) {
        setSelectedPipeline(pipelinesResponse.data[0].id);
      }
    } catch (err) {
      setErrorMsg(`Erro ao carregar: ${err.message}`);
    }
  };

  const handleOpenModal = () => {
    setFormData({
      title: '',
      pipelineId: selectedPipeline || '',
      stageId: '',
      accountId: '',
      contactId: '',
      value: '',
      probability: 50,
      expectedClosureDate: '',
      description: '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim() || !formData.pipelineId) {
      setErrorMsg('Título e Pipeline são obrigatórios');
      return;
    }

    try {
      const response = await upsertOpportunity(formData);
      if (response.opportunity) {
        await loadData();
        setIsModalOpen(false);
        setErrorMsg('Opportunity salva com sucesso!');
      }
    } catch (err) {
      setErrorMsg(`Erro ao salvar: ${err.message}`);
    }
  };

  const handleMoveStage = async (opportunityId, toStageId) => {
    try {
      await moveOpportunityStage(opportunityId, toStageId);
      await loadData();
      setErrorMsg('Opportunity movida com sucesso!');
    } catch (err) {
      setErrorMsg(`Erro ao mover: ${err.message}`);
    }
  };

  const currentPipeline = pipelines.find((p) => p.id === selectedPipeline);
  const filteredOpportunities = opportunities.filter(
    (opp) => opp.pipeline_id === selectedPipeline
  );

  const kanbanColumns = (currentPipeline?.stages || []).map((stage) => ({
    id: stage.id,
    name: stage.name,
    opportunities: filteredOpportunities.filter((opp) => opp.stage_id === stage.id),
  }));

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Opportunities</h1>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1 rounded ${viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
            >
              Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
            >
              Tabela
            </button>
          </div>
        </div>
        <CrmButton onClick={handleOpenModal} variant="primary">
          + Nova Opportunity
        </CrmButton>
      </div>

      {error && (
        <CrmAlert
          message={error}
          variant="error"
          onDismiss={() => setErrorMsg(null)}
        />
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Pipeline</label>
        <select
          value={selectedPipeline || ''}
          onChange={(e) => setSelectedPipeline(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kanbanColumns.map((column) => (
            <div key={column.id} className="bg-gray-100 rounded-lg p-4">
              <h2 className="font-bold text-gray-700 mb-3">
                {column.name} ({column.opportunities.length})
              </h2>
              <div className="space-y-2">
                {column.opportunities.map((opp) => (
                  <div
                    key={opp.id}
                    className="bg-white rounded p-3 shadow hover:shadow-md transition-shadow"
                    draggable
                    onDragEnd={(e) => {
                      const nextStage = kanbanColumns[(kanbanColumns.findIndex((c) => c.id === column.id) + 1) % kanbanColumns.length];
                      if (nextStage) {
                        handleMoveStage(opp.id, nextStage.id);
                      }
                    }}
                  >
                    <h3 className="font-semibold text-sm text-gray-900">{opp.title}</h3>
                    <p className="text-xs text-gray-600 mt-1">{opp.description}</p>
                    <div className="flex justify-between items-center mt-2">
                      <CrmBadge
                        label={`${opp.probability}%`}
                        variant={opp.probability > 70 ? 'success' : 'warning'}
                      />
                      <span className="text-xs font-semibold text-blue-600">
                        {opp.value ? `R$ ${opp.value}` : '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <CrmCard>
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-4 py-2 text-left">Título</th>
                <th className="px-4 py-2 text-left">Stage</th>
                <th className="px-4 py-2 text-left">Valor</th>
                <th className="px-4 py-2 text-left">Probabilidade</th>
              </tr>
            </thead>
            <tbody>
              {filteredOpportunities.map((opp) => (
                <tr key={opp.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2">{opp.title}</td>
                  <td className="px-4 py-2">{opp.stage_id}</td>
                  <td className="px-4 py-2">{opp.value ? `R$ ${opp.value}` : '-'}</td>
                  <td className="px-4 py-2">{opp.probability}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrmCard>
      )}

      <CrmModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nova Opportunity"
        size="lg"
      >
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <CrmInput
            label="Título"
            value={formData.title}
            onChange={(v) => setFormData({ ...formData, title: v })}
            placeholder="Ex: Venda ABC Corp"
            required
          />
          <CrmSelect
            label="Pipeline"
            value={formData.pipelineId}
            onChange={(v) => {
              const pipeline = pipelines.find((p) => p.id === v);
              setFormData({
                ...formData,
                pipelineId: v,
                stageId: pipeline?.stages?.[0]?.id || '',
              });
            }}
            options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
            required
          />
          <CrmSelect
            label="Stage"
            value={formData.stageId}
            onChange={(v) => setFormData({ ...formData, stageId: v })}
            options={
              currentPipeline?.stages?.map((s) => ({ value: s.id, label: s.name })) || []
            }
            required
          />
          <CrmInput
            label="Valor (R$)"
            type="number"
            value={formData.value}
            onChange={(v) => setFormData({ ...formData, value: v })}
            placeholder="100000"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Probabilidade (%): {formData.probability}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={formData.probability}
              onChange={(e) => setFormData({ ...formData, probability: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
          <CrmInput
            label="Data Prevista de Fechamento"
            type="date"
            value={formData.expectedClosureDate}
            onChange={(v) => setFormData({ ...formData, expectedClosureDate: v })}
          />
          <CrmTextarea
            label="Descrição"
            value={formData.description}
            onChange={(v) => setFormData({ ...formData, description: v })}
            placeholder="Detalhes sobre a oportunidade..."
          />
        </CrmForm>
      </CrmModal>
    </div>
  );
}
