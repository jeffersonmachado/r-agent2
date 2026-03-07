import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import logger from '../utils/logger';

const MAX_TOASTS = 5;
const toastListeners = new Set();
const toastTimeouts = new Map();
const toastContainerListeners = new Set();
let idCounter = 0;
let globalToasts = [];
let activeContainerOwner = null;

function notifyToastListeners() {
  toastListeners.forEach((listener) => listener(globalToasts));
}

function subscribeToasts(listener) {
  toastListeners.add(listener);
  listener(globalToasts);
  return () => {
    toastListeners.delete(listener);
  };
}

function notifyContainerListeners() {
  toastContainerListeners.forEach((listener) => listener());
}

function clearToastTimeout(id) {
  const timer = toastTimeouts.get(id);
  if (timer) {
    clearTimeout(timer);
    toastTimeouts.delete(id);
  }
}

function removeToastGlobal(id) {
  clearToastTimeout(id);
  globalToasts = globalToasts.filter((toast) => toast.id !== id);
  notifyToastListeners();
}

function clearAllToastsGlobal() {
  toastTimeouts.forEach((timer) => clearTimeout(timer));
  toastTimeouts.clear();
  globalToasts = [];
  notifyToastListeners();
}

function showToastGlobal(message, type = 'info', durationOrOptions = 6000, options = undefined) {
  const id = `toast-${Date.now()}-${++idCounter}`;
  const mergedOptions = (
    durationOrOptions !== null
    && typeof durationOrOptions === 'object'
    && !Array.isArray(durationOrOptions)
  )
    ? durationOrOptions
    : { ...(options || {}), duration: durationOrOptions };

  const hasDuration = Object.prototype.hasOwnProperty.call(mergedOptions, 'duration');
  const duration = hasDuration ? mergedOptions.duration : 6000;
  const normalizedDuration = Number(duration);
  const newToast = {
    id,
    message,
    type,
    duration,
    actions: Array.isArray(mergedOptions.actions) ? mergedOptions.actions : [],
    dismissLabel: typeof mergedOptions.dismissLabel === 'string' ? mergedOptions.dismissLabel : 'Fechar',
    onDismiss: typeof mergedOptions.onDismiss === 'function' ? mergedOptions.onDismiss : null,
  };

  const isDuplicate = globalToasts.some(
    (toast) => toast.message === message && toast.type === type
  );

  if (!isDuplicate) {
    globalToasts = [...globalToasts, newToast];
    if (globalToasts.length > MAX_TOASTS) {
      const removed = globalToasts.slice(0, globalToasts.length - MAX_TOASTS);
      removed.forEach((toast) => clearToastTimeout(toast.id));
      globalToasts = globalToasts.slice(-MAX_TOASTS);
    }
    notifyToastListeners();
  }

  const logLevel = {
    success: 'info',
    error: 'error',
    warning: 'warn',
    info: 'info',
  }[type] || 'info';

  logger[logLevel](`Toast [${type}]: ${message}`, { type, duration });

  if (normalizedDuration > 0 && !isDuplicate) {
    const timer = setTimeout(() => {
      removeToastGlobal(id);
    }, normalizedDuration);
    toastTimeouts.set(id, timer);
  }

  return id;
}

/**
 * Sistema de Toast/Notification usando Tailwind CSS puro
 * Baseado nos padrões do Tailwind UI
 */
