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
      className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]"
      title={`Alternar para tema ${themeName === 'dark' ? 'claro' : 'escuro'}`}
    >
      {themeName === 'dark' ? '🌙' : '☀️'}
    </button>
  );
}
