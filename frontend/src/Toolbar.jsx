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
  onExportPNG,
  onExportSVG,
  onExportPDF,
  onSimulate,
  onTest,
  onSave,
  onSaveAsTemplate,
  onValidate,
  onValidateAndFix,
  onShowErrors,
  onArrange,
  onOptimizeLayout,
  onSimplifyGraph,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onResetZoom,
  onCenterCanvas,
  onToggleMinimap,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDuplicate,
  onSelectAll,
  onDeselectAll,
  onAlignLeft,
  onAlignCenter,
  onAlignRight,
  onAlignTop,
  onAlignMiddle,
  onAlignBottom,
  onDistributeHorizontal,
  onDistributeVertical,
  onToggleReroutePoints,
  onClearOrphanConnections,
  onSearchNode,
  onGoToNode,
  onNextNode,
  onPreviousNode,
  onToggleDebug,
  onShowStatistics,
  onImportTemplate,
  onOpen,
  onClearEditor,
  children,
}) {
  const { themeName } = useTheme();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  
  // Estado para controlar quais grupos estão visíveis na toolbar
  const [visibleItems, setVisibleItems] = useState({
    file: true,       // Novo, Abrir (FlowSelector), Remover, Salvar
    main: true,      // Validar, Simular
    zoom: true,      // Zoom controls
    edit: true,      // Undo, Redo, Copy, Paste, Duplicar, Organizar
    search: true,     // Buscar
    extra: true,      // Importar, Exportar, Template
    tools: true,      // Tema e outros (prioridade maior que extra)
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
          const separators = toolbar.querySelectorAll('.toolbar-separator');
          
          // Calcula largura dos elementos fixos
          // NOTA: spacer NÃO é incluído porque é flex: 1 (ocupa espaço restante dinamicamente)
          let fixedWidth = TAILWIND_PX_2 * 2; // padding da toolbar (px-2 = 8px * 2)
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
          const fileGroup = toolbar.querySelector('.toolbar-group-file');
          const mainGroup = toolbar.querySelector('.toolbar-group-main');
          const zoomGroup = toolbar.querySelector('.toolbar-group-zoom');
          const editGroup = toolbar.querySelector('.toolbar-group-edit');
          const searchGroup = toolbar.querySelector('.toolbar-group-search');
          const extraGroup = toolbar.querySelector('.toolbar-group-extra');
          const toolsGroup = toolbar.querySelector('.toolbar-group-utils');
          
          // Ordem de prioridade: tools > file > main > search > zoom > edit > extra (extra contém Logs)
          let usedWidth = 0;
          const newVisible = { file: true, main: true, zoom: true, edit: true, search: true, extra: true, tools: true };
          
          // Temporariamente mostra todos os grupos para medir
          const groups = [toolsGroup, fileGroup, mainGroup, searchGroup, zoomGroup, editGroup, extraGroup].filter(Boolean);
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
          
          // Tools group (prioridade máxima - Tema e outros) - primeiro na toolbar
          if (toolsGroup) {
            const width = toolsGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.tools = false;
            }
          }
          
          // File group (prioridade alta - Novo, Abrir, Remover, Salvar)
          if (fileGroup && newVisible.tools) {
            const width = fileGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.file = false;
            }
          }
          
          // Main group (Validar, Simular)
          if (mainGroup && newVisible.tools && newVisible.file) {
            const width = mainGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.main = false;
            }
          }
          
          // Search group
          if (searchGroup && newVisible.tools && newVisible.file) {
            const width = searchGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.search = false;
            }
          }
          
          // Zoom group
          if (zoomGroup && newVisible.tools && newVisible.file) {
            const width = zoomGroup.offsetWidth + TAILWIND_PX_2; // gap-2
            if (usedWidth + width <= availableForGroups) {
              usedWidth += width;
            } else {
              newVisible.zoom = false;
            }
          }
          
          // Edit group - com histerese para evitar alternância
          if (editGroup && newVisible.tools && newVisible.file) {
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
          
          // Extra group (Importar, Exportar, Template, Logs) - menor prioridade, com histerese para evitar alternância
          if (extraGroup && newVisible.tools && newVisible.file) {
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
              prev.file !== newVisible.file ||
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
    }, [onSave, onSaveAsTemplate, onValidate, onSimulate, onTest, onOpen, onArrange, onZoomOut, onZoomIn, onZoomFit, onResetZoom, onUndo, onRedo, onCopy, onPaste, onSearchNode, onImportJson, onExportJson, onImportTemplate, onDuplicate]);

  // Função helper para obter ícone e texto baseado na key
  const getIconAndText = (key) => {
    const iconMap = {
      'import': { icon: 'icon-import', text: 'Importar' },
      'export': { icon: 'icon-export', text: 'Exportar' },
      'template': { icon: 'icon-template', text: 'Template' },
      'open': { icon: 'icon-folder-open', text: 'Abrir' },
      'save': { icon: 'icon-save', text: 'Salvar' },
      'saveAsTemplate': { icon: 'icon-save', text: 'Template' },
      'validate': { icon: 'icon-check', text: 'Validar' },
      'validateAndFix': { icon: 'icon-check', text: 'Validar e corrigir' },
      'showErrors': { icon: 'icon-check', text: 'Mostrar erros' },
      'simulate': { icon: 'icon-play', text: 'Simular' },
      'test': { icon: 'icon-chat', text: 'Testar' },
      'zoomOut': { icon: 'icon-minus', text: 'Diminuir zoom' },
      'resetZoom': { icon: null, text: '100% Zoom' },
      'zoomIn': { icon: 'icon-plus', text: 'Aumentar zoom' },
      'zoomFit': { icon: 'icon-search', text: 'Fit' },
      'centerCanvas': { icon: 'icon-search', text: 'Centralizar canvas' },
      'toggleMinimap': { icon: 'icon-settings', text: 'Alternar minimap' },
      'undo': { icon: 'icon-undo', text: 'Desfazer' },
      'redo': { icon: 'icon-redo', text: 'Refazer' },
      'copy': { icon: 'icon-copy', text: 'Copiar' },
      'paste': { icon: 'icon-paste', text: 'Colar' },
      'duplicate': { icon: 'icon-duplicate', text: 'Duplicar' },
      'arrange': { icon: 'icon-settings', text: 'Organizar' },
      'optimizeLayout': { icon: 'icon-settings', text: 'Otimizar layout' },
      'simplify': { icon: 'icon-settings', text: 'Simplificar grafo' },
      'selectAll': { icon: 'icon-check', text: 'Selecionar tudo' },
      'deselectAll': { icon: 'icon-check', text: 'Limpar seleção' },
      'alignLeft': { icon: 'icon-settings', text: 'Alinhar esquerda' },
      'alignCenter': { icon: 'icon-settings', text: 'Alinhar centro' },
      'alignRight': { icon: 'icon-settings', text: 'Alinhar direita' },
      'alignTop': { icon: 'icon-settings', text: 'Alinhar topo' },
      'alignMiddle': { icon: 'icon-settings', text: 'Alinhar meio' },
      'alignBottom': { icon: 'icon-settings', text: 'Alinhar base' },
      'distributeHorizontal': { icon: 'icon-settings', text: 'Distribuir horizontal' },
      'distributeVertical': { icon: 'icon-settings', text: 'Distribuir vertical' },
      'toggleReroute': { icon: 'icon-settings', text: 'Alternar reroute' },
      'clearOrphans': { icon: 'icon-trash', text: 'Limpar conexões órfãs' },
      'search': { icon: 'icon-search', text: 'Buscar' },
      'goTo': { icon: 'icon-search', text: 'Ir para nó' },
      'nextNode': { icon: 'icon-plus', text: 'Próximo nó' },
      'previousNode': { icon: 'icon-minus', text: 'Nó anterior' },
      'toggleDebug': { icon: 'icon-settings', text: 'Alternar debug' },
      'showStatistics': { icon: 'icon-settings', text: 'Estatísticas' },
      'clear': { icon: 'icon-trash', text: 'Limpar' },
      'exportPng': { icon: 'icon-export', text: 'Exportar PNG' },
      'exportSvg': { icon: 'icon-export', text: 'Exportar SVG' },
      'exportPdf': { icon: 'icon-export', text: 'Exportar PDF' },
    };
    return iconMap[key] || { icon: null, text: key };
  };

  // Função para determinar quais itens vão para o menu "Mais" (agrupados por grupo)
  const getMoreMenuItems = () => {
    const groups = {
      file: [],
      main: [],
      extra: [],
      zoom: [],
      edit: [],
      search: []
    };
    
    // Itens do grupo file (Novo, Abrir via FlowSelector, Remover, Salvar, Template)
    if (!visibleItems.file) {
      // Novo está em children[0], não precisa adicionar aqui
      // Abrir está no FlowSelector (children[1]), não precisa adicionar aqui
      if (onSave) groups.file.push({ key: 'save', action: onSave });
      if (onSaveAsTemplate) groups.file.push({ key: 'saveAsTemplate', action: onSaveAsTemplate, text: 'Template' });
    }
    
    // Itens do grupo main (Validar, Simular, Testar)
    if (!visibleItems.main) {
      if (onValidate) groups.main.push({ key: 'validate', action: onValidate });
      if (onSimulate) groups.main.push({ key: 'simulate', action: onSimulate });
      if (onTest) groups.main.push({ key: 'test', action: onTest });
    }
    
    // Itens do grupo extra (Importar, Exportar, Template)
    if (!visibleItems.extra) {
      if (onImportJson) groups.extra.push({ key: 'import', action: onImportJson });
      if (onExportJson) groups.extra.push({ key: 'export', action: onExportJson });
      if (onImportTemplate) groups.extra.push({ key: 'template', action: onImportTemplate });
    }
    
    // Itens do grupo zoom
    if (!visibleItems.zoom) {
      if (onZoomOut) groups.zoom.push({ key: 'zoomOut', action: onZoomOut });
      if (onResetZoom) groups.zoom.push({ key: 'resetZoom', action: onResetZoom });
      if (onZoomIn) groups.zoom.push({ key: 'zoomIn', action: onZoomIn });
      if (onZoomFit) groups.zoom.push({ key: 'zoomFit', action: onZoomFit });
    }
    
    // Itens do grupo edit
    if (!visibleItems.edit) {
      if (onUndo) groups.edit.push({ key: 'undo', action: onUndo });
      if (onRedo) groups.edit.push({ key: 'redo', action: onRedo });
      if (onCopy) groups.edit.push({ key: 'copy', action: onCopy });
      if (onPaste) groups.edit.push({ key: 'paste', action: onPaste });
      if (onDuplicate) groups.edit.push({ key: 'duplicate', action: onDuplicate });
      if (onArrange) groups.edit.push({ key: 'arrange', action: onArrange });
      if (onClearEditor) groups.edit.push({ key: 'clear', action: onClearEditor });
    }
    
    // Itens do grupo search
    if (!visibleItems.search && onSearchNode) {
      groups.search.push({ key: 'search', action: () => setShowSearch(true) });
    }

    // Ações avançadas sempre disponíveis pelo menu "Mais"
    if (onValidateAndFix) groups.main.push({ key: 'validateAndFix', action: onValidateAndFix });
    if (onShowErrors) groups.main.push({ key: 'showErrors', action: onShowErrors });
    if (onToggleDebug) groups.main.push({ key: 'toggleDebug', action: onToggleDebug });
    if (onShowStatistics) groups.main.push({ key: 'showStatistics', action: onShowStatistics });

    if (onCenterCanvas) groups.zoom.push({ key: 'centerCanvas', action: onCenterCanvas });
    if (onToggleMinimap) groups.zoom.push({ key: 'toggleMinimap', action: onToggleMinimap });

    if (onSelectAll) groups.edit.push({ key: 'selectAll', action: onSelectAll });
    if (onDeselectAll) groups.edit.push({ key: 'deselectAll', action: onDeselectAll });
    if (onAlignLeft) groups.edit.push({ key: 'alignLeft', action: onAlignLeft });
    if (onAlignCenter) groups.edit.push({ key: 'alignCenter', action: onAlignCenter });
    if (onAlignRight) groups.edit.push({ key: 'alignRight', action: onAlignRight });
    if (onAlignTop) groups.edit.push({ key: 'alignTop', action: onAlignTop });
    if (onAlignMiddle) groups.edit.push({ key: 'alignMiddle', action: onAlignMiddle });
    if (onAlignBottom) groups.edit.push({ key: 'alignBottom', action: onAlignBottom });
    if (onDistributeHorizontal) groups.edit.push({ key: 'distributeHorizontal', action: onDistributeHorizontal });
    if (onDistributeVertical) groups.edit.push({ key: 'distributeVertical', action: onDistributeVertical });
    if (onToggleReroutePoints) groups.edit.push({ key: 'toggleReroute', action: onToggleReroutePoints });
    if (onClearOrphanConnections) groups.edit.push({ key: 'clearOrphans', action: onClearOrphanConnections });
    if (onOptimizeLayout) groups.edit.push({ key: 'optimizeLayout', action: onOptimizeLayout });
    if (onSimplifyGraph) groups.edit.push({ key: 'simplify', action: onSimplifyGraph });

    if (onGoToNode) groups.search.push({ key: 'goTo', action: onGoToNode });
    if (onNextNode) groups.search.push({ key: 'nextNode', action: onNextNode });
    if (onPreviousNode) groups.search.push({ key: 'previousNode', action: onPreviousNode });

    if (onExportPNG) groups.extra.push({ key: 'exportPng', action: onExportPNG });
    if (onExportSVG) groups.extra.push({ key: 'exportSvg', action: onExportSVG });
    if (onExportPDF) groups.extra.push({ key: 'exportPdf', action: onExportPDF });
    
    // Retorna grupos na ordem de prioridade: file > main > search > zoom > edit > tools > extra
    return {
      file: groups.file,
      main: groups.main,
      extra: groups.extra,
      zoom: groups.zoom,
      edit: groups.edit,
      search: groups.search
    };
  };

  const moreMenuGroups = getMoreMenuItems();
  const hasMoreItems = Object.values(moreMenuGroups).some(group => group.length > 0);
  
  // Nomes dos grupos para exibição
  const groupNames = {
    file: 'Arquivo',
    main: 'Fluxo',
    extra: 'Importar/Exportar',
    zoom: 'Zoom',
    edit: 'Editar',
    search: 'Buscar'
  };
  
  // Separa os children em grupos
  const childrenArray = children ? React.Children.toArray(children) : [];
  
  // Identifica o botão de Logs (verifica se tem icon-logs ou texto "Logs")
  const logsButton = childrenArray.find(child => {
    if (!React.isValidElement(child)) return false;
    
    // Verifica se é um botão com icon-logs
    const childChildren = React.Children.toArray(child.props?.children || []);
    const hasLogsIcon = childChildren.some(c => 
      React.isValidElement(c) && 
      (c.props?.className?.includes('icon-logs') || 
       (typeof c.props?.children === 'string' && c.props.children.includes('Logs')))
    );
    
    // Verifica se o texto do botão contém "Logs"
    const hasLogsText = childChildren.some(c => 
      (typeof c === 'string' && c.includes('Logs')) ||
      (React.isValidElement(c) && typeof c.props?.children === 'string' && c.props.children.includes('Logs'))
    );
    
    return hasLogsIcon || hasLogsText;
  });
  
  // Identifica os botões de navegação (Atendimento, Manutenção, Configuração)
  const navigationButtons = childrenArray.filter(child => {
    if (!React.isValidElement(child)) return false;
    
    // Verifica se é um NavigationLink ou botão com texto de navegação
    const childChildren = React.Children.toArray(child.props?.children || []);
    const navigationTexts = ['Atendimento', 'Manutenção', 'Configuração'];
    
    const hasNavigationText = childChildren.some(c => {
      if (typeof c === 'string') {
        return navigationTexts.some(text => c.includes(text));
      }
      if (React.isValidElement(c) && typeof c.props?.children === 'string') {
        return navigationTexts.some(text => c.props.children.includes(text));
      }
      return false;
    });
    
    // Verifica se é um NavigationLink com to="/support", "/maintenance" ou "/config"
    const isNavigationLink = child.props?.to && 
      (child.props.to === '/support' || child.props.to === '/maintenance' || child.props.to === '/config');
    
    return hasNavigationText || isNavigationLink;
  });
  
  // Identifica o botão Remover (verifica se tem icon-delete ou texto "Remover")
  const removeButton = childrenArray.find(child => {
    if (!React.isValidElement(child)) return false;
    
    const childChildren = React.Children.toArray(child.props?.children || []);
    const hasDeleteIcon = childChildren.some(c => 
      React.isValidElement(c) && 
      c.props?.className?.includes('icon-delete')
    );
    
    const hasRemoveText = childChildren.some(c => 
      (typeof c === 'string' && c.includes('Remover')) ||
      (React.isValidElement(c) && typeof c.props?.children === 'string' && c.props.children.includes('Remover'))
    );
    
    return hasDeleteIcon || hasRemoveText;
  });
  
  // Identifica botões específicos de forma estável (não por índice)
  // Usa useMemo para evitar recálculos desnecessários
  const { newButton, flowSelector, generateAIButton } = React.useMemo(() => {
    const newBtn = childrenArray.find(child => {
      if (!React.isValidElement(child)) return false;
      // Verifica se é um botão (pode ser 'button' ou componente Button)
      const isButton = child.type === 'button' || 
                      child.type?.displayName === 'button' ||
                      child.props?.className?.includes('btn-base');
      
      if (isButton) {
        const childChildren = React.Children.toArray(child.props?.children || []);
        const hasPlusIcon = childChildren.some(c => 
          React.isValidElement(c) && 
          (c.props?.className?.includes('icon-plus') || c.props?.className?.includes('icon icon-plus'))
        );
        const hasNovoText = childChildren.some(c => 
          typeof c === 'string' && c.trim() === 'Novo'
        );
        return hasPlusIcon || hasNovoText;
      }
      return false;
    });
    
    const flowSel = childrenArray.find(child => {
      if (!React.isValidElement(child)) return false;
      // FlowSelector pode ser identificado pelo tipo ou pela prop onFlowSelected
      return child.props?.onFlowSelected !== undefined || 
             child.type?.name === 'FlowSelector' ||
             (child.type?.displayName && child.type.displayName.includes('FlowSelector'));
    });
    
    const genAI = childrenArray.find(child => {
      if (!React.isValidElement(child)) return false;
      // Verifica se é um botão (pode ser 'button' ou componente Button)
      const isButton = child.type === 'button' || 
                      child.type?.displayName === 'button' ||
                      child.props?.className?.includes('btn-base');
      
      if (isButton) {
        const childChildren = React.Children.toArray(child.props?.children || []);
        const hasAIIcon = childChildren.some(c => 
          React.isValidElement(c) && 
          (c.props?.className?.includes('icon-ai') || c.props?.className?.includes('icon icon-ai'))
        );
        const hasAIText = childChildren.some(c => 
          typeof c === 'string' && (c.includes('Gerar com IA') || c.trim() === 'Gerar com IA')
        );
        const hasAITitle = child.props?.title?.includes('Gerar fluxo com IA') || 
                          child.props?.title?.includes('Gerar com IA');
        return hasAIIcon || hasAIText || hasAITitle;
      }
      return false;
    });
    
    return { newButton: newBtn, flowSelector: flowSel, generateAIButton: genAI };
  }, [childrenArray]);
  
  // Ordena os botões na ordem correta: Novo, FlowSelector, Gerar com IA, Remover
  // Usa uma ordem fixa para evitar mudanças constantes
  const fileGroupChildren = React.useMemo(() => {
    const ordered = [
      newButton,
      flowSelector,
      generateAIButton,
      removeButton
    ].filter(Boolean); // Remove undefined/null
    
    // Garante que a ordem seja sempre a mesma, mesmo se alguns botões não existirem
    return ordered;
  }, [newButton, flowSelector, generateAIButton, removeButton]);

  return (
    <div ref={toolbarRef} className="toolbar">
      {visibleItems.tools && (
        <div className="toolbar-group toolbar-group-utils">
          {childrenArray.filter(child => 
            child !== logsButton && 
            !fileGroupChildren.includes(child) &&
            !navigationButtons.includes(child)
          )} {/* Tema e outros (excluindo Logs, file group e botões de navegação) */}
        </div>
      )}

      {visibleItems.tools && (visibleItems.file || visibleItems.main || visibleItems.zoom || visibleItems.edit || visibleItems.search || visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.file && (
        <div className="toolbar-group toolbar-group-file">
          {fileGroupChildren.map((child, idx) => 
            React.isValidElement(child) ? React.cloneElement(child, { key: `file-${idx}` }) : null
          )}
          {onSave && (
            <button className="btn-base" onClick={onSave} title="Salvar fluxo">
              <span className="icon icon-save"></span>
              <span>Salvar</span>
            </button>
          )}
          {onSaveAsTemplate && (
            <button className="btn-base" onClick={onSaveAsTemplate} title="Salvar fluxo como template">
              <span className="icon icon-save"></span>
              <span>Template</span>
            </button>
          )}
        </div>
      )}

      {(visibleItems.tools || visibleItems.file) && (visibleItems.main || visibleItems.zoom || visibleItems.edit || visibleItems.search || visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.main && (
        <div className="toolbar-group toolbar-group-main">
        {onValidate && (
          <button className="btn-base" onClick={onValidate} title="Validar fluxo">
            <span className="icon icon-check"></span>
            <span>Validar</span>
          </button>
        )}
        {onSimulate && (
          <button className="btn-base" onClick={onSimulate} title="Simular fluxo">
            <span className="icon icon-play"></span>
            <span>Simular</span>
          </button>
        )}
        {onTest && (
          <button className="btn-base" onClick={onTest} title="Testar fluxo no chat">
            <span className="icon icon-chat"></span>
            <span>Testar</span>
          </button>
        )}
        </div>
      )}
      
      {visibleItems.main && (visibleItems.zoom || visibleItems.edit || visibleItems.search || visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.zoom && (
        <div className="toolbar-group toolbar-group-zoom">
        {onZoomOut && (
          <button className="btn-base" onClick={onZoomOut} title="Diminuir zoom">
            <span className="icon icon-minus"></span>
          </button>
        )}
        {onResetZoom && (
          <button className="btn-base" onClick={onResetZoom} title="Zoom 100%">
            <span>100%</span>
          </button>
        )}
        {onZoomIn && (
          <button className="btn-base" onClick={onZoomIn} title="Aumentar zoom">
            <span className="icon icon-plus"></span>
          </button>
        )}
        {onZoomFit && (
          <button className="btn-base" onClick={onZoomFit} title="Ajustar zoom">
            <span className="icon icon-search"></span>
            <span>Fit</span>
          </button>
      )}
        </div>
      )}

      {visibleItems.zoom && (visibleItems.edit || visibleItems.search || visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.edit && (
        <div className="toolbar-group toolbar-group-edit">
        {onUndo && (
          <button className="btn-base" onClick={onUndo} title="Desfazer">
            <span className="icon icon-undo"></span>
          </button>
        )}
        {onRedo && (
          <button className="btn-base" onClick={onRedo} title="Refazer">
            <span className="icon icon-redo"></span>
          </button>
        )}
        {onCopy && (
          <button className="btn-base" onClick={onCopy} title="Copiar">
            <span className="icon icon-copy"></span>
          </button>
        )}
        {onPaste && (
          <button className="btn-base" onClick={onPaste} title="Colar">
            <span className="icon icon-paste"></span>
          </button>
        )}
        {onDuplicate && (
          <button className="btn-base" onClick={onDuplicate} title="Duplicar">
            <span className="icon icon-duplicate"></span>
            <span>Duplicar</span>
          </button>
        )}
        {onArrange && (
          <button className="btn-base" onClick={onArrange} title="Organizar nós">
            <span className="icon icon-settings"></span>
            <span>Organizar</span>
          </button>
        )}
        {onClearEditor && (
          <button className="btn-base" onClick={onClearEditor} title="Limpar editor">
            <span className="icon icon-trash"></span>
            <span>Limpar</span>
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
              <button className="btn-base" type="submit" title="Buscar">
                <span className="icon icon-search"></span>
              </button>
            </form>
          ) : (
            <button className="btn-base" onClick={() => setShowSearch(true)} title="Buscar nó">
              <span className="icon icon-search"></span>
              <span>Buscar</span>
            </button>
      )}
        </div>
      )}

      {visibleItems.search && (visibleItems.tools || visibleItems.extra || hasMoreItems) && <div className="toolbar-separator"></div>}

      {visibleItems.extra && (
        <div className="toolbar-group toolbar-group-extra">
          {onImportJson && (
            <button className="btn-base" onClick={onImportJson} title="Importar JSON/BPMN">
              <span className="icon icon-import"></span>
              <span>Importar</span>
            </button>
          )}
          {onExportJson && (
            <button className="btn-base" onClick={onExportJson} title="Exportar JSON">
              <span className="icon icon-export"></span>
              <span>Exportar</span>
            </button>
          )}
          {onImportTemplate && (
            <button className="btn-base" onClick={onImportTemplate} title="Importar Template">
              <span className="icon icon-template"></span>
              <span>Template</span>
            </button>
          )}
          {logsButton} {/* Logs */}
          {navigationButtons} {/* Atendimento, Manutenção, Configuração */}
        </div>
      )}

      {visibleItems.extra && hasMoreItems && <div className="toolbar-separator"></div>}

      {visibleItems.extra && hasMoreItems && <div className="toolbar-separator"></div>}

      <div className="toolbar-spacer"></div>

      {hasMoreItems && (
        <div className="toolbar-group toolbar-group-more toolbar-more-container">
          <button
            className="btn-base"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            title="Mais opções"
          >
            <span>⋯</span>
            <span>Mais</span>
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
                    <span>✕</span>
                  </button>
                </div>
                <div className="toolbar-more-content">
                  {Object.entries(moreMenuGroups).map(([groupKey, items]) => {
                    if (items.length === 0) return null;
                    
                    return (
                      <div key={groupKey} className="toolbar-more-group">
                        <div className="toolbar-more-group-header">
                          {groupNames[groupKey]}
                        </div>
                        {items.map((item) => {
                          const { icon, text } = getIconAndText(item.key);
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => {
                                item.action();
                                setShowMoreMenu(false);
                              }}
                              className="toolbar-more-item"
                            >
                              {icon && <span className={`icon ${icon}`}></span>}
                              <span>{text}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
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
