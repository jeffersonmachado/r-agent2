import React from 'react';

export function PlatformGridEmptyState({
  title = 'Nenhum item encontrado',
  description = 'Ajuste a busca ou os filtros para tentar novamente.',
}) {
  return (
    <div className="pg-empty">
      <span className="pg-empty__title">{title}</span>
      <span className="pg-empty__description">{description}</span>
    </div>
  );
}
