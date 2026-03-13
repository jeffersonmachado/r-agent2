import React from 'react';

export function PlatformGridLoadingState({
  title = 'Carregando dados...',
  description = 'A listagem sera exibida assim que a consulta terminar.',
}) {
  return (
    <div className="pg-loading">
      <span className="pg-loading__title">{title}</span>
      <span className="pg-loading__description">{description}</span>
    </div>
  );
}
