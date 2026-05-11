/**
 * Design system moderno estilo Linear/Stripe
 * Dark mode por padrão, minimalista e elegante
 */

export const theme = {
  colors: {
    // Backgrounds
    bg: {
      primary: '#0a0b14',
      secondary: '#10111d',
      tertiary: '#151827',
      elevated: '#121420',
      hover: '#1b2033',
    },
    // Borders
    border: {
      default: 'rgba(255, 255, 255, 0.06)',
      hover: 'rgba(255, 255, 255, 0.12)',
      focus: '#818cf8',
    },
    // Text
    text: {
      primary: '#f8fafc',
      secondary: '#94a3b8',
      tertiary: '#64748b',
      disabled: '#475569',
    },
    // Accent (azul suave estilo Linear)
    accent: {
      primary: '#6366f1',
      hover: '#818cf8',
      pressed: '#4f46e5',
      light: 'rgba(99, 102, 241, 0.12)',
    },
    // Status
    status: {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6',
    },
    // Node types (cores sutis)
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
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
  },
  typography: {
    fontFamily: {
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      mono: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace',
    },
    fontSize: {
      xs: '11px',
      sm: '12px',
      base: '13px',
      md: '14px',
      lg: '15px',
      xl: '16px',
      '2xl': '18px',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
    },
  },
  borderRadius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 6px rgba(0, 0, 0, 0.3)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.4)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.5)',
  },
  transitions: {
    fast: '150ms ease',
    normal: '200ms ease',
    slow: '300ms ease',
  },
};

export const globalStyles = {
  '*': {
    boxSizing: 'border-box',
  },
  body: {
    margin: 0,
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.base,
    lineHeight: theme.typography.lineHeight.normal,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.bg.primary,
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
  },
};

