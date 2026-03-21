import React from 'react';

/**
 * DashboardLoadingState
 *
 * Estado de carregamento isolado para dashboards inteiros ou seções de largo porte.
 * Use DashboardSectionState para estados inline dentro de uma seção.
 *
 * @param {string} [message]
 */
export function DashboardLoadingState({ message = 'Carregando...' }) {
  return (
    <div className="flex items-center justify-center py-16 text-text-secondary text-sm">
      <span className="mr-2 animate-spin">⏳</span>
      {message}
    </div>
  );
}
