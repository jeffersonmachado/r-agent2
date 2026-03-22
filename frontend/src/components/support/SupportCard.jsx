import React from 'react';

export function SupportCard({
  id,
  title,
  subtitle = null,
  badge = null,
  actions = null,
  children,
  compact = false,
}) {
  return (
    <section
      id={id}
      className="bg-bg-elevated rounded-xl border border-border-default shadow-lg"
      style={{ padding: compact ? '14px' : '16px' }}
    >
      {(title || badge || actions || subtitle) ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
          <div style={{ minWidth: 0 }}>
            {title ? <div style={{ fontWeight: 700 }}>{title}</div> : null}
            {subtitle ? (
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {badge}
            {actions}
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}
