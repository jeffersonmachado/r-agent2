import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../styles/themeContext';

/**
 * Componente de painel redimensionável HÍBRIDO (CSS resize + JS para callbacks).
 * 
 * Usa CSS `resize` para redimensionamento nativo do browser e JavaScript apenas para:
 * - Callbacks (onResize)
 * - Colapsar/expandir
 * - Validação de limites (min/max)
 * 
 * Props:
 * - children: conteúdo do painel
 * - defaultWidth: largura padrão (em pixels)
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
  collapsedWidth = 48, // EXATAMENTE como no modelo (48px)
  collapseDirection = 'left',
  title = null,
  collapsedContent = null,
  onToggle = null,
  isCollapsed: externalIsCollapsed = null, // Estado externo controlado
  style: additionalStyle = {},
}) {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(externalIsCollapsed !== null ? externalIsCollapsed : false);
  const [savedWidth, setSavedWidth] = useState(null);
  const panelRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const prevExternalCollapsedRef = useRef(externalIsCollapsed);

  // Sincroniza estado interno com estado externo quando fornecido
  useEffect(() => {
    if (externalIsCollapsed !== null && externalIsCollapsed !== prevExternalCollapsedRef.current && panelRef.current) {
      const wasCollapsed = prevExternalCollapsedRef.current;
      prevExternalCollapsedRef.current = externalIsCollapsed;
      setIsCollapsed(externalIsCollapsed);
      
      if (externalIsCollapsed && !wasCollapsed) {
        // Colapsar: salva largura atual
        const currentSize = direction === 'horizontal' 
          ? panelRef.current.offsetWidth 
          : panelRef.current.offsetHeight;
        setSavedWidth(currentSize);
        if (direction === 'horizontal') {
          panelRef.current.style.width = `${collapsedWidth}px`;
        } else {
          panelRef.current.style.height = `${collapsedWidth}px`;
        }
        if (onResize) onResize(collapsedWidth);
      } else if (!externalIsCollapsed && wasCollapsed) {
        // Expandir: restaura largura salva
        const widthToRestore = savedWidth !== null 
          ? savedWidth 
          : (typeof defaultWidth === 'number' ? defaultWidth : parseInt(defaultWidth) || 200);
        if (direction === 'horizontal') {
          panelRef.current.style.width = `${widthToRestore}px`;
        } else {
          panelRef.current.style.height = `${widthToRestore}px`;
        }
        if (onResize) onResize(widthToRestore);
      }
    }
  }, [externalIsCollapsed, direction, collapsedWidth, savedWidth, defaultWidth, onResize]);

  const isHorizontal = direction === 'horizontal';

  // Inicializa a largura usando CSS variable
  useEffect(() => {
    if (panelRef.current && defaultWidth !== null && defaultWidth !== undefined) {
      const initialWidth = typeof defaultWidth === 'number' ? defaultWidth : parseInt(defaultWidth) || 200;
      panelRef.current.style.setProperty('--panel-width', `${initialWidth}px`);
    }
  }, [defaultWidth]);

  // Observa mudanças de tamanho usando ResizeObserver (para callbacks)
  useEffect(() => {
    if (!panelRef.current || !onResize || isCollapsed) return;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newSize = isHorizontal 
          ? entry.contentRect.width 
          : entry.contentRect.height;
        
        // Valida limites
        if (minWidth && newSize < minWidth) {
          const element = entry.target;
          if (isHorizontal) {
            element.style.width = `${minWidth}px`;
          } else {
            element.style.height = `${minWidth}px`;
          }
          return;
        }
        
        if (maxWidth && newSize > maxWidth) {
          const element = entry.target;
          if (isHorizontal) {
            element.style.width = `${maxWidth}px`;
          } else {
            element.style.height = `${maxWidth}px`;
          }
          return;
        }

        // Chama callback
        onResize(newSize);
      }
    });

    resizeObserverRef.current.observe(panelRef.current);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [onResize, isCollapsed, isHorizontal, minWidth, maxWidth]);

  const handleToggleCollapse = () => {
    if (!panelRef.current) return;

    if (isCollapsed) {
      // Expandir: restaura largura salva ou usa defaultWidth
      setIsCollapsed(false);
      const widthToRestore = savedWidth !== null 
        ? savedWidth 
        : (typeof defaultWidth === 'number' ? defaultWidth : parseInt(defaultWidth) || 200);
      
      if (isHorizontal) {
        panelRef.current.style.width = `${widthToRestore}px`;
      } else {
        panelRef.current.style.height = `${widthToRestore}px`;
      }
      
      if (onResize) onResize(widthToRestore);
      
      if (onToggle) {
        setTimeout(() => onToggle(false), 0);
      }
    } else {
      // Colapsar: salva largura atual e colapsa
      const currentSize = isHorizontal 
        ? panelRef.current.offsetWidth 
        : panelRef.current.offsetHeight;
      setSavedWidth(currentSize);
      setIsCollapsed(true);
      
      if (isHorizontal) {
        panelRef.current.style.width = `${collapsedWidth}px`;
      } else {
        panelRef.current.style.height = `${collapsedWidth}px`;
      }
      
      if (onResize) onResize(collapsedWidth);
      
      if (onToggle) {
        setTimeout(() => onToggle(true), 0);
      }
    }
  };

  // Remove flexShrink do additionalStyle se flex estiver sendo usado
  const { flexShrink, ...restAdditionalStyle } = additionalStyle;
  
  const currentWidth = isCollapsed ? collapsedWidth : (defaultWidth || 200);
  
  const style = {
    position: 'relative',
    ...(currentWidth !== null && currentWidth !== undefined && !isCollapsed && {
      [isHorizontal ? 'width' : 'height']: typeof currentWidth === 'number' 
        ? `${currentWidth}px` 
        : currentWidth,
      ...(flexShrink !== undefined && { flexShrink }),
    }),
    ...(currentWidth === null || currentWidth === undefined ? {
      [isHorizontal ? 'flex' : 'flex']: 1,
    } : {}),
    [isHorizontal ? 'minWidth' : 'minHeight']: isCollapsed ? `${collapsedWidth}px` : `${minWidth}px`,
    ...(maxWidth && !isCollapsed && { [isHorizontal ? 'maxWidth' : 'maxHeight']: `${maxWidth}px` }),
    // CSS resize - permite redimensionamento nativo do browser
    resize: isCollapsed ? 'none' : (isHorizontal ? 'horizontal' : 'vertical'),
    overflow: 'hidden', // Necessário para resize funcionar, mas esconde scrollbars
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 200ms ease, height 200ms ease',
    ...restAdditionalStyle,
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
    <div ref={panelRef} className="resizable-panel-hybrid" style={style}>
      {collapsible && title && (
        <div
          style={{
            padding: '8px 12px',
            paddingRight: collapseDirection === 'right' ? '12px' : '40px',
            paddingLeft: collapseDirection === 'right' ? '40px' : '12px',
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
            className="resizable-panel-collapse-btn"
            style={collapseButtonStyle}
            title={isCollapsed ? 'Expandir' : 'Recolher'}
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
            flexDirection: 'column',
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
    </div>
  );
}
