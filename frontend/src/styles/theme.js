/**
 * Design system moderno estilo Linear/Stripe
 * Dark mode por padrão, minimalista e elegante
 */

export const theme = {
  colors: {
    // Backgrounds
    bg: {
      primary: '#0a0a0a',
      secondary: '#111111',
      tertiary: '#1a1a1a',
      elevated: '#1f1f1f',
      hover: '#252525',
    },
    // Borders
    border: {
      default: '#2a2a2a',
      hover: '#3a3a3a',
      focus: '#4a4a4a',
    },
    // Text
    text: {
      primary: '#ffffff',
      secondary: '#a0a0a0',
      tertiary: '#707070',
      disabled: '#404040',
    },
    // Accent (azul suave estilo Linear)
    accent: {
      primary: '#5e6ad2',
      hover: '#6b77e0',
      pressed: '#525cc4',
      light: 'rgba(94, 106, 210, 0.1)',
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


