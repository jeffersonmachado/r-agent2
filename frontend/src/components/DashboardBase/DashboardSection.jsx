import React from 'react';

export function DashboardSection({ title, icon = null, children, action = null }) {
  return (
    <section className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
      <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
        {icon && <span>{icon}</span>}
        <span>{title}</span>
      </h3>
      {action && <div className="mb-4">{action}</div>}
      {children}
    </section>
  );
}
