import React from 'react';

export function PlatformChartCard({ title, children }) {
  return (
    <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
      {title ? <div className="text-sm font-medium text-text-primary mb-3">{title}</div> : null}
      {children}
    </div>
  );
}
