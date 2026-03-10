import React from 'react';

export function PlatformDashboardSection({
  title,
  icon = '',
  actions = null,
  children,
  className = '',
}) {
  return (
    <section className={`platform-shell__section bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg ${className}`.trim()}>
      {(title || actions) ? (
        <div className="flex items-center justify-between mb-4">
          {title ? (
            <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              {icon ? <span>{icon}</span> : null}
              <span>{title}</span>
            </h3>
          ) : <div />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
