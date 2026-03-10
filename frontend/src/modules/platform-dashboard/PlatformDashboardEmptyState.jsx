import React from 'react';

export function PlatformDashboardEmptyState({
  title = 'Sem dados',
  description = 'Nenhum dado disponível para os filtros atuais.',
}) {
  return (
    <div className="text-center py-12">
      <p className="text-text-primary font-medium">{title}</p>
      <p className="text-text-secondary text-sm mt-2">{description}</p>
    </div>
  );
}
