import React, { useEffect, useState } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { CrmCard, CrmTable, CrmButton, CrmModal, CrmForm, CrmInput, CrmAlert } from '../../components/crm/CrmComponents';

export function ContactsPage() {
  const { contacts, setContacts, error, setErrorMsg } = useCrm();
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
      setContacts(response.data || []);
    } catch (err) {
      setErrorMsg(`Erro ao carregar: ${err.message}`);
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
      setErrorMsg('Nome é obrigatório');
      return;
    }
    try {
      await upsertContact(formData);
      await loadContacts();
      setIsModalOpen(false);
      setErrorMsg('Contato salvo com sucesso!');
    } catch (err) {
      setErrorMsg(`Erro ao salvar: ${err.message}`);
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
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Contatos</h1>
        <CrmButton onClick={() => handleOpenModal()}>+ Novo Contato</CrmButton>
      </div>
      {error && <CrmAlert message={error} variant="error" onDismiss={() => setErrorMsg(null)} />}
      <CrmCard>
        <CrmTable columns={columns} data={contacts} onRowClick={handleOpenModal} isLoading={loading} />
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
    </div>
  );
}
