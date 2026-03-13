import { useMemo } from 'react';

function isFilterActive(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value != null && value !== '';
}

export function usePlatformGridFilters({
  rows = [],
  filterDefinitions = [],
  filterValues = {},
  searchTerm = '',
  getSearchText = (row) => JSON.stringify(row || {}),
}) {
  return useMemo(() => {
    const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
    let nextRows = Array.isArray(rows) ? rows : [];

    if (normalizedSearch) {
      nextRows = nextRows.filter((row) => String(getSearchText(row) || '').toLowerCase().includes(normalizedSearch));
    }

    for (const definition of filterDefinitions) {
      const value = filterValues?.[definition.id];
      if (!isFilterActive(value)) continue;

      nextRows = nextRows.filter((row) => {
        const rowValue = definition.getValue ? definition.getValue(row) : row?.[definition.id];
        if (definition.type === 'text') {
          return String(rowValue ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
        }
        if (Array.isArray(value)) {
          return value.includes(String(rowValue ?? ''));
        }
        return String(rowValue ?? '') === String(value);
      });
    }

    return nextRows;
  }, [filterDefinitions, filterValues, getSearchText, rows, searchTerm]);
}
