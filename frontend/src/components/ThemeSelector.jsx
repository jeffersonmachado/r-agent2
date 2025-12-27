import React from 'react';
import { useTheme } from '../styles/themeContext';

/**
 * Seletor de tema - alterna entre dark e light mode
 * Usa apenas CSS :hover (sem JavaScript)
 */
export function ThemeSelector() {
  const { theme, themeName, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn-base"
      title={`Alternar para tema ${themeName === 'dark' ? 'claro' : 'escuro'}`}
    >
      <span className={`icon ${themeName === 'dark' ? 'icon-moon' : 'icon-sun'}`}></span>
    </button>
  );
}
