import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './styles/Button';
import { useTheme } from './styles/themeContext';

/**
 * Barra de ferramentas simplificada e responsiva
 */
export function Toolbar({
  onImportJson,
  onExportJson,
  onSimulate,
  onSave,
  onValidate,
  onArrange,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onResetZoom,
  onCenterCanvas,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDuplicate,
  onSearchNode,
  onImportTemplate,
  onOpen,
  children,
}) {
  const { themeName } = useTheme();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  
  // Estado para controlar quais grupos estão visíveis na toolbar
  const [visibleItems, setVisibleItems] = useState({
    main: true,      // Abrir, Salvar, Validar, Simular
    zoom: true,      // Zoom controls
    edit: true,      // Undo, Redo, Copy, Paste, Duplicar, Organizar
    search: true,    // Buscar
    extra: true,     // Importar, Exportar, Template
    tools: true,     // Logs, Tema (menor prioridade)
  });
  
  const toolbarRef = useRef(null);
  
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (onSearchNode && searchQuery.trim()) {
      onSearchNode(searchQuery.trim());
      setSearchQuery('');
      setShowSearch(false);
    }
  };

  // Calcula quais grupos cabem na toolbar baseado no espaço disponível
  useEffect(() => {
    let rafId = null;
    let timeoutId = null;
    let isChecking = false;
    let lastViewportWidth = 0;
    
    // Constantes baseadas em classes Tailwind (valores em pixels)
    // px-2 = 8px (0.5rem)
    // gap-2 = 8px (0.5rem)
    // min-w-5 = 20px (1.25rem)
    // w-20 = 80px (5rem)
    // gap-12 = 48px (3rem) - aproximação para margem de segurança
    // gap-4 = 16px (1rem) - aproximação para histerese
    const TAILWIND_PX_2 = 8;   // px-2, gap-2
    const TAILWIND_PX_4 = 16;  // gap-4 (histerese aproximada)
    const TAILWIND_MIN_W_5 = 20; // min-w-5
    const TAILWIND_W_20 = 80;  // w-20
    const TAILWIND_GAP_12 = 48; // gap-12 (margem de segurança aproximada)
    
    const checkSpace = () => {
      if (isChecking || !toolbarRef.current) return;
      
      const toolbar = toolbarRef.current;
      const availableWidth = toolbar.offsetWidth;
      const viewportWidth = window.innerWidth;
      
      if (availableWidth === 0) return; // Ainda não renderizado
      
      // Só recalcula se a viewport mudou (não se apenas a toolbar mudou por causa de painéis)
      // Ignora mudanças menores que 5px para evitar recálculos desnecessários
      if (Math.abs(viewportWidth - lastViewportWidth) < 5) {
        return;
      }
      
      lastViewportWidth = viewportWidth;
      
      // Marca como processando ANTES de qualquer modificação
      isChecking = true;
      
      // Usa requestAnimationFrame para evitar múltiplas chamadas
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      
      rafId = requestAnimationFrame(() => {
        try {
          // Elementos fixos que sempre estão presentes
          const childrenContainer = toolbar.querySelector('.flex.items-center.gap-2');
          const separators = toolbar.querySelectorAll('.toolbar-separator');
          
          // Calcula largura dos elementos fixos
          // NOTA: spacer NÃO é incluído porque é flex: 1 (ocupa espaço restante dinamicamente)
          let fixedWidth = TAILWIND_PX_2 * 2; // padding da toolbar (px-2 = 8px * 2)
          if (childrenContainer && childrenContainer.offsetParent !== null) {
            fixedWidth += childrenContainer.offsetWidth + TAILWIND_PX_2; // gap-2
          }
          // Spacer é flex: 1, não deve ser incluído no cálculo fixo
          separators.forEach(sep => {
            if (sep.offsetParent !== null) {
              fixedWidth += sep.offsetWidth + TAILWIND_PX_2; // gap-2
            }
          });
          
          // Adiciona espaço estimado para o botão "Mais" (sempre reserva espaço para ele)
          // Isso evita que o cálculo mude quando o botão aparece/desaparece
          const estimatedMoreButtonWidth = TAILWIND_W_20; // w-20 = 80px
          fixedWidth += estimatedMoreButtonWidth + TAILWIND_PX_2; // gap-2
          
          // Margem de segurança reduzida (gap-8 = 32px ao invés de gap-12 = 48px)
          // gap-8 é suficiente e evita cálculos muito conservadores
          const TAILWIND_GAP_8 = 32; // gap-8
          const availableForGroups = availableWidth - fixedWidth - TAILWIND_GAP_8;
          
          // Busca os grupos (mesmo que ocultos, para calcular tamanho)
          const mainGroup = toolbar.querySelector('.toolbar-group-main');
          const zoomGroup = toolbar.querySelector('.toolbar-group-zoom');
          const editGroup = toolbar.querySelector('.toolbar-group-edit');
          const searchGroup = toolbar.querySelector('.toolbar-group-search');
          const extraGroup = toolbar.querySelector('.toolbar-group-extra');
          const toolsGroup = toolbar.querySelector('.toolbar-group-utils');
          
          // Ordem de prioridade: main > search > zoom > edit > extra > tools (tools tem menor prioridade)
          let usedWidth = 0;
          const newVisible = { main: true, zoom: true, edit: true, search: true, extra: true, tools: true };
          
          // Temporariamente mostra todos os grupos para medir
          const groups = [mainGroup, searchGroup, zoomGroup, editGroup, extraGroup, toolsGroup].filter(Boolean);
          const originalDisplays = groups.map(g => {
            const computed = window.getComputedStyle(g).display;
            return computed === 'none' ? '' : g.style.display;
          });
          groups.forEach(g => { 
            if (window.getComputedStyle(g).display === 'none') {
              g.style.display = 'flex';
            }
          });
          
          // Força reflow para garantir que as medidas estão atualizadas
          void toolbar.offsetHeight;
          
          // Main group (prioridade máxima)
          if (mainGroup) {
            const width = mainGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.main = false;
            }
          }
          
          // Search group
          if (searchGroup && newVisible.main) {
            const width = searchGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.search = false;
            }
          }
          
          // Zoom group
          if (zoomGroup && newVisible.main) {
            const width = zoomGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.zoom = false;
            }
          }
          
          // Edit group - com histerese para evitar alternância
          if (editGroup && newVisible.main) {
            const width = editGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            const isCurrentlyVisible = visibleItems.edit;
            // Se já está visível, precisa de menos espaço para continuar (histerese de gap-4 = 16px)
            // Isso evita alternância quando o espaço está no limite
            const threshold = isCurrentlyVisible ? availableForGroups + TAILWIND_PX_4 : availableForGroups;
            if (usedWidth + width <= threshold) {
              usedWidth += width;
            } else {
              newVisible.edit = false;
            }
          }
          
          // Extra group (Importar, Exportar, Template) - com histerese para evitar alternância
          if (extraGroup && newVisible.main) {
            const width = extraGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            const isCurrentlyVisible = visibleItems.extra;
            // Se já está visível, precisa de menos espaço para continuar (histerese de gap-4 = 16px)
            // Isso evita alternância quando o espaço está no limite
            const threshold = isCurrentlyVisible ? availableForGroups + TAILWIND_PX_4 : availableForGroups;
            if (usedWidth + width <= threshold) {
              usedWidth += width;
            } else {
              newVisible.extra = false;
            }
          }
          
          // Tools group (Logs, Tema) - menor prioridade, com histerese para evitar alternância
          if (toolsGroup && newVisible.main) {
            const width = toolsGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            const isCurrentlyVisible = visibleItems.tools;
            // Se já está visível, precisa de menos espaço para continuar (histerese de gap-4 = 16px)
            // Isso evita alternância quando o espaço está no limite
            const threshold = isCurrentlyVisible ? availableForGroups + TAILWIND_PX_4 : availableForGroups;
            if (usedWidth + width <= threshold) {
              usedWidth += width;
            } else {
              newVisible.tools = false;
            }
          }
          
          // Restaura displays originais (remove style inline se estava vazio)
          groups.forEach((g, i) => {
            if (originalDisplays[i]) {
              g.style.display = originalDisplays[i];
            } else {
              g.style.display = '';
            }
          });
          
          // Só atualiza o estado se realmente mudou
          setVisibleItems(prev => {
            const hasChanged = 
              prev.main !== newVisible.main ||
              prev.zoom !== newVisible.zoom ||
              prev.edit !== newVisible.edit ||
              prev.search !== newVisible.search ||
              prev.extra !== newVisible.extra ||
              prev.tools !== newVisible.tools;
            
            if (!hasChanged) {
              return prev;
            }
            
            return newVisible;
          });
        } finally {
          // Aguarda um frame antes de permitir novos cálculos
          setTimeout(() => {
            isChecking = false;
          }, 50);
        }
      });
    };
    
    // Verifica ao montar e após um pequeno delay para garantir que o DOM está renderizado
    timeoutId = setTimeout(checkSpace, 150);
    
    // Observa APENAS mudanças na viewport (window resize)
    // NÃO observa mudanças na Toolbar diretamente para evitar recálculo quando painéis colapsam
    const handleWindowResize = () => {
      // Ignora se já está processando
      if (isChecking) return;
      
      // Cancela timeout anterior se existir
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // Debounce de 300ms para evitar múltiplas chamadas
      timeoutId = setTimeout(() => {
        if (toolbarRef.current && !isChecking) {
          const viewportWidth = window.innerWidth;
          // Só recalcula se a viewport realmente mudou (threshold de 5px)
          if (Math.abs(viewportWidth - lastViewportWidth) >= 5) {
            checkSpace();
          }
        }
      }, 300);
    };
    
    window.addEventListener('resize', handleWindowResize);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      // Removido: resizeObserverInstance não é mais necessário
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [onSave, onValidate, onSimulate, onOpen, onArrange, onZoomOut, onZoomIn, onZoomFit, onResetZoom, onUndo, onRedo, onCopy, onPaste, onSearchNode, onImportJson, onExportJson, onImportTemplate, onDuplicate]);

  // Função para determinar quais itens vão para o menu "Mais"
  const getMoreMenuItems = () => {
    const items = [];
    
    // Itens que vão para "Mais" quando não cabem na toolbar
    if (!visibleItems.extra) {
      if (onImportJson) {
        items.push({ key: 'import', label: '📥 Importar', action: onImportJson });
      }
      if (onExportJson) {
        items.push({ key: 'export', label: '📤 Exportar', action: onExportJson });
      }
      if (onImportTemplate) {
        items.push({ key: 'template', label: '📋 Template', action: onImportTemplate });
      }
    }
    
    // Itens que vão para "Mais" quando não cabem na toolbar
    if (!visibleItems.main) {
      if (onOpen) items.push({ key: 'open', label: '📂 Abrir', action: onOpen });
      if (onSave) items.push({ key: 'save', label: '💾 Salvar', action: onSave });
      if (onValidate) items.push({ key: 'validate', label: '✓ Validar', action: onValidate });
      if (onSimulate) items.push({ key: 'simulate', label: '▶️ Simular', action: onSimulate });
    }
    
    if (!visibleItems.zoom) {
      if (onZoomOut) items.push({ key: 'zoomOut', label: '➖ Diminuir zoom', action: onZoomOut });
      if (onResetZoom) items.push({ key: 'resetZoom', label: '100% Zoom', action: onResetZoom });
      if (onZoomIn) items.push({ key: 'zoomIn', label: '➕ Aumentar zoom', action: onZoomIn });
      if (onZoomFit) items.push({ key: 'zoomFit', label: '🔍 Fit', action: onZoomFit });
    }
    
    if (!visibleItems.edit) {
      if (onUndo) items.push({ key: 'undo', label: '↶ Desfazer', action: onUndo });
      if (onRedo) items.push({ key: 'redo', label: '↷ Refazer', action: onRedo });
      if (onCopy) items.push({ key: 'copy', label: '📋 Copiar', action: onCopy });
      if (onPaste) items.push({ key: 'paste', label: '📄 Colar', action: onPaste });
      if (onDuplicate) items.push({ key: 'duplicate', label: '📑 Duplicar', action: onDuplicate });
      if (onArrange) items.push({ key: 'arrange', label: '⚙️ Organizar', action: onArrange });
    }
    
    if (!visibleItems.search && onSearchNode) {
      items.push({ key: 'search', label: '🔍 Buscar', action: () => setShowSearch(true) });
    }
    
    return items;
  };

  const moreMenuItems = getMoreMenuItems();
  const hasMoreItems = moreMenuItems.length > 0;
  
  return (
    <div ref={toolbarRef} className="toolbar">
      <div className="flex items-center gap-2">
        {children && React.Children.toArray(children)[0]}
      </div>

      <div className="toolbar-separator"></div>

      {visibleItems.main && (
        <div className="toolbar-group toolbar-group-main">
        {onOpen && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onOpen} title="Abrir fluxo">
            📂 Abrir
          </button>
        )}
        {onSave && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onSave} title="Salvar fluxo">
            💾 Salvar
          </button>
        )}
        {onValidate && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onValidate} title="Validar fluxo">
            ✓ Validar
          </button>
        )}
        {onSimulate && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onSimulate} title="Simular fluxo">
            ▶️ Simular
          </button>
        )}
        </div>
      )}
      
      {visibleItems.main && (visibleItems.zoom || visibleItems.edit || visibleItems.search || visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.zoom && (
        <div className="toolbar-group toolbar-group-zoom">
        {onZoomOut && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onZoomOut} title="Diminuir zoom">
            ➖
          </button>
        )}
        {onResetZoom && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onResetZoom} title="Zoom 100%">
            100%
          </button>
        )}
        {onZoomIn && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onZoomIn} title="Aumentar zoom">
            ➕
          </button>
        )}
        {onZoomFit && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onZoomFit} title="Ajustar zoom">
            🔍 Fit
          </button>
      )}
        </div>
      )}

      {visibleItems.zoom && (visibleItems.edit || visibleItems.search || visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.edit && (
        <div className="toolbar-group toolbar-group-edit">
        {onUndo && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onUndo} title="Desfazer">
            ↶
          </button>
        )}
        {onRedo && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onRedo} title="Refazer">
            ↷
          </button>
        )}
        {onCopy && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onCopy} title="Copiar">
            📋
          </button>
        )}
        {onPaste && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onPaste} title="Colar">
            📄
          </button>
        )}
        {onDuplicate && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onDuplicate} title="Duplicar">
            📑 Duplicar
          </button>
        )}
        {onArrange && (
          <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onArrange} title="Organizar nós">
            ⚙️ Organizar
          </button>
        )}
        </div>
      )}

      {visibleItems.search && onSearchNode && (
        <div className="toolbar-group toolbar-group-search">
          {showSearch ? (
            <form onSubmit={handleSearchSubmit} className="toolbar-search-form">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar nó..."
                className="toolbar-search-input"
                autoFocus
                onBlur={() => setTimeout(() => setShowSearch(false), 200)}
              />
              <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" type="submit" title="Buscar">
                🔍
              </button>
            </form>
          ) : (
            <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={() => setShowSearch(true)} title="Buscar nó">
              🔍 Buscar
            </button>
      )}
        </div>
      )}

      {visibleItems.search && (visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.extra && (
        <div className="toolbar-group toolbar-group-extra">
          {onImportJson && (
            <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onImportJson} title="Importar JSON">
              📥 Importar
            </button>
          )}
          {onExportJson && (
            <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onExportJson} title="Exportar JSON">
              📤 Exportar
            </button>
          )}
          {onImportTemplate && (
            <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={onImportTemplate} title="Importar Template">
              📋 Template
            </button>
          )}
        </div>
      )}

      {visibleItems.extra && (hasMoreItems || visibleItems.tools) && <div className="toolbar-separator"></div>}

      {visibleItems.tools && (
        <div className="toolbar-group toolbar-group-utils">
          {children && React.Children.toArray(children).slice(1)}
        </div>
      )}

      {visibleItems.tools && hasMoreItems && <div className="toolbar-separator"></div>}

      <div className="toolbar-spacer"></div>

      {hasMoreItems && (
        <div className="toolbar-group toolbar-group-more toolbar-more-container">
          <button
            className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            title="Mais opções"
          >
            ⋯ Mais
          </button>
          
          {showMoreMenu && typeof document !== 'undefined' && createPortal(
            <>
              <div 
                className="toolbar-more-overlay"
                onClick={() => setShowMoreMenu(false)}
              />
              <div className="toolbar-more-menu">
                <div className="toolbar-more-header">
                  <span>Mais opções</span>
                  <button
                    type="button"
                    onClick={() => setShowMoreMenu(false)}
                    className="toolbar-more-close"
                  >
                    ✕
                    </button>
                </div>
                <div className="toolbar-more-content">
                  {moreMenuItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        item.action();
                        setShowMoreMenu(false);
                      }}
                      className="toolbar-more-item"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
            </div>
          </>,
          document.body
        )}
        </div>
      )}
    </div>
  );
}
