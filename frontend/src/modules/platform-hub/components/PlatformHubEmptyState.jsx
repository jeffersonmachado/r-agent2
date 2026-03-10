import React from 'react';

export function PlatformHubEmptyState({
  title = 'Nenhum item encontrado',
  description = '',
}) {
  return (
    <div className="text-center py-12 bg-bg-secondary rounded-xl border border-border-default">
      <p className="text-text-primary font-medium">{title}</p>
      {description ? <p className="mt-2 text-sm text-text-secondary">{description}</p> : null}
    </div>
  );
}
