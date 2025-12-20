import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { listFlows } from '../api/flows';

/**
 * Seletor de fluxos salvos - dropdown para carregar fluxos
 */
export function FlowSelector({ onFlowSelected, currentFlowId, refreshTrigger }) {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState(null);
  const hasLoadedRef = useRef(false);

  const loadingRef = useRef(false);
  
  const loadFlows = useCallback(async () => {
    if (loadingRef.current) return; // Evita múltiplas chamadas simultâneas
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const flowsList = await listFlows();
      const flowsArray = Array.isArray(flowsList) ? flowsList : [];
      setFlows(flowsArray);
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err.message || 'Erro ao carregar fluxos');
      setFlows([]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !hasLoadedRef.current && !loading) {
      // Carrega apenas na primeira vez que abre
      loadFlows();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Carrega apenas quando isOpen muda, evitando loop

  // Recarrega quando o currentFlowId muda para null (fluxo foi deletado)
  const prevFlowIdRef = useRef(currentFlowId);
  useEffect(() => {
    const prevFlowId = prevFlowIdRef.current;
    // Se tinha um fluxo selecionado e agora não tem mais, recarrega a lista
    if (prevFlowId && !currentFlowId) {
      hasLoadedRef.current = false;
      // Força recarregamento na próxima vez que abrir
    }
    prevFlowIdRef.current = currentFlowId;
  }, [currentFlowId]);

  // Recarrega quando refreshTrigger muda (notificação externa de atualização)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger !== null && refreshTrigger > 0) {
      hasLoadedRef.current = false;
      // Força recarregamento na próxima vez que abrir
      // Se já estiver aberto, recarrega imediatamente
      if (isOpen) {
        loadFlows();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger, isOpen]);

  // Fechar dropdown ao clicar fora é feito pelo overlay do Portal

  const handleSelect = (flow) => {
    setIsOpen(false);
    if (onFlowSelected) {
      onFlowSelected(flow);
    }
  };

  const handleFlowClick = (e, flow) => {
    e.stopPropagation();
    e.preventDefault();
    handleSelect(flow);
  };

  const currentFlow = flows.find((f) => f.id === currentFlowId);


  const containerRef = React.useRef(null);
  const [dropdownPosition, setDropdownPosition] = React.useState({ top: 0, left: 0 });

  React.useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
  }, [isOpen]);

  return (
    <>
      <div ref={containerRef} className="relative inline-block flow-selector-container">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const newIsOpen = !isOpen;
            setIsOpen(newIsOpen);
            if (newIsOpen && !hasLoadedRef.current && !loading) {
              loadFlows();
            }
          }}
          className="px-3 py-1.5 bg-bg-tertiary border border-border-default rounded-md cursor-pointer text-sm text-text-primary transition-all duration-fast font-medium hover:bg-bg-hover hover:border-border-hover hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          title={currentFlow ? `Fluxo atual: ${currentFlow.name || currentFlow.id}` : 'Abrir fluxo salvo'}
        >
          📂 Abrir
        </button>
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[150]"
            onClick={() => setIsOpen(false)}
          />
          <div
            className="fixed min-w-[300px] max-w-[400px] max-h-[400px] bg-gradient-to-br from-bg-elevated to-bg-tertiary border border-border-default rounded-lg shadow-2xl z-[200] overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              minHeight: '200px',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              pointerEvents: 'auto',
            }}
          >
            <div className="px-3 py-2.5 border-b border-border-default flex justify-between items-center bg-bg-secondary/50 flex-shrink-0">
              <span className="text-xs font-medium text-text-primary">
                Fluxos salvos
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  hasLoadedRef.current = false; // Permite recarregar
                  loadFlows();
                }}
                className="px-2 py-1 text-[11px] bg-transparent border border-border-default rounded text-text-secondary cursor-pointer transition-all duration-fast hover:bg-bg-tertiary hover:border-border-hover hover:text-text-primary"
              >
                🔄 Atualizar
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 p-1 scrollbar-thin scrollbar-thumb-border-default scrollbar-track-transparent">
              {loading && (
                <div className="p-4 text-center text-text-secondary text-xs animate-pulse">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
                    <span>Carregando fluxos...</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-4 text-center text-status-error text-xs space-y-2">
                  <div className="font-medium">Erro ao carregar fluxos</div>
                  <div className="text-[10px] text-text-tertiary">{error}</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      loadFlows();
                    }}
                    className="mt-2 px-3 py-1.5 text-[11px] bg-status-error/20 border border-status-error rounded text-status-error hover:bg-status-error/30 transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {!loading && !error && flows.length === 0 && (
                <div className="p-4 text-center text-text-tertiary text-xs space-y-2">
                  <div>Nenhum fluxo salvo</div>
                  <div className="text-[10px] text-text-tertiary">
                    Crie um novo fluxo usando o botão "+ Novo Fluxo"
                  </div>
                </div>
              )}

              {!loading && !error && flows.length > 0 && (
                <>
                  <div className="text-[10px] text-text-tertiary px-2 py-1.5 border-b border-border-default/50 bg-bg-secondary/30 flex-shrink-0">
                    {flows.length} {flows.length === 1 ? 'fluxo encontrado' : 'fluxos encontrados'}
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {flows.map((flow) => (
                      <div
                        key={flow.id}
                        onClick={(e) => handleFlowClick(e, flow)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`p-2.5 mx-1 my-1 rounded cursor-pointer transition-all duration-fast ${
                          currentFlowId === flow.id
                            ? 'bg-accent-light border border-accent-primary shadow-md'
                            : 'bg-transparent border border-transparent hover:bg-bg-tertiary hover:border-border-default'
                        }`}
                        style={{ pointerEvents: 'auto' }}
                      >
                        <div className="font-medium text-text-primary text-sm mb-1 truncate">
                          {flow.name || flow.id}
                        </div>
                        <div className="text-[11px] text-text-tertiary font-mono">
                          ID: {flow.id} {flow.version ? `v${flow.version}` : ''}
                        </div>
                        {flow.nodes && flow.nodes.length > 0 && (
                          <div className="text-[10px] text-text-tertiary mt-1">
                            {flow.nodes.length} {flow.nodes.length === 1 ? 'nó' : 'nós'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

