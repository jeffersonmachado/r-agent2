import React from 'react';

export function CrudPageBase({
  title,
  actions = null,
  filters = null,
  className = '',
  style,
  hideHeader = false,
  children,
}) {
  const shouldRenderHeader = hideHeader !== true && Boolean(title || actions);

  return (
    <div className={`support-page ${className}`.trim()} style={style}>
      {shouldRenderHeader ? (
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>{title}</h1>
          </div>
          {actions ? (
            <div className="support-controls">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}

      {filters ? filters : null}

      {children}
    </div>
  );
}
