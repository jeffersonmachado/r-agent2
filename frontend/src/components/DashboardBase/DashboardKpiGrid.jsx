import React from 'react';

/**
 * DashboardKpiGrid
 *
 * Container responsivo para um grupo de KPI cards.
 * Por padrão usa 4 colunas em desktop, adaptando para menos em mobile.
 *
 * @param {React.ReactNode} children
 * @param {number} [cols] - número de colunas base em desktop (2|3|4)
 */
export function DashboardKpiGrid({ children, cols = 4 }) {
  const colsClass = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-2 md:grid-cols-4',
  }[cols] || 'grid-cols-2 sm:grid-cols-2 md:grid-cols-4';

  return (
    <div className={`grid gap-4 mb-6 ${colsClass}`}>
      {children}
    </div>
  );
}
