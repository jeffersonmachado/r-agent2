import { useMemo, useState } from 'react';

export function useCrudFilters(initialFilters) {
  const [filters, setFilters] = useState(initialFilters);

  function setFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function resetFilters() {
    setFilters(initialFilters);
  }

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return Boolean(value);
    });
  }, [filters]);

  return {
    filters,
    setFilter,
    setFilters,
    resetFilters,
    hasActiveFilters,
  };
}
