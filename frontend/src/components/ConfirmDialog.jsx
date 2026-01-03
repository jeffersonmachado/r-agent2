import React from 'react';
import { Dialog } from './Dialog';
import { Button } from '../styles/Button';

/**
 * Componente de diálogo de confirmação usando Tailwind CSS.
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Se o diálogo está aberto
 * @param {Function} props.onClose - Callback quando fecha (sem confirmar)
 * @param {Function} props.onConfirm - Callback quando confirma
 * @param {string} props.title - Título do diálogo
 * @param {string|React.ReactNode} props.message - Mensagem do diálogo
 * @param {string} [props.confirmLabel='Confirmar'] - Texto do botão de confirmação
 * @param {string} [props.cancelLabel='Cancelar'] - Texto do botão de cancelamento
 * @param {string} [props.variant='warning'] - Variante: 'warning', 'danger', 'info'
 * @param {boolean} [props.disabled=false] - Se os botões devem estar desabilitados
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'warning',
  disabled = false,
}) {
  const handleConfirm = () => {
    if (disabled) return;
    onConfirm();
    onClose();
  };

  const handleClose = () => {
    if (disabled) return;
    onClose();
  };

  const variantStyles = {
    warning: {
      icon: '⚠️',
      confirmVariant: 'primary',
      confirmClass: 'bg-status-warning hover:bg-status-warning/90 text-white',
    },
    danger: {
      icon: '❌',
      confirmVariant: 'primary',
      confirmClass: 'bg-status-error hover:bg-status-error/90 text-white',
    },
    info: {
      icon: 'ℹ️',
      confirmVariant: 'primary',
      confirmClass: 'bg-status-info hover:bg-status-info/90 text-white',
    },
  };

  const style = variantStyles[variant] || variantStyles.warning;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={title || 'Confirmação'}
      size="md"
      draggable={false}
      resizable={false}
      showCloseButton={!disabled}
    >
      <div className="space-y-4">
        {/* Mensagem */}
        <div className="flex items-start gap-3">
          <span className="text-3xl flex-shrink-0">{style.icon}</span>
          <div className="flex-1">
            {typeof message === 'string' ? (
              <p className="text-text-primary whitespace-pre-line">{message}</p>
            ) : (
              message
            )}
          </div>
        </div>

        {/* Botões */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
          <Button
            onClick={handleClose}
            variant="secondary"
            className="flex items-center gap-2"
            disabled={disabled}
          >
            <span>{cancelLabel}</span>
          </Button>
          <Button
            onClick={handleConfirm}
            className={`flex items-center gap-2 ${style.confirmClass}`}
            disabled={disabled}
          >
            <span>{confirmLabel}</span>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Hook para usar diálogo de confirmação de forma simples.
 * 
 * @returns {Object} { confirm, ConfirmDialog }
 */
export function useConfirmDialog() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [config, setConfig] = React.useState({
    title: 'Confirmação',
    message: '',
    onConfirm: () => {},
    onCancel: null,
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar',
    variant: 'warning',
  });
  const resolveRef = React.useRef(null);

  const confirm = React.useCallback((options) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfig({
        title: options.title || 'Confirmação',
        message: options.message || '',
        onConfirm: options.onConfirm || null,
        onCancel: options.onCancel || null,
        confirmLabel: options.confirmLabel || 'Confirmar',
        cancelLabel: options.cancelLabel || 'Cancelar',
        variant: options.variant || 'warning',
      });
      setIsOpen(true);
    });
  }, []);

  const handleConfirm = React.useCallback(() => {
    if (config.onConfirm) {
      config.onConfirm();
    }
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
    setIsOpen(false);
  }, [config]);

  const handleClose = React.useCallback(() => {
    if (config.onCancel) {
      config.onCancel();
    }
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setIsOpen(false);
  }, [config]);

  // Retorna um componente React, não um elemento JSX
  const ConfirmDialogComponent = React.useCallback(() => {
    return (
      <ConfirmDialog
        isOpen={isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={config.title}
        message={config.message}
        confirmLabel={config.confirmLabel}
        cancelLabel={config.cancelLabel}
        variant={config.variant}
      />
    );
  }, [isOpen, config, handleClose, handleConfirm]);

  return {
    confirm,
    ConfirmDialog: ConfirmDialogComponent,
  };
}
