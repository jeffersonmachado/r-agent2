import React from 'react';
import { useTheme } from '../../styles/themeContext';

export function DevDashboardKpiCard({ label, value, valueColor = null }) {
  const { theme } = useTheme();

  return (
    <div
      className="p-4 rounded-lg"
      style={{
        backgroundColor: theme.colors.bg.secondary,
        border: `1px solid ${theme.colors.border.default}`,
      }}
    >
      <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>{label}</div>
      <div className="text-2xl md:text-3xl font-bold" style={{ color: valueColor || theme.colors.text.primary }}>
        {value}
      </div>
    </div>
  );
}
