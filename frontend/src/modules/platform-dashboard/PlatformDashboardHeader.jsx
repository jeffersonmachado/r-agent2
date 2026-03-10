import React from 'react';

export function PlatformDashboardHeader({
  title,
  description = '',
  actions = null,
}) {
  return (
    <div className="platform-shell__header">
      <div className="platform-shell__header-main">
        <h1 className="platform-shell__title">{title}</h1>
      </div>
      {description ? (
        <p className="platform-shell__description" style={{ marginBottom: actions ? '20px' : '0' }}>
          {description}
        </p>
      ) : null}
      {actions ? <div className="platform-shell__controls support-controls">{actions}</div> : null}
    </div>
  );
}