export function Toast({
  message,
  type = 'info',
  duration = 6000,
  onClose,
  actions = [],
  dismissLabel = 'Fechar',
  onAction,
}) {
  const handleClose = () => onClose?.();
  const hasActions = Array.isArray(actions) && actions.length > 0;

  // Estilos Tailwind CSS puros para cada tipo
  const typeStyles = {
    success: {
      bg: 'bg-green-50 dark:bg-green-900/20',
      border: 'border-green-200 dark:border-green-800',
      text: 'text-green-800 dark:text-green-200',
      icon: 'text-green-400',
      iconBg: 'bg-green-100 dark:bg-green-900/40',
    },
    error: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      text: 'text-red-800 dark:text-red-200',
      icon: 'text-red-400',
      iconBg: 'bg-red-100 dark:bg-red-900/40',
    },
    warning: {
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      border: 'border-yellow-200 dark:border-yellow-800',
      text: 'text-yellow-800 dark:text-yellow-200',
      icon: 'text-yellow-400',
      iconBg: 'bg-yellow-100 dark:bg-yellow-900/40',
    },
    info: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
      text: 'text-blue-800 dark:text-blue-200',
      icon: 'text-blue-400',
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    },
  };

  const icons = {
    success: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    error: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    ),
    warning: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    ),
    info: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
    ),
  };

  const styles = typeStyles[type] || typeStyles.info;

  return (
    <div
      className={`
        pointer-events-auto w-full min-w-[320px] max-w-md overflow-hidden rounded-lg shadow-lg ring-1 ring-black ring-opacity-5
        ${styles.bg} ${styles.border}
        transform transition-all duration-300 ease-in-out translate-x-0 opacity-100
      `}
      role="alert"
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className={`flex-shrink-0 ${styles.icon}`}>
            {icons[type]}
          </div>
          <div className="ml-3 w-0 flex-1 pt-0.5">
            {typeof message === 'string' && message.includes('\n') ? (
              <div className={`text-sm font-medium ${styles.text} whitespace-pre-line`}>
                {message}
              </div>
            ) : (
              <p className={`text-sm font-medium ${styles.text}`}>
                {message}
              </p>
            )}
          </div>
          <div className="ml-4 flex flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className={`inline-flex rounded-md ${styles.text} hover:opacity-75 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white ${
                type === 'success' ? 'focus:ring-green-500' :
                type === 'error' ? 'focus:ring-red-500' :
                type === 'warning' ? 'focus:ring-yellow-500' :
                'focus:ring-blue-500'
              }`}
              aria-label={dismissLabel}
            >
              <span className="sr-only">{dismissLabel}</span>
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        {hasActions ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action, index) => {
              const isPrimary = action?.variant === 'primary';
              return (
                <button
                  key={`${action?.label || 'action'}-${index}`}
                  type="button"
                  onClick={() => onAction?.(action)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    isPrimary
                      ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
                      : 'bg-white/70 text-slate-800 hover:bg-white focus:ring-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'
                  }`}
                  aria-label={action?.label || `Ação ${index + 1}`}
                >
                  {action?.label || `Ação ${index + 1}`}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Hook para gerenciar toasts
 */
export function useToast() {
  const [toasts, setToasts] = useState(globalToasts);
  const ownerTokenRef = useRef(Symbol('toast-container-owner'));

  useEffect(() => subscribeToasts(setToasts), []);

  const removeToast = useCallback((id) => {
    removeToastGlobal(id);
  }, []);

  const showToast = useCallback((message, type = 'info', durationOrOptions = 6000, options = undefined) => {
    return showToastGlobal(message, type, durationOrOptions, options);
  }, []);

  const clearAllToasts = useCallback(() => {
    clearAllToastsGlobal();
  }, []);

  const ToastContainer = () => {
    const [isOwner, setIsOwner] = useState(false);

    useEffect(() => {
      const ensureOwnership = () => {
        if (activeContainerOwner === null) {
          activeContainerOwner = ownerTokenRef.current;
          notifyContainerListeners();
        }
        setIsOwner(activeContainerOwner === ownerTokenRef.current);
      };

      toastContainerListeners.add(ensureOwnership);
      ensureOwnership();

      return () => {
        toastContainerListeners.delete(ensureOwnership);
        if (activeContainerOwner === ownerTokenRef.current) {
          activeContainerOwner = null;
          notifyContainerListeners();
        }
      };
    }, []);

    if (!isOwner) return null;

    const content = (
      <div
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="assertive"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto animate-slide-in-from-right"
          >
            <Toast
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              actions={toast.actions}
              dismissLabel={toast.dismissLabel}
              onClose={() => {
                removeToast(toast.id);
                try {
                  toast.onDismiss?.();
                } catch (error) {
                  logger.error('Erro ao executar onDismiss do toast', {
                    error,
                    toastId: toast.id,
                  });
                }
              }}
              onAction={(action) => {
                removeToast(toast.id);
                try {
                  action?.onClick?.();
                } catch (error) {
                  logger.error('Erro ao executar ação do toast', {
                    error,
                    toastId: toast.id,
                    actionLabel: action?.label,
                  });
                }
              }}
            />
          </div>
        ))}
      </div>
    );

    // ✅ Renderiza via portal para fora de containers com overflow/transform
    // (evita toast “sumir” por clipping/stacking context).
    if (typeof document !== 'undefined' && document.body) {
      return createPortal(content, document.body);
    }

    return content;
  };

  return { showToast, removeToast, clearAllToasts, ToastContainer };
}
