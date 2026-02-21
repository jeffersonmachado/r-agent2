import { useEffect, useState } from 'react';

/**
 * WebSocket Status Configuration Module
 * Centralizes WebSocket status metadata for consistent UI display across all pages
 * Provides standardized badge, label, and styling configuration
 */

const WS_STATUS_META = {
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
  auth_error: {
    title: 'WebSocket conectado, falha de autenticação',
    label: 'Falha de autenticação',
    dotClassName: 'bg-status-error',
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

function resolveStatusMeta(phase) {
  return WS_STATUS_META[phase] || WS_STATUS_META.disconnected;
}

function useResolvedStatusPhase({ connected, authenticated, authFailed, disconnectDelayMs = 1500 }) {
  const [phase, setPhase] = useState('connecting');

  useEffect(() => {
    let timeoutId = null;

    if (connected && authenticated) {
      setPhase('ready');
      return () => {};
    }

    if (connected && authFailed) {
      setPhase('auth_error');
      return () => {};
    }

    if (connected && !authenticated) {
      setPhase('auth');
      return () => {};
    }

    setPhase('connecting');
    timeoutId = setTimeout(() => {
      setPhase('disconnected');
    }, disconnectDelayMs);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [connected, authenticated, authFailed, disconnectDelayMs]);

  return phase;
}

/**
 * Hook completo para status visual do WebSocket.
 * Centraliza fase, metadados e comportamento de animação do indicador.
 *
 * @param {Object} params
 * @param {boolean} params.connected
 * @param {boolean} params.authenticated
 * @param {boolean} params.authFailed
 * @param {number} [params.disconnectDelayMs=1500]
 * @returns {{
 *   phase: string,
 *   title: string,
 *   label: string,
 *   dotClassName: string,
 *   shouldPulse: boolean,
 *   dotAnimationClassName: string,
 *   indicatorDotClassName: string,
 * }}
 */
export function useWebSocketStatus({ connected, authenticated, authFailed, disconnectDelayMs = 1500 }) {
  const phase = useResolvedStatusPhase({
    connected,
    authenticated,
    authFailed,
    disconnectDelayMs,
  });

  const meta = resolveStatusMeta(phase);
  const shouldPulse = !connected;
  const dotAnimationClassName = shouldPulse ? 'animate-pulse' : '';

  return {
    phase,
    title: meta.title,
    label: meta.label,
    dotClassName: meta.dotClassName,
    shouldPulse,
    dotAnimationClassName,
    indicatorDotClassName: `${meta.dotClassName} ${dotAnimationClassName}`.trim(),
  };
}
