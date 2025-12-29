import React, { useEffect, useRef, useState } from 'react';

/**
 * Componente Dialog/Modal moderno com Tailwind CSS
 * Suporta animações, backdrop blur, fechamento por ESC, arrastável e redimensionável
 */
export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  draggable = true,
  resizable = true, // Nova prop para habilitar redimensionamento
  dynamicSize = null, // { width, isCollapsed } - para ajuste dinâmico
  onSizeChange = null, // Callback quando o tamanho muda
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dialogSize, setDialogSize] = useState({ width: null, height: null });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const dialogRef = useRef(null);
  const headerRef = useRef(null);
  const resizeHandleRef = useRef(null);

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

  // Reset position quando o modal é aberto
  useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen]);

  // Handlers para drag
  const handleMouseDown = (e) => {
    if (!draggable || !headerRef.current) return;
    
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Calcula offset baseado na posição real do elemento na tela
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const rect = dialogRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Calcula nova posição baseada no mouse e offset
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      
      // Limita o movimento dentro da viewport (considerando padding de 16px = 1rem)
      const padding = 16;
      const maxX = window.innerWidth - rect.width - padding;
      const maxY = window.innerHeight - rect.height - padding;
      
      setPosition({
        x: Math.max(padding, Math.min(newX, maxX)),
        y: Math.max(padding, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Handlers para redimensionamento
  const handleResizeStart = (e) => {
    if (!resizable || !dialogRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = dialogRef.current.getBoundingClientRect();
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
    });
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      if (!dialogRef.current) return;

      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      
      const minWidth = 300;
      const minHeight = 200;
      const maxWidth = window.innerWidth - 32; // padding
      const maxHeight = window.innerHeight - 32; // padding
      
      const newWidth = Math.max(minWidth, Math.min(resizeStart.width + deltaX, maxWidth));
      const newHeight = Math.max(minHeight, Math.min(resizeStart.height + deltaY, maxHeight));
      
      setDialogSize({ width: newWidth, height: newHeight });
      
      if (onSizeChange) {
        onSizeChange({ width: newWidth, height: newHeight });
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeStart, onSizeChange, resizable]);

  // Reset size quando o modal é aberto
  useEffect(() => {
    if (isOpen) {
      setDialogSize({ width: null, height: null });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Calcula classes e estilos de tamanho baseado em dynamicSize, dialogSize ou size padrão
  const getSizeConfig = () => {
    // Prioridade: dialogSize (redimensionamento manual) > dynamicSize > size padrão
    if (dialogSize.width || dialogSize.height) {
      return {
        className: '',
        style: {
          width: dialogSize.width ? `${dialogSize.width}px` : undefined,
          height: dialogSize.height ? `${dialogSize.height}px` : undefined,
          maxWidth: dialogSize.width ? `${dialogSize.width}px` : undefined,
          maxHeight: dialogSize.height ? `${dialogSize.height}px` : undefined,
        },
      };
    }
    
    if (dynamicSize && dynamicSize.width) {
      return {
        className: '',
        style: { maxWidth: `${dynamicSize.width}px`, width: '100%' },
      };
    }
    
    const sizeClasses = {
      sm: 'max-w-md',
      md: 'max-w-lg',
      lg: 'max-w-2xl',
      xl: 'max-w-4xl',
      full: 'max-w-[90vw]',
    };
    return {
      className: sizeClasses[size] || sizeClasses.md,
      style: {},
    };
  };

  const sizeConfig = getSizeConfig();

  const transformStyle = position.x !== 0 || position.y !== 0
    ? { transform: `translate(${position.x}px, ${position.y}px)` }
    : {};

  // Verifica se o modal foi arrastado
  const hasCustomPosition = position.x !== 0 || position.y !== 0;

  // Se foi arrastado, usa posicionamento absoluto; senão, centraliza com flex
  const containerClass = hasCustomPosition
    ? 'fixed inset-0 z-[2000] p-4'
    : 'fixed inset-0 z-[2000] flex items-center justify-center p-4';

  const dialogStyle = hasCustomPosition
    ? { position: 'absolute', top: `${position.y}px`, left: `${position.x}px` }
    : {};

  return (
    <div className={containerClass}>
      {/* Backdrop - sem blur para não borrar o canvas do fluxo */}
      <div
        className="absolute inset-0 bg-black/25 fade-in"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div
        ref={dialogRef}
        className={`relative z-10 bg-gradient-to-br from-bg-elevated to-bg-tertiary border border-border-default rounded-xl shadow-2xl w-full ${sizeConfig.className} ${dialogSize.height ? '' : 'max-h-[90vh]'} flex flex-col ${hasCustomPosition ? '' : 'slide-in-from-top-4'} ${isDragging ? 'cursor-move' : ''}`}
        onClick={(e) => e.stopPropagation()}
        style={{ ...dialogStyle, ...sizeConfig.style }}
      >
        {/* Header */}
        {title && (
          <div
            ref={headerRef}
            onMouseDown={handleMouseDown}
            className={`flex items-center justify-between px-6 py-4 border-b border-border-default ${draggable ? 'cursor-move' : ''}`}
          >
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              {draggable && (
                <svg className="w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                </svg>
              )}
              {title}
            </h2>
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

        {/* Handle de redimensionamento */}
        {resizable && (
          <div
            ref={resizeHandleRef}
            onMouseDown={handleResizeStart}
            className={`absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize flex items-end justify-end p-1 ${
              isResizing ? 'opacity-100' : 'opacity-60 hover:opacity-100'
            } transition-opacity`}
            title="Redimensionar"
          >
            {/* Padrão de linhas diagonais para redimensionamento */}
            <div className="flex flex-col gap-0.5">
              <div className="flex gap-0.5">
                <div className="w-1 h-1 bg-text-tertiary rounded-full"></div>
                <div className="w-1 h-1 bg-text-tertiary rounded-full"></div>
                <div className="w-1 h-1 bg-text-tertiary rounded-full"></div>
              </div>
              <div className="flex gap-0.5">
                <div className="w-1 h-1 bg-text-tertiary rounded-full"></div>
                <div className="w-1 h-1 bg-text-tertiary rounded-full"></div>
              </div>
              <div className="flex gap-0.5">
                <div className="w-1 h-1 bg-text-tertiary rounded-full"></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

