import React, { useEffect, useState, useMemo } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import { PlatformGrid } from '../../modules/platform-grid';
import { CrmCard, CrmButton, CrmModal, CrmForm, CrmInput } from '../../components/crm/CrmComponents';
import { ScheduleModal } from '../../components/ScheduleModal';

export function ContactsPage() {
  const { contacts: allContacts, setContacts } = useCrm();
  const { showToast, ToastContainer } = useToast();
  const [filters, setFilters] = useState({ search: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalContacts, setTotalContacts] = useState(0);
  const contacts = useMemo(() => allContacts, [allContacts]);
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };
  const clearFilters = () => {
    setFilters({ search: '' });
  };
  const { listContacts, upsertContact, deleteContact, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [scheduleContact, setScheduleContact] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    accountId: '',
    role: '',
    department: '',
  });

  useEffect(() => {
    loadContacts(page, pageSize, filters.search);
  }, [page, pageSize, filters.search]);

  useEffect(() => {
    setPage(1);
  }, [filters.search]);

  const loadContacts = async (nextPage = page, nextPageSize = pageSize, query = filters.search) => {
    try {
      const safePage = Math.max(1, Number(nextPage) || 1);
      const safePageSize = Math.max(1, Number(nextPageSize) || 20);
      const offset = (safePage - 1) * safePageSize;
      const response = await listContacts(safePageSize, offset, query);
      const total = Number(response.total || 0);
      const maxPage = Math.max(1, Math.ceil(total / safePageSize));

      if (safePage > maxPage) {
        setPage(maxPage);
        return;
      }

      setContacts(response.items || []);
      setTotalContacts(total);
    } catch (err) {
      showToast(`Erro ao carregar: ${err.message}`, 'error');
    }
  };

  const handleOpenModal = (contact = null) => {
    if (contact) {
      setFormData(contact);
      setEditingContact(contact);
    } else {
      setFormData({ name: '', email: '', phone: '', accountId: '', role: '', department: '' });
      setEditingContact(null);
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      showToast('Nome é obrigatório', 'error');
      return;
    }
    try {
      await upsertContact(formData);
      await loadContacts(page, pageSize, filters.search);
      setIsModalOpen(false);
      showToast('Contato salvo com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteContact(id);
      await loadContacts(page, pageSize, filters.search);
      showToast('Contato deletado com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao deletar: ${err.message}`, 'error');
    }
  };

  const columns = [
    {
      id: 'name',
      header: 'Nome',
      accessor: (contact) => contact.name || '—',
      sortValue: (contact) => contact.name || '',
    },
    {
      id: 'email',
      header: 'Email',
      accessor: (contact) => contact.email || '—',
      sortValue: (contact) => contact.email || '',
    },
    {
      id: 'phone',
      header: 'Telefone',
      accessor: (contact) => contact.phone || '—',
      sortValue: (contact) => contact.phone || '',
    },
    {
      id: 'role',
      header: 'Cargo',
      accessor: (contact) => contact.role || '—',
      sortValue: (contact) => contact.role || '',
    },
    {
      id: 'department',
      header: 'Departamento',
      accessor: (contact) => contact.department || '—',
      sortValue: (contact) => contact.department || '',
    },
  ];
  const totalPages = Math.max(1, Math.ceil(totalContacts / pageSize));
  const currentPageCount = contacts.length;
  const startItem = totalContacts === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = totalContacts === 0 ? 0 : startItem + currentPageCount - 1;

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>👤 Contatos</h1>
        </div>
        <div className="support-controls">
          <CrmButton onClick={() => handleOpenModal()}>➕ Novo Contato</CrmButton>
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
              Buscar
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="Nome, email ou telefone..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Itens por página
              </label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) || 20)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
            <CrmButton
              onClick={clearFilters}
              variant="secondary"
              disabled={!filters.search}
            >
              Limpar Filtros
            </CrmButton>
          </div>
        </div>

        {/* Resumo dos filtros aplicados */}
        <div className="mt-4 pt-4 border-t border-border-default">
          <p className="text-sm text-text-secondary">
            Exibindo <strong>{startItem}</strong>-<strong>{endItem}</strong> de <strong>{totalContacts}</strong> contato(s)
            {filters.search ? ` para "${filters.search}"` : ''}
          </p>
        </div>
      </div>

      <CrmCard>
        <PlatformGrid
          columns={columns}
          rows={contacts}
          loading={loading}
          onRowClick={handleOpenModal}
          pagination={{
            page,
            totalPages,
            pageSize,
            totalItems: totalContacts,
            pageSizeOptions: [20, 50, 100],
            onPageChange: setPage,
            onPageSizeChange: (nextPageSize) => setPageSize(Number(nextPageSize) || 20),
          }}
          rowActions={(contact) => ([
            {
              label: 'Editar',
              onClick: () => handleOpenModal(contact),
            },
            {
              label: 'Excluir',
              variant: 'danger',
              onClick: () => handleDelete(contact.id),
            },
          ])}
          emptyState={{
            title: 'Nenhum contato encontrado',
            description: 'Ajuste a busca para localizar contatos.',
          }}
        />
      </CrmCard>
      <CrmModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Contato" size="md">
        {editingContact?.id ? (
          <div style={{ marginBottom: '12px' }}>
            <CrmButton variant="secondary" onClick={() => setScheduleContact(editingContact)}>
              🗓️ Agendar para este contato
            </CrmButton>
          </div>
        ) : null}
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <CrmInput label="Nome" value={formData.name} onChange={(v) => setFormData({ ...formData, name: v })} required />
          <CrmInput label="Email" type="email" value={formData.email} onChange={(v) => setFormData({ ...formData, email: v })} />
          <CrmInput label="Telefone" value={formData.phone} onChange={(v) => setFormData({ ...formData, phone: v })} />
          <CrmInput label="Cargo" value={formData.role} onChange={(v) => setFormData({ ...formData, role: v })} />
          <CrmInput label="Departamento" value={formData.department} onChange={(v) => setFormData({ ...formData, department: v })} />
        </CrmForm>
      </CrmModal>
      {scheduleContact?.id ? (
        <ScheduleModal
          isOpen={!!scheduleContact}
          onClose={() => setScheduleContact(null)}
          contextType="crm"
          contextId={String(scheduleContact.id)}
          contactId={String(scheduleContact.id)}
          defaultPurpose="reunião"
          defaultChannel="internal"
          title={`Agendar para contato: ${scheduleContact.name || scheduleContact.id}`}
          onCreated={() => showToast('Agendamento criado', 'success')}
        />
      ) : null}
      <ToastContainer />
    </div>
  );
}
