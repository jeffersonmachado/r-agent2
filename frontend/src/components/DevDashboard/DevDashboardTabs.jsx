import React from 'react';
import { useTheme } from '../../styles/themeContext';
import { TABS } from '../../utils/devDashboardUtils';

/**
 * Componente de tabs do DevDashboard
 */
export function DevDashboardTabs({ activeTab, setActiveTab }) {
  const { theme } = useTheme();

  return (
    <div className="mb-6" style={{ borderBottom: `1px solid ${theme.colors.border.default}` }}>
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 font-medium transition-colors"
            style={{
              color: activeTab === tab.id ? theme.colors.accent.primary : theme.colors.text.secondary,
              borderBottom: activeTab === tab.id ? `2px solid ${theme.colors.accent.primary}` : '2px solid transparent',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) {
                e.target.style.color = theme.colors.text.primary;
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) {
                e.target.style.color = theme.colors.text.secondary;
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

