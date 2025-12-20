import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './styles/Button';
import { Input } from './styles/Input';

/**
 * Barra de ferramentas superior do editor - estilo moderno
 * Organizada em grupos visuais com recursos principais em destaque
 */
export function Toolbar({
  // Recursos básicos
  onImportJson,
  onExportJson,
  onSimulate,
  onSave,
  onValidate,
  onLoadFlow,
  onArrange,
  
  // Controles de zoom
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onResetZoom,
  onCenterCanvas,
  
  // Controles de edição
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDuplicate,
  onSelectAll,
  onDeselectAll,
  
  // Controles de alinhamento
  onAlignLeft,
  onAlignCenter,
  onAlignRight,
  onAlignTop,
  onAlignMiddle,
  onAlignBottom,
  onDistributeHorizontal,
  onDistributeVertical,
  
  // Controles de conexão
  onToggleReroutePoints,
  onClearOrphanConnections,
  
  // Controles de busca e navegação
  onSearchNode,
  onGoToNode,
  onNextNode,
  onPreviousNode,
  
  // Controles de exportação
  onExportPNG,
  onExportSVG,
  onExportPDF,
  onImportTemplate,
  
  // Controles de validação e debug
  onValidateAndFix,
  onShowErrors,
  onToggleDebug,
  onShowStatistics,
  
  // Controles de performance
  onOptimizeLayout,
  onSimplifyGraph,
  
  // Controles de minimap
  onToggleMinimap,
  minimapVisible,
  currentZoom,
  
  children,
}) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [hiddenItems, setHiddenItems] = useState(new Set());
  const hiddenItemsRef = useRef(new Set());
  
  const toolbarRef = useRef(null);
  const itemsRef = useRef({});
  const spacerRef = useRef(null);
  const moreButtonRef = useRef(null);
  const childrenRef = useRef(null);
  const simulateRef = useRef(null);
  
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (onSearchNode && searchQuery.trim()) {
      onSearchNode(searchQuery.trim());
      setSearchQuery('');
      setShowSearch(false);
    }
  };

  // Detecta quais itens não cabem na tela
  useEffect(() => {
    let isChecking = false;
    let lastCheckTime = 0;
    
    const checkOverflow = () => {
      // Evita múltiplas chamadas simultâneas
      if (isChecking) return;
      
      // Throttle: só verifica a cada 200ms
      const now = Date.now();
      if (now - lastCheckTime < 200) return;
      lastCheckTime = now;
      
      if (!toolbarRef.current || !spacerRef.current) return;
      
      isChecking = true;
      
      // Aguarda um frame para garantir que o DOM foi atualizado
      requestAnimationFrame(() => {
        if (!toolbarRef.current || !spacerRef.current) {
          isChecking = false;
          return;
        }
        
        const toolbar = toolbarRef.current;
        const spacer = spacerRef.current;
        const toolbarRect = toolbar.getBoundingClientRect();
        const spacerRect = spacer.getBoundingClientRect();
        
        // Largura disponível antes do spacer (onde ficam os botões)
        const availableWidth = spacerRect.left - toolbarRect.left;
        
        // Calcula a largura necessária para os elementos fixos no final (Logs, Theme, etc.)
        let reservedWidth = 0;
        if (childrenRef.current && childrenRef.current.offsetParent !== null) {
          reservedWidth += childrenRef.current.getBoundingClientRect().width + 12;
        }
        // Espaço para o botão "Mais" se necessário (estimativa)
        const moreButtonWidth = 80;
        
        const hidden = new Set();
        let totalWidth = 0;
        
        // Calcula a largura do grupo inicial (Novo Fluxo, Abrir, etc.)
        const initialGroup = toolbar.querySelector('[class*="flex items-center gap-2"]');
        if (initialGroup && initialGroup.offsetParent !== null) {
          totalWidth += initialGroup.getBoundingClientRect().width + 12; // + gap
        }
        
        // Calcula a largura total dos elementos principais (sempre visíveis)
        const mainGroup = toolbar.querySelector('[data-main-group]');
        if (mainGroup && mainGroup.offsetParent !== null) {
          totalWidth += mainGroup.getBoundingClientRect().width + 12; // + gap
        }
        
        // Conta separadores visíveis ANTES do spacer
        const separators = toolbar.querySelectorAll('.w-px.h-8');
        separators.forEach(sep => {
          const sepRect = sep.getBoundingClientRect();
          if (sep.offsetParent !== null && sepRect.left < spacerRect.left) {
            totalWidth += sepRect.width + 12; // + gap
          }
        });
        
        // Itens secundários que podem ser movidos para o menu (em ordem de prioridade)
        const secondaryItems = [
          { key: 'undo', ref: itemsRef.current.undo },
          { key: 'redo', ref: itemsRef.current.redo },
          { key: 'copy', ref: itemsRef.current.copy },
          { key: 'paste', ref: itemsRef.current.paste },
          { key: 'duplicate', ref: itemsRef.current.duplicate },
          { key: 'zoom', ref: itemsRef.current.zoom },
          { key: 'align', ref: itemsRef.current.align },
          { key: 'search', ref: itemsRef.current.search },
          { key: 'center', ref: itemsRef.current.center },
          { key: 'zoomFit', ref: itemsRef.current.zoomFit },
        ];
        
        // Primeiro, verifica se todos os itens cabem SEM o botão "Mais"
        let tempTotalWidth = totalWidth;
        let wouldNeedMore = false;
        
        for (const item of secondaryItems) {
          if (item.ref && item.ref.offsetParent !== null) {
            const itemRect = item.ref.getBoundingClientRect();
            const itemWidth = itemRect.width;
            
            // Verifica se este item caberia sem o botão "Mais"
            if (tempTotalWidth + itemWidth + 12 > availableWidth - reservedWidth) {
              wouldNeedMore = true;
              break;
            }
            tempTotalWidth += itemWidth + 12;
          }
        }
        
        // Se precisa do botão "Mais", adiciona ao espaço reservado
        if (wouldNeedMore) {
          reservedWidth += moreButtonWidth;
        }
        
        // Agora verifica cada item secundário considerando o espaço correto
        for (const item of secondaryItems) {
          if (item.ref && item.ref.offsetParent !== null) {
            const itemRect = item.ref.getBoundingClientRect();
            const itemWidth = itemRect.width;
            
            // Se adicionar este item ultrapassaria o espaço disponível
            if (totalWidth + itemWidth + 12 > availableWidth - reservedWidth) {
              hidden.add(item.key);
            } else {
              totalWidth += itemWidth + 12; // + gap
            }
          }
        }
        
        // Só atualiza se realmente mudou (evita loop)
        const hiddenArray = Array.from(hidden).sort();
        const currentArray = Array.from(hiddenItemsRef.current).sort();
        const hasChanged = hiddenArray.length !== currentArray.length || 
          !hiddenArray.every((val, idx) => val === currentArray[idx]);
        
        if (hasChanged) {
          hiddenItemsRef.current = hidden;
          setHiddenItems(hidden);
        }
        
        isChecking = false;
      });
    };

    // Verifica apenas no resize e após um delay inicial
    // NÃO usa MutationObserver para evitar loops infinitos
    const timeoutId = setTimeout(checkOverflow, 500);
    const resizeHandler = () => {
      clearTimeout(timeoutId);
      setTimeout(checkOverflow, 200);
    };
    window.addEventListener('resize', resizeHandler);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', resizeHandler);
    };
  }, [onUndo, onRedo, onCopy, onPaste, onDuplicate, onZoomIn, onAlignLeft, onSearchNode, onCenterCanvas, onZoomFit]);

  // Determina quais itens mostrar na toolbar vs menu
  const showInToolbar = (key) => !hiddenItems.has(key);
  
  return (
    <div 
      ref={toolbarRef}
      className="flex gap-3 px-4 py-3 border-b border-border-default bg-gradient-to-r from-bg-secondary via-bg-secondary to-bg-tertiary items-center min-h-[64px] backdrop-blur-sm shadow-sm overflow-hidden"
    >
      {/* GRUPO INICIAL - Novo Fluxo e Abrir (primeiro child) */}
      {children && (
        <>
          {React.Children.toArray(children)[0]}
          <div className="w-px h-8 bg-border-default/50"></div>
        </>
      )}

      {/* GRUPO PRINCIPAL - Recursos Essenciais */}
      <div className="flex gap-2 items-center px-3 py-1.5 bg-bg-elevated/50 rounded-lg border border-border-default/50" data-main-group>
        {onSave && (
          <Button variant="primary" size="sm" onClick={onSave} title="Salvar fluxo (Ctrl+S)" className="font-semibold">
            💾 Salvar
          </Button>
        )}
        {onValidate && (
          <Button variant="ghost" size="sm" onClick={onValidate} title="Validar fluxo" className="border border-border-default">
            ✓ Validar
          </Button>
        )}
        {onSimulate && (
          <Button variant="primary" size="sm" onClick={onSimulate} title="Simular fluxo" className="font-semibold">
            ▶️ Simular
          </Button>
        )}
        {onArrange && (
          <Button variant="ghost" size="sm" onClick={onArrange} title="Organizar nós automaticamente" className="border border-border-default">
            📐 Organizar
          </Button>
        )}
      </div>

      {/* Separador */}
      <div className="w-px h-8 bg-border-default/50"></div>

      {/* GRUPO DE EDIÇÃO - Undo/Redo/Copy/Paste */}
      {(onUndo || onRedo || onCopy || onPaste || onDuplicate) && (
        <div className="flex gap-1.5 items-center" ref={(el) => { if (el) itemsRef.current.edition = el; }}>
          {onUndo && (
            <Button 
              ref={(el) => { if (el) itemsRef.current.undo = el; }} 
              variant="ghost" 
              size="sm" 
              onClick={onUndo} 
              title="Desfazer (Ctrl+Z)" 
              className="px-2"
              style={{ display: showInToolbar('undo') ? 'inline-flex' : 'none' }}
            >
              ↶
            </Button>
          )}
          {onRedo && (
            <Button 
              ref={(el) => { if (el) itemsRef.current.redo = el; }} 
              variant="ghost" 
              size="sm" 
              onClick={onRedo} 
              title="Refazer (Ctrl+Y)" 
              className="px-2"
              style={{ display: showInToolbar('redo') ? 'inline-flex' : 'none' }}
            >
              ↷
            </Button>
          )}
          {(onCopy || onPaste || onDuplicate) && (
            <>
              <div className="w-px h-6 bg-border-default/30 mx-1" style={{ display: showInToolbar('copy') ? 'block' : 'none' }}></div>
              {onCopy && (
                <Button 
                  ref={(el) => { if (el) itemsRef.current.copy = el; }} 
                  variant="ghost" 
                  size="sm" 
                  onClick={onCopy} 
                  title="Copiar (Ctrl+C)" 
                  className="px-2"
                  style={{ display: showInToolbar('copy') ? 'inline-flex' : 'none' }}
                >
                  📋
                </Button>
              )}
              {onPaste && (
                <Button 
                  ref={(el) => { if (el) itemsRef.current.paste = el; }} 
                  variant="ghost" 
                  size="sm" 
                  onClick={onPaste} 
                  title="Colar (Ctrl+V)" 
                  className="px-2"
                  style={{ display: showInToolbar('paste') ? 'inline-flex' : 'none' }}
                >
                  📄
                </Button>
              )}
              {onDuplicate && (
                <Button 
                  ref={(el) => { if (el) itemsRef.current.duplicate = el; }} 
                  variant="ghost" 
                  size="sm" 
                  onClick={onDuplicate} 
                  title="Duplicar" 
                  className="px-2"
                  style={{ display: showInToolbar('duplicate') ? 'inline-flex' : 'none' }}
                >
                  📑
        </Button>
      )}
            </>
          )}
        </div>
      )}
      
      {/* Separador para edição */}
      {(onUndo || onRedo || onCopy || onPaste || onDuplicate) && (showInToolbar('undo') || showInToolbar('redo') || showInToolbar('copy')) && (
        <div className="w-px h-8 bg-border-default/50"></div>
      )}

      {/* Separador */}
      <div className="w-px h-8 bg-border-default/50"></div>

      {/* GRUPO DE VISUALIZAÇÃO - Zoom */}
      {(onZoomIn || onZoomOut || onZoomFit || onResetZoom || onCenterCanvas) && (
        <div className="flex gap-1 items-center px-2 py-1 bg-bg-elevated/30 rounded-md" ref={(el) => { if (el) itemsRef.current.zoom = el; }}>
        {onZoomOut && (
          <Button variant="ghost" size="sm" onClick={onZoomOut} title="Zoom Out (-)" className="px-2 text-xs">
            −
          </Button>
        )}
        {onResetZoom && (
          <span className="text-xs text-text-secondary px-2 min-w-[3rem] text-center" title={`Zoom: ${Math.round((currentZoom || 1) * 100)}%`}>
            {Math.round((currentZoom || 1) * 100)}%
          </span>
        )}
        {onZoomIn && (
          <Button variant="ghost" size="sm" onClick={onZoomIn} title="Zoom In (+)" className="px-2 text-xs">
            +
          </Button>
        )}
        {onZoomFit && (
          <Button 
            ref={(el) => { if (el) itemsRef.current.zoomFit = el; }} 
            variant="ghost" 
            size="sm" 
            onClick={onZoomFit} 
            title="Ajustar zoom" 
            className="px-2 text-xs"
            style={{ display: showInToolbar('zoomFit') ? 'inline-flex' : 'none' }}
          >
            Fit
          </Button>
        )}
        {onCenterCanvas && (
          <Button 
            ref={(el) => { if (el) itemsRef.current.center = el; }} 
            variant="ghost" 
            size="sm" 
            onClick={onCenterCanvas} 
            title="Centralizar" 
            className="px-2 text-xs"
            style={{ display: showInToolbar('center') ? 'inline-flex' : 'none' }}
          >
            🎯
        </Button>
      )}
        </div>
      )}

      {/* Separador */}
      {(onZoomIn || onZoomOut || onZoomFit || onResetZoom || onCenterCanvas) && (showInToolbar('zoom') || showInToolbar('center') || showInToolbar('zoomFit')) && (
        <div className="w-px h-8 bg-border-default/50"></div>
      )}

      {/* GRUPO DE ALINHAMENTO - Compacto */}
      {(onAlignLeft || onAlignCenter || onAlignRight || onAlignTop || onAlignMiddle || onAlignBottom) && (
        <div className="flex gap-1 items-center px-2 py-1 bg-bg-elevated/30 rounded-md" ref={(el) => { if (el) itemsRef.current.align = el; }} style={{ display: showInToolbar('align') ? 'flex' : 'none' }}>
          <span className="text-xs text-text-tertiary mr-1">Alinhar:</span>
          <div className="flex gap-0.5">
            {onAlignLeft && (
              <Button variant="ghost" size="sm" onClick={onAlignLeft} title="Alinhar à esquerda" className="px-1.5 text-xs">
                ⬅️
              </Button>
            )}
            {onAlignCenter && (
              <Button variant="ghost" size="sm" onClick={onAlignCenter} title="Alinhar ao centro" className="px-1.5 text-xs">
                ↔️
              </Button>
            )}
            {onAlignRight && (
              <Button variant="ghost" size="sm" onClick={onAlignRight} title="Alinhar à direita" className="px-1.5 text-xs">
                ➡️
              </Button>
            )}
          </div>
          <div className="w-px h-4 bg-border-default/30 mx-1"></div>
          <div className="flex gap-0.5">
            {onAlignTop && (
              <Button variant="ghost" size="sm" onClick={onAlignTop} title="Alinhar ao topo" className="px-1.5 text-xs">
                ⬆️
              </Button>
            )}
            {onAlignMiddle && (
              <Button variant="ghost" size="sm" onClick={onAlignMiddle} title="Alinhar ao meio" className="px-1.5 text-xs">
                ↕️
              </Button>
            )}
            {onAlignBottom && (
              <Button variant="ghost" size="sm" onClick={onAlignBottom} title="Alinhar à base" className="px-1.5 text-xs">
                ⬇️
        </Button>
      )}
          </div>
        </div>
      )}

      {/* GRUPO DE NAVEGAÇÃO - Busca */}
      {onSearchNode && (
        <div className="flex gap-1 items-center" ref={(el) => { if (el) itemsRef.current.search = el; }} style={{ display: showInToolbar('search') ? 'flex' : 'none' }}>
          {showSearch ? (
            <form onSubmit={handleSearchSubmit} className="flex gap-1 items-center">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar nó..."
                className="w-40 h-7 text-xs"
                autoFocus
                onBlur={() => setTimeout(() => setShowSearch(false), 200)}
              />
              <Button variant="ghost" size="sm" type="submit" className="px-2">🔍</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowSearch(false)} className="px-2">✕</Button>
            </form>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setShowSearch(true)} title="Buscar nó (Ctrl+F)" className="px-2">
              🔍 Buscar
            </Button>
          )}
          {onNextNode && (
            <Button variant="ghost" size="sm" onClick={onNextNode} title="Próximo nó" className="px-2">
              ⏭️
            </Button>
          )}
          {onPreviousNode && (
            <Button variant="ghost" size="sm" onClick={onPreviousNode} title="Nó anterior" className="px-2">
              ⏮️
        </Button>
      )}
        </div>
      )}

      {/* Separador para navegação */}
      {onSearchNode && showInToolbar('search') && (
        <div className="w-px h-8 bg-border-default/50"></div>
      )}

      {/* Espaçador flexível */}
      <div className="flex-1" ref={spacerRef}></div>

      {/* GRUPO SECUNDÁRIO - Menu "Mais" para recursos que não cabem na tela */}
      {hiddenItems.size > 0 && (
        <div className="relative" ref={(buttonContainerRef) => {
          if (buttonContainerRef) {
            const rect = buttonContainerRef.getBoundingClientRect();
            window._moreMenuPosition = { 
              top: rect.bottom + 8, 
              right: window.innerWidth - rect.right 
            };
          }
        }}>
          <Button 
            ref={moreButtonRef}
            variant="ghost" 
            size="sm" 
            onClick={() => {
              setShowMoreMenu(!showMoreMenu);
            }}
            className="px-3 border border-border-default/50"
            title="Mais opções"
          >
            ⋯ Mais
          </Button>
          
          {showMoreMenu && typeof document !== 'undefined' && createPortal(
            <>
              <div 
                className="fixed inset-0 z-[9998]" 
                onClick={() => setShowMoreMenu(false)}
                style={{ pointerEvents: 'auto' }}
              ></div>
              <div 
                className="fixed w-64 bg-bg-elevated border border-border-default rounded-lg shadow-2xl py-2"
                style={{
                  top: window._moreMenuPosition?.top || '64px',
                  right: window._moreMenuPosition?.right || '16px',
                  zIndex: 9999,
                  pointerEvents: 'auto',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Itens de edição ocultos */}
                {((hiddenItems.has('undo') && onUndo) || (hiddenItems.has('redo') && onRedo) || 
                  (hiddenItems.has('copy') && onCopy) || (hiddenItems.has('paste') && onPaste) || 
                  (hiddenItems.has('duplicate') && onDuplicate)) && (
                  <div className="px-3 py-2 border-b border-border-default/50">
                    <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Edição</div>
                    {hiddenItems.has('undo') && onUndo && (
                      <button onClick={() => { onUndo(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ↶ Desfazer
                      </button>
                    )}
                    {hiddenItems.has('redo') && onRedo && (
                      <button onClick={() => { onRedo(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ↷ Refazer
                      </button>
                    )}
                    {hiddenItems.has('copy') && onCopy && (
                      <button onClick={() => { onCopy(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        📋 Copiar
                      </button>
                    )}
                    {hiddenItems.has('paste') && onPaste && (
                      <button onClick={() => { onPaste(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        📄 Colar
                      </button>
                    )}
                    {hiddenItems.has('duplicate') && onDuplicate && (
                      <button onClick={() => { onDuplicate(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        📑 Duplicar
                      </button>
                    )}
                  </div>
                )}

                {/* Itens de zoom ocultos */}
                {((hiddenItems.has('zoom') && (onZoomIn || onZoomOut || onZoomFit || onResetZoom)) || 
                  (hiddenItems.has('center') && onCenterCanvas)) && (
                  <div className="px-3 py-2 border-b border-border-default/50">
                    <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Visualização</div>
                    {hiddenItems.has('zoom') && onZoomOut && (
                      <button onClick={() => { onZoomOut(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        🔍− Zoom Out
                      </button>
                    )}
                    {hiddenItems.has('zoom') && onZoomIn && (
                      <button onClick={() => { onZoomIn(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        🔍+ Zoom In
                      </button>
                    )}
                    {hiddenItems.has('zoom') && onZoomFit && (
                      <button onClick={() => { onZoomFit(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        🔍 Fit Zoom
                      </button>
                    )}
                    {hiddenItems.has('zoom') && onResetZoom && (
                      <button onClick={() => { onResetZoom(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        🔍 Reset Zoom
                      </button>
                    )}
                    {hiddenItems.has('center') && onCenterCanvas && (
                      <button onClick={() => { onCenterCanvas(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        🎯 Centralizar
                      </button>
                    )}
                  </div>
                )}

                {/* Itens de alinhamento ocultos */}
                {hiddenItems.has('align') && (onAlignLeft || onAlignCenter || onAlignRight || onAlignTop || onAlignMiddle || onAlignBottom) && (
                  <div className="px-3 py-2 border-b border-border-default/50">
                    <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Alinhamento</div>
                    {onAlignLeft && (
                      <button onClick={() => { onAlignLeft(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ⬅️ Alinhar à Esquerda
                      </button>
                    )}
                    {onAlignCenter && (
                      <button onClick={() => { onAlignCenter(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ↔️ Alinhar ao Centro
                      </button>
                    )}
                    {onAlignRight && (
                      <button onClick={() => { onAlignRight(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ➡️ Alinhar à Direita
                      </button>
                    )}
                    {onAlignTop && (
                      <button onClick={() => { onAlignTop(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ⬆️ Alinhar ao Topo
                      </button>
                    )}
                    {onAlignMiddle && (
                      <button onClick={() => { onAlignMiddle(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ↕️ Alinhar ao Meio
                      </button>
                    )}
                    {onAlignBottom && (
                      <button onClick={() => { onAlignBottom(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ⬇️ Alinhar à Base
                      </button>
                    )}
                    {onDistributeHorizontal && (
                      <button onClick={() => { onDistributeHorizontal(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ⬌ Distribuir Horizontalmente
                      </button>
                    )}
                    {onDistributeVertical && (
                      <button onClick={() => { onDistributeVertical(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ⬍ Distribuir Verticalmente
                      </button>
                    )}
                  </div>
                )}

                {/* Itens de navegação ocultos */}
                {hiddenItems.has('search') && onSearchNode && (
                  <div className="px-3 py-2 border-b border-border-default/50">
                    <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Navegação</div>
                    {onSearchNode && (
                      <button onClick={() => { setShowSearch(true); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        🔍 Buscar Nó
                      </button>
                    )}
                    {onNextNode && (
                      <button onClick={() => { onNextNode(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ⏭️ Próximo Nó
                      </button>
                    )}
                    {onPreviousNode && (
                      <button onClick={() => { onPreviousNode(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                        ⏮️ Nó Anterior
                      </button>
                    )}
                  </div>
                )}

                {/* Submenu: Arquivo */}
                {(onImportJson || onExportJson || onImportTemplate) && (
                <div className="px-3 py-2 border-b border-border-default/50">
                  <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Arquivo</div>
                  {onImportJson && (
                    <button onClick={() => { onImportJson(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      📥 Importar JSON
                    </button>
                  )}
                  {onExportJson && (
                    <button onClick={() => { onExportJson(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      📤 Exportar JSON
                    </button>
                  )}
                  {onImportTemplate && (
                    <button onClick={() => { onImportTemplate(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      📋 Importar Template
                    </button>
                  )}
                </div>
              )}

              {/* Submenu: Exportação */}
              {(onExportPNG || onExportSVG || onExportPDF) && (
                <div className="px-3 py-2 border-b border-border-default/50">
                  <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Exportar Como</div>
                  {onExportPNG && (
                    <button onClick={() => { onExportPNG(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      🖼️ PNG
                    </button>
                  )}
                  {onExportSVG && (
                    <button onClick={() => { onExportSVG(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      📐 SVG
                    </button>
                  )}
                  {onExportPDF && (
                    <button onClick={() => { onExportPDF(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      📄 PDF
                    </button>
                  )}
                </div>
              )}

              {/* Submenu: Seleção */}
              {(onSelectAll || onDeselectAll) && (
                <div className="px-3 py-2 border-b border-border-default/50">
                  <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Seleção</div>
                  {onSelectAll && (
                    <button onClick={() => { onSelectAll(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      ☑️ Selecionar Tudo
                    </button>
                  )}
                  {onDeselectAll && (
                    <button onClick={() => { onDeselectAll(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      ☐ Desselecionar
                    </button>
                  )}
                </div>
              )}

              {/* Submenu: Distribuição */}
              {(onDistributeHorizontal || onDistributeVertical) && (
                <div className="px-3 py-2 border-b border-border-default/50">
                  <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Distribuir</div>
                  {onDistributeHorizontal && (
                    <button onClick={() => { onDistributeHorizontal(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      ⬌ Horizontalmente
                    </button>
                  )}
                  {onDistributeVertical && (
                    <button onClick={() => { onDistributeVertical(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      ⬍ Verticalmente
                    </button>
                  )}
                </div>
              )}

              {/* Submenu: Validação e Debug */}
              {(onValidateAndFix || onShowErrors || onToggleDebug || onShowStatistics) && (
                <div className="px-3 py-2 border-b border-border-default/50">
                  <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Validação</div>
                  {onValidateAndFix && (
                    <button onClick={() => { onValidateAndFix(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      🔧 Validar e Corrigir
                    </button>
                  )}
                  {onShowErrors && (
                    <button onClick={() => { onShowErrors(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      ⚠️ Mostrar Erros
                    </button>
                  )}
                  {onToggleDebug && (
                    <button onClick={() => { onToggleDebug(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      🐛 Modo Debug
                    </button>
                  )}
                  {onShowStatistics && (
                    <button onClick={() => { onShowStatistics(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      📊 Estatísticas
                    </button>
                  )}
                </div>
              )}

              {/* Submenu: Performance */}
              {(onOptimizeLayout || onSimplifyGraph) && (
                <div className="px-3 py-2 border-b border-border-default/50">
                  <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Performance</div>
                  {onOptimizeLayout && (
                    <button onClick={() => { onOptimizeLayout(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      ⚡ Otimizar Layout
                    </button>
                  )}
                  {onSimplifyGraph && (
                    <button onClick={() => { onSimplifyGraph(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      🧹 Simplificar Grafo
                    </button>
                  )}
                </div>
              )}

              {/* Submenu: Conexões */}
              {(onToggleReroutePoints || onClearOrphanConnections) && (
                <div className="px-3 py-2">
                  <div className="text-xs text-text-tertiary uppercase mb-2 px-2">Conexões</div>
                  {onToggleReroutePoints && (
                    <button onClick={() => { onToggleReroutePoints(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      🔀 Reroute Points
                    </button>
                  )}
                  {onClearOrphanConnections && (
                    <button onClick={() => { onClearOrphanConnections(); setShowMoreMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded">
                      🧹 Limpar Órfãs
                    </button>
                  )}
                </div>
              )}

              {/* Toggle Minimap */}
              {onToggleMinimap && (
                <div className="px-3 py-2 border-t border-border-default/50">
                  <button 
                    onClick={() => { onToggleMinimap(); setShowMoreMenu(false); }} 
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-bg-secondary rounded ${minimapVisible ? 'bg-bg-secondary' : ''}`}
                  >
                    🗺️ {minimapVisible ? 'Ocultar' : 'Mostrar'} Minimapa
                  </button>
                </div>
              )}
            </div>
          </>,
          document.body
        )}
        </div>
      )}

      {/* GRUPO FINAL - Logs e Theme */}
      <div className="flex items-center gap-3" ref={childrenRef}>
        {/* Logs e ThemeSelector (children após o primeiro) */}
        {React.Children.toArray(children).slice(1)}
      </div>
    </div>
  );
}
