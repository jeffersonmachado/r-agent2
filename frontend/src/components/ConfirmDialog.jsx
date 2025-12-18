import React from 'react';
import { Dialog } from './Dialog';
import { Button } from '../styles/Button';

/**
 * Dialog de confirmação moderno
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirmar ação',
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'danger',
  icon,
}) {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        {icon && (
          <div className="flex justify-center">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${
              variant === 'danger' ? 'bg-status-error/20' :
              variant === 'primary' ? 'bg-accent-primary/20' :
              'bg-status-info/20'
            }`}>
              {icon}
            </div>
          </div>
        )}
        
        <p className="text-sm text-text-secondary text-center leading-relaxed whitespace-pre-line">
          {message}
        </p>

        <div className="flex gap-3 justify-end pt-4">
          <Button variant="ghost" onClick={onClose}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={handleConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

