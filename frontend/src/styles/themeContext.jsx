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
    rap: {
      shellBackground: 'linear-gradient(180deg, #0a0a0a 0%, #111111 100%)',
      shellGlowStart: 'rgba(94, 106, 210, 0.16)',
      shellGlowEnd: 'rgba(59, 130, 246, 0.12)',
      panelBackground: 'rgba(31, 31, 31, 0.82)',
      panelBackgroundSoft: 'rgba(26, 26, 26, 0.74)',
      panelBackgroundStrong: 'rgba(37, 37, 37, 0.92)',
      panelBorder: 'rgba(74, 74, 74, 0.34)',
      panelBorderStrong: 'rgba(94, 106, 210, 0.34)',
      textPrimary: 'rgba(255, 255, 255, 0.92)',
      textSecondary: 'rgba(255, 255, 255, 0.68)',
      textTertiary: 'rgba(255, 255, 255, 0.52)',
      activeBackground: 'linear-gradient(135deg, rgba(94, 106, 210, 0.24), rgba(59, 130, 246, 0.16))',
      heroBackground: 'linear-gradient(135deg, rgba(94, 106, 210, 0.18), rgba(59, 130, 246, 0.1))',
      overlayBackdrop: 'rgba(10, 10, 10, 0.62)',
    },
    workspace: {
      pageBackground: 'linear-gradient(135deg, #101312 0%, #171512 48%, #0d1615 100%)',
      pageGlowStart: 'rgba(229, 181, 88, 0.20)',
      pageGlowEnd: 'rgba(57, 171, 148, 0.16)',
      accentPrimary: '#e5b558',
      accentLight: 'rgba(229, 181, 88, 0.18)',
      healthyBg: 'rgba(57, 171, 148, 0.14)',
      healthyColor: '#9be2d4',
      healthyDot: '#39ab94',
      warningBg: 'rgba(229, 181, 88, 0.14)',
      warningColor: '#f6d58c',
      warningDot: '#e5b558',
      criticalBg: 'rgba(225, 92, 92, 0.14)',
      criticalColor: '#ffb1b1',
      criticalDot: '#e15c5c',
      inputBg: 'rgba(255, 251, 238, 0.08)',
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
    rap: {
      shellBackground: 'linear-gradient(180deg, #f6f7f9 0%, #eef2f7 100%)',
      shellGlowStart: 'rgba(94, 106, 210, 0.08)',
      shellGlowEnd: 'rgba(59, 130, 246, 0.06)',
      panelBackground: 'rgba(255, 255, 255, 0.92)',
      panelBackgroundSoft: 'rgba(255, 255, 255, 0.82)',
      panelBackgroundStrong: 'rgba(255, 255, 255, 0.98)',
      panelBorder: 'rgba(209, 213, 219, 0.82)',
      panelBorderStrong: 'rgba(94, 106, 210, 0.26)',
      textPrimary: 'rgba(31, 41, 55, 0.94)',
      textSecondary: 'rgba(75, 85, 99, 0.82)',
      textTertiary: 'rgba(107, 114, 128, 0.76)',
      activeBackground: 'linear-gradient(135deg, rgba(94, 106, 210, 0.14), rgba(59, 130, 246, 0.08))',
      heroBackground: 'linear-gradient(135deg, rgba(94, 106, 210, 0.12), rgba(59, 130, 246, 0.07))',
      overlayBackdrop: 'rgba(15, 23, 42, 0.18)',
    },
    workspace: {
      pageBackground: 'linear-gradient(135deg, #f6f7f9 0%, #eff3f9 48%, #f0f4f9 100%)',
      pageGlowStart: 'rgba(94, 106, 210, 0.08)',
      pageGlowEnd: 'rgba(59, 130, 246, 0.06)',
      accentPrimary: '#5e6ad2',
      accentLight: 'rgba(94, 106, 210, 0.12)',
      healthyBg: 'rgba(16, 185, 129, 0.12)',
      healthyColor: '#047857',
      healthyDot: '#10b981',
      warningBg: 'rgba(245, 158, 11, 0.12)',
      warningColor: '#b45309',
      warningDot: '#f59e0b',
      criticalBg: 'rgba(239, 68, 68, 0.12)',
      criticalColor: '#dc2626',
      criticalDot: '#ef4444',
      inputBg: 'rgba(31, 41, 55, 0.05)',
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
    root.classList.toggle('dark', themeName === 'dark');
    root.setAttribute('data-theme', themeName);
    root.style.colorScheme = themeName;

    // Mantem barra do browser/PWA alinhada com o tema atual.
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', theme.colors.bg.primary);
    }

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

    root.style.setProperty('--color-status-success', theme.colors.status.success);
    root.style.setProperty('--color-status-error', theme.colors.status.error);
    root.style.setProperty('--color-status-warning', theme.colors.status.warning);
    root.style.setProperty('--color-status-info', theme.colors.status.info);

    root.style.setProperty('--rap-shell-background', theme.rap.shellBackground);
    root.style.setProperty('--rap-shell-glow-start', theme.rap.shellGlowStart);
    root.style.setProperty('--rap-shell-glow-end', theme.rap.shellGlowEnd);
    root.style.setProperty('--rap-panel-background', theme.rap.panelBackground);
    root.style.setProperty('--rap-panel-background-soft', theme.rap.panelBackgroundSoft);
    root.style.setProperty('--rap-panel-background-strong', theme.rap.panelBackgroundStrong);
    root.style.setProperty('--rap-panel-border', theme.rap.panelBorder);
    root.style.setProperty('--rap-panel-border-strong', theme.rap.panelBorderStrong);
    root.style.setProperty('--rap-text-primary', theme.rap.textPrimary);
    root.style.setProperty('--rap-text-secondary', theme.rap.textSecondary);
    root.style.setProperty('--rap-text-tertiary', theme.rap.textTertiary);
    root.style.setProperty('--rap-active-background', theme.rap.activeBackground);
    root.style.setProperty('--rap-hero-background', theme.rap.heroBackground);
    root.style.setProperty('--rap-overlay-backdrop', theme.rap.overlayBackdrop);

    // Workspace-specific variables
    root.style.setProperty('--workspace-page-background', theme.workspace.pageBackground);
    root.style.setProperty('--workspace-page-glow-start', theme.workspace.pageGlowStart);
    root.style.setProperty('--workspace-page-glow-end', theme.workspace.pageGlowEnd);
    root.style.setProperty('--workspace-accent-primary', theme.workspace.accentPrimary);
    root.style.setProperty('--workspace-accent-light', theme.workspace.accentLight);
    root.style.setProperty('--workspace-healthy-bg', theme.workspace.healthyBg);
    root.style.setProperty('--workspace-healthy-color', theme.workspace.healthyColor);
    root.style.setProperty('--workspace-healthy-dot', theme.workspace.healthyDot);
    root.style.setProperty('--workspace-warning-bg', theme.workspace.warningBg);
    root.style.setProperty('--workspace-warning-color', theme.workspace.warningColor);
    root.style.setProperty('--workspace-warning-dot', theme.workspace.warningDot);
    root.style.setProperty('--workspace-critical-bg', theme.workspace.criticalBg);
    root.style.setProperty('--workspace-critical-color', theme.workspace.criticalColor);
    root.style.setProperty('--workspace-critical-dot', theme.workspace.criticalDot);
    root.style.setProperty('--workspace-input-bg', theme.workspace.inputBg);

    // Canvas background colors
    if (themeName === 'dark') {
      root.style.setProperty('--canvas-bg-color', '#0b0b0b');
      root.style.setProperty('--canvas-grid-image', 'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)');
    } else {
      root.style.setProperty('--canvas-bg-color', '#f8fafc');
      root.style.setProperty('--canvas-grid-image', 'linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)');
    }
    
    // Nota: Variáveis CSS para toolbar buttons removidas - agora usando classes Tailwind diretamente
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
