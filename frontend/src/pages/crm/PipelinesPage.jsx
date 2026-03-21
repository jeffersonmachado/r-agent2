import React, { useEffect, useState, useMemo } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput, CrmTextarea } from '../../components/crm/CrmComponents';
import { CrudPageBase } from '../../modules/crud-base';

export function PipelinesPage() {
  const { pipelines: allPipelines, setPipelines } = useCrm();
  const { showToast, ToastContainer } = useToast();
  const { listPipelines, upsertPipeline, deletePipeline, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filters, setFilters] = useState({ search: '' });
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isDefault: false,
    stages: '',
  });

  const pipelines = useMemo(() => {
    return allPipelines.filter(p => {
      if (filters.search && !p.name.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [allPipelines, filters]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ search: '' });
  };

  const loadPipelines = async () => {
    try {
      const response = await listPipelines();
      setPipelines(response.items || []);
    } catch (err) {
      showToast(`Erro ao carregar: ${err.message}`, 'error');
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
      showToast('Nome é obrigatório', 'error');
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
      showToast('Pipeline salvo com sucesso!', 'success');
    } catch (err) {
      if (err instanceof SyntaxError) {
        showToast('JSON de stages inválido', 'error');
      } else {
        showToast(`Erro ao salvar: ${err.message}`, 'error');
      }
    }
  };

  const handleDelete = async (id) => {
    try {
      await deletePipeline(id);
      await loadPipelines();
      showToast('Pipeline deletado com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao deletar: ${err.message}`, 'error');
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
    <CrudPageBase>
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📈 Pipelines</h1>
        </div>
        <div className="support-controls">
          <CrmButton onClick={() => handleOpenModal()}>➕ Novo Pipeline</CrmButton>
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
              Buscar Pipeline
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="Nome do pipeline..."
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
              Mostrando <strong>{pipelines.length}</strong> de <strong>{allPipelines.length}</strong> pipeline(s)
              {filters.search && ` contendo "${filters.search}"`}
            </p>
          </div>
        )}
      </div>

      <CrmCard>
        <CrmTable columns={columns} data={pipelines} onRowClick={handleOpenModal} onDelete={handleDelete} isLoading={loading} />
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
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Definir como padrão</span>
          </label>
        </CrmForm>
      </CrmModal>
      <ToastContainer />
    </CrudPageBase>
  );
}
