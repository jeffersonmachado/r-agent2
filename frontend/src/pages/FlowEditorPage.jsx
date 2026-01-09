import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FlowEditor } from '../FlowEditor';
import { SidebarProperties } from '../SidebarProperties';
import { Toolbar } from '../Toolbar';
import { AreaExtensions } from 'rete-area-plugin';
import { SimulationPanel } from '../simulator/SimulationPanel';
import { ConversationTimeline } from '../simulator/ConversationTimeline';
import { useEditor } from '../state/editorStore';
import { getReplay } from '../api/flows';
import { NodePalette, NodePaletteCollapsed } from '../components/NodePalette';
import { ThemeSelector } from '../components/ThemeSelector';
import { FlowSelector } from '../components/FlowSelector';
import { FlowTemplateSelector } from '../components/FlowTemplateSelector';
import { FlowGeneratorDialog } from '../components/FlowGeneratorDialog';
import { SaveAsTemplateDialog } from '../components/SaveAsTemplateDialog';
import { Button } from '../styles/Button';
import { createFlow, saveTemplate } from '../api/flows';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import logger from '../utils/logger';
import { LogViewer } from '../components/LogViewer';
import { ResizableDivider } from '../components/ResizableDivider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useTheme } from '../styles/themeContext';
import { Dialog } from '../components/Dialog';
import { FlowTestChat } from '../components/FlowTestChat';
import { reteJsonToEngineFlow, engineFlowToReteJson } from '../engine-mapper/engineMapper';
import { NavigationLink } from '../components/NavigationLink';
import { FallbackEventsViewer } from '../components/FallbackEventsViewer';
import { getNodeSchema } from '../editor/nodeSchemas';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useIsMobile } from '../hooks/useIsMobile';

