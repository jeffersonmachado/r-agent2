import React from 'react';
import { PlatformGrid } from '../components/PlatformGrid';
import { usePlatformGridState } from '../hooks/usePlatformGridState';

const demoRows = [
  { id: '1', name: 'Ana', status: 'active', email: 'ana@example.com' },
  { id: '2', name: 'Bruno', status: 'inactive', email: 'bruno@example.com' },
];

const demoColumns = [
  { id: 'name', header: 'Nome' },
  { id: 'email', header: 'Email' },
  { id: 'status', header: 'Status' },
];

export function BasicGridExample() {
  const grid = usePlatformGridState({
    rows: demoRows,
    columns: demoColumns,
    filterDefinitions: [
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { label: 'Ativo', value: 'active' },
          { label: 'Inativo', value: 'inactive' },
        ],
      },
    ],
    getSearchText: (row) => `${row.name} ${row.email}`,
  });

  return (
    <PlatformGrid
      columns={demoColumns}
      rows={grid.rows}
      searchTerm={grid.searchTerm}
      onSearchTermChange={grid.setSearchTerm}
      filterDefinitions={[
        {
          id: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { label: 'Ativo', value: 'active' },
            { label: 'Inativo', value: 'inactive' },
          ],
        },
      ]}
      filterValues={grid.filterValues}
      onFilterChange={grid.handleFilterChange}
      onClearFilters={grid.clearFilters}
      sort={grid.sort}
      onSortChange={grid.handleSortChange}
      pagination={{
        page: grid.page,
        totalPages: grid.totalPages,
        pageSize: grid.pageSize,
        totalItems: grid.totalItems,
        pageSizeOptions: grid.pageSizeOptions,
        onPageChange: grid.setPage,
        onPageSizeChange: grid.setPageSize,
      }}
    />
  );
}
