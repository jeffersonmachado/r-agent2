import React from 'react';

export function SharedMultiSelectFilter({
  label,
  value = [],
  options = [],
  onChange,
  size = 4,
}) {
  return (
    <div>
      <label className="block mb-2 text-sm font-medium text-text-primary">{label}</label>
      <select
        multiple
        size={size}
        value={value}
        onChange={(event) => {
          const nextValue = Array.from(event.target.selectedOptions).map((option) => option.value);
          onChange?.(nextValue);
        }}
        className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
