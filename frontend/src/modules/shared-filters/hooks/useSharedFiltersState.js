import { useEffect, useState } from 'react';

function readPersistedFilters(persistenceKey, fallbackState) {
  if (!persistenceKey || typeof window === 'undefined') return fallbackState;
  try {
    const raw = window.localStorage.getItem(persistenceKey);
    if (!raw) return fallbackState;
    return { ...fallbackState, ...JSON.parse(raw) };
  } catch {
    return fallbackState;
  }
}

export function useSharedFiltersState(initialState, persistenceKey = '') {
  const [filters, setFilters] = useState(() => readPersistedFilters(persistenceKey, initialState));

  useEffect(() => {
    if (!persistenceKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(persistenceKey, JSON.stringify(filters));
    } catch {
      // Persistencia opcional.
    }
  }, [filters, persistenceKey]);

  function updateFilter(filterId, value) {
    setFilters((current) => ({ ...current, [filterId]: value }));
  }

  function resetFilters() {
    setFilters(initialState);
  }

  return {
    filters,
    setFilters,
    updateFilter,
    resetFilters,
  };
}
