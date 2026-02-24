import React, { useEffect, useState, useMemo } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput } from '../../components/crm/CrmComponents';

export function ContactsPage() {
  const { contacts: allContacts, setContacts } = useCrm();
  const { showToast, ToastContainer } = useToast();
  const [filters, setFilters] = useState({ search: '' });
  const contacts = useMemo(() => {
    return allContacts.filter(c => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const nameMatch = c.name?.toLowerCase().includes(searchLower) || false;
        const emailMatch = c.email?.toLowerCase().includes(searchLower) || false;
        if (!nameMatch && !emailMatch) {
          return false;
        }
      }
      return true;
    });
  }, [allContacts, filters]);
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };
  const clearFilters = () => {
    setFilters({ search: '' });
  };
  const { listContacts, upsertContact, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    accountId: '',
    role: '',
    department: '',
  });

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const response = await listContacts();
      setContacts(response.items || []);
    } catch (err) {
      showToast(`Erro ao carregar: ${err.message}`, 'error');
    }
  };

  const handleOpenModal = (contact = null) => {
    if (contact) {
      setFormData(contact);
    } else {
      setFormData({ name: '', email: '', phone: '', accountId: '', role: '', department: '' });
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
      await loadContacts();
      setIsModalOpen(false);
      showToast('Contato salvo com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteContact(id);
      await loadContacts();
      showToast('Contato deletado com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao deletar: ${err.message}`, 'error');
    }
  };

  const columns = [
    { key: 'name', label: 'Nome' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Telefone' },
    { key: 'role', label: 'Cargo' },
    { key: 'department', label: 'Departamento' },
  ];

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
              placeholder="Nome ou email..."
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
              Mostrando <strong>{contacts.length}</strong> de <strong>{allContacts.length}</strong> contato(s)
              {filters.search && ` contendo "${filters.search}"`}
            </p>
          </div>
        )}
      </div>

      <CrmCard>
        <CrmTable columns={columns} data={contacts} onRowClick={handleOpenModal} onDelete={handleDelete} isLoading={loading} />
      </CrmCard>
      <CrmModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Contato" size="md">
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <CrmInput label="Nome" value={formData.name} onChange={(v) => setFormData({ ...formData, name: v })} required />
          <CrmInput label="Email" type="email" value={formData.email} onChange={(v) => setFormData({ ...formData, email: v })} />
          <CrmInput label="Telefone" value={formData.phone} onChange={(v) => setFormData({ ...formData, phone: v })} />
          <CrmInput label="Cargo" value={formData.role} onChange={(v) => setFormData({ ...formData, role: v })} />
          <CrmInput label="Departamento" value={formData.department} onChange={(v) => setFormData({ ...formData, department: v })} />
        </CrmForm>
      </CrmModal>
      <ToastContainer />
    </div>
  );
}
