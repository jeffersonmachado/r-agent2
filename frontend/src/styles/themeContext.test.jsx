import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from './themeContext';

function ThemeProbe() {
  const { themeName, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-name">{themeName}</span>
      <button type="button" onClick={toggleTheme}>Alternar</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', '#ffffff');
  });

  it('sincroniza classe global e metadados ao alternar tema', () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    const themeName = screen.getByTestId('theme-name');
    const toggle = screen.getByRole('button', { name: 'Alternar' });

    expect(themeName.textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0a0b14');
    expect(localStorage.getItem('chatbot-theme')).toBe('dark');

    fireEvent.click(toggle);

    expect(themeName.textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f8fafc');
    expect(localStorage.getItem('chatbot-theme')).toBe('light');
  });
});
