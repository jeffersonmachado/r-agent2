import React from 'react';

export function SharedPeriodFilter({
  label = 'Período',
  value = '',
  options = [],
  onChange,
}) {
  return (
    <div>
      <label className="block mb-2 text-sm font-medium text-text-primary">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange?.(option.value)}
              className={[
                'px-3 py-2 rounded-lg border text-sm transition-colors',
                active
                  ? 'bg-accent-primary text-white border-accent-primary'
                  : 'bg-bg-secondary text-text-primary border-border-default hover:border-border-hover',
              ].join(' ')}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
