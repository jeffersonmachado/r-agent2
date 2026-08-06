import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ThemeContext = createContext(null);

const themes = {
  dark: {
    name: 'dark',
    colors: {
      bg: {
        primary: '#0a0b14',
        secondary: '#10111d',
        tertiary: '#151827',
        elevated: '#121420',
        hover: '#1b2033',
      },
      border: {
        default: 'rgba(255, 255, 255, 0.06)',
        hover: 'rgba(255, 255, 255, 0.12)',
        focus: '#818cf8',
      },
      text: {
        primary: '#f8fafc',
        secondary: '#94a3b8',
        tertiary: '#64748b',
        disabled: '#475569',
      },
      accent: {
        primary: '#6366f1',
        hover: '#818cf8',
        pressed: '#4f46e5',
        light: 'rgba(99, 102, 241, 0.12)',
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
      shellBackground: 'linear-gradient(180deg, #0a0b14 0%, #0f1220 100%)',
      shellGlowStart: 'rgba(99, 102, 241, 0.14)',
      shellGlowEnd: 'rgba(244, 63, 94, 0.08)',
      panelBackground: 'rgba(255, 255, 255, 0.03)',
      panelBackgroundSoft: 'rgba(255, 255, 255, 0.02)',
      panelBackgroundStrong: 'rgba(18, 20, 32, 0.92)',
      panelBorder: 'rgba(255, 255, 255, 0.06)',
      panelBorderStrong: 'rgba(99, 102, 241, 0.24)',
      textPrimary: 'rgba(248, 250, 252, 0.96)',
      textSecondary: 'rgba(148, 163, 184, 0.88)',
      textTertiary: 'rgba(100, 116, 139, 0.9)',
      activeBackground: 'linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(139, 92, 246, 0.09))',
      heroBackground: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.06), transparent)',
      overlayBackdrop: 'rgba(10, 11, 20, 0.72)',
    },
    qa: {
      glowAccent: 'rgba(99, 102, 241, 0.14)',
      glowDanger: 'rgba(244, 63, 94, 0.08)',
      accentShadow: 'rgba(99, 102, 241, 0.30)',
      avatarBackground: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      onAccent: '#ffffff',
      warningMuted: 'rgba(245, 158, 11, 0.18)',
    },
    workspace: {
      pageBackground: 'var(--rap-shell-background)',
      pageGlowStart: 'var(--rap-shell-glow-start)',
      pageGlowEnd: 'var(--rap-shell-glow-end)',
      accentPrimary: 'var(--color-accent-primary)',
      accentLight: 'var(--color-accent-light)',
      accentContrast: 'var(--qa-on-accent)',
      panelShadow: 'var(--qa-accent-shadow)',
      entityHoverBackground: 'var(--rap-active-background)',
      iconBorder: 'var(--rap-panel-border-strong)',
      skeletonBackground: 'linear-gradient(90deg, var(--rap-panel-background-soft), var(--rap-panel-background-strong), var(--rap-panel-background-soft))',
      healthyBg: 'rgba(57, 171, 148, 0.14)',
      healthyColor: '#9be2d4',
      healthyDot: '#39ab94',
      warningBg: 'rgba(229, 181, 88, 0.14)',
      warningColor: '#f6d58c',
      warningDot: '#e5b558',
      criticalBg: 'rgba(225, 92, 92, 0.14)',
      criticalColor: '#ffb1b1',
      criticalDot: '#e15c5c',
      inputBg: 'var(--rap-panel-background-soft)',
    },
  },
  light: {
    name: 'light',
    colors: {
      bg: {
        primary: '#f8fafc',
        secondary: '#ffffff',
        tertiary: '#f1f5f9',
        elevated: '#ffffff',
        hover: '#eef2ff',
      },
      border: {
        default: 'rgba(15, 23, 42, 0.08)',
        hover: 'rgba(99, 102, 241, 0.2)',
        focus: '#6366f1',
      },
      text: {
        primary: '#0f172a',
        secondary: '#475569',
        tertiary: '#64748b',
        disabled: '#94a3b8',
      },
      accent: {
        primary: '#4f46e5',
        hover: '#6366f1',
        pressed: '#4338ca',
        light: 'rgba(79, 70, 229, 0.1)',
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
      shellBackground: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
      shellGlowStart: 'rgba(99, 102, 241, 0.1)',
      shellGlowEnd: 'rgba(244, 63, 94, 0.05)',
      panelBackground: 'rgba(255, 255, 255, 0.9)',
      panelBackgroundSoft: 'rgba(255, 255, 255, 0.76)',
      panelBackgroundStrong: 'rgba(255, 255, 255, 0.98)',
      panelBorder: 'rgba(15, 23, 42, 0.08)',
      panelBorderStrong: 'rgba(99, 102, 241, 0.24)',
      textPrimary: 'rgba(15, 23, 42, 0.96)',
      textSecondary: 'rgba(71, 85, 105, 0.88)',
      textTertiary: 'rgba(100, 116, 139, 0.82)',
      activeBackground: 'linear-gradient(135deg, rgba(99, 102, 241, 0.13), rgba(139, 92, 246, 0.06))',
      heroBackground: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.04), transparent)',
      overlayBackdrop: 'rgba(15, 23, 42, 0.18)',
    },
    qa: {
      glowAccent: 'rgba(99, 102, 241, 0.10)',
      glowDanger: 'rgba(244, 63, 94, 0.06)',
      accentShadow: 'rgba(79, 70, 229, 0.22)',
      avatarBackground: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
      onAccent: '#ffffff',
      warningMuted: 'rgba(245, 158, 11, 0.16)',
    },
    workspace: {
      pageBackground: 'var(--rap-shell-background)',
      pageGlowStart: 'var(--rap-shell-glow-start)',
      pageGlowEnd: 'var(--rap-shell-glow-end)',
      accentPrimary: 'var(--color-accent-primary)',
      accentLight: 'var(--color-accent-light)',
      accentContrast: 'var(--qa-on-accent)',
      panelShadow: 'var(--qa-accent-shadow)',
      entityHoverBackground: 'var(--rap-active-background)',
      iconBorder: 'var(--rap-panel-border-strong)',
      skeletonBackground: 'linear-gradient(90deg, var(--rap-panel-background-soft), var(--rap-panel-background-strong), var(--rap-panel-background-soft))',
      healthyBg: 'rgba(16, 185, 129, 0.12)',
      healthyColor: '#047857',
      healthyDot: '#10b981',
      warningBg: 'rgba(245, 158, 11, 0.12)',
      warningColor: '#b45309',
      warningDot: '#f59e0b',
      criticalBg: 'rgba(239, 68, 68, 0.12)',
      criticalColor: '#dc2626',
      criticalDot: '#ef4444',
      inputBg: 'var(--rap-panel-background-soft)',
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

    root.style.setProperty('--qa-glow-accent', theme.qa.glowAccent);
    root.style.setProperty('--qa-glow-danger', theme.qa.glowDanger);
    root.style.setProperty('--qa-accent-shadow', theme.qa.accentShadow);
    root.style.setProperty('--qa-avatar-background', theme.qa.avatarBackground);
    root.style.setProperty('--qa-on-accent', theme.qa.onAccent);
    root.style.setProperty('--qa-warning-muted', theme.qa.warningMuted);

    // Workspace-specific variables
    root.style.setProperty('--workspace-page-background', theme.workspace.pageBackground);
    root.style.setProperty('--workspace-page-glow-start', theme.workspace.pageGlowStart);
    root.style.setProperty('--workspace-page-glow-end', theme.workspace.pageGlowEnd);
    root.style.setProperty('--workspace-accent-primary', theme.workspace.accentPrimary);
    root.style.setProperty('--workspace-accent-light', theme.workspace.accentLight);
    root.style.setProperty('--workspace-accent-contrast', theme.workspace.accentContrast);
    root.style.setProperty('--workspace-panel-shadow', theme.workspace.panelShadow);
    root.style.setProperty('--workspace-entity-hover-background', theme.workspace.entityHoverBackground);
    root.style.setProperty('--workspace-icon-border', theme.workspace.iconBorder);
    root.style.setProperty('--workspace-skeleton-background', theme.workspace.skeletonBackground);
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

  const toggleTheme = useCallback(() => {
    setThemeName((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({
    theme,
    themeName,
    toggleTheme,
    setTheme: setThemeName,
  }), [theme, themeName, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
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
