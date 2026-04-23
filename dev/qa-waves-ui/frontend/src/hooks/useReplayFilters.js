import { useMemo, useState } from 'react';

const initialFilters = {
  waveId: '',
  itemId: '',
  status: '',
  channel: '',
  query: '',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  sortBy: 'startedAt',
  sortDir: 'desc',
  page: 1,
  pageSize: 10
};

export function useReplayFilters() {
  const [filters, setFilters] = useState(initialFilters);

  function updateFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value, page: name === 'page' ? value : 1 }));
  }

  function resetFilters() {
    setFilters(initialFilters);
  }

  const activeCount = useMemo(
    () =>
      Object.entries(filters)
        .filter(([key]) => !['page', 'pageSize', 'sortBy', 'sortDir'].includes(key))
        .map(([, value]) => value)
        .filter((value) => String(value).trim() !== '').length,
    [filters]
  );

  return {
    filters,
    updateFilter,
    resetFilters,
    activeCount
  };
}
