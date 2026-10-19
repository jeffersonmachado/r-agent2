import React, { useEffect, useState, useMemo } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput, CrmSelect, CrmBadge } from '../../components/crm/CrmComponents';
import { CrudPageBase } from '../../modules/crud-base';

const LEAD_STATUS_LABELS = {
  novo: 'Novo',
  contactado: 'Contactado',
  qualificado: 'Qualificado',
  perdido: 'Perdido',
  // Etapas legadas de `marketing_leads` (valores em inglês que já existem na
  // base). Sem rótulo, a coluna mostrava o valor cru (medido em 2026-10-19).
  visitor: 'Visitante',
  lead: 'Lead',
  customer: 'Cliente',
  opportunity: 'Oportunidade',
  proposal: 'Proposta',
  negotiation: 'Negociação',
  won: 'Ganho',
  lost: 'Perdido',
};

// DEFEITO MEDIDO (2026-10-19, jornada real em /crm/leads): o formulário enviava
// `status: 'new'` (inglês) e a lista lia `lead.status`, mas o backend persiste
// `stage` com valores em português ('novo'|'contactado'|'qualificado'|'perdido').
// Resultado: todo lead aparecia com Status "—" e o filtro de status nunca
// encontrava nada. `stage` é o campo canônico; os valores legados em inglês são
// normalizados para não quebrar registros antigos.
const LEGACY_STATUS_ALIASES = {
  new: 'novo',
  contacted: 'contactado',
  qualified: 'qualificado',
  lost: 'perdido',
  contact: 'contato',
};

function normalizeLeadStatus(lead) {
  const bruto = lead?.stage || lead?.status || lead?.lead_status || '';
  const normalizado = String(bruto).trim().toLowerCase();
  return LEGACY_STATUS_ALIASES[normalizado] || normalizado;
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
        const alvo = `${l.name || ''} ${l.email || ''} ${l.source || ''}`.toLowerCase();
        if (!alvo.includes(searchLower)) {
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
  const FORM_VAZIO = {
    name: '',
    email: '',
    phone: '',
    accountId: '',
    contactId: '',
    source: 'website',
    stage: 'novo',
    score: 0,
    notes: '',
  };
  const [formData, setFormData] = useState(FORM_VAZIO);

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
      setFormData({ ...FORM_VAZIO, ...lead, stage: normalizeLeadStatus(lead) || 'novo' });
    } else {
      setFormData({ ...FORM_VAZIO });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    // Sem identidade o registro vira "Sem nome" e não há como rastrear o lead.
    if (!String(formData.name || '').trim()) {
      showToast('Informe o nome do lead.', 'error');
      return;
    }
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
    { key: 'name', label: 'Nome', render: (nome) => nome || '—' },
    { key: 'source', label: 'Fonte' },
    {
      key: 'stage',
      label: 'Status',
      render: (_, row) => {
        const normalized = normalizeLeadStatus(row);
        return <CrmBadge label={LEAD_STATUS_LABELS[normalized] || (normalized || '—')} />;
      },
    },
    { key: 'score', label: 'Score', render: (score) => <span className="font-bold">{score}</span> },
    { key: 'created_at', label: 'Criado em', render: (_, row) => formatLeadDate(getLeadCreatedAt(row)) },
  ];

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
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
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar por nome, e-mail ou fonte
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="Ex: website, email..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer"
            >
              <option value="">Todos</option>
              <option value="novo">Novo</option>
              <option value="contactado">Contactado</option>
              <option value="qualificado">Qualificado</option>
              <option value="perdido">Perdido</option>
            </select>
          </div>

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
              {filters.search && ` para "${filters.search}"`}
              {filters.status && ` com status "${LEAD_STATUS_LABELS[filters.status] || filters.status}"`}
            </p>
          </div>
        )}
      </div>

      <CrmCard>
        <CrmTable columns={columns} data={leads} onRowClick={handleOpenModal} onDelete={handleDelete} isLoading={loading} />
      </CrmCard>
      <CrmModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Lead" size="md">
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <CrmInput
            label="Nome"
            value={formData.name}
            onChange={(v) => setFormData({ ...formData, name: v })}
            placeholder="Nome do lead"
          />
          <CrmInput
            label="E-mail"
            value={formData.email || ''}
            onChange={(v) => setFormData({ ...formData, email: v })}
            placeholder="lead@empresa.com"
          />
          <CrmInput
            label="Telefone"
            value={formData.phone || ''}
            onChange={(v) => setFormData({ ...formData, phone: v })}
            placeholder="+55 11 90000-0000"
          />
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
            value={formData.stage}
            onChange={(v) => setFormData({ ...formData, stage: v })}
            options={[
              { value: 'novo', label: 'Novo' },
              { value: 'contactado', label: 'Contactado' },
              { value: 'qualificado', label: 'Qualificado' },
              { value: 'perdido', label: 'Perdido' },
            ]}
          />
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Score: {formData.score}</label>
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
    </CrudPageBase>
  );
}
