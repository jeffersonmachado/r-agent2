import React from 'react';

export function PlatformKpiCard({
  label,
  value,
  hint = '',
  valueClassName = 'text-text-primary',
}) {
  return (
    <div className="platform-shell__card p-4 rounded-lg border border-border-default bg-bg-secondary">
      <div className="text-sm text-text-secondary">{label}</div>
      <div className={`text-lg font-semibold ${valueClassName}`.trim()}>{value}</div>
      {hint ? <div className="text-xs text-text-secondary">{hint}</div> : null}
    </div>
  );
}
