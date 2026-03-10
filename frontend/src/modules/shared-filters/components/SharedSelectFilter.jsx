import React from 'react';

export function SharedSelectFilter({
  label,
  value = '',
  options = [],
  placeholder = 'Selecione...',
  onChange,
}) {
  return (
    <div>
      <label className="block mb-2 text-sm font-medium text-text-primary">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
