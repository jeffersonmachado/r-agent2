import React, { useEffect, useState } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import {
  CrmCard,
  CrmTable,
  CrmButton,
  CrmModal,
  CrmForm,
  CrmInput,
  CrmSelect,
  CrmAlert,
} from '../../components/crm/CrmComponents';

export function AccountsPage() {
  const { accounts, setAccounts, error, setErrorMsg, selectedAccount, setSelectedAccount } = useCrm();
  const { listAccounts, upsertAccount, loading } = useCrmApi();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    status: 'active',
    email: '',
    phone: '',
    website: '',
    industry: '',
    employees: '',
  });
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await listAccounts();
      setAccounts(response.data || []);
    } catch (err) {
      setErrorMsg(`Erro ao carregar accounts: ${err.message}`);
    }
  };

  const handleOpenModal = (account = null) => {
    if (account) {
      setFormData(account);
      setEditingId(account.id);
    } else {
      setFormData({
        name: '',
        status: 'active',
        email: '',
        phone: '',
        website: '',
        industry: '',
        employees: '',
      });
      setEditingId(null);
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setErrorMsg('Nome é obrigatório');
      return;
    }

    try {
      const response = await upsertAccount(formData);
      if (response.account) {
        await loadAccounts();
        setIsModalOpen(false);
        setErrorMsg('Account salva com sucesso!');
      }
    } catch (err) {
      setErrorMsg(`Erro ao salvar: ${err.message}`);
    }
  };

  const columns = [
    { key: 'name', label: 'Nome' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Telefone' },
    { key: 'industry', label: 'Indústria' },
    {
      key: 'status',
      label: 'Status',
      render: (status) => (
        <span className={status === 'active' ? 'text-green-600' : 'text-gray-500'}>
          {status}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Contas (Accounts)</h1>
        <CrmButton onClick={() => handleOpenModal()} variant="primary">
          + Nova Conta
        </CrmButton>
      </div>

      {error && (
        <CrmAlert
          message={error}
          variant="error"
          onDismiss={() => setErrorMsg(null)}
        />
      )}

      <CrmCard>
        <CrmTable
          columns={columns}
          data={accounts}
          onRowClick={handleOpenModal}
          isLoading={loading}
        />
      </CrmCard>

      <CrmModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? 'Editar Conta' : 'Nova Conta'}
        size="lg"
      >
        <CrmForm onSubmit={handleSubmit} isLoading={loading}>
          <CrmInput
            label="Nome"
            value={formData.name}
            onChange={(v) => setFormData({ ...formData, name: v })}
            placeholder="Nome da empresa"
            required
          />
          <CrmInput
            label="Email"
            type="email"
            value={formData.email}
            onChange={(v) => setFormData({ ...formData, email: v })}
            placeholder="contato@empresa.com"
          />
          <CrmInput
            label="Telefone"
            value={formData.phone}
            onChange={(v) => setFormData({ ...formData, phone: v })}
            placeholder="+55 11 9999-9999"
          />
          <CrmInput
            label="Website"
            value={formData.website}
            onChange={(v) => setFormData({ ...formData, website: v })}
            placeholder="https://exemplo.com"
          />
          <CrmInput
            label="Indústria"
            value={formData.industry}
            onChange={(v) => setFormData({ ...formData, industry: v })}
            placeholder="Ex: Tecnologia"
          />
          <CrmSelect
            label="Status"
            value={formData.status}
            onChange={(v) => setFormData({ ...formData, status: v })}
            options={[
              { value: 'active', label: 'Ativo' },
              { value: 'inactive', label: 'Inativo' },
              { value: 'prospect', label: 'Prospect' },
            ]}
          />
        </CrmForm>
      </CrmModal>
    </div>
  );
}
