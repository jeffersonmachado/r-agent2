import React, { useEffect, useState } from 'react';

/**
 * Sistema de Toast/Notification moderno
 */
export function Toast({ message, type = 'info', duration = 3000, onClose }) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onClose?.(), 300); // Aguarda animação
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const typeStyles = {
    success: 'bg-status-success/90 border-status-success',
    error: 'bg-status-error/90 border-status-error',
    warning: 'bg-status-warning/90 border-status-warning',
    info: 'bg-status-info/90 border-status-info',
  };

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  if (!isVisible) return null;

  const bgColor = typeStyles[type]?.split(' ')[0] || 'bg-status-info/90';
  
  return (
    <div
      className={`fixed top-4 right-4 z-[3000] px-4 py-3 rounded-lg border shadow-2xl backdrop-blur-sm animate-in slide-in-from-right fade-in duration-300 min-w-[300px] max-w-md ${bgColor}`}
    >
      <div className="flex items-start gap-3">
        <div className="text-xl flex-shrink-0">{icons[type]}</div>
        <div className="flex-1 text-sm text-white font-medium">{message}</div>
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(() => onClose?.(), 300);
          }}
          className="text-white/80 hover:text-white transition-colors flex-shrink-0"
          aria-label="Fechar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Hook para gerenciar toasts
 */
export function useToast() {
  const [toasts, setToasts] = React.useState([]);

  const showToast = (message, type = 'info', duration = 3000) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    return id;
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const ToastContainer = () => (
    <div className="fixed top-4 right-4 z-[3000] space-y-2 pointer-events-none">
      {toasts.map((toast, index) => (
        <div key={toast.id} className="pointer-events-auto" style={{ marginTop: index > 0 ? '8px' : '0' }}>
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

  return { showToast, removeToast, ToastContainer };
}

