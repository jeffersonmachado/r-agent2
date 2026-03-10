import React from 'react';

export function PlatformDashboardFilters({
  title = 'Filtros',
  description = '',
  actions = null,
  children,
}) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🔍</span>
            <span>{title}</span>
          </h3>
          {description ? <p className="text-sm text-text-secondary mt-1">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
