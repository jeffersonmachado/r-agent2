import React from 'react';
import { PlatformGridToolbar } from './PlatformGridToolbar';
import { PlatformGridFilters } from './PlatformGridFilters';
import { PlatformGridPagination } from './PlatformGridPagination';
import { PlatformGridEmptyState } from './PlatformGridEmptyState';
import { PlatformGridLoadingState } from './PlatformGridLoadingState';
import './platformGrid.css';

function defaultGetRowKey(row, index) {
  return row && (row.id != null || row.id === 0) ? String(row.id) : String(index);
}

function getText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function PlatformGrid({
  mode = 'client',
  columns = [],
  rows = [],
  loading = false,
  dense = true,
  getRowKey = defaultGetRowKey,
  searchTerm = '',
  searchPlaceholder = 'Buscar...',
  onSearchTermChange = null,
  filterDefinitions = [],
  filterValues = {},
  onFilterChange = null,
  onClearFilters = null,
  sort = null,
  onSortChange = null,
  pagination = null,
  toolbarActions = null,
  emptyState = null,
  onRowClick = null,
  rowActions = null,
  rowClassName = null,
  selectable = false,
  selectedRowKeys = [],
  onToggleRowSelection = null,
  onToggleAllRowsSelection = null,
}) {
  const hasActions = typeof rowActions === 'function' || (Array.isArray(rowActions) && rowActions.length > 0);
  const rowsCount = Array.isArray(rows) ? rows.length : 0;
  const totalItems = pagination?.totalItems ?? rowsCount;
  const allRowsSelected = rowsCount > 0 && selectedRowKeys.length === rowsCount;

  return (
    <div className={`pg ${dense ? 'pg--dense' : ''}`} data-grid-mode={mode}>
      <PlatformGridToolbar
        totalItems={totalItems}
        searchTerm={searchTerm}
        searchPlaceholder={searchPlaceholder}
        onSearchTermChange={onSearchTermChange}
        toolbarActions={toolbarActions}
        selectionCount={selectedRowKeys.length}
      />

      <PlatformGridFilters
        definitions={filterDefinitions}
        values={filterValues}
        onFilterChange={onFilterChange}
        onClearFilters={onClearFilters}
      />

      <div className="pg-grid">
        <table className="pg-table">
          <thead>
            <tr>
              {selectable ? (
                <th className="pg-th" style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    className="pg-select"
                    checked={allRowsSelected}
                    onChange={(event) => onToggleAllRowsSelection?.(event.target.checked)}
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const isSortable = column.sortable === false ? false : Boolean(onSortChange);
                const isSorted = sort?.columnId === column.id;
                const sortDirection = isSorted ? sort.direction : null;

                return (
                  <th
                    key={column.id}
                    className={isSortable ? 'pg-th pg-th--sortable' : 'pg-th'}
                    style={column.width ? { width: column.width } : undefined}
                    onClick={() => (isSortable ? onSortChange(column.id) : null)}
                  >
                    <span className="pg-th__inner">
                      <span>{column.header || column.id}</span>
                      {sortDirection ? <span className="pg-th__sort">{sortDirection === 'asc' ? '▲' : '▼'}</span> : null}
                    </span>
                  </th>
                );
              })}
              {hasActions ? <th className="pg-th pg-th--actions">Acoes</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="pg-td" colSpan={columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0)}>
                  <PlatformGridLoadingState
                    title={emptyState?.loadingTitle}
                    description={emptyState?.loadingDescription}
                  />
                </td>
              </tr>
            ) : rowsCount > 0 ? (
              rows.map((row, index) => {
                const key = getRowKey(row, index);
                const actions = typeof rowActions === 'function' ? rowActions(row) : rowActions;
                const isSelected = selectedRowKeys.includes(key);

                return (
                  <tr
                    key={key}
                    className={[
                      onRowClick ? 'pg-tr pg-tr--clickable' : 'pg-tr',
                      typeof rowClassName === 'function' ? rowClassName(row) : rowClassName,
                    ].filter(Boolean).join(' ')}
                    onClick={() => onRowClick?.(row)}
                  >
                    {selectable ? (
                      <td className="pg-td">
                        <input
                          type="checkbox"
                          className="pg-select"
                          checked={isSelected}
                          onChange={() => onToggleRowSelection?.(row)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td key={`${key}-${column.id}`} className="pg-td">
                        {column.render ? column.render(row) : getText(column.accessor ? column.accessor(row) : row?.[column.id]) || '—'}
                      </td>
                    ))}
                    {hasActions ? (
                      <td className="pg-td pg-td--actions">
                        <div className="pg-row-actions">
                          {(actions || []).map((action) => (
                            <button
                              key={`${key}-${action.label}`}
                              type="button"
                              className={`pg-row-action ${action.variant ? `pg-row-action--${action.variant}` : ''}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                action.onClick?.(row);
                              }}
                              disabled={action.disabled}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="pg-td" colSpan={columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0)}>
                  <PlatformGridEmptyState
                    title={emptyState?.title}
                    description={emptyState?.description}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <PlatformGridPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          pageSizeOptions={pagination.pageSizeOptions}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
        />
      ) : null}
    </div>
  );
}
