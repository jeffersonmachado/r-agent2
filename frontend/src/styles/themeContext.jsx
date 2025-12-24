import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

const themes = {
  dark: {
    name: 'dark',
    colors: {
      bg: {
        primary: '#0a0a0a',
        secondary: '#111111',
        tertiary: '#1a1a1a',
        elevated: '#1f1f1f',
        hover: '#252525',
      },
      border: {
        default: '#2a2a2a',
        hover: '#3a3a3a',
        focus: '#4a4a4a',
      },
      text: {
        primary: '#ffffff',
        secondary: '#a0a0a0',
        tertiary: '#707070',
        disabled: '#404040',
      },
      accent: {
        primary: '#5e6ad2',
        hover: '#6b77e0',
        pressed: '#525cc4',
        light: 'rgba(94, 106, 210, 0.1)',
      },
      status: {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6',
      },
      node: {
        start: '#8b5cf6',
        message: '#3b82f6',
        user_input: '#10b981',
        router: '#f59e0b',
        set_variable: '#6366f1',
        handoff: '#ec4899',
        ai: '#14b8a6',
        end: '#6b7280',
      },
    },
  },
  light: {
    name: 'light',
    colors: {
      bg: {
        primary: '#F6F7F9',      // Fundo neutro conforme diretrizes
        secondary: '#FFFFFF',     // Cards e painéis
        tertiary: '#F0F2F5',      // Hover e estados
        elevated: '#FFFFFF',      // Elementos elevados
        hover: '#E8EAED',         // Hover states
      },
      border: {
        default: '#E1E4E8',       // Bordas padrão
        hover: '#D1D5DB',         // Bordas hover
        focus: '#5e6ad2',         // Bordas focus
      },
      text: {
        primary: '#1F2937',       // Texto principal - alto contraste
        secondary: '#4B5563',     // Texto secundário
        tertiary: '#6B7280',      // Texto terciário
        disabled: '#9CA3AF',      // Texto desabilitado
      },
      accent: {
        primary: '#5e6ad2',       // Azul suave
        hover: '#6b77e0',
        pressed: '#525cc4',
        light: 'rgba(94, 106, 210, 0.1)',
      },
      status: {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6',
      },
      // Cores suaves dos nós conforme diretrizes
      node: {
        start: '#4A90E2',         // Azul suave
        message: '#52C9A2',       // Verde suave
        user_input: '#52C9A2',    // Verde suave
        router: '#F5A623',        // Amarelo suave
        set_variable: '#7B68EE',  // Roxo suave
        handoff: '#9B59B6',       // Roxo suave
        ai: '#16A085',            // Verde-água suave
        end: '#95A5A6',           // Cinza suave
      },
    },
  },
};

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState(() => {
    // Carregar do localStorage ou usar dark como padrão
    const saved = localStorage.getItem('chatbot-theme');
    return saved && themes[saved] ? saved : 'dark';
  });

  const theme = themes[themeName];

  useEffect(() => {
    // Salvar no localStorage
    localStorage.setItem('chatbot-theme', themeName);
    
    // Aplicar tema no body
    document.body.style.backgroundColor = theme.colors.bg.primary;
    document.body.style.color = theme.colors.text.primary;
    
    // Atualizar variáveis CSS dinamicamente para que as classes Tailwind funcionem
    const root = document.documentElement;
    root.style.setProperty('--color-bg-primary', theme.colors.bg.primary);
    root.style.setProperty('--color-bg-secondary', theme.colors.bg.secondary);
    root.style.setProperty('--color-bg-tertiary', theme.colors.bg.tertiary);
    root.style.setProperty('--color-bg-elevated', theme.colors.bg.elevated);
    root.style.setProperty('--color-bg-hover', theme.colors.bg.hover);
    
    root.style.setProperty('--color-border-default', theme.colors.border.default);
    root.style.setProperty('--color-border-hover', theme.colors.border.hover);
    root.style.setProperty('--color-border-focus', theme.colors.border.focus);
    
    root.style.setProperty('--color-text-primary', theme.colors.text.primary);
    root.style.setProperty('--color-text-secondary', theme.colors.text.secondary);
    root.style.setProperty('--color-text-tertiary', theme.colors.text.tertiary);
    root.style.setProperty('--color-text-disabled', theme.colors.text.disabled);
    
    root.style.setProperty('--color-accent-primary', theme.colors.accent.primary);
    root.style.setProperty('--color-accent-hover', theme.colors.accent.hover);
    root.style.setProperty('--color-accent-pressed', theme.colors.accent.pressed);
    root.style.setProperty('--color-accent-light', theme.colors.accent.light);
    
    // Canvas background colors
    if (themeName === 'dark') {
      root.style.setProperty('--canvas-bg-color', '#0b0b0b');
      root.style.setProperty('--canvas-grid-image', 'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)');
    } else {
      root.style.setProperty('--canvas-bg-color', '#f8fafc');
      root.style.setProperty('--canvas-grid-image', 'linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)');
    }
    
    // Toolbar button colors
    if (themeName === 'dark') {
      root.style.setProperty('--tb-btn-border-color', '#2a2a2a');
      root.style.setProperty('--tb-btn-hover-bg', 'rgba(255, 255, 255, 0.05)');
      root.style.setProperty('--tb-btn-hover-border', '#3a3a3a');
      root.style.setProperty('--tb-btn-active-bg', 'rgba(255, 255, 255, 0.1)');
    } else {
      root.style.setProperty('--tb-btn-border-color', '#ccc');
      root.style.setProperty('--tb-btn-hover-bg', 'rgba(0, 0, 0, 0.05)');
      root.style.setProperty('--tb-btn-hover-border', '#999');
      root.style.setProperty('--tb-btn-active-bg', 'rgba(0, 0, 0, 0.1)');
    }
  }, [themeName, theme]);

  const toggleTheme = () => {
    setThemeName((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, themeName, toggleTheme, setTheme: setThemeName }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme deve ser usado dentro de um ThemeProvider');
  }
  return context;
}

