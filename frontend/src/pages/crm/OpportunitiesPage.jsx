import React, { useEffect, useState } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import {
  CrmCard,
  CrmButton,
  CrmModal,
  CrmForm,
  CrmInput,
  CrmSelect,
  CrmTextarea,
  CrmBadge,
} from '../../components/crm/CrmComponents';
import { ScheduleModal } from '../../components/ScheduleModal';
import { CrudPageBase } from '../../modules/crud-base';

export function OpportunitiesPage() {
  const { opportunities, setOpportunities, pipelines, setPipelines } = useCrm();
  const { showToast, ToastContainer } = useToast();
  const { listOpportunities, listPipelines, upsertOpportunity, updateOpportunity, deleteOpportunity, moveOpportunityStage, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Edição explícita: guardar o id separa "atualizar" de "criar". Sem isto o
  // formulário de edição caía no POST de criação e duplicava o registro
  // (P1 medido em 2026-10-19).
  const [editingId, setEditingId] = useState(null);
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' ou 'table'
  const [selectedPipeline, setSelectedPipeline] = useState(null);
  const [scheduleOpportunity, setScheduleOpportunity] = useState(null);
  const [filters, setFilters] = useState({ search: '' });
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

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ search: '' });
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [oppsResponse, pipelinesResponse] = await Promise.all([
        listOpportunities(),
        listPipelines(),
      ]);
      setOpportunities(oppsResponse.items || []);
      setPipelines(pipelinesResponse.items || []);
      if (pipelinesResponse.items?.length > 0) {
        setSelectedPipeline(pipelinesResponse.items[0].id);
      }
    } catch (err) {
      showToast(`Erro ao carregar: ${err.message}`, 'error');
    }
  };

  const handleOpenModal = () => {
    // Abertura para CRIAÇÃO: limpa qualquer id de edição pendente.
    setEditingId(null);
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
      showToast('Título e Pipeline são obrigatórios', 'error');
      return;
    }

    // A UI usa nomes de campo próprios; a API do CRM persiste `name`,
    // `expectedCloseDate` e `notes`. Sem este mapeamento o título era descartado
    // e a oportunidade nascia como "Nova Oportunidade" (medido em 2026-10-19).
    const payload = {
      name: formData.title,
      pipelineId: formData.pipelineId,
      stageId: formData.stageId,
      accountId: formData.accountId,
      contactId: formData.contactId,
      value: Number(formData.value) || 0,
      probability: formData.probability,
      expectedCloseDate: formData.expectedClosureDate || null,
      notes: formData.description || null,
    };

    try {
      // Atualização vai por PUT com id explícito; criação vai por POST. O backend
      // recusa PUT sem registro existente (404) e id divergente (400), então
      // editar nunca cria uma oportunidade nova.
      const response = editingId
        ? await updateOpportunity(editingId, payload)
        : await upsertOpportunity(payload);
      // Mesma classe de defeito da tela de Contas: a guarda esperava
      // `response.opportunity`, a API devolve o registro direto.
      const salva = response?.opportunity || (response?.id ? response : null);
      if (salva) {
        await loadData();
        setIsModalOpen(false);
        setEditingId(null);
        showToast(editingId ? 'Oportunidade atualizada com sucesso!' : 'Oportunidade salva com sucesso!', 'success');
      }
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    }
  };

  const handleMoveStage = async (opportunityId, toStageId) => {
    try {
      await moveOpportunityStage(opportunityId, toStageId);
      await loadData();
      showToast('Oportunidade movida com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao mover: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteOpportunity(id);
      await loadData();
      showToast('Oportunidade excluida com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao deletar: ${err.message}`, 'error');
    }
  };

  const currentPipeline = pipelines.find((p) => p.id === selectedPipeline);
  // A API devolve camelCase (`pipelineId`/`stageId`/`name`/`expectedCloseDate`).
  // O kanban filtrava por snake_case (`pipeline_id`/`stage_id`) e lia `opp.title`:
  // resultado medido em 2026-10-19 — coluna sempre (0) e card sem título, mesmo
  // com a oportunidade gravada na API. `nomeDoCampo` cobre registros legados.
  const pipelineIdDe = (opp) => opp.pipelineId || opp.pipeline_id;
  const stageIdDe = (opp) => opp.stageId || opp.stage_id;
  const tituloDe = (opp) => opp.name || opp.title || '—';

  const filteredOpportunities = opportunities.filter(
    (opp) => pipelineIdDe(opp) === selectedPipeline
  );

  const kanbanColumns = (currentPipeline?.stages || []).map((stage) => ({
    id: stage.id,
    name: stage.name,
    opportunities: filteredOpportunities.filter((opp) => stageIdDe(opp) === stage.id),
  }));

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>💼 Oportunidades</h1>
        </div>
        <div className="support-controls">
          <button
            onClick={() => setViewMode('kanban')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: viewMode === 'kanban' ? 'var(--color-accent-primary)' : 'transparent',
              color: viewMode === 'kanban' ? 'white' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-default)',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              marginRight: '8px'
            }}
          >
            Kanban
          </button>
          <button
            onClick={() => setViewMode('table')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: viewMode === 'table' ? 'var(--color-accent-primary)' : 'transparent',
              color: viewMode === 'table' ? 'white' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-default)',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              marginRight: '12px'
            }}
          >
            Tabela
          </button>
          <CrmButton onClick={handleOpenModal} variant="primary">
            ➕ Nova Oportunidade
          </CrmButton>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar Oportunidade
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="Título ou descrição..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>

          <div className="flex items-end">
            <CrmButton
              onClick={clearFilters}
              variant="secondary"
              style={{ width: '100%' }}
              disabled={!filters.search}
            >
              Limpar Filtros
            </CrmButton>
          </div>
        </div>

        {/* Resumo dos filtros aplicados */}
        {filters.search && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-sm text-text-secondary">
              Aplicando filtro: <strong>{filters.search}</strong>
            </p>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>Pipeline</label>
        <select
          value={selectedPipeline || ''}
          onChange={(e) => setSelectedPipeline(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--color-border-default)',
            backgroundColor: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)',
            fontSize: '14px',
            cursor: 'pointer'
          }}
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
            <div
              key={column.id}
              className="bg-bg-hover rounded-lg p-4"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                // DEFEITO MEDIDO (2026-10-19): o card movia de etapa em QUALQUER
                // `dragEnd` — arrastar e soltar no mesmo lugar adiantava o funil
                // sem o usuário pedir. Mover agora exige soltar NA COLUNA.
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) handleMoveStage(id, column.id);
              }}
            >
              <h2 className="font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>
                {column.name} ({column.opportunities.length})
              </h2>
              <div className="space-y-2">
                {column.opportunities.map((opp) => (
                  <div
                    key={opp.id}
                    className="rounded p-3 shadow transition-shadow"
                    style={{
                      backgroundColor: 'var(--color-bg-elevated)',
                      cursor: 'grab'
                    }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', opp.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{tituloDe(opp)}</h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{opp.notes || opp.description || ''}</p>
                    <div className="flex justify-between items-center mt-2">
                      <CrmBadge
                        label={`${opp.probability}%`}
                        variant={opp.probability > 70 ? 'success' : 'warning'}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-accent-primary)' }}>
                        {opp.value ? `R$ ${opp.value}` : '-'}
                      </span>
                    </div>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setScheduleOpportunity(opp)}
                        style={{
                          border: '1px solid var(--color-border-default)',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          fontSize: '11px',
                          color: 'var(--color-text-secondary)',
                          background: 'var(--color-bg-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        Agendar
                      </button>
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
            <thead style={{ backgroundColor: 'var(--color-bg-hover)', borderBottom: '1px solid var(--color-border-default)' }}>
              <tr>
                <th className="px-4 py-2 text-left" style={{ color: 'var(--color-text-primary)' }}>Título</th>
                <th className="px-4 py-2 text-left" style={{ color: 'var(--color-text-primary)' }}>Etapa</th>
                <th className="px-4 py-2 text-left" style={{ color: 'var(--color-text-primary)' }}>Valor</th>
                <th className="px-4 py-2 text-left" style={{ color: 'var(--color-text-primary)' }}>Probabilidade</th>
                <th className="px-4 py-2 text-center" style={{ color: 'var(--color-text-primary)' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredOpportunities.map((opp) => (
                <tr key={opp.id} className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>{tituloDe(opp)}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>{opp.stage_id}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>{opp.value ? `R$ ${opp.value}` : '-'}</td>
                  <td className="px-4 py-2" style={{ color: 'var(--color-text-primary)' }}>{opp.probability}%</td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => {
                          setEditingId(opp.id);
                          setFormData({
                            ...opp,
                            title: tituloDe(opp),
                            pipelineId: pipelineIdDe(opp),
                            stageId: stageIdDe(opp),
                            expectedClosureDate: opp.expectedCloseDate || opp.expectedClosureDate || '',
                            description: opp.notes || opp.description || '',
                          });
                          setIsModalOpen(true);
                        }}
                        className="text-accent-primary hover:text-accent-primary-hover transition-colors"
                        title="Editar"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => setScheduleOpportunity(opp)}
                        className="text-text-secondary hover:text-text-primary transition-colors"
                        title="Agendar"
                      >
                        🗓️
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Deseja excluir esta oportunidade?')) {
                            handleDelete(opp.id);
                          }
                        }}
                        className="text-status-error hover:opacity-80 transition-opacity"
                        title="Excluir"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrmCard>
      )}

      <CrmModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? 'Editar Oportunidade' : 'Nova Oportunidade'}
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
            label="Etapa"
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
            <label className="block text-sm font-medium text-text-secondary mb-1">
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
      {scheduleOpportunity?.id ? (
        <ScheduleModal
          isOpen={!!scheduleOpportunity}
          onClose={() => setScheduleOpportunity(null)}
          contextType="crm"
          contextId={String(scheduleOpportunity.id)}
          contactId={scheduleOpportunity.contact_id || ''}
          defaultPurpose="follow-up comercial"
          defaultChannel="internal"
          title={`Agendar oportunidade: ${scheduleOpportunity.title || scheduleOpportunity.id}`}
          onCreated={() => showToast('Agendamento criado', 'success')}
        />
      ) : null}
      <ToastContainer />
    </CrudPageBase>
  );
}
