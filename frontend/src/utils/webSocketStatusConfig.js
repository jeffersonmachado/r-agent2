/**
 * WebSocket Status Configuration Module
 * Centralizes WebSocket status metadata for consistent UI display across all pages
 * Provides standardized badge, label, and styling configuration
 */

export const WS_STATUS_META = {
  ready: {
    title: 'WebSocket conectado e autenticado - Atualizações em tempo real ativas',
    label: 'Conectado',
    dotClassName: 'bg-status-success',
  },
  auth: {
    title: 'WebSocket conectado, autenticando...',
    label: 'Autenticando...',
    dotClassName: 'bg-accent-primary',
  },
  connecting: {
    title: 'WebSocket conectando...',
    label: 'Conectando...',
    dotClassName: 'bg-accent-primary',
  },
  disconnected: {
    title: 'WebSocket desconectado',
    label: 'Desconectado',
    dotClassName: 'bg-status-error',
  },
};

/**
 * Get UI metadata for WebSocket phase
 * Falls back to disconnected state if phase is unknown
 * @param {string} phase - The WebSocket phase ('ready', 'auth', 'connecting', 'disconnected')
 * @returns {Object} The metadata object with title, label, and dotClassName
 */
export function getWebSocketStatusMeta(phase) {
  return WS_STATUS_META[phase] || WS_STATUS_META.disconnected;
}

/**
 * Standardized WebSocket status indicator component data
 * Returns ready-to-use configuration for rendering status badges
 * @param {string} phase - Current WebSocket phase
 * @returns {Object} Configuration with className and visual properties
 */
export function getWebSocketStatusConfig(phase) {
  const meta = getWebSocketStatusMeta(phase);
  return {
    ...meta,
    phase,
  };
}
