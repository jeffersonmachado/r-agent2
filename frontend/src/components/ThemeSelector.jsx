import React from 'react';
import { useTheme } from '../styles/themeContext';

/**
 * Seletor de tema - alterna entre dark e light mode
 */
export function ThemeSelector() {
  const { theme, themeName, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: theme.colors.bg.tertiary,
        border: `1px solid ${theme.colors.border.default}`,
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '13px',
        color: theme.colors.text.primary,
        transition: 'all 150ms ease',
        fontFamily: 'inherit',
        fontWeight: 500,
        minWidth: '80px',
        justifyContent: 'center',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.colors.bg.hover;
        e.currentTarget.style.borderColor = theme.colors.border.hover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = theme.colors.bg.tertiary;
        e.currentTarget.style.borderColor = theme.colors.border.default;
      }}
      title={`Alternar para tema ${themeName === 'dark' ? 'claro' : 'escuro'}`}
    >
      <span style={{ fontSize: '16px', lineHeight: 1 }}>
        {themeName === 'dark' ? '🌙' : '☀️'}
      </span>
      <span style={{ fontWeight: 500 }}>
        {themeName === 'dark' ? 'Dark' : 'Light'}
      </span>
    </button>
  );
}

