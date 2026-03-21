import React from 'react';

/**
 * DashboardEmptyState
 *
 * Estado vazio de alto nível para um dashboard ou seção principal.
 * Use quando não há dados para exibir e se deseja um visual mais elaborado
 * do que o inline de DashboardSectionState.
 *
 * @param {string} [icon]
 * @param {string} [title]
 * @param {string} [description]
 * @param {React.ReactNode} [action]
 */
export function DashboardEmptyState({ icon = '📭', title = 'Sem dados', description = 'Nenhum registro disponível para os filtros aplicados.', action = null }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-base font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-secondary max-w-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