export function FlowEditorPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { themeName } = useTheme();
  const isMobile = useIsMobile();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Adiciona classe ao body quando estiver no editor para estilizar UserMenu como flutuante
  useEffect(() => {
    document.body.classList.add('flow-editor-active');
    return () => {
      document.body.classList.remove('flow-editor-active');
    };
  }, []);

  if (authLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p>Carregando...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }
  const {
    currentFlow,
    selectedNode,
    validation,
    simulation,
    loading,
    error,
    setSelectedNode,
    setValidation,
    validateCurrentFlow,
    saveFlow,
    simulateCurrentFlow,
    loadFlow,
    deleteFlow,
    clearCurrentFlow,
  } = useEditor();

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showFlowGenerator, setShowFlowGenerator] = useState(false);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTestChat, setShowTestChat] = useState(false);
  const [testFlowDefinition, setTestFlowDefinition] = useState(null);
  const [testChatSize, setTestChatSize] = useState(null);
  const [testKey, setTestKey] = useState(0);
  const [flowListRefreshTrigger, setFlowListRefreshTrigger] = useState(0);
  const [templateListRefreshTrigger, setTemplateListRefreshTrigger] = useState(0);
  const { showToast, ToastContainer } = useToast();
  const lastErrorRef = useRef(null);
  
  // Estados para replay de sessão
  const [sessionId, setSessionId] = useState('');
  const [replay, setReplay] = useState(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [replayError, setReplayError] = useState(null);
  const [replayCollapsed, setReplayCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  // WebSocket para atualizações em tempo real
  const handleWebSocketEvent = useCallback((event, data, fullMessage) => {
    logger.debug('[FlowEditorPage] Evento WebSocket recebido', { event, data });
    
    // Trata evento de atualização de fluxo
    if (event === 'flow.updated') {
      // O backend envia { flowId, flowName, agentId } no evento
      const updatedFlowId = data?.flowId || data?.flow?.id || data?.id;
      const currentFlowId = currentFlow?.id;
      
      // Se for o fluxo atual, recarrega automaticamente
      if (updatedFlowId && updatedFlowId === currentFlowId) {
        logger.info('[FlowEditorPage] Fluxo atual foi atualizado via WebSocket, recarregando...', {
          flowId: updatedFlowId,
          flowName: data?.flowName,
          updatedBy: data?.agentId,
        });
        
        // Recarrega o fluxo do backend
        loadFlow(updatedFlowId).then(() => {
          const flowName = data?.flowName || currentFlow?.name || 'Fluxo';
          showToast(`"${flowName}" foi atualizado automaticamente`, 'info', 3000);
        }).catch((err) => {
          logger.error('[FlowEditorPage] Erro ao recarregar fluxo após atualização WebSocket', err);
          showToast('Erro ao recarregar fluxo atualizado', 'error', 3000);
        });
      } else if (updatedFlowId) {
        // Se for outro fluxo, apenas loga (opcional)
        logger.debug('[FlowEditorPage] Outro fluxo foi atualizado', { 
          updatedFlowId, 
          currentFlowId,
          flowName: data?.flowName,
        });
      }
    }
    
    // Trata outros eventos se necessário
    // Exemplo: ticket.created, ticket.updated, etc.
  }, [currentFlow, loadFlow, showToast]);

  // Conecta ao WebSocket quando autenticado
  const { connected: wsConnected, authenticated: wsAuthenticated } = useWebSocketContext({
    enabled: isAuthenticated,
    onEvent: handleWebSocketEvent,
    subscribeEvents: ['flow.updated'], // Inscreve-se em atualizações de fluxo
  });

  // Monitora erros do editorStore e exibe via Toast
  useEffect(() => {
    // Ignora erros de validação e flow_not_found (já tratados em outros lugares)
    if (!error || error.includes('"validation_failed"') || error.includes('flow_not_found')) {
      return;
    }
    
    // Evita exibir o mesmo erro múltiplas vezes
    if (lastErrorRef.current === error) {
      return;
    }
    
    lastErrorRef.current = error;
    
    // Extrai mensagem amigável do erro
    let errorMessage = error;
    if (error.includes('Erro HTTP')) {
      try {
        const match = error.match(/\{.*\}/);
        if (match) {
          const errorObj = JSON.parse(match[0]);
          errorMessage = errorObj.message || errorObj.error || error;
        }
      } catch (e) {
        // Se não conseguir parsear, usa o erro original
      }
    }
    
    showToast(errorMessage, 'error', 5000);
    
    // Limpa a referência após um tempo para permitir que o mesmo erro seja exibido novamente se necessário
    setTimeout(() => {
      if (lastErrorRef.current === error) {
        lastErrorRef.current = null;
      }
    }, 6000);
  }, [error, showToast]);
  
  // Estados para colapso e larguras (EXATAMENTE como no modelo)
  // Em mobile, inicia recolhido
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  
  // Estados para colapso vertical dos painéis do painel direito
  // Em mobile, inicia recolhido
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  const [validationCollapsed, setValidationCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth < 768;
  }); // Em mobile, inicia colapsada
  const [simulationCollapsed, setSimulationCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth < 768;
  }); // Em mobile, inicia colapsada
  
  const [paletteWidth, setPaletteWidth] = useState(() => {
    const saved = localStorage.getItem('paletteWidth');
    return saved ? parseInt(saved) : 224; // w-56 = 224px
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('rightPanelWidth');
    return saved ? parseInt(saved) : 288; // w-72 = 288px
  });
  
  // Salva larguras no localStorage
  useEffect(() => {
    localStorage.setItem('paletteWidth', paletteWidth.toString());
  }, [paletteWidth]);
  useEffect(() => {
    localStorage.setItem('rightPanelWidth', rightPanelWidth.toString());
  }, [rightPanelWidth]);

  // Funções de toggle EXATAMENTE como no modelo
  const togglePalette = useCallback(() => {
    setPaletteCollapsed(prev => !prev);
  }, []);

  const toggleRightPanel = () => {
    setRightPanelCollapsed(!rightPanelCollapsed);
  };

  const [displayedFlow, setDisplayedFlow] = useState(null);

  useEffect(() => {
    if (currentFlow && currentFlow.id) {
      setDisplayedFlow(currentFlow);
    } else {
      setDisplayedFlow(null);
    }
  }, [currentFlow]);

  // ✅ Expande automaticamente o painel de validação quando há erros
  useEffect(() => {
    if (validation && !validation.valid && validation.uiErrors && validation.uiErrors.length > 0) {
      logger.info('Painel de validação expandido automaticamente devido a erros', {
        errorCount: validation.uiErrors.length,
        hasGlobalErrors: validation.uiErrors.some(e => !e.nodeIds || e.nodeIds.length === 0),
      });
      setValidationCollapsed(false);
    }
  }, [validation]);

  const handleFlowSelected = async (flow) => {
    if (flow && flow.id) {
      await loadFlow(flow.id);
      
      // ✅ Executa validação do backend após carregar fluxo salvo
      setTimeout(async () => {
        const editor = editorRef.current?.editor?.current;
        const area = editorRef.current?.area;
        if (editor && area) {
          try {
            const reteJson = await editor.toJSON();
            logger.info('Executando validação automática após carregar fluxo', {
              nodeCount: Object.keys(reteJson.nodes || {}).length,
            });
            
            // ✅ Validação local de fallback (antes de chamar backend) - mesma lógica do handleValidate
            const { validateFlow: validateFlowLocal } = await import('../editor/flowValidator');
            const localValidation = validateFlowLocal(reteJson);
            
            // Se validação local falhou, mostra erros e não chama backend
            if (!localValidation.valid && localValidation.errors.length > 0) {
              const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
              // Converte erros do validador local para formato esperado
              const formattedErrors = localValidation.errors.map(err => ({
                code: err.code,
                message: err.message,
                messageUi: err.messageUi || err.message,
                severity: err.severity || 'error',
                nodeIds: err.nodeIds || [],
                details: err.details || {},
              }));
              applyBackendValidationErrors(editor, area, formattedErrors);
              
              // Atualiza estado de validação
              const validationState = {
                valid: false,
                errors: formattedErrors,
                uiErrors: formattedErrors,
              };
              setValidation(validationState);
              
              const globalErrors = formattedErrors.filter(e => !e.nodeIds || e.nodeIds.length === 0);
              logger.info('Validação local de fallback falhou após carregar fluxo', {
                errorCount: formattedErrors.length,
                hasGlobalErrors: globalErrors.length > 0,
                globalErrorCodes: globalErrors.map(e => e.code),
                errorCodes: formattedErrors.map(e => e.code),
              });
              logger.debug('Detalhes da validação local', {
                formattedErrors: formattedErrors.map(e => ({
                  code: e.code,
                  message: e.message,
                  messageUi: e.messageUi,
                  nodeIds: e.nodeIds,
                })),
              });
              
              // O useEffect vai expandir o painel automaticamente quando o estado mudar
              return;
            }
            
            // Se validação local passou, chama validação do backend
            const validationResult = await validateCurrentFlow(reteJson);
            
            // ✅ Sempre aplica (limpa erros antigos e aplica novos, ou limpa tudo se válido)
            // O validateCurrentFlow já atualiza o estado validation internamente
            const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
            if (validationResult) {
              // Aplica erros aos nós do editor
              applyBackendValidationErrors(editor, area, validationResult.valid ? [] : (validationResult.errors || []));
              
              logger.info('Validação do backend concluída após carregar fluxo', {
                valid: validationResult.valid,
                errorCount: validationResult.errors?.length || 0,
              });
              logger.debug('Detalhes da validação do backend', {
                validationState: {
                  valid: validationResult.valid,
                  errorsCount: validationResult.errors?.length || 0,
                  uiErrorsCount: validationResult.uiErrors?.length || 0,
                },
              });
              
              // O useEffect vai expandir o painel automaticamente quando o estado mudar
            } else {
              logger.warn('Validação retornou null após carregar fluxo');
            }
          } catch (validationErr) {
            logger.error('Erro ao validar fluxo após carregar', { error: validationErr });
          }
        } else {
          logger.warn('Editor ou area não disponível para validação automática', {
            hasEditor: !!editor,
            hasArea: !!area,
          });
        }
      }, 500); // Aguarda 500ms para garantir que o editor foi atualizado
    }
  };

  const handleFlowGenerated = async (flow) => {
    logger.info('Fluxo gerado', { flowId: flow?.id, flowName: flow?.name });
    setShowFlowGenerator(false);
    
    // Limpa o estado antes de criar o novo fluxo
    clearCurrentFlow();
    
    try {
      const savedFlow = await createFlow(flow);
      logger.info('Fluxo gerado salvo no backend', { savedFlowId: savedFlow?.id });
      setFlowListRefreshTrigger(prev => prev + 1);
      
      // Só tenta carregar o fluxo se ele foi criado com sucesso
      if (savedFlow && savedFlow.id) {
        // Verifica se há avisos de validação na resposta
        const hasValidationWarnings = savedFlow.validationWarnings && 
                                      savedFlow.validationWarnings.errors && 
                                      savedFlow.validationWarnings.errors.length > 0;
        
        if (hasValidationWarnings) {
          const errorCount = savedFlow.validationWarnings.errors.length;
          showToast(
            `Fluxo gerado com sucesso, mas possui ${errorCount} erro${errorCount > 1 ? 's' : ''} de validação. Verifique o painel de validação.`,
            'warning',
            5000
          );
        } else {
          showToast('Fluxo gerado com sucesso', 'success', 2000);
        }
        
        await loadFlow(savedFlow.id);
        logger.info('Fluxo gerado carregado no editor com sucesso');
        
        // Aplica erros de validação se houver avisos na resposta
        setTimeout(async () => {
          const editor = editorRef.current?.editor?.current;
          const area = editorRef.current?.area;
          if (editor && area) {
            try {
              if (hasValidationWarnings) {
                const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
                applyBackendValidationErrors(editor, area, savedFlow.validationWarnings.errors);
                
                setValidation({
                  valid: false,
                  errors: savedFlow.validationWarnings.errors,
                  uiErrors: savedFlow.validationWarnings.errors,
                });
                setValidationCollapsed(false);
                
                logger.info('Erros de validação aplicados após gerar fluxo', {
                  errorCount: savedFlow.validationWarnings.errors.length,
                });
              } else {
                const reteJson = await editor.toJSON();
                const validationResult = await validateCurrentFlow(reteJson);
                
                const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
                if (validationResult) {
                  applyBackendValidationErrors(editor, area, validationResult.valid ? [] : (validationResult.errors || []));
                  
                  if (!validationResult.valid && validationResult.errors && validationResult.errors.length > 0) {
                    setValidationCollapsed(false);
                  }
                }
              }
            } catch (validationErr) {
              logger.error('Erro ao validar fluxo gerado', { error: validationErr });
            }
          }
        }, 500);
      }
    } catch (err) {
      logger.error('Erro ao salvar fluxo gerado', err);
      showToast(`Erro ao salvar fluxo gerado: ${err.message || 'Erro desconhecido'}`, 'error', 5000);
    }
  };

  const handleTemplateSelected = async (flow) => {
    logger.info('Template selecionado', { templateId: flow?.id, templateName: flow?.name });
    setShowTemplateSelector(false);
    
    // Limpa o estado antes de criar o novo fluxo
    clearCurrentFlow();
    
    try {
      const savedFlow = await createFlow(flow);
      logger.info('Fluxo salvo no backend', { savedFlowId: savedFlow?.id });
      setFlowListRefreshTrigger(prev => prev + 1);
      
      // Só tenta carregar o fluxo se ele foi criado com sucesso
      if (savedFlow && savedFlow.id) {
        // ✅ Verifica se há avisos de validação na resposta
        const hasValidationWarnings = savedFlow.validationWarnings && 
                                      savedFlow.validationWarnings.errors && 
                                      savedFlow.validationWarnings.errors.length > 0;
        
        if (hasValidationWarnings) {
          const errorCount = savedFlow.validationWarnings.errors.length;
          showToast(
            `Fluxo criado com sucesso, mas possui ${errorCount} erro${errorCount > 1 ? 's' : ''} de validação. Verifique o painel de validação.`,
            'warning',
            5000
          );
        } else {
          showToast('Fluxo criado com sucesso', 'success', 2000);
        }
        
        await loadFlow(savedFlow.id);
        logger.info('Fluxo carregado no editor com sucesso');
        
        // ✅ Aplica erros de validação se houver avisos na resposta
        // Aguarda um pouco para garantir que o editor foi atualizado
        setTimeout(async () => {
          const editor = editorRef.current?.editor?.current;
          const area = editorRef.current?.area;
          if (editor && area) {
            try {
              // Se a resposta já incluiu erros de validação, aplica-os diretamente
              if (hasValidationWarnings) {
                const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
                applyBackendValidationErrors(editor, area, savedFlow.validationWarnings.errors);
                
                // ✅ Atualiza estado de validação e expande painel
                setValidation({
                  valid: false,
                  errors: savedFlow.validationWarnings.errors,
                  uiErrors: savedFlow.validationWarnings.errors,
                });
                setValidationCollapsed(false);
                
                logger.info('Erros de validação aplicados após criar fluxo', {
                  errorCount: savedFlow.validationWarnings.errors.length,
                });
                logger.debug('Detalhes dos erros de validação', {
                  errors: savedFlow.validationWarnings.errors.map(e => ({
                    code: e.code,
                    message: e.message,
                    nodeIds: e.nodeIds,
                  })),
                });
              } else {
                // Caso contrário, executa validação completa
                // O validateCurrentFlow já atualiza o estado validation internamente
                const reteJson = await editor.toJSON();
                const validationResult = await validateCurrentFlow(reteJson);
                
                // ✅ Aplica erros do backend (limpa se válido, aplica se inválido)
                const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
                if (validationResult) {
                  applyBackendValidationErrors(editor, area, validationResult.valid ? [] : (validationResult.errors || []));
                  
                  // ✅ Expande painel de validação se houver erros
                  if (!validationResult.valid && validationResult.errors && validationResult.errors.length > 0) {
                    setValidationCollapsed(false);
                  }
                  
                  logger.info('Validação do backend concluída após criar novo fluxo', {
                    valid: validationResult.valid,
                    errorCount: validationResult.errors?.length || 0,
                  });
                  logger.debug('Detalhes da validação do backend', {
                    validationState: {
                      valid: validationResult.valid,
                      errorsCount: validationResult.errors?.length || 0,
                      uiErrorsCount: validationResult.uiErrors?.length || 0,
                    },
                  });
                }
              }
            } catch (validationErr) {
              logger.error('Erro ao validar fluxo após criar', { error: validationErr });
            }
          }
        }, 500); // Aguarda 500ms para garantir que o editor foi atualizado
      } else {
        logger.warn('Fluxo criado mas sem ID válido', { savedFlow });
        showToast('Erro: fluxo criado mas sem ID válido', 'error', 5000);
      }
    } catch (err) {
      logger.error('Erro ao criar fluxo do template', err);
      
      // Extrai mensagem de erro mais amigável
      let errorMessage = 'Erro ao criar fluxo do template. Verifique os logs.';
      if (err && typeof err === 'object') {
        if (err.body && typeof err.body === 'object') {
          if (err.body.error === 'validation_failed' && err.body.errors && Array.isArray(err.body.errors)) {
            const errorCount = err.body.errors.length;
            errorMessage = `O fluxo não passou na validação (${errorCount} erro${errorCount > 1 ? 's' : ''} encontrado${errorCount > 1 ? 's' : ''}). Verifique os erros no painel de validação.`;
          } else if (err.body.message) {
            errorMessage = err.body.message;
          } else if (err.body.error) {
            errorMessage = `Erro: ${err.body.error}`;
          }
        } else if (err.message) {
          errorMessage = err.message;
        }
      }
      
      showToast(errorMessage, 'error', 5000);
      // Não tenta carregar o fluxo do template, pois ele não existe no backend
      // O estado já foi limpo no início da função
    }
  };

  const handleFlowChanged = useCallback(() => {}, []);
  const handleNodeSelected = useCallback((node) => {
    if (node) {
      let previousNodeId = null;
      let nextNodeId = null;
      
      try {
        if (editorRef.current?.editor?.current) {
          const editor = editorRef.current.editor.current;
          const nodeId = String(node.id || '');
          
          const allConnections = editor.getConnections();
          
          for (const conn of allConnections) {
            const targetId = String(conn.target || '');
            if (targetId === nodeId) {
              previousNodeId = String(conn.source || '');
              break;
            }
          }
          
          for (const conn of allConnections) {
            const sourceId = String(conn.source || '');
            if (sourceId === nodeId) {
              nextNodeId = String(conn.target || '');
              break;
            }
          }
        }
      } catch (err) {
        logger.warn('Erro ao obter conexões do nó', { nodeId: node.id, error: err });
      }
      
      // ✅ Obtém erros de validação diretamente do nó no editor (já formatados como objetos)
      let nodeValidationErrors = [];
      try {
        if (editorRef.current?.editor?.current) {
          const editor = editorRef.current.editor.current;
          const editorNode = editor.getNode(String(node.id || ''));
          const validationErrors = editorNode?.data?.validation?.errors || [];
          
          // ✅ Usa erros exatamente como estão (sem transformação)
          nodeValidationErrors = validationErrors;
        }
      } catch (err) {
        logger.warn('Erro ao obter erros de validação do nó', { nodeId: node.id, error: err });
      }
      
      // ✅ Fallback: se não encontrou erros no editor, tenta buscar nos erros de validação do backend
      if (nodeValidationErrors.length === 0 && validation?.uiErrors) {
        const nodeIdStr = String(node.id || '');
        nodeValidationErrors = (validation.uiErrors || []).filter(
          (err) => Array.isArray(err.nodeIds) && err.nodeIds.includes(nodeIdStr),
        );
      }

      const nodeData = {
        id: String(node.id || ''),
        type: node.type || 'unknown',
        config: node.config || {},
        previousNodeId,
        nextNodeId,
        validationErrors: nodeValidationErrors,
      };
      setSelectedNode(nodeData);
    } else {
      setSelectedNode(null);
    }
  }, [setSelectedNode, validation]);

  const handleUpdateNodeConfig = (nodeId, newConfig) => {
    if (!editorRef.current) return;
    try {
      const editor = editorRef.current.editor?.current;
      if (!editor) return;
      
      const node = editor.getNode(nodeId);
      if (!node) return;
      
      // Atualiza config do nó
      node.data.config = { ...node.data.config, ...newConfig };
      
      // ✅ Atualiza inputs/outputs dinamicamente para nós com sockets dinâmicos
      // (router, schedule_router, options, ai_task/intent_list, keywords)
      if (editorRef.current.updateNodeIO) {
        editorRef.current.updateNodeIO(nodeId);
      }
      
      // Se o editor tem updateNodeIO, atualiza inputs/outputs dinamicamente
      // Isso é necessário para nós com outputs dinâmicos (router, schedule_router)
      // ou inputs de erro (nós com errorPorts)
      if (editorRef.current.updateNodeIO) {
        editorRef.current.updateNodeIO(nodeId);
      }
      
      // Atualiza nó selecionado no estado
      if (selectedNode && selectedNode.id === nodeId) {
        setSelectedNode({ ...selectedNode, config: { ...selectedNode.config, ...newConfig } });
      }
      
      // Notifica mudança no fluxo
      if (editorRef.current.onFlowChanged) {
        editorRef.current.onFlowChanged(editor);
      }
    } catch (err) {
      logger.error('Erro ao atualizar config do nó', { nodeId, error: err });
    }
  };

  const handleSave = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const reteJson = await editor.toJSON();
      const saved = await saveFlow(reteJson);
    if (saved) {
      setFlowListRefreshTrigger(prev => prev + 1);
      showToast('Fluxo salvo com sucesso', 'success');
    } else {
        showToast('Erro ao salvar fluxo', 'error');
      }
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao salvar fluxo', 'error');
    }
  };

  const handleSaveAsTemplate = async (templateData) => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }

    try {
      const reteJson = await editor.toJSON();
      const flowDefinition = reteJsonToEngineFlow(reteJson, currentFlow || undefined);

      // Prepara o template com o fluxo atual
      const template = {
        ...templateData,
        flow: flowDefinition,
      };

      await saveTemplate(template);
      showToast(`Template "${templateData.name}" salvo com sucesso!`, 'success', 3000);
      setShowSaveAsTemplate(false);
      // Atualiza a lista de templates para incluir o novo template
      setTemplateListRefreshTrigger(prev => prev + 1);
    } catch (err) {
      logger.error('Erro ao salvar template', err);
      const errorMessage = err?.body?.message || err?.message || 'Erro ao salvar template';
      showToast(errorMessage, 'error', 5000);
    }
  };

  const handleValidate = async () => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    // Expande a seção de validação para mostrar os resultados
    setValidationCollapsed(false);
    logger.info('Validação manual iniciada');
    try {
      const reteJson = await editor.toJSON();
      logger.debug('JSON do editor obtido para validação', {
        nodeCount: Object.keys(reteJson.nodes || {}).length,
      });
      
      // ✅ Validação local de fallback (antes de chamar backend)
      const { validateFlow: validateFlowLocal } = await import('../editor/flowValidator');
      const localValidation = validateFlowLocal(reteJson);
      
      // Se validação local falhou, mostra erros e não chama backend
      if (!localValidation.valid && localValidation.errors.length > 0) {
        const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
        // Converte erros do validador local para formato esperado
        const formattedErrors = localValidation.errors.map(err => ({
          code: err.code,
          message: err.message,
          messageUi: err.messageUi || err.message,
          severity: err.severity || 'error',
          nodeIds: err.nodeIds || [],
          details: err.details || {},
        }));
        applyBackendValidationErrors(editor, area, formattedErrors);
        
        // Atualiza estado de validação
        const validationState = {
          valid: false,
          errors: formattedErrors,
          uiErrors: formattedErrors,
        };
        setValidation(validationState);
        
        const globalErrors = formattedErrors.filter(e => !e.nodeIds || e.nodeIds.length === 0);
        const nodeSpecificErrors = formattedErrors.filter(e => e.nodeIds && e.nodeIds.length > 0);
        
        logger.info('Validação local de fallback falhou', {
          errorCount: formattedErrors.length,
          globalErrorsCount: globalErrors.length,
          nodeSpecificErrorsCount: nodeSpecificErrors.length,
          globalErrorCodes: globalErrors.map(e => e.code),
          formattedErrors: formattedErrors.map(e => ({
            code: e.code,
            message: e.message,
            messageUi: e.messageUi,
            nodeIds: e.nodeIds,
          })),
          validationState: {
            valid: validationState.valid,
            errorsCount: validationState.errors.length,
            uiErrorsCount: validationState.uiErrors.length,
          },
        });
        
        // ✅ Garante que o painel está expandido (já está na linha 443, mas garantimos novamente)
        setValidationCollapsed(false);
        
        logger.debug('Estado de validação atualizado', {
          validationCollapsed: false,
          validationState: {
            valid: validationState.valid,
            errorsCount: validationState.errors.length,
            uiErrorsCount: validationState.uiErrors.length,
          },
        });
        
        return;
      }
      
      // Se validação local passou, chama validação do backend
      // O validateCurrentFlow já atualiza o estado validation internamente
      const validationResult = await validateCurrentFlow(reteJson);
      
      // ✅ Aplica erros de validação do backend aos nós do editor
      // Se válido, passa array vazio (limpa erros do backend)
      // Se inválido, passa os erros recebidos do servidor
      if (validationResult) {
        const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
        applyBackendValidationErrors(editor, area, validationResult.valid ? [] : (validationResult.errors || []));
        
        logger.info('Validação do backend concluída', {
          valid: validationResult.valid,
          errorCount: validationResult.errors?.length || 0,
        });
        logger.debug('Detalhes da validação do backend', {
          validationState: {
            valid: validationResult.valid,
            errorsCount: validationResult.errors?.length || 0,
            uiErrorsCount: validationResult.uiErrors?.length || 0,
          },
        });
      } else {
        logger.warn('Validação do backend retornou null');
      }
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao validar fluxo', 'error');
    }
  };

  const handleClearEditor = async () => {
    const editorInstance = editorRef.current;
    if (!editorInstance || !editorInstance.clearEditor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      await editorInstance.clearEditor();
      clearCurrentFlow();
      setSelectedNode(null);
      showToast('Editor limpo com sucesso', 'success');
    } catch (err) {
      logger.error('Erro ao limpar editor', err);
      showToast('Erro ao limpar editor', 'error');
    }
  };

  const handleSimulate = async () => {
    // Expande a seção de simulação para mostrar os resultados
    setSimulationCollapsed(false);
    await simulateCurrentFlow();
  };

  const handleTest = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const reteJson = await editor.toJSON();
      const flowDefinition = reteJsonToEngineFlow(reteJson, currentFlow || undefined);
      setTestFlowDefinition(flowDefinition);
      setTestKey(prev => prev + 1); // Incrementa a key para forçar remontagem e limpar log
      setShowTestChat(true);
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao preparar teste do fluxo', 'error');
    }
  };

  const handleDeleteClick = () => {
    if (!currentFlow || !currentFlow.id) return;
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentFlow || !currentFlow.id) return;
    try {
      await deleteFlow(currentFlow.id);
      
      // ✅ Limpa o editor visual quando o fluxo é removido
      const editor = editorRef.current?.editor?.current;
      if (editor && typeof editor.clear === 'function') {
        editor.clear();
        logger.debug('Editor limpo após remoção do fluxo');
      }
      
      showToast('Fluxo removido com sucesso', 'success');
      setFlowListRefreshTrigger(prev => prev + 1);
    } catch (err) {
      logger.error('Erro ao remover fluxo', { error: err });
      showToast(`Erro ao remover fluxo: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    }
  };

  const handleArrange = async () => {
    try {
      const arrange = editorRef.current?.arrange;
      const area = editorRef.current?.area;
      const editor = editorRef.current?.editor?.current;
      
      if (!arrange || !area || !editor) {
        showToast('Editor não está pronto', 'warning', 2000);
        return;
      }
      
      const nodes = editor.getNodes();
      if (nodes.length === 0) {
        showToast('Nenhum nó para organizar', 'info', 2000);
        return;
      }
      
      showToast('Organizando nós...', 'info', 1000);
      await new Promise(resolve => {
        requestAnimationFrame(async () => {
          try {
            await arrange.layout();
            resolve();
          } catch (err) {
            logger.warn('Erro ao calcular layout', { error: err?.message || String(err) });
            resolve();
          }
        });
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (nodes.length > 0) {
        try {
        AreaExtensions.zoomAt(area, nodes);
        } catch (err) {
          logger.warn('Erro ao fazer zoom após organizar', { error: err?.message });
        }
      }
      
      showToast('Nós organizados automaticamente', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao organizar nós', { error: err });
      showToast('Erro ao organizar nós. Tente novamente.', 'error', 3000);
    }
  };

  // Handlers simplificados para zoom
  const handleZoomIn = async () => {
    const area = editorRef.current?.area;
    if (!area || !area.area) return;
    try {
      const currentZoom = area.area.transform?.k || 1;
      const newZoom = Math.min(currentZoom * 1.2, 3);
      await area.area.zoom(newZoom);
      showToast(`Zoom: ${Math.round(newZoom * 100)}%`, 'info', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom in', { error: err?.message || String(err) });
      showToast('Erro ao aumentar zoom', 'error', 2000);
    }
  };

  const handleZoomOut = async () => {
    const area = editorRef.current?.area;
    if (!area || !area.area) return;
    try {
      const currentZoom = area.area.transform?.k || 1;
      const newZoom = Math.max(currentZoom / 1.2, 0.1);
      await area.area.zoom(newZoom);
      showToast(`Zoom: ${Math.round(newZoom * 100)}%`, 'info', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom out', { error: err?.message || String(err) });
      showToast('Erro ao diminuir zoom', 'error', 2000);
    }
  };

  const handleZoomFit = () => {
    const area = editorRef.current?.area;
    const editor = editorRef.current?.editor?.current;
    if (!area || !editor) return;
    try {
      const nodes = editor.getNodes();
      if (nodes.length === 0) {
        showToast('Nenhum nó para fazer zoom', 'info', 2000);
        return;
      }
      AreaExtensions.zoomAt(area, nodes);
      showToast('Zoom ajustado', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom fit', { error: err });
    }
  };

  const handleResetZoom = async () => {
    const area = editorRef.current?.area;
    if (!area || !area.area) return;
    try {
      await area.area.zoom(1);
      showToast('Zoom resetado para 100%', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao resetar zoom', { error: err?.message || String(err) });
      showToast('Erro ao resetar zoom', 'error', 2000);
    }
  };

  const handleCenterCanvas = () => {
    const area = editorRef.current?.area;
    const editor = editorRef.current?.editor?.current;
    if (!area || !editor) return;
    try {
      const nodes = editor.getNodes();
      if (nodes.length === 0) {
        showToast('Nenhum nó para centralizar', 'info', 2000);
        return;
      }
      AreaExtensions.zoomAt(area, nodes);
      showToast('Canvas centralizado', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao centralizar canvas', { error: err });
    }
  };

  // Handlers simplificados (stubs para funcionalidades futuras)
  const handleUndo = () => showToast('Undo não implementado', 'warning', 2000);
  const handleRedo = () => showToast('Redo não implementado', 'warning', 2000);
  const handleCopy = () => showToast('Copy não implementado', 'warning', 2000);
  const handlePaste = () => showToast('Paste não implementado', 'warning', 2000);
  const handleDuplicate = () => showToast('Duplicate não implementado', 'warning', 2000);
  const handleSelectAll = () => showToast('Select All não implementado', 'warning', 2000);
  const handleDeselectAll = () => showToast('Deselect All não implementado', 'warning', 2000);
  const handleAlignLeft = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignCenter = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignRight = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignTop = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignMiddle = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignBottom = () => showToast('Align não implementado', 'warning', 2000);

  // Handler para carregar replay de sessão
  const handleLoadReplay = async () => {
    if (!sessionId.trim()) {
      showToast('Digite um Session ID', 'warning', 2000);
      return;
    }
    
    setLoadingReplay(true);
    setReplayError(null);
    try {
      const result = await getReplay(sessionId.trim());
      setReplay(result);
      setReplayCollapsed(false);
      showToast('Replay carregado com sucesso', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao carregar replay', err);
      setReplayError(err instanceof Error ? err.message : String(err));
      setReplay(null);
      showToast('Erro ao carregar replay', 'error', 3000);
    } finally {
      setLoadingReplay(false);
    }
  };

  const handleSeekNode = (nodeId, index) => {
    // Foca no nó correspondente no editor
    if (nodeId && editorRef.current?.editor?.current) {
      const editor = editorRef.current.editor.current;
      const node = editor.getNodes().find(n => String(n.id) === String(nodeId));
      if (node) {
        setSelectedNode(node);
        // Scroll para o nó
        const area = editorRef.current?.area;
        if (area && area.area) {
          AreaExtensions.zoomAt(area, [node]);
        }
      }
    }
  };
  const handleDistributeHorizontal = () => showToast('Distribute não implementado', 'warning', 2000);
  const handleDistributeVertical = () => showToast('Distribute não implementado', 'warning', 2000);
  const handleToggleReroutePoints = () => showToast('Reroute não implementado', 'warning', 2000);
  const handleClearOrphanConnections = () => showToast('Clear não implementado', 'warning', 2000);
  const handleSearchNode = () => showToast('Search não implementado', 'warning', 2000);
  const handleGoToNode = () => showToast('Go to não implementado', 'warning', 2000);
  const handleNextNode = () => showToast('Next não implementado', 'warning', 2000);
  const handlePreviousNode = () => showToast('Previous não implementado', 'warning', 2000);
  const handleExportPNG = () => showToast('Export PNG não implementado', 'warning', 2000);
  const handleExportSVG = () => showToast('Export SVG não implementado', 'warning', 2000);
  const handleExportPDF = () => showToast('Export PDF não implementado', 'warning', 2000);
  const handleImportTemplate = () => setShowTemplateSelector(true);
  const handleValidateAndFix = () => showToast('Validate and Fix não implementado', 'warning', 2000);
  const handleShowErrors = () => showToast('Show Errors não implementado', 'warning', 2000);
  const handleToggleDebug = () => showToast('Debug não implementado', 'warning', 2000);
  const handleShowStatistics = () => showToast('Statistics não implementado', 'warning', 2000);
  const handleOptimizeLayout = () => handleArrange();
  const handleSimplifyGraph = () => showToast('Simplify não implementado', 'warning', 2000);
  const handleToggleMinimap = () => showToast('Minimap não implementado', 'warning', 2000);
  const handleImportJson = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };
  const handleExportJson = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const reteJson = await editor.toJSON();
      const blob = new Blob([JSON.stringify(reteJson, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFlow?.name ? `${currentFlow.name.replace(/[^a-z0-9]/gi, '_')}.json` : 'flow.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Fluxo exportado com sucesso', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao exportar JSON', err);
      showToast('Erro ao exportar fluxo', 'error', 3000);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(reader.result);
        
        // Valida se o JSON tem a estrutura básica
        if (!json || typeof json !== 'object') {
          showToast('JSON inválido: formato incorreto', 'error', 3000);
          return;
        }
        
        let reteJson = null;
        let flowData = json;
        let metadata = null;
        
        // Detecta formato wrapper (template com metadados)
        // Formato: { id, name, description, icon, flow: {...} }
        if (json.flow && typeof json.flow === 'object' && !json.nodes) {
          logger.debug('JSON detectado como formato wrapper (template), extraindo campo flow', {
            hasMetadata: !!(json.id || json.name || json.description || json.icon),
            jsonKeys: Object.keys(json),
          });
          flowData = json.flow;
          // Preserva metadados para possível uso futuro
          metadata = {
            id: json.id,
            name: json.name,
            description: json.description,
            icon: json.icon,
          };
        }
        
        // Detecta e converte formato da engine (nodes como array) para formato Rete
        if (Array.isArray(flowData.nodes)) {
          // Formato da engine: tem nodes como array
          logger.debug('JSON detectado como formato da engine, convertendo para Rete', {
            nodeCount: flowData.nodes.length,
          });
          try {
            reteJson = engineFlowToReteJson(flowData);
            if (!reteJson || !reteJson.nodes || Object.keys(reteJson.nodes).length === 0) {
              showToast('JSON inválido: não foi possível converter o formato da engine', 'error', 3000);
              return;
            }
            logger.debug('JSON convertido com sucesso', {
              nodeCount: Object.keys(reteJson.nodes).length,
            });
          } catch (convertErr) {
            logger.error('Erro ao converter JSON da engine para Rete', convertErr);
            showToast('Erro ao converter formato do fluxo', 'error', 3000);
            return;
          }
        } else if (flowData.nodes && typeof flowData.nodes === 'object') {
          // Formato Rete: nodes como objeto
          reteJson = flowData;
        } else {
          // Formato desconhecido
          showToast('JSON inválido: formato não reconhecido. Esperado formato Rete ou Engine.', 'error', 3000);
          logger.warn('JSON com formato desconhecido', {
            hasNodes: !!flowData.nodes,
            nodesType: typeof flowData.nodes,
            nodesIsArray: Array.isArray(flowData.nodes),
            jsonKeys: Object.keys(flowData),
            hasWrapper: !!json.flow,
          });
          return;
        }
        
        // Valida se o JSON convertido tem nós válidos
        if (!reteJson.nodes || typeof reteJson.nodes !== 'object' || Object.keys(reteJson.nodes).length === 0) {
          showToast('JSON inválido: nenhum nó válido encontrado', 'error', 3000);
          return;
        }
        
        // Carrega o JSON no editor
        const editor = editorRef.current;
        if (!editor || !editor.loadFromJson) {
          showToast('Editor não está pronto', 'warning', 2000);
          return;
        }
        
        try {
          await editor.loadFromJson(reteJson);
          showToast('Fluxo importado com sucesso', 'success', 2000);
          
          // Limpa o fluxo atual do estado para permitir trabalhar com o importado
          clearCurrentFlow();
          setSelectedNode(null);
          
          // Opcional: valida o fluxo importado após um pequeno delay
          // O validateCurrentFlow já atualiza o estado validation internamente
          setTimeout(async () => {
            try {
              const reteJson = await editor.editor?.current?.toJSON();
              if (reteJson) {
                const validationResult = await validateCurrentFlow(reteJson);
                const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
                if (validationResult) {
                  applyBackendValidationErrors(
                    editor.editor?.current,
                    editor.area,
                    validationResult.valid ? [] : (validationResult.errors || [])
                  );
                  
                  // ✅ Expande painel de validação se houver erros
                  if (!validationResult.valid && validationResult.errors && validationResult.errors.length > 0) {
                    setValidationCollapsed(false);
                  }
                }
              }
            } catch (validationErr) {
              logger.debug('Erro ao validar fluxo importado (não crítico)', { error: validationErr });
            }
          }, 500);
        } catch (loadErr) {
          logger.error('Erro ao carregar JSON no editor', loadErr);
          showToast('Erro ao carregar fluxo no editor', 'error', 3000);
        }
      } catch (err) {
        logger.error('Erro ao importar JSON', err);
        if (err instanceof SyntaxError) {
          showToast('Erro ao importar fluxo: JSON malformado', 'error', 3000);
        } else {
          showToast('Erro ao importar fluxo: JSON inválido', 'error', 3000);
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flow-editor-page">
      <Toolbar
        onImportJson={handleImportJson}
        onExportJson={handleExportJson}
        onSimulate={handleSimulate}
        onTest={handleTest}
        onSave={handleSave}
        onSaveAsTemplate={() => setShowSaveAsTemplate(true)}
        onValidate={handleValidate}
        onArrange={handleArrange}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onResetZoom={handleResetZoom}
        onCenterCanvas={handleCenterCanvas}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDuplicate={handleDuplicate}
        onSearchNode={handleSearchNode}
        onGoToNode={handleGoToNode}
        onNextNode={handleNextNode}
        onPreviousNode={handlePreviousNode}
        onClearEditor={handleClearEditor}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportPDF={handleExportPDF}
        onImportTemplate={handleImportTemplate}
        onValidateAndFix={handleValidateAndFix}
        onShowErrors={handleShowErrors}
        onToggleDebug={handleToggleDebug}
        onShowStatistics={handleShowStatistics}
        onOptimizeLayout={handleOptimizeLayout}
        onSimplifyGraph={handleSimplifyGraph}
        onToggleMinimap={handleToggleMinimap}
        minimapVisible={false}
        currentZoom={1}
      >
        {/* Indicador de status WebSocket */}
        {isAuthenticated && (
          <div 
            className="flex items-center gap-1 px-2 py-1 text-xs"
            title={wsConnected && wsAuthenticated 
              ? 'WebSocket conectado e autenticado - Atualizações em tempo real ativas' 
              : wsConnected 
                ? 'WebSocket conectado, aguardando autenticação...' 
                : 'WebSocket desconectado'}
          >
            <span 
              className={`inline-block w-2 h-2 rounded-full ${
                wsConnected && wsAuthenticated 
                  ? 'bg-green-500 animate-pulse' 
                  : wsConnected 
                    ? 'bg-yellow-500' 
                    : 'bg-red-500'
              }`}
            />
            <span className="hidden sm:inline text-text-secondary">
              {wsConnected && wsAuthenticated ? 'WS' : wsConnected ? 'WS...' : 'WS'}
            </span>
          </div>
        )}
        <button className="btn-base" onClick={() => setShowTemplateSelector(true)}>
          <span className="icon icon-plus"></span>
          <span>Novo</span>
        </button>
        <FlowSelector
          onFlowSelected={handleFlowSelected}
          currentFlowId={currentFlow?.id}
          refreshTrigger={flowListRefreshTrigger}
        />
        <button className="btn-base" onClick={() => setShowFlowGenerator(true)} title="Gerar fluxo com IA">
          <span className="icon icon-ai"></span>
          <span>Gerar com IA</span>
        </button>
        {currentFlow?.id && (
          <button className="btn-base" onClick={handleDeleteClick}>
            <span className="icon icon-delete"></span>
            <span>Remover</span>
          </button>
        )}
        <button className="btn-base" onClick={() => setShowLogViewer(true)}>
          <span className="icon icon-logs"></span>
          <span>Logs</span>
        </button>
        <ThemeSelector />
      </Toolbar>

      {showTemplateSelector && (
        <FlowTemplateSelector
          onTemplateSelected={handleTemplateSelected}
          onCancel={() => setShowTemplateSelector(false)}
          refreshTrigger={templateListRefreshTrigger}
        />
      )}

      {showFlowGenerator && (
        <FlowGeneratorDialog
          onFlowGenerated={handleFlowGenerated}
          onCancel={() => setShowFlowGenerator(false)}
        />
      )}

      <SaveAsTemplateDialog
        isOpen={showSaveAsTemplate}
        onClose={() => setShowSaveAsTemplate(false)}
        onSave={handleSaveAsTemplate}
        flowName={currentFlow?.name || 'Fluxo sem nome'}
      />

      {showLogViewer && (
        <LogViewer onClose={() => setShowLogViewer(false)} />
      )}

      {loading && <div className="loading-indicator">Carregando...</div>}

      {/* Barra "Fluxo atual" - EXATAMENTE como no modelo */}
      <div className="flow-current-display">
        Fluxo atual: <strong className="ml-1">{displayedFlow ? (displayedFlow.name || displayedFlow.id) : 'não carregado'}</strong>
      </div>

      {/* MAIN - EXATAMENTE como no modelo */}
      <div className="flex min-h-0">
        {/* PALETA - EXATAMENTE como no modelo */}
        <div
          id="palette"
          className={`${paletteCollapsed ? 'w-12' : ''} min-w-[48px] flex flex-col transition-all duration-200 flow-editor-palette`}
          style={!paletteCollapsed ? { width: `${paletteWidth}px` } : {}}
        >
          <div className="section-header">
            <span className={paletteCollapsed ? 'hidden' : 'inline'}>
              Paleta
            </span>
            <button 
              className={`collapse-btn-horizontal ${paletteCollapsed ? 'collapsed' : ''}`}
              onClick={togglePalette}
              aria-label={paletteCollapsed ? 'Expandir paleta' : 'Recolher paleta'}
            >
            </button>
          </div>

          {!paletteCollapsed ? (
            <div className="flex-1 p-2 text-sm space-y-2 overflow-y-auto">
                <NodePalette />
            </div>
          ) : (
            <div className="flex-1 p-2 flex flex-col items-center gap-2 overflow-y-auto">
              <NodePaletteCollapsed />
            </div>
          )}
        </div>

        {/* DIVIDER PALETA - EXATAMENTE como no modelo */}
        <ResizableDivider
          direction="horizontal-left"
          targetId="palette"
          onResize={setPaletteWidth}
        />

        {/* CANVAS - EXATAMENTE como no modelo */}
        <div className="flex-1 relative overflow-hidden canvas-container">
          <div className="absolute inset-0 canvas-grid pointer-events-none"></div>
          <div className="relative h-full">
              <FlowEditor
              ref={editorRef}
                onFlowChanged={handleFlowChanged}
                onNodeSelected={handleNodeSelected}
                showToast={showToast}
              />
          </div>
        </div>

        {/* DIVIDER DIREITA - EXATAMENTE como no modelo */}
        <ResizableDivider
          direction="horizontal-right"
          targetId="rightPanel"
          onResize={setRightPanelWidth}
        />

        {/* PAINEL DIREITO - EXATAMENTE como no modelo */}
        <div
          id="rightPanel"
          className={`${rightPanelCollapsed ? 'w-12' : ''} min-w-[48px] flex flex-col transition-all duration-200 flow-editor-right-panel`}
          style={!rightPanelCollapsed ? { width: `${rightPanelWidth}px` } : {}}
        >
          {/* HEADER */}
          <div className="section-header">
            <button className={`collapse-btn-horizontal collapse-btn-right ${rightPanelCollapsed ? 'collapsed' : ''}`} onClick={toggleRightPanel}>
            </button>
          </div>

          {/* CONTEÚDO - EXATAMENTE como no modelo */}
          <div id="rightContent" className="flex-1 flex flex-col min-h-0 overflow-x-hidden">
            {rightPanelCollapsed ? (
              <>
                {/* Modo colapsado - textos verticais */}
                <div 
                  className="flex-1 p-2 section-container flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                  onClick={() => {
                    setRightPanelCollapsed(false);
                    setPropertiesCollapsed(false);
                  }}
                  title="Clique para expandir Propriedades"
                >
                  Propriedades
                </div>
                <div 
                  className="flex-1 p-2 section-container flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                  onClick={() => {
                    setRightPanelCollapsed(false);
                    setValidationCollapsed(false);
                  }}
                  title="Clique para expandir Validação"
                >
                  Validação
                </div>
                <div 
                  className="flex-1 p-2 flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                  onClick={() => {
                    setRightPanelCollapsed(false);
                    setSimulationCollapsed(false);
                  }}
                  title="Clique para expandir Simulação"
                >
                  Simulação
                </div>
              </>
            ) : (
              <>
                {/* Propriedades - com colapso vertical */}
                <div className={`flex flex-col ${propertiesCollapsed ? 'section-collapsed' : 'section-expanded-full'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Propriedades</span>
                    <button
                      className={`collapse-btn-vertical ${propertiesCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setPropertiesCollapsed(!propertiesCollapsed)}
                      title={propertiesCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!propertiesCollapsed && (
                    <div className="section-content">
                      <SidebarProperties
                        selectedNode={selectedNode}
                        onChangeConfig={(newConfig) => {
                          if (selectedNode?.id) {
                            handleUpdateNodeConfig(selectedNode.id, newConfig);
                          }
                        }}
                        availableNodes={(() => {
                          // Obtém lista de nós disponíveis do editor para o combobox
                          try {
                            if (editorRef.current?.editor?.current) {
                              const editor = editorRef.current.editor.current;
                              const nodes = editor.getNodes();
                              return nodes.map(node => {
                                const schema = getNodeSchema(node.data?.type);
                                return {
                                  id: String(node.id),
                                  type: node.data?.type || 'unknown',
                                  label: schema?.label || node.data?.type || 'unknown',
                                };
                              }).filter(node => node.id !== selectedNode?.id); // Exclui o nó atual
                            }
                          } catch (err) {
                            logger.warn('Erro ao obter nós disponíveis', { error: err });
                          }
                          return [];
                        })()}
                      />
                    </div>
                  )}
                </div>

                {/* Validação - com colapso vertical */}
                <div className={`flex flex-col ${validationCollapsed ? 'section-collapsed' : 'section-expanded'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Validação</span>
                    <button
                      className={`collapse-btn-vertical ${validationCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setValidationCollapsed(!validationCollapsed)}
                      title={validationCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!validationCollapsed && (
                    <div className="section-content">
                      {!validation ? (
                        <div className="w-full h-full flex flex-col items-center justify-center text-sm sidebar-properties-empty">
                          <div className="text-center space-y-3 max-w-[240px]">
                            <div className="text-4xl mb-3 opacity-40">
                              <span className="icon icon-check sidebar-properties-empty-icon"></span>
                            </div>
                            <div className="text-base font-semibold mb-1 sidebar-properties-empty-title">
                              Nenhuma validação executada
                            </div>
                            <div className="text-xs leading-relaxed sidebar-properties-empty-description">
                              Execute a validação para ver os resultados.
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm mb-2">
                            <span>Resultado: </span>
                            <span className={validation.valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {validation.valid ? 'Válido' : 'Inválido'}
                            </span>
                          </div>
                          {validation.uiErrors && validation.uiErrors.length > 0 && (
                            <div className="text-xs space-y-2">
                              {(() => {
                                const errorsByNode = new Map();
                                validation.uiErrors.forEach((err) => {
                                  if (err.nodeIds && err.nodeIds.length > 0) {
                                    err.nodeIds.forEach((nodeId) => {
                                      if (!errorsByNode.has(nodeId)) {
                                        errorsByNode.set(nodeId, []);
                                      }
                                      errorsByNode.get(nodeId).push(err);
                                    });
                                  } else {
                                    if (!errorsByNode.has('_global')) {
                                      errorsByNode.set('_global', []);
                                    }
                                    errorsByNode.get('_global').push(err);
                                  }
                                });

                                return Array.from(errorsByNode.entries()).map(([nodeId, errors]) => (
                                  <div key={nodeId} className="mb-3">
                                    <div className="font-semibold mb-1">
                                      {nodeId !== '_global' ? `Nó: ${nodeId}` : 'Erros Gerais'}
                                    </div>
                                    <ul className="list-disc list-inside space-y-1">
                                      {errors.map((err, idx) => (
                                        <li key={`${err.code}-${idx}`}>
                                          <span className="text-gray-600 dark:text-gray-400">[{err.code}]</span>
                                          <span> {err.messageUi || err.message}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ));
                              })()}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Simulação - com colapso vertical */}
                <div className={`flex flex-col ${simulationCollapsed ? 'section-collapsed' : 'section-expanded'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Simulação</span>
                    <button
                      className={`collapse-btn-vertical ${simulationCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setSimulationCollapsed(!simulationCollapsed)}
                      title={simulationCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!simulationCollapsed && (
                    <div className="section-content">
                      <SimulationPanel simulation={simulation} />
                    </div>
                  )}
                </div>

                {/* Replay de Sessão - com colapso vertical */}
                <div className={`flex flex-col ${replayCollapsed ? 'section-collapsed' : 'section-expanded'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Replay de Sessão</span>
                    <button
                      className={`collapse-btn-vertical ${replayCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setReplayCollapsed(!replayCollapsed)}
                      title={replayCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!replayCollapsed && (
                    <div className="section-content">
                      <div className="space-y-3 p-3">
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={sessionId}
                            onChange={(e) => setSessionId(e.target.value)}
                            placeholder="Session ID (ex: sess-123)"
                            className="flex-1 px-3 py-2 text-sm border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter' && !loadingReplay) {
                                handleLoadReplay();
                              }
                            }}
                            disabled={loadingReplay}
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleLoadReplay}
                            disabled={loadingReplay || !sessionId.trim()}
                          >
                            {loadingReplay ? 'Carregando...' : 'Carregar'}
                          </Button>
                        </div>
                        {replayError && (
                          <div className="p-2 bg-status-error/10 border border-status-error/20 text-status-error text-sm rounded">
                            Erro: {replayError}
                          </div>
                        )}
                        {replay && (
                          <div className="space-y-3">
                            <ConversationTimeline replay={replay} onSeekNode={handleSeekNode} />
                            {replay.simulation && (
                              <div className="mt-3 pt-3 border-t border-border-default">
                                <SimulationPanel simulation={replay.simulation} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {currentFlow && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteConfirm}
          title="Remover fluxo"
          message={`Tem certeza que deseja remover o fluxo "${currentFlow.name || currentFlow.id}"?\n\nEsta ação não pode ser desfeita.`}
          confirmText="Remover"
          cancelText="Cancelar"
          variant="danger"
          icon="🗑️"
        />
      )}

      <Dialog
        isOpen={showTestChat}
        onClose={() => {
          // Limpa estados visuais antes de fechar
          if (typeof window !== 'undefined') {
            try {
              window.dispatchEvent(
                new CustomEvent('flow-runner-cleanup', {
                  detail: {
                    clearAll: true,
                  },
                }),
              );
            } catch (err) {
              logger.debug('FlowEditorPage - erro ao emitir evento de limpeza', err);
            }
          }
          
          setShowTestChat(false);
          setTestFlowDefinition(null);
          setTestChatSize(null);
        }}
        title="Chat de Teste"
        size="xl"
        draggable={true}
        resizable={true}
        dynamicSize={testChatSize}
      >
        {testFlowDefinition && (
          <div className="h-[600px] min-h-[400px]">
            <FlowTestChat 
              key={testKey} // Key muda quando clica em Testar, forçando remontagem completa e limpeza do log
              flow={testFlowDefinition} 
              onSizeChange={setTestChatSize}
            />
          </div>
        )}
      </Dialog>

      <ToastContainer />
      
      <input
        type="file"
        accept="application/json"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
