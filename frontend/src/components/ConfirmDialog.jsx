import React from 'react';
import { Dialog } from './Dialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

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
  const cancelButtonRef = React.useRef(null);

  React.useEffect(() => {
    if (isOpen && cancelButtonRef.current) {
      // Pequeno delay para garantir que o modal está totalmente renderizado
      setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (disabled) return;
    
    // Log quando o botão Confirmar é clicado no componente
    logger.debug('✅ [CONFIRM] Botão "Confirmar" clicado (componente)', {
      title,
      message: typeof message === 'string' ? message.substring(0, 100) : 'ReactNode',
      timestamp: new Date().toISOString()
    });
    
    onConfirm();
    onClose();
    
    logger.debug('📂 [CONFIRM] Modal fechado após confirmação (componente)');
  };

  const handleClose = () => {
    if (disabled) return;
    
    logger.debug('❌ [CONFIRM] Botão "Cancelar" clicado ou modal fechado (componente)', {
      title,
      timestamp: new Date().toISOString()
    });
    
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
            ref={cancelButtonRef}
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
    // Log quando o botão Confirmar é clicado
    logger.debug('✅ [CONFIRM] Botão "Confirmar" clicado no modal', {
      title: config.title,
      message: config.message,
      timestamp: new Date().toISOString()
    });
    
    if (config.onConfirm) {
      config.onConfirm();
    }
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
    setIsOpen(false);
    
    // Log após fechar o modal
    logger.debug('📂 [CONFIRM] Modal de confirmação fechado após confirmação');
  }, [config]);

  const handleClose = React.useCallback(() => {
    // Log quando o botão Cancelar é clicado ou modal é fechado
    logger.debug('❌ [CONFIRM] Modal de confirmação fechado (cancelado)', {
      title: config.title,
      timestamp: new Date().toISOString()
    });
    
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
