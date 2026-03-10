import React, { useEffect, useState, useMemo } from 'react';
import { useCrm } from '../../context/crm/CrmContext';
import { useCrmApi } from '../../hooks/crm/useCrmApi';
import { useToast } from '../../components/Toast';
import { PlatformGrid, usePlatformGridState } from '../../modules/platform-grid';
import {
  CrmCard,
  CrmButton,
  CrmModal,
  CrmForm,
  CrmInput,
  CrmSelect,
} from '../../components/crm/CrmComponents';

export function AccountsPage() {
  const { accounts: allAccounts, setAccounts } = useCrm();
  const { listAccounts, upsertAccount, deleteAccount, loading } = useCrmApi();
  const { showToast, ToastContainer } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filters, setFilters] = useState({ search: '', status: '' });
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
      setAccounts(response.items || []);
    } catch (err) {
      showToast(`Erro ao carregar accounts: ${err.message}`, 'error');
    }
  };

  const accounts = useMemo(() => {
    return allAccounts.filter(acc => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const nameMatch = acc.name?.toLowerCase().includes(searchLower) || false;
        const emailMatch = acc.email?.toLowerCase().includes(searchLower) || false;
        if (!nameMatch && !emailMatch) {
          return false;
        }
      }
      if (filters.status && acc.status !== filters.status) {
        return false;
      }
      return true;
    });
  }, [allAccounts, filters]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ search: '', status: '' });
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
      showToast('Nome é obrigatório', 'error');
      return;
    }

    try {
      const response = await upsertAccount(formData);
      if (response.account) {
        await loadAccounts();
        setIsModalOpen(false);
        showToast('Account salva com sucesso!', 'success');
      }
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAccount(id);
      await loadAccounts();
      showToast('Conta deletada com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao deletar: ${err.message}`, 'error');
    }
  };

  const columns = [
    {
      id: 'name',
      header: 'Nome',
      accessor: (account) => account.name || '—',
      sortValue: (account) => account.name || '',
    },
    {
      id: 'email',
      header: 'Email',
      accessor: (account) => account.email || '—',
      sortValue: (account) => account.email || '',
    },
    {
      id: 'phone',
      header: 'Telefone',
      accessor: (account) => account.phone || '—',
      sortValue: (account) => account.phone || '',
    },
    {
      id: 'industry',
      header: 'Indústria',
      accessor: (account) => account.industry || '—',
      sortValue: (account) => account.industry || '',
    },
    {
      id: 'status',
      header: 'Status',
      render: (account) => (
        <span className={account.status === 'active' ? 'text-green-600' : 'text-gray-500'}>
          {account.status || '—'}
        </span>
      ),
      sortValue: (account) => account.status || '',
      width: '120px',
    },
  ];

  const grid = usePlatformGridState({
    rows: accounts,
    columns,
    persistenceKey: 'crm-accounts-grid-v1',
    initialSort: { columnId: 'name', direction: 'asc' },
    getSearchText: (account) => [
      account.name,
      account.email,
      account.phone,
      account.industry,
      account.status,
    ].filter(Boolean).join(' '),
  });

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🏢 Contas</h1>
        </div>
        <div className="support-controls">
          <CrmButton onClick={() => handleOpenModal()} variant="primary">
            ➕ Nova Conta
          </CrmButton>
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
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
              <option value="prospect">Prospect</option>
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
              Mostrando <strong>{accounts.length}</strong> de <strong>{allAccounts.length}</strong> conta(s)
              {filters.search && ` contendo "${filters.search}"`}
              {filters.status && ` com status "${filters.status === 'active' ? 'Ativo' : filters.status === 'inactive' ? 'Inativo' : 'Prospect'}"`}
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
          rowActions={(account) => ([
            {
              label: 'Editar',
              onClick: () => handleOpenModal(account),
            },
            {
              label: 'Excluir',
              variant: 'danger',
              onClick: () => handleDelete(account.id),
            },
          ])}
          emptyState={{
            title: 'Nenhuma conta encontrada',
            description: 'Ajuste os filtros para localizar contas.',
          }}
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
      <ToastContainer />
    </div>
  );
}
