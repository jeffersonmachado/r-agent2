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
        {/* Mensagem - sempre deve ter uma mensagem */}
        <div className="flex items-start gap-3">
          <span className="text-3xl flex-shrink-0">{style.icon}</span>
          <div className="flex-1">
            {typeof message === 'string' ? (
              <p className="text-text-primary whitespace-pre-line">{message || 'Tem certeza que deseja continuar?'}</p>
            ) : (
              message || <p className="text-text-primary">Tem certeza que deseja continuar?</p>
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

  const confirm = React.useCallback(function(options, messageParam) {
    return new Promise((resolve) => {
      // Suporta API antiga: confirm(title, message) ou nova: confirm({ message, title, ... })
      let message, title;
      
      if (typeof options === 'string') {
        // API antiga: confirm(title, message)
        title = options;
        message = messageParam || 'Tem certeza que deseja continuar?';
      } else if (options && typeof options === 'object') {
        // API nova: confirm({ message, title, ... })
        message = options.message?.trim() || options.message || 'Tem certeza que deseja continuar?';
        title = options.title || 'Confirmação';
      } else {
        // Sem parâmetros: usa mensagem padrão
        message = 'Tem certeza que deseja continuar?';
        title = 'Confirmação';
      }

      resolveRef.current = resolve;
      setConfig({
        title: title,
        message: message,
        onConfirm: (options && typeof options === 'object' ? options.onConfirm : null) || null,
        onCancel: (options && typeof options === 'object' ? options.onCancel : null) || null,
        confirmLabel: (options && typeof options === 'object' ? options.confirmLabel : null) || 'Confirmar',
        cancelLabel: (options && typeof options === 'object' ? options.cancelLabel : null) || 'Cancelar',
        variant: (options && typeof options === 'object' ? options.variant : null) || 'warning',
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
