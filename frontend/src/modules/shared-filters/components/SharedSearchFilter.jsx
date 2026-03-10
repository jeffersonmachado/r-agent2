import React from 'react';

export function SharedSearchFilter({
  label = 'Buscar',
  value = '',
  placeholder = 'Buscar...',
  onChange,
}) {
  return (
    <div>
      <label className="block mb-2 text-sm font-medium text-text-primary">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
      />
    </div>
  );
}
