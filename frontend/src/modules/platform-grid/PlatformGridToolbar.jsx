import React from 'react';

export function PlatformGridToolbar({
  totalItems = 0,
  searchTerm = '',
  searchPlaceholder = 'Buscar...',
  onSearchTermChange = null,
  toolbarActions = null,
  selectionCount = 0,
}) {
  const hasSearch = typeof onSearchTermChange === 'function';

  return (
    <div className="pg-toolbar">
      <div className="pg-toolbar__meta">
        Itens: <strong>{totalItems}</strong>
        {selectionCount > 0 ? <> • Selecionados: <strong>{selectionCount}</strong></> : null}
      </div>
      <div className="pg-toolbar__controls">
        {hasSearch ? (
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="pg-toolbar__search"
          />
        ) : null}
        {toolbarActions ? <div className="pg-toolbar__actions">{toolbarActions}</div> : null}
      </div>
    </div>
  );
}
