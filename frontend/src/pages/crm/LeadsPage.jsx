import React, { useEffect, useState, useMemo } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import { PlatformGrid, usePlatformGridState } from '../../modules/platform-grid';
import { SharedSearchFilter, SharedSelectFilter } from '../../modules/shared-filters';
import { CrmCard, CrmButton, CrmModal, CrmForm, CrmInput, CrmSelect, CrmBadge } from '../../components/crm/CrmComponents';

const LEAD_STATUS_LABELS = {
  new: 'Novo',
  contacted: 'Contactado',
  qualified: 'Qualificado',
  lost: 'Perdido',
};

function normalizeLeadStatus(lead) {
  const status = lead?.status || lead?.lead_status || '';
  return String(status).trim().toLowerCase();
}

function getLeadCreatedAt(lead) {
  return lead?.created_at || lead?.createdAt || lead?.createdAtMs || null;
}

function formatLeadDate(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const date =
    typeof value === 'number'
      ? new Date(value < 1000000000000 ? value * 1000 : value)
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString('pt-BR');
}

export function LeadsPage() {
  const { leads: allLeads, setLeads } = useCrm();
  const { showToast, ToastContainer } = useToast();
  const [filters, setFilters] = useState({ search: '', status: '' });
  const leads = useMemo(() => {
    return allLeads.filter(l => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        if (!l.source?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      const normalizedStatus = normalizeLeadStatus(l);
      if (filters.status && normalizedStatus !== filters.status) {
        return false;
      }
      return true;
    });
  }, [allLeads, filters]);
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };
  const clearFilters = () => {
    setFilters({ search: '', status: '' });
  };
  const { listLeads, upsertLead, deleteLead, loading } = useCrmApi();
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
      setLeads(response.items || []);
    } catch (err) {
      showToast(`Erro ao carregar: ${err.message}`, 'error');
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
      showToast('Lead salvo com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteLead(id);
      await loadLeads();
      showToast('Lead deletado com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao deletar: ${err.message}`, 'error');
    }
  };

  const columns = [
    {
      id: 'source',
      header: 'Fonte',
      accessor: (lead) => lead.source || '—',
      sortValue: (lead) => lead.source || '',
    },
    {
      id: 'status',
      header: 'Status',
      render: (lead) => {
        const normalized = normalizeLeadStatus(lead);
        return <CrmBadge label={LEAD_STATUS_LABELS[normalized] || (normalized || '—')} />;
      },
      sortValue: (lead) => normalizeLeadStatus(lead),
      width: '140px',
    },
    {
      id: 'score',
      header: 'Score',
      render: (lead) => <span className="font-bold">{lead.score ?? 0}</span>,
      sortValue: (lead) => Number(lead.score || 0),
      width: '90px',
    },
    {
      id: 'createdAt',
      header: 'Criado em',
      render: (lead) => formatLeadDate(getLeadCreatedAt(lead)),
      sortValue: (lead) => getLeadCreatedAt(lead) || '',
      width: '150px',
    },
  ];

  const grid = usePlatformGridState({
    rows: leads,
    columns,
    persistenceKey: 'crm-leads-grid-v1',
    initialSort: { columnId: 'createdAt', direction: 'desc' },
    getSearchText: (lead) => [
      lead.source,
      normalizeLeadStatus(lead),
      lead.notes,
      String(lead.score ?? ''),
    ].filter(Boolean).join(' '),
  });

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🎯 Leads</h1>
        </div>
        <div className="support-controls">
          <CrmButton onClick={() => handleOpenModal()}>➕ Novo Lead</CrmButton>
        </div>
      </div>
      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <SharedSearchFilter
            label="Buscar Fonte"
            value={filters.search}
            placeholder="Ex: website, email..."
            onChange={(value) => handleFilterChange('search', value)}
          />

          <SharedSelectFilter
            label="Status"
            value={filters.status}
            placeholder="Todos"
            onChange={(value) => handleFilterChange('status', value)}
            options={[
              { label: 'Novo', value: 'new' },
              { label: 'Contactado', value: 'contacted' },
              { label: 'Qualificado', value: 'qualified' },
              { label: 'Perdido', value: 'lost' },
            ]}
          />

          <div className="flex items-end">
            <CrmButton
              onClick={clearFilters}
              variant="secondary"
              style={{ width: '100%' }}
              disabled={!filters.search && !filters.status}
            >
              Limpar Filtros
            </CrmButton>
          </div>
        </div>

        {/* Resumo dos filtros aplicados */}
        {(filters.search || filters.status) && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-sm text-text-secondary">
              Mostrando <strong>{leads.length}</strong> de <strong>{allLeads.length}</strong> lead(s)
              {filters.search && ` with source "${filters.search}"`}
              {filters.status && ` com status "${filters.status}"`}
            </p>
          </div>
        )}
      </div>

      <CrmCard>
        <PlatformGrid
          columns={columns}
          rows={grid.rows}
          loading={loading}
          sort={grid.sort}
          onSortChange={grid.handleSortChange}
          onRowClick={handleOpenModal}
          pagination={{
            page: grid.page,
            totalPages: grid.totalPages,
            pageSize: grid.pageSize,
            totalItems: grid.totalItems,
            pageSizeOptions: grid.pageSizeOptions,
            onPageChange: grid.setPage,
            onPageSizeChange: grid.setPageSize,
          }}
          rowActions={(lead) => ([
            {
              label: 'Editar',
              onClick: () => handleOpenModal(lead),
            },
            {
              label: 'Excluir',
              variant: 'danger',
              onClick: () => handleDelete(lead.id),
            },
          ])}
          emptyState={{
            title: 'Nenhum lead encontrado',
            description: 'Ajuste os filtros para localizar leads.',
          }}
        />
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
      <ToastContainer />
    </div>
  );
}
