import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../styles/themeContext';

/**
 * Componente de painel redimensionável com opção de colapsar/expandir.
 * 
 * Props:
 * - children: conteúdo do painel
 * - defaultWidth: largura padrão (em pixels ou porcentagem)
 * - minWidth: largura mínima (em pixels)
 * - maxWidth: largura máxima (em pixels)
 * - direction: 'horizontal' (redimensiona horizontalmente) ou 'vertical' (verticalmente)
 * - onResize: callback chamado quando o tamanho muda
 * - collapsible: se true, permite colapsar/expandir o painel
 * - collapsedWidth: largura quando colapsado (padrão: 40px)
 * - collapseDirection: 'left' ou 'right' - direção do colapso (padrão: 'left')
 * - collapsedContent: conteúdo customizado a mostrar quando colapsado
 * - onToggle: callback chamado quando o painel é expandido ou recolhido (recebe isCollapsed)
 * - style: estilos adicionais para o container
 */
export function ResizablePanel({ 
  children, 
  defaultWidth, 
  minWidth = 100, 
  maxWidth,
  direction = 'horizontal',
  onResize,
  collapsible = false,
  collapsedWidth = 40,
  collapseDirection = 'left',
  title = null,
  collapsedContent = null,
  onToggle = null,
  style: additionalStyle = {},
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [savedWidth, setSavedWidth] = useState(null);
  const panelRef = useRef(null);
  const startPosRef = useRef(null);
  const startWidthRef = useRef(null);

  // Inicializa a largura
  useEffect(() => {
    if (width === null) {
      if (defaultWidth === null || defaultWidth === undefined) {
        // Se não especificado, usa flex (não define width)
        return;
      } else if (typeof defaultWidth === 'string' && defaultWidth.includes('%')) {
        // Se for porcentagem, converte para pixels baseado no container pai
        const updateWidth = () => {
          const parent = panelRef.current?.parentElement;
          if (parent) {
            const parentWidth = direction === 'horizontal' 
              ? parent.offsetWidth 
              : parent.offsetHeight;
            const percent = parseFloat(defaultWidth) / 100;
            setWidth(parentWidth * percent);
          }
        };
        
        // Aguarda o DOM estar pronto
        setTimeout(updateWidth, 0);
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
      } else if (typeof defaultWidth === 'number') {
        setWidth(defaultWidth);
      } else {
        setWidth(defaultWidth);
      }
    }
  }, [defaultWidth, direction, width]);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing || !startPosRef.current || startWidthRef.current === null) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = currentPos - startPosRef.current;
    const parent = panelRef.current?.parentElement;
    
    if (!parent) return;

    const parentSize = direction === 'horizontal' 
      ? parent.offsetWidth 
      : parent.offsetHeight;

    let newWidth = startWidthRef.current + delta;
    
    // Aplica limites
    if (newWidth < minWidth) newWidth = minWidth;
    if (maxWidth && newWidth > maxWidth) newWidth = maxWidth;
    if (newWidth > parentSize - 50) newWidth = parentSize - 50; // Deixa espaço mínimo para outros painéis

    setWidth(newWidth);
    
    if (onResize) {
      onResize(newWidth);
    }
  }, [isResizing, direction, minWidth, maxWidth, onResize]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    startPosRef.current = null;
    startWidthRef.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startWidthRef.current = typeof width === 'number' ? width : panelRef.current?.offsetWidth || minWidth;
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleToggleCollapse = () => {
    if (isCollapsed) {
      // Expandir: restaura largura salva ou usa defaultWidth
      setIsCollapsed(false);
      if (savedWidth !== null) {
        setWidth(savedWidth);
        if (onResize) onResize(savedWidth);
      } else if (typeof defaultWidth === 'number') {
        setWidth(defaultWidth);
        if (onResize) onResize(defaultWidth);
      }
      // Chama callback de toggle após expandir
      if (onToggle) {
        // Usa setTimeout para garantir que o estado foi atualizado
        setTimeout(() => onToggle(false), 0);
      }
    } else {
      // Colapsar: salva largura atual e colapsa
      setSavedWidth(typeof width === 'number' ? width : panelRef.current?.offsetWidth);
      setIsCollapsed(true);
      setWidth(collapsedWidth);
      if (onResize) onResize(collapsedWidth);
      // Chama callback de toggle após recolher
      if (onToggle) {
        // Usa setTimeout para garantir que o estado foi atualizado
        setTimeout(() => onToggle(true), 0);
      }
    }
  };

  const isHorizontal = direction === 'horizontal';
  const currentWidth = isCollapsed ? collapsedWidth : width;
  
  // Remove flexShrink do additionalStyle se flex estiver sendo usado
  const { flexShrink, ...restAdditionalStyle } = additionalStyle;
  
  const style = {
    position: 'relative',
    ...(currentWidth !== null && currentWidth !== undefined && {
      [isHorizontal ? 'width' : 'height']: typeof currentWidth === 'number' 
        ? `${currentWidth}px` 
        : currentWidth,
      // Quando width/height está definido, não usa flex, mas pode usar flexShrink
      ...(flexShrink !== undefined && { flexShrink }),
    }),
    ...(currentWidth === null || currentWidth === undefined ? {
      // Quando não há width definido, usa flex: 1 (não flexShrink)
      [isHorizontal ? 'flex' : 'flex']: 1,
    } : {}),
    [isHorizontal ? 'minWidth' : 'minHeight']: isCollapsed ? `${collapsedWidth}px` : `${minWidth}px`,
    ...(maxWidth && !isCollapsed && { [isHorizontal ? 'maxWidth' : 'maxHeight']: `${maxWidth}px` }),
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: isResizing ? 'none' : 'width 200ms ease, height 200ms ease',
    ...restAdditionalStyle,
  };

  const resizeHandleStyle = {
    position: 'absolute',
    [isHorizontal ? 'right' : 'bottom']: 0,
    [isHorizontal ? 'top' : 'left']: 0,
    [isHorizontal ? 'width' : 'height']: '4px',
    [isHorizontal ? 'height' : 'width']: '100%',
    cursor: isHorizontal ? 'col-resize' : 'row-resize',
    backgroundColor: isResizing 
      ? theme.colors.accent.primary 
      : 'transparent',
    zIndex: 10,
    transition: isResizing ? 'none' : 'background-color 150ms ease',
  };

  const collapseButtonStyle = {
    position: 'absolute',
    [isHorizontal 
      ? (collapseDirection === 'right' ? 'left' : 'right')
      : (collapseDirection === 'right' ? 'top' : 'bottom')
    ]: '8px',
    [isHorizontal ? 'top' : 'left']: '8px',
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.bg.tertiary,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    zIndex: 11,
    transition: 'all 150ms ease',
  };

  return (
    <div ref={panelRef} style={style}>
      {collapsible && title && (
        <div
          style={{
            padding: '8px 12px',
            paddingRight: collapseDirection === 'right' ? '12px' : '40px', // Espaço para o botão de colapsar
            paddingLeft: collapseDirection === 'right' ? '40px' : '12px', // Espaço para o botão quando colapsa à direita
            borderBottom: `1px solid ${theme.colors.border.default}`,
            fontSize: '12px',
            fontWeight: 500,
            color: theme.colors.text.primary,
            backgroundColor: theme.colors.bg.secondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'relative',
            minHeight: '32px',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          <span 
            style={{ 
              flex: 1, 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              minWidth: 0,
              marginRight: collapseDirection === 'right' ? '8px' : '0',
            }}
          >
            {title}
          </span>
          <button
            onClick={handleToggleCollapse}
            style={collapseButtonStyle}
            title={isCollapsed ? 'Expandir' : 'Recolher'}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.bg.hover;
              e.currentTarget.style.borderColor = theme.colors.accent.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.bg.tertiary;
              e.currentTarget.style.borderColor = theme.colors.border.default;
            }}
          >
            {isCollapsed 
              ? (collapseDirection === 'right' ? '◀' : '▶')
              : (collapseDirection === 'right' ? '▶' : '◀')
            }
          </button>
        </div>
      )}
      {!isCollapsed && children}
      {isCollapsed && collapsible && (
        <div
          style={{
            display: 'flex',
            flexDirection: collapseDirection === 'right' ? 'column' : 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: '8px 4px',
            height: '100%',
            overflowY: 'auto',
          }}
        >
          {collapsedContent || (
            <div
              style={{
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                padding: '8px',
                fontSize: '11px',
                color: theme.colors.text.tertiary,
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              {title || 'Recolhido'}
            </div>
          )}
        </div>
      )}
      {!isCollapsed && (
        <div
          style={resizeHandleStyle}
          onMouseDown={handleMouseDown}
          onMouseEnter={(e) => {
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = theme.colors.accent.primary + '40';
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        />
      )}
    </div>
  );
}
