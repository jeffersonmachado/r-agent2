import React, { useEffect } from 'react';

/**
 * Componente Dialog/Modal moderno com Tailwind CSS
 * Suporta animações, backdrop blur, e fechamento por ESC
 */
export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[90vw]',
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm fade-in" />
      
      {/* Dialog */}
      <div
        className={`relative bg-gradient-to-br from-bg-elevated to-bg-tertiary border border-border-default rounded-xl shadow-2xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col slide-in-from-top-4`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                aria-label="Fechar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-border-default scrollbar-track-transparent">
          {children}
        </div>
      </div>
    </div>
  );
}

