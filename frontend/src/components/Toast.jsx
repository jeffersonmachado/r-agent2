import React, { useEffect, useState, useRef } from 'react';
import logger from '../utils/logger';

/**
 * Sistema de Toast/Notification usando Tailwind CSS puro
 * Baseado nos padrões do Tailwind UI
 */
export function Toast({ message, type = 'info', duration = 6000, onClose }) {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => {
          setIsVisible(false);
          onClose?.();
        }, 300); // Aguarda animação de saída
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, 300);
  };

  if (!isVisible) return null;

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
        transform transition-all duration-300 ease-in-out
        ${isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
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
              aria-label="Fechar"
            >
              <span className="sr-only">Fechar</span>
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook para gerenciar toasts
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);
  const idCounterRef = useRef(0); // ✅ Contador para garantir IDs únicos
  const MAX_TOASTS = 5; // Número máximo de toasts simultâneos

  const showToast = (message, type = 'info', duration = 6000) => {
    // Evita toasts duplicados com a mesma mensagem e tipo
    setToasts((prev) => {
      const isDuplicate = prev.some(
        (toast) => toast.message === message && toast.type === type
      );
      
      if (isDuplicate) {
        // Se já existe um toast igual, não adiciona outro
        return prev;
      }
      
      // ✅ Combina timestamp com contador para garantir unicidade
      const id = `toast-${Date.now()}-${++idCounterRef.current}`;
      const newToast = { id, message, type, duration };
      
      // Limita o número de toasts - remove os mais antigos se necessário
      const updatedToasts = [...prev, newToast];
      if (updatedToasts.length > MAX_TOASTS) {
        // Remove os toasts mais antigos (primeiros da lista)
        return updatedToasts.slice(-MAX_TOASTS);
      }
      
      return updatedToasts;
    });
    
    // ✅ Registra a mensagem do toast no sistema de logs
    const logLevel = {
      success: 'info',
      error: 'error',
      warning: 'warn',
      info: 'info',
    }[type] || 'info';
    
    logger[logLevel](`Toast [${type}]: ${message}`, { type, duration });
    
    // Retorna um ID aproximado (pode não ser exato devido ao estado assíncrono)
    return `toast-${Date.now()}-${idCounterRef.current}`;
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };
  
  // Função para limpar todos os toasts
  const clearAllToasts = () => {
    setToasts([]);
  };

  const ToastContainer = () => (
    <div 
      className="fixed top-4 right-4 z-[3000] flex flex-col gap-2 pointer-events-none"
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
            onClose={() => removeToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );

  return { showToast, removeToast, clearAllToasts, ToastContainer };
}

