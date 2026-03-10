import { useEffect, useMemo, useState } from 'react';
import { readDashboardPersistence, writeDashboardPersistence } from '../utils/dashboardPersistence';

export function useDashboardQueryState({
  initialFilters = {},
  initialView = 'default',
  persistenceKey = '',
}) {
  const persisted = readDashboardPersistence(persistenceKey, {
    filters: initialFilters,
    view: initialView,
  });

  const [filters, setFilters] = useState(persisted.filters);
  const [view, setView] = useState(persisted.view);

  useEffect(() => {
    writeDashboardPersistence(persistenceKey, { filters, view });
  }, [filters, persistenceKey, view]);

  const query = useMemo(() => ({ filters, view }), [filters, view]);

  return {
    filters,
    setFilters,
    view,
    setView,
    query,
  };
}
