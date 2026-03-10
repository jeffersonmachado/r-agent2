import React from 'react';

export function PlatformHubSection({
  title,
  icon = '',
  description = '',
  actions = null,
  children,
  className = '',
}) {
  return (
    <section className={`platform-shell__section bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg ${className}`.trim()}>
      {(title || description || actions) ? (
        <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-start md:justify-between">
          <div>
            {title ? (
              <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                {icon ? <span>{icon}</span> : null}
                <span>{title}</span>
              </h3>
            ) : null}
            {description ? (
              <p className="mt-2 text-sm text-text-secondary">{description}</p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
