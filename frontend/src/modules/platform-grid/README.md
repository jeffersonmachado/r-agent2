# PlatformGrid

Grid reutilizavel para listas operacionais e administrativas do frontend.

## Estrutura

- `components/`: tabela, toolbar, filtros, paginação e estados visuais
- `hooks/`: estado client-side, filtros e seleção
- `utils/`: persistência, helpers de colunas e mapeamento para query
- `examples/`: exemplo mínimo de composição

## API base

```jsx
const grid = usePlatformGridState({
  rows,
  columns,
  filterDefinitions,
  getSearchText: (row) => `${row.name} ${row.email}`,
  persistenceKey: 'agents-grid-v1',
  initialSort: { columnId: 'createdAt', direction: 'desc' },
});

<PlatformGrid
  columns={columns}
  rows={grid.rows}
  searchTerm={grid.searchTerm}
  onSearchTermChange={grid.setSearchTerm}
  filterDefinitions={filterDefinitions}
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
```

## API server-side

```jsx
const grid = usePlatformGridState({
  mode: 'server',
  rows: logs,
  totalRows: total,
  queryState: {
    page,
    pageSize,
    sort,
    filterValues,
  },
  onQueryChange: (nextQuery) => {
    setFilters({
      ...filters,
      action: nextQuery.filterValues.action || '',
      resource: nextQuery.filterValues.resource || '',
      username: nextQuery.filterValues.username || '',
      limit: nextQuery.pageSize,
      offset: (nextQuery.page - 1) * nextQuery.pageSize,
    });
  },
});

<PlatformGrid
  mode="server"
  columns={columns}
  rows={grid.rows}
  filterDefinitions={filterDefinitions}
  filterValues={grid.filterValues}
  onFilterChange={grid.handleFilterChange}
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
```

## Decisoes

- Mantem composicao: toolbar, filtros, tabela, estados e paginação são componentes separados.
- `usePlatformGridState` cobre o caso client-side com persistência opcional em `localStorage`.
- `usePlatformGridState` agora expõe `mode="server"`, `queryState`, `onQueryChange` e `totalRows` para paginação/filtros remotos explícitos.
- `usePlatformGridFilters` e `usePlatformGridSelection` permitem evolução pontual sem inflar o componente principal.
- Para server-side, o componente continua aceitando estado controlado externamente sem mover regra de negócio para o módulo.
- `DataGrid` antigo permanece como camada de compatibilidade para migrações incrementais.
