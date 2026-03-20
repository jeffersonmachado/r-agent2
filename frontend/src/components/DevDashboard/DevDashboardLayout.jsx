import React from 'react';
import { useTheme } from '../../styles/themeContext';

export function DevDashboardLayout({ header, tabs, children }) {
  const { theme } = useTheme();

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden" style={{ backgroundColor: theme.colors.bg.primary }}>
      <div className="flex-1 overflow-y-auto dev-dashboard-scroll">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="w-full">
            {header}
            {tabs}
            <div
              className="rounded-lg p-4 md:p-6"
              style={{
                backgroundColor: theme.colors.bg.elevated,
                border: `1px solid ${theme.colors.border.default}`,
                boxShadow: theme.name === 'dark' ? '0 4px 6px rgba(0, 0, 0, 0.3)' : '0 4px 6px rgba(0, 0, 0, 0.1)',
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
