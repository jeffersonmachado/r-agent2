import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlatformGridFilters } from './usePlatformGridFilters';
import { usePlatformGridSelection } from './usePlatformGridSelection';
import { getGridCellValue, toComparableGridValue } from '../utils/gridColumns';
import { readPersistedGridState, writePersistedGridState } from '../utils/gridPersistence';

function defaultGetSearchText(row) {
  if (!row || typeof row !== 'object') return '';
  return Object.values(row)
    .filter((value) => value == null || ['string', 'number', 'boolean'].includes(typeof value))
    .join(' ');
}

function areQueriesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function usePlatformGridState({
  mode = 'client',
  rows = [],
  columns = [],
  filterDefinitions = [],
  getSearchText = defaultGetSearchText,
  persistenceKey = '',
  initialSearchTerm = '',
  initialFilterValues = {},
  initialSort = null,
  initialPage = 1,
  initialPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  queryState = null,
  onQueryChange = null,
  totalRows = null,
  getRowKey = (row, index) => String(row?.id ?? index),
}) {
  const persistedDefaults = readPersistedGridState(persistenceKey, {
    searchTerm: initialSearchTerm,
    filterValues: initialFilterValues,
    sort: initialSort,
    page: initialPage,
    pageSize: initialPageSize,
  });

  const [internalQuery, setInternalQuery] = useState({
    searchTerm: queryState?.searchTerm ?? persistedDefaults.searchTerm,
    filterValues: queryState?.filterValues ?? persistedDefaults.filterValues,
    sort: queryState?.sort ?? persistedDefaults.sort,
    page: queryState?.page ?? persistedDefaults.page,
    pageSize: queryState?.pageSize ?? persistedDefaults.pageSize,
  });

  useEffect(() => {
    if (!queryState) return;
    setInternalQuery((current) => {
      const next = {
        searchTerm: queryState.searchTerm ?? '',
        filterValues: queryState.filterValues ?? {},
        sort: queryState.sort ?? null,
        page: queryState.page ?? 1,
        pageSize: queryState.pageSize ?? persistedDefaults.pageSize,
      };
      return areQueriesEqual(current, next) ? current : next;
    });
  }, [persistedDefaults.pageSize, queryState]);

  const searchTerm = internalQuery.searchTerm;
  const filterValues = internalQuery.filterValues;
  const sort = internalQuery.sort;
  const page = internalQuery.page;
  const pageSize = internalQuery.pageSize;

  useEffect(() => {
    writePersistedGridState(persistenceKey, {
      searchTerm,
      filterValues,
      sort,
      page,
      pageSize,
    });
  }, [filterValues, page, pageSize, persistenceKey, searchTerm, sort]);

  const emitQueryRef = useRef(onQueryChange);
  emitQueryRef.current = onQueryChange;

  function updateQuery(updater) {
    setInternalQuery((current) => {
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      if (mode === 'server' && emitQueryRef.current && !areQueriesEqual(current, next)) {
        emitQueryRef.current(next);
      }
      return next;
    });
  }

  const filteredRows = usePlatformGridFilters({
    rows,
    filterDefinitions,
    filterValues,
    searchTerm,
    getSearchText,
  });

  const sortedRows = useMemo(() => {
    if (mode === 'server') return Array.isArray(rows) ? rows : [];
    if (!sort?.columnId) return filteredRows;
    const targetColumn = columns.find((column) => column.id === sort.columnId);
    if (!targetColumn || targetColumn.sortable === false) return filteredRows;

    const direction = sort.direction === 'desc' ? -1 : 1;
    const indexedRows = filteredRows.map((row, index) => ({ row, index }));
    indexedRows.sort((left, right) => {
      const leftValue = toComparableGridValue(getGridCellValue(targetColumn, left.row));
      const rightValue = toComparableGridValue(getGridCellValue(targetColumn, right.row));
      if (leftValue < rightValue) return -1 * direction;
      if (leftValue > rightValue) return 1 * direction;
      return left.index - right.index;
    });
    return indexedRows.map((item) => item.row);
  }, [columns, filteredRows, mode, rows, sort]);

  const totalItems = mode === 'server'
    ? Math.max(0, Number(totalRows ?? rows.length ?? 0))
    : sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (mode === 'server') return;
    updateQuery((current) => ({ ...current, page: 1 }));
  }, [mode, filterValues, searchTerm, pageSize]);

  useEffect(() => {
    if (page === safePage) return;
    updateQuery((current) => ({ ...current, page: safePage }));
  }, [page, safePage]);

  const pageRows = useMemo(() => {
    if (mode === 'server') return Array.isArray(rows) ? rows : [];
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [mode, pageSize, rows, safePage, sortedRows]);

  const selection = usePlatformGridSelection({
    rows: pageRows,
    getRowKey,
  });

  function handleSortChange(columnId) {
    updateQuery((current) => {
      const currentSort = current.sort;
      if (!currentSort || currentSort.columnId !== columnId) {
        return { ...current, sort: { columnId, direction: 'asc' }, page: 1 };
      }
      if (currentSort.direction === 'asc') {
        return { ...current, sort: { columnId, direction: 'desc' }, page: 1 };
      }
      return { ...current, sort: null, page: 1 };
    });
  }

  function handleFilterChange(filterId, value) {
    updateQuery((current) => ({
      ...current,
      page: 1,
      filterValues: {
        ...current.filterValues,
        [filterId]: value,
      },
    }));
  }

  function clearFilters() {
    updateQuery((current) => ({
      ...current,
      page: 1,
      searchTerm: '',
      filterValues: initialFilterValues,
    }));
  }

  function setPage(nextPage) {
    updateQuery((current) => ({
      ...current,
      page: Math.max(1, Number(nextPage) || 1),
    }));
  }

  function setPageSize(nextPageSize) {
    updateQuery((current) => ({
      ...current,
      page: 1,
      pageSize: Number(nextPageSize) || initialPageSize,
    }));
  }

  function setSearchTerm(nextSearchTerm) {
    updateQuery((current) => ({
      ...current,
      page: 1,
      searchTerm: nextSearchTerm,
    }));
  }

  return {
    mode,
    rows: pageRows,
    filteredRows: mode === 'server' ? rows : filteredRows,
    totalItems,
    totalPages,
    page: safePage,
    pageSize,
    pageSizeOptions,
    searchTerm,
    filterValues,
    sort,
    queryState: {
      searchTerm,
      filterValues,
      sort,
      page: safePage,
      pageSize,
    },
    selectedRowKeys: selection.selectedRowKeys,
    setPage,
    setPageSize,
    setSearchTerm,
    handleSortChange,
    handleFilterChange,
    clearFilters,
    toggleRowSelection: selection.toggleRowSelection,
    setAllRowsSelected: selection.setAllRowsSelected,
  };
}
