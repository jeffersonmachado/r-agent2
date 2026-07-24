import React from 'react';

function normalizeMultiValue(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

export function PlatformGridFilters({
  definitions = [],
  values = {},
  onFilterChange = null,
  onClearFilters = null,
}) {
  if (!definitions.length) return null;

  return (
    <div className="pg-filters">
      {definitions.map((definition) => {
        const currentValue = values?.[definition.id] ?? (definition.type === 'multiselect' ? [] : '');

        if (definition.type === 'text') {
          return (
            <div key={definition.id}>
              <label className="pg-filter__label" htmlFor={`pg-filter-${definition.id}`}>{definition.label}</label>
              <input
                id={`pg-filter-${definition.id}`}
                type="text"
                value={currentValue}
                onChange={(event) => onFilterChange?.(definition.id, event.target.value)}
                className="pg-filter__control"
                placeholder={definition.placeholder || 'Filtrar'}
              />
            </div>
          );
        }

        if (definition.type === 'multiselect') {
          const selectedValues = normalizeMultiValue(currentValue);
          return (
            <div key={definition.id}>
              <label className="pg-filter__label" htmlFor={`pg-filter-${definition.id}`}>{definition.label}</label>
              <select
                id={`pg-filter-${definition.id}`}
                multiple
                value={selectedValues}
                onChange={(event) => {
                  if (!onFilterChange) return;
                  const nextValues = Array.from(event.target.selectedOptions).map((option) => option.value);
                  onFilterChange(definition.id, nextValues);
                }}
                className="pg-filter__control"
              >
                {definition.options?.map((option) => (
                  <option key={`${definition.id}-${option.value}`} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          );
        }

        return (
          <div key={definition.id}>
            <label className="pg-filter__label" htmlFor={`pg-filter-${definition.id}`}>{definition.label}</label>
            <select
              id={`pg-filter-${definition.id}`}
              value={currentValue}
              onChange={(event) => onFilterChange?.(definition.id, event.target.value)}
              className="pg-filter__control"
            >
              <option value="">{definition.placeholder || 'Todos'}</option>
              {definition.options?.map((option) => (
                <option key={`${definition.id}-${option.value}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        );
      })}
      {onClearFilters ? (
        <div className="flex items-end">
          <button type="button" onClick={onClearFilters} className="pg-row-action">Limpar filtros</button>
        </div>
      ) : null}
    </div>
  );
}
