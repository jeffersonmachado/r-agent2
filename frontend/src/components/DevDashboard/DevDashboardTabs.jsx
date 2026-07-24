import React from 'react';
import { useTheme } from '../../styles/themeContext';
import { TABS } from '../../utils/devDashboardUtils';

/**
 * Componente de tabs do DevDashboard
 */
export function DevDashboardTabs({ activeTab, setActiveTab }) {
  const { theme } = useTheme();

  return (
    <div className="mb-4 md:mb-6 border-b border-border-default">
      <div className="flex gap-1 md:gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-3 md:px-4 py-2 font-medium transition-colors whitespace-nowrap text-sm md:text-base flex-shrink-0"
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

