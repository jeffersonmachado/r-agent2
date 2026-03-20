import React from 'react';

const VARIANTS = {
  default: {
    wrapper: 'bg-bg-elevated border-border-default',
    label: 'text-text-tertiary',
    value: 'text-text-primary',
    subtitle: 'text-text-secondary',
  },
  warning: {
    wrapper: 'bg-amber-50 border-amber-300',
    label: 'text-amber-700',
    value: 'text-amber-700',
    subtitle: 'text-amber-600',
  },
  danger: {
    wrapper: 'bg-red-50 border-red-300',
    label: 'text-red-700',
    value: 'text-red-600',
    subtitle: 'text-text-secondary',
  },
  success: {
    wrapper: 'bg-green-50 border-green-300',
    label: 'text-green-700',
    value: 'text-green-700',
    subtitle: 'text-text-secondary',
  },
};

export function DashboardKpiCard({ label, value, subtitle = null, variant = 'default', onClick = null, icon = null }) {
  const styles = VARIANTS[variant] || VARIANTS.default;
  const interactive = onClick != null;

  return (
    <div
      className={`rounded-xl border p-4 shadow-lg ${styles.wrapper} ${interactive ? 'cursor-pointer hover:shadow-xl transition-all' : ''}`}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div className={`text-xs flex items-center gap-1.5 mb-1 ${styles.label}`}>
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div className={`text-2xl font-semibold ${styles.value}`}>{value}</div>
      {subtitle && <div className={`text-xs mt-1 ${styles.subtitle}`}>{subtitle}</div>}
    </div>
  );
}
