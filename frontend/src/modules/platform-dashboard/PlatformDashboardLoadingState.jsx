import React from 'react';

export function PlatformDashboardLoadingState({ label = 'Carregando métricas...' }) {
  return (
    <div className="text-center py-12">
      <p className="text-text-secondary">{label}</p>
    </div>
  );
}
