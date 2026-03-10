import React from 'react';

export function PlatformHubCard({
  title,
  description = '',
  icon = '',
  badge = '',
  accentClassName = 'bg-cyan-500',
  onClick,
  as: Component = 'button',
  className = '',
  children = null,
  ...props
}) {
  const interactiveProps = Component === 'button'
    ? { type: 'button' }
    : {};

  return (
    <Component
      className={`block text-left ${className}`.trim()}
      onClick={onClick}
      {...interactiveProps}
      {...props}
    >
      <div className="platform-shell__card h-full bg-bg-elevated rounded-xl border border-border-default hover:shadow-lg transition-shadow p-6 cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div className={`${accentClassName} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
            {icon}
          </div>
          {badge ? (
            <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">
              {badge}
            </span>
          ) : null}
        </div>
        <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
        {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
        {children}
      </div>
    </Component>
  );
}
