import { useEffect, useState } from 'react';
import { readDashboardPersistence, writeDashboardPersistence } from '../utils/dashboardPersistence';

export function useDashboardFilters(initialState, persistenceKey = '') {
  const [filters, setFilters] = useState(() => {
    return readDashboardPersistence(persistenceKey, initialState);
  });

  useEffect(() => {
    writeDashboardPersistence(persistenceKey, filters);
  }, [filters, persistenceKey]);

  return [filters, setFilters];
}
