import React, { useState, useRef, useEffect } from 'react';

/**
 * FlowEditorModelPage - Conversão EXATA do modelo.html para React
 * Mantém EXATAMENTE o layout, comportamento e aparência visual
 */
export function FlowEditorModelPage() {
  // Estados obrigatórios
  const [isDark, setIsDark] = useState(false);
  const [paletteWidth, setPaletteWidth] = useState(224); // w-56 = 14rem = 224px
  const [rightPanelWidth, setRightPanelWidth] = useState(288); // w-72 = 18rem = 288px
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  // Refs para elementos DOM
  const paletteRef = useRef(null);
  const rightPanelRef = useRef(null);
  const rightContentRef = useRef(null);

  // Aplicar tema dark ao documentElement
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Toggle tema
  const toggleTheme = () => {
    setIsDark(prev => !prev);
  };

  // Toggle paleta - EXATAMENTE como no modelo
  const togglePalette = () => {
    setIsPaletteCollapsed(prev => !prev);
  };

  // Toggle painel direito - EXATAMENTE como no modelo
  const toggleRightPanel = () => {
    setIsRightPanelCollapsed(prev => !prev);
  };

  // Aplicar largura quando colapsado/expandido
  useEffect(() => {
    if (paletteRef.current) {
      if (isPaletteCollapsed) {
        paletteRef.current.style.width = '48px';
      } else {
        paletteRef.current.style.width = '';
      }
    }
  }, [isPaletteCollapsed]);

  useEffect(() => {
    if (rightPanelRef.current) {
      if (isRightPanelCollapsed) {
        rightPanelRef.current.style.width = '48px';
      } else {
        rightPanelRef.current.style.width = '';
      }
    }
  }, [isRightPanelCollapsed]);

  // Resize handlers - EXATAMENTE como no modelo
  const startResize = (e, direction) => {
    e.preventDefault();
    const target = direction === 'palette' ? paletteRef.current : rightPanelRef.current;
    if (!target) return;

    const startX = e.clientX;
    const startSize = target.offsetWidth;

    const resize = (e) => {
      if (!target) return;
      const deltaX = e.clientX - startX;
      let newWidth;

      if (direction === 'palette') {
        // horizontal-left: paleta cresce para a direita (delta positivo)
        newWidth = startSize + deltaX;
      } else {
        // horizontal-right: painel direito cresce para a esquerda (delta INVERTIDO)
        newWidth = startSize - deltaX;
      }

      // Limites
      if (newWidth < 48) newWidth = 48;
      if (newWidth > 800) newWidth = 800;

      target.style.width = `${newWidth}px`;
      if (direction === 'palette') {
        setPaletteWidth(newWidth);
      } else {
        setRightPanelWidth(newWidth);
      }
    };

    const stopResize = () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
    };

    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);
  };

  return (
    <div className="h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-[#e8eaed]">
      <div className="h-screen grid grid-rows-[auto_auto_1fr]">
        {/* TOOLBAR */}
        <div className="h-12 flex items-center px-2 border-b bg-white dark:bg-[#1a1a1a] dark:border-[#2a2a2a]">
          <div className="flex items-center gap-2 overflow-hidden">
            <button className="btn-base">
              <span className="icon icon-plus"></span>
              <span className="hidden md:inline">Novo</span>
            </button>
            <button className="btn-base">
              <span className="icon icon-folder-open"></span>
              <span className="hidden md:inline">Abrir</span>
            </button>
            <button className="btn-base">
              <span className="icon icon-delete"></span>
              <span className="hidden md:inline">Remover</span>
            </button>
          </div>
          <div className="flex-1"></div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98] hidden md:flex">
              📋<span>Logs</span>
            </button>
            <button className="flex items-center gap-1 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-transparent cursor-pointer transition-all duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98]" onClick={toggleTheme}>
              🌙
            </button>
          </div>
        </div>

        {/* FLUXO ATUAL */}
        <div className="h-8 px-4 flex items-center border-b bg-gray-50 dark:bg-black dark:border-[#2a2a2a] text-sm">
          Fluxo atual: <strong className="ml-1">exemplo-fluxo</strong>
        </div>

        {/* MAIN */}
        <div className="flex min-h-0">
          {/* PALETA */}
          <div
            ref={paletteRef}
            className="w-56 min-w-[48px] bg-white dark:bg-[#1a1a1a] border-r dark:border-[#2a2a2a] flex flex-col transition-all duration-200"
            style={!isPaletteCollapsed ? { width: `${paletteWidth}px` } : {}}
          >
            <div className="h-10 px-2 flex items-center justify-between border-b dark:border-[#2a2a2a]">
              <span className={isPaletteCollapsed ? 'hidden' : 'inline'}>
                Paleta
              </span>
              <button className="text-xs px-1.5 py-0.5 border border-gray-300 dark:border-gray-700 rounded bg-transparent cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={togglePalette}>
                {isPaletteCollapsed ? '▶' : '◀'}
              </button>
            </div>

            <div className="flex-1 p-2 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span>🔵</span>
                <span className={isPaletteCollapsed ? 'hidden' : 'inline'}>
                  Entrada
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>💬</span>
                <span className={isPaletteCollapsed ? 'hidden' : 'inline'}>
                  Mensagem
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>🔀</span>
                <span className={isPaletteCollapsed ? 'hidden' : 'inline'}>
                  Condição
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>🌐</span>
                <span className={isPaletteCollapsed ? 'hidden' : 'inline'}>
                  API
                </span>
              </div>
            </div>
          </div>

          {/* DIVIDER PALETA */}
          {!isPaletteCollapsed && (
            <div
              className="w-1 cursor-col-resize hover:bg-blue-400/30"
              onMouseDown={(e) => startResize(e, 'palette')}
            />
          )}

          {/* CANVAS */}
          <div className="flex-1 relative overflow-hidden bg-[#f8fafc] dark:bg-[#0b0b0b]">
            <div
              className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.05)_1px,transparent_1px)] bg-[size:20px_20px] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] dark:bg-[size:20px_20px]"
            />
            <div className="relative h-full flex items-center justify-center text-gray-400">
              Canvas (Rete.js)
            </div>
          </div>

          {/* DIVIDER DIREITA */}
          {!isRightPanelCollapsed && (
            <div
              className="w-1 cursor-col-resize hover:bg-blue-400/30"
              onMouseDown={(e) => startResize(e, 'rightPanel')}
            />
          )}

          {/* PAINEL DIREITO */}
          <div
            ref={rightPanelRef}
            className="w-72 min-w-[48px] bg-white dark:bg-[#1a1a1a] border-l dark:border-[#2a2a2a] flex flex-col transition-all duration-200"
            style={!isRightPanelCollapsed ? { width: `${rightPanelWidth}px` } : {}}
          >
            {/* HEADER */}
            <div className="h-10 px-2 flex items-center justify-end border-b dark:border-[#2a2a2a]">
              <button className="text-xs px-1.5 py-0.5 border border-gray-300 dark:border-gray-700 rounded bg-transparent cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={toggleRightPanel}>
                {isRightPanelCollapsed ? '◀' : '▶'}
              </button>
            </div>

            {/* CONTEÚDO */}
            <div
              ref={rightContentRef}
              className="flex-1 flex flex-col overflow-x-hidden"
            >
              <div
                className={`flex-1 p-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-center ${
                  isRightPanelCollapsed ? 'vertical' : ''
                }`}
              >
                Propriedades
              </div>

              <div
                className={`flex-1 p-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-center ${
                  isRightPanelCollapsed ? 'vertical' : ''
                }`}
              >
                Validação
              </div>

              <div
                className={`flex-1 p-2 flex items-center justify-center ${
                  isRightPanelCollapsed ? 'vertical' : ''
                }`}
              >
                Simulação
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CSS inline - mantido apenas .vertical que é necessário */}
      <style>{`
        .vertical {
          writing-mode: vertical-rl;
          transform: rotate(180deg);
        }
        /* Nota: .no-x-scroll, .tb-btn, .collapse-btn removidos - usar classes Tailwind diretamente */
      `}</style>
    </div>
  );
}

