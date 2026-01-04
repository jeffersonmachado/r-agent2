import React, { useState, useEffect, useRef } from 'react';
import logger from '../utils/logger';
import { useFlowRunner } from '../hooks/useFlowRunner';
import { ResizableDivider } from './ResizableDivider';
import { getFeature, setFeature } from '../utils/featuresConfig';
import { useTheme } from '../styles/themeContext';
import { speak, stopSpeaking, isAvailable } from '../utils/textToSpeech';
import { processFile, validateFile, formatFileSize, getFileIcon } from '../utils/fileProcessor';

/**
 * Componente de Chat de Teste para validar e executar fluxos de chatbot.
 *
 * Características:
 * - Interface estilo chat (mensagens empilhadas)
 * - Execução local e determinística (sem IA, sem backend)
 * - Validação prévia do fluxo
 * - Suporta: start, message, user_input, router, end
 */
export function FlowTestChat({ flow, onSizeChange }) {
  const {
    conversationState,
    isRunning,
    isProcessing,
    error,
    validationResult,
    pendingOutputs,
    executionLog,
    startConversation,
    sendMessage,
    resetConversation,
  } = useFlowRunner(flow);

  const { theme, themeName } = useTheme();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [showExecutionLog, setShowExecutionLog] = useState(true);
  const [executionLogWidth, setExecutionLogWidth] = useState(400);
  const [aiTasksEnabled, setAiTasksEnabled] = useState(true);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const executionLogEndRef = useRef(null);
  const lastProcessedOutputsRef = useRef([]);
  const ttsAvailable = isAvailable();

  // Scroll automático
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Scroll automático do log de execução
  useEffect(() => {
    if (executionLogEndRef.current) {
      executionLogEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [executionLog]);

  // Processa outputs pendentes e adiciona mensagens
  useEffect(() => {
    if (!pendingOutputs || pendingOutputs.length === 0) return;

    // Evita processar os mesmos outputs duas vezes
    if (JSON.stringify(pendingOutputs) === JSON.stringify(lastProcessedOutputsRef.current)) {
      return;
    }

    const newMessages = [];

    pendingOutputs.forEach((output) => {
      if (output?.type === 'message' && output.text) {
        newMessages.push({
          id: `msg-${Date.now()}-${Math.random()}`,
          role: 'bot',
          text: output.text,
          timestamp: new Date().toISOString(),
        });
      } else if (output?.type === 'options') {
        newMessages.push({
          id: `msg-${Date.now()}-${Math.random()}`,
          role: 'bot',
          text: output.message || 'Escolha uma opção:',
          options: output.options || [],
          optionsType: output.optionsType || 'button',
          allowMultiple: output.allowMultiple || false,
          timestamp: new Date().toISOString(),
        });
      } else if (output?.type === 'end' && output.message) {
        newMessages.push({
          id: `msg-${Date.now()}-${Math.random()}`,
          role: 'bot',
          text: output.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    if (newMessages.length > 0) {
      setMessages((prev) => [...prev, ...newMessages]);
      
      // Fala as novas mensagens do bot se TTS estiver habilitado
      if (ttsEnabled && ttsAvailable) {
        newMessages.forEach((msg) => {
          if (msg.role === 'bot' && msg.text) {
            // Remove opções e formatação para falar apenas o texto
            const textToSpeak = msg.text.replace(/\[.*?\]/g, '').trim();
            if (textToSpeak) {
              speak(textToSpeak, {
                useQualitySettings: true, // Usa configurações de qualidade melhorada
              }).catch((error) => {
                logger.debug('Erro ao falar mensagem:', error);
              });
            }
          }
        });
      }
    }

    lastProcessedOutputsRef.current = pendingOutputs;
  }, [pendingOutputs, ttsEnabled, ttsAvailable]);

  // Notifica mudança de tamanho quando o log é recolhido/expandido
  useEffect(() => {
    if (onSizeChange) {
      // Quando recolhido: modal menor (apenas chat + painel recolhido de 48px)
      // Quando expandido: modal maior (chat + log redimensionável)
      const chatWidth = 520; // Largura do chat quando sozinho
      const collapsedPanelWidth = 48; // w-12 = 48px
      const logWidth = showExecutionLog ? executionLogWidth : collapsedPanelWidth;
      const dividerWidth = showExecutionLog ? 4 : 0; // Largura do divisor (w-1 = 4px)
      const totalWidth = chatWidth + logWidth + dividerWidth + 50; // +50 para padding/borders do modal
      onSizeChange({ width: totalWidth, isCollapsed: !showExecutionLog });
    }
  }, [showExecutionLog, executionLogWidth, onSizeChange]);

  // Carrega o estado inicial de aiTasksEnabled
  useEffect(() => {
    getFeature('aiTasksEnabled', true).then(setAiTasksEnabled);
  }, []);

  // Inicia a conversa automaticamente quando o componente é montado
  useEffect(() => {
    if (!isRunning && flow) {
      const started = startConversation();
      if (started) {
        setMessages([]);
        setInputText('');
        lastProcessedOutputsRef.current = [];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reinicia automaticamente quando isRunning muda para false após reset
  useEffect(() => {
    if (!isRunning && flow && conversationState === null && !error) {
      // Pequeno delay para garantir que o reset foi processado completamente
      const timer = setTimeout(() => {
        const started = startConversation();
        if (started) {
          setMessages([]);
          setInputText('');
          lastProcessedOutputsRef.current = [];
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, conversationState, flow, error]);

  // Foca no input quando está aguardando user_input
  useEffect(() => {
    if (
      isRunning &&
      conversationState &&
      flow?.nodes?.find((n) => n.id === conversationState.currentNodeId)?.type === 'user_input'
    ) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
    }
  }, [conversationState, isRunning, flow]);

  // Limpa estados visuais quando o componente é desmontado (modal fecha)
  useEffect(() => {
    return () => {
      // Para qualquer fala em andamento
      if (ttsAvailable) {
        stopSpeaking();
      }
      
      // Emite evento para limpar todos os destaques quando o modal fecha
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
          logger.debug('FlowTestChat - erro ao emitir evento de limpeza', err);
        }
      }
    };
  }, [ttsAvailable]);

  // Para fala quando TTS é desabilitado
  useEffect(() => {
    if (!ttsEnabled && ttsAvailable) {
      stopSpeaking();
    }
  }, [ttsEnabled, ttsAvailable]);


  // Manipulação de arquivos
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limite de arquivos por mensagem (5 arquivos)
    const MAX_FILES = 5;
    const currentFileCount = attachedFiles.length;
    const remainingSlots = MAX_FILES - currentFileCount;
    
    if (files.length > remainingSlots) {
      alert(`Você pode anexar no máximo ${MAX_FILES} arquivos por mensagem. Já tem ${currentFileCount} arquivo(s) anexado(s).`);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    const newFiles = [];
    
    for (const file of files) {
      try {
        // Valida arquivo
        validateFile(file, 10, [
          'image/*',
          'application/pdf',
          'text/*',
          'application/json',
          'text/csv',
        ]);

        const fileObj = {
          file,
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          status: 'processing', // pending, processing, ready, error
          preview: null,
          content: null,
          error: null,
          progress: 0,
          progressMessage: 'Iniciando...',
        };

        newFiles.push(fileObj);
        setAttachedFiles((prev) => [...prev, fileObj]);

        // Processa arquivo com progresso
        processFile(fileObj.file, {
          compressImages: true,
          extractImageText: false, // OCR pode ser lento, desabilitado por padrão
          onProgress: (progress, message) => {
            setAttachedFiles((prev) =>
              prev.map((f) =>
                f.id === fileObj.id
                  ? { ...f, progress, progressMessage: message || 'Processando...' }
                  : f
              )
            );
          },
        })
          .then(({ content, preview, file: processedFile }) => {
            setAttachedFiles((prev) =>
              prev.map((f) =>
                f.id === fileObj.id
                  ? { 
                      ...f, 
                      status: 'ready', 
                      content, 
                      preview,
                      file: processedFile, // Arquivo pode ter sido comprimido
                      size: processedFile.size, // Atualiza tamanho se comprimido
                      progress: 100,
                      progressMessage: 'Concluído',
                    }
                  : f
              )
            );
          })
          .catch((error) => {
            logger.error('Erro ao processar arquivo:', error);
            setAttachedFiles((prev) =>
              prev.map((f) =>
                f.id === fileObj.id
                  ? { 
                      ...f, 
                      status: 'error', 
                      error: error.message,
                      progress: 0,
                      progressMessage: 'Erro',
                    }
                  : f
              )
            );
          });
      } catch (error) {
        logger.error('Erro ao validar arquivo:', error);
        // Mostra erro para o usuário de forma mais amigável
        const errorMessage = error.message || 'Erro desconhecido';
        alert(`Erro ao adicionar arquivo "${file.name}": ${errorMessage}`);
      }
    }

    // Limpa input para permitir selecionar o mesmo arquivo novamente
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (fileId) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleSend = async () => {
    const hasText = inputText.trim().length > 0;
    const hasFiles = attachedFiles.some((f) => f.status === 'ready');
    
    if ((!hasText && !hasFiles) || !isRunning) return;

    // Prepara arquivos prontos
    const readyFiles = attachedFiles
      .filter((f) => f.status === 'ready')
      .map((f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        content: f.content,
        preview: f.preview,
      }));

    const userMessage = {
      id: `msg-${Date.now()}-${Math.random()}`,
      role: 'user',
      text: inputText.trim(),
      files: readyFiles,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    
    // Prepara input com texto e arquivos
    const input = {
      text: inputText.trim(),
      files: readyFiles,
    };
    
    setInputText('');
    setAttachedFiles([]);

    // Envia mensagem com arquivos
    await sendMessage(input);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = isRunning && 
    (inputText.trim().length > 0 || attachedFiles.some(f => f.status === 'ready')) &&
    !attachedFiles.some(f => f.status === 'processing');
  const isFinished = conversationState && conversationState.currentNodeId === null;
  const isWaitingInput =
    isRunning &&
    conversationState &&
    flow?.nodes?.find((n) => n.id === conversationState.currentNodeId)?.type === 'user_input';
  
  // Indica quando o bot está processando/respondendo
  // Mostra apenas quando está realmente processando (isProcessing = true)
  // Não mostra quando está aguardando input do usuário ou quando o fluxo terminou
  const isBotProcessing = isProcessing && !isWaitingInput && !isFinished;

  // Erro de validação
  if (validationResult && !validationResult.valid && !isRunning) {
    return (
      <div className="flow-test-chat-container flex flex-col h-full bg-bg-primary">
        <div className="flow-test-chat-header p-4 border-b border-border-default bg-bg-secondary">
          <h3 className="text-lg font-semibold text-text-primary">Chat de Teste</h3>
        </div>
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 font-semibold mb-2">Erro de Validação</p>
            <ul className="list-disc list-inside text-red-700 text-sm space-y-1">
              {validationResult.errors.map((err, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={idx}>{err.messageUi || err.message}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Formata o tipo de evento para exibição
   */
  const formatEventType = (eventType) => {
    const eventLabels = {
      FLOW_START: 'Início',
      NODE_ENTER: 'Entrada',
      BOT_MESSAGE: 'Mensagem',
      USER_INPUT: 'Input',
      DECISION_EVALUATED: 'Decisão',
      ROUTE_SELECTED: 'Rota',
      FLOW_END: 'Fim',
      ERROR: 'Erro',
    };
    return eventLabels[eventType] || eventType;
  };

  /**
   * Obtém a cor do tipo de evento
   */
  const getEventTypeColor = (eventType) => {
    const colors = {
      FLOW_START: 'text-blue-600 bg-blue-50',
      NODE_ENTER: 'text-green-600 bg-green-50',
      BOT_MESSAGE: 'text-purple-600 bg-purple-50',
      USER_INPUT: 'text-orange-600 bg-orange-50',
      DECISION_EVALUATED: 'text-yellow-600 bg-yellow-50',
      ROUTE_SELECTED: 'text-indigo-600 bg-indigo-50',
      FLOW_END: 'text-gray-600 bg-gray-50',
      ERROR: 'text-red-600 bg-red-50',
    };
    return colors[eventType] || 'text-gray-600 bg-gray-50';
  };

  /**
   * Formata o log de execução em texto para copiar
   */
  const formatLogForCopy = () => {
    if (executionLog.length === 0) {
      return 'Nenhum evento registrado ainda';
    }

    return executionLog.map((logEntry) => {
      let logText = `#${logEntry.step} [${formatEventType(logEntry.eventType)}] ${new Date(logEntry.timestamp).toLocaleTimeString()}\n`;
      
      if (logEntry.nodeId) {
        logText += `  Nó: ${logEntry.nodeId}`;
        if (logEntry.nodeType) {
          logText += ` (${logEntry.nodeType})`;
        }
        logText += '\n';
      }
      
      if (logEntry.action) {
        logText += `  Ação: ${logEntry.action}\n`;
      }
      
      if (logEntry.input) {
        logText += `  Input do usuário: "${logEntry.input}"\n`;
      }
      
      if (logEntry.message) {
        logText += `  Mensagem: ${logEntry.message}\n`;
      }
      
      if (logEntry.sourceNodeId && logEntry.targetNodeId) {
        logText += `  Rota: ${logEntry.sourceNodeId} → ${logEntry.targetNodeId}\n`;
      }
      
      if (logEntry.result !== undefined) {
        if (logEntry.eventType === 'IA_TASK_RESPONSE' && typeof logEntry.result === 'object') {
          // Formata resposta da IA
          logText += `  Resposta da IA:\n`;
          if (logEntry.result._noMatch || logEntry.result.value === null) {
            logText += `    ⚠ Nenhum match encontrado\n`;
          } else {
            if (logEntry.result.value !== undefined && logEntry.result.value !== null) {
              logText += `    Valor: ${logEntry.result.value}\n`;
            }
            if (logEntry.result.confidence !== undefined) {
              logText += `    Confiança: ${(logEntry.result.confidence * 100).toFixed(1)}%\n`;
            }
            if (logEntry.result.entities && Array.isArray(logEntry.result.entities)) {
              logText += `    Entidades: ${JSON.stringify(logEntry.result.entities)}\n`;
            }
            if (logEntry.result.normalized !== undefined) {
              logText += `    Normalizado: ${logEntry.result.normalized}\n`;
            }
            if (logEntry.result.response !== undefined) {
              logText += `    Resposta: ${logEntry.result.response}\n`;
            }
          }
          if (logEntry.result._fallbackUsed) {
            logText += `    ⚠ Fallback usado${logEntry.result._reason ? ` (${logEntry.result._reason})` : ''}\n`;
          }
        } else {
          logText += `  Resultado: ${logEntry.result ? '✓ Verdadeiro' : '✗ Falso'}\n`;
        }
      }
      
      // Adiciona resposta original da IA quando fallback foi usado
      if (logEntry.eventType === 'IA_FALLBACK_USED' && logEntry.originalResponse) {
        logText += `  Resposta original da IA:\n`;
        if (logEntry.originalResponse._noMatch || logEntry.originalResponse.value === null) {
          logText += `    Nenhum match encontrado\n`;
        } else {
          if (logEntry.originalResponse.value !== undefined && logEntry.originalResponse.value !== null) {
            logText += `    Valor: ${logEntry.originalResponse.value}\n`;
          }
          if (logEntry.originalResponse.confidence !== undefined) {
            logText += `    Confiança: ${(logEntry.originalResponse.confidence * 100).toFixed(1)}%\n`;
          }
        }
      }
      
      if (logEntry.error) {
        logText += `  Erro: ${logEntry.error}\n`;
      }
      
      if (logEntry.condition) {
        logText += `  Condição: ${JSON.stringify(logEntry.condition, null, 2)}\n`;
      }
      
      return logText;
    }).join('\n');
  };

  /**
   * Copia o log de execução para a área de transferência
   */
  const handleCopyLog = async () => {
    try {
      const logText = formatLogForCopy();
      await navigator.clipboard.writeText(logText);
      // Mostra mensagem de feedback
      setCopiedMessage(true);
      // Remove a mensagem após 2 segundos
      setTimeout(() => {
        setCopiedMessage(false);
      }, 2000);
    } catch (err) {
      console.error('Erro ao copiar log:', err);
    }
  };

  /**
   * Alterna o estado de aiTasksEnabled
   */
  const handleToggleAiTasks = async (enabled) => {
    await setFeature('aiTasksEnabled', enabled);
    setAiTasksEnabled(enabled);
  };

  return (
    <div className="flow-test-chat-container flex flex-col h-full bg-bg-primary">
      {/* Cabeçalho */}
      <div className="flow-test-chat-header p-4 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">Chat de Teste</h3>
          <div className="flex items-center gap-3">
            {/* Toggle de TTS (Voz) */}
            {ttsAvailable && (
              <label className="flex items-center gap-2 cursor-pointer" title="Ativar/desativar narração de voz">
                <span className="text-sm text-text-secondary">🔊 Voz</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={ttsEnabled}
                    onChange={(e) => {
                      setTtsEnabled(e.target.checked);
                      if (!e.target.checked) {
                        stopSpeaking();
                      }
                    }}
                    className="sr-only"
                  />
                  <div
                    className={`w-11 h-6 rounded-full transition-colors border ${
                      ttsEnabled 
                        ? 'bg-primary border-primary' 
                        : `${themeName === 'dark' ? 'bg-border-default border-border-hover' : 'bg-border-default border-border-hover'}`
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                        ttsEnabled 
                          ? `translate-x-5 ${themeName === 'dark' ? 'bg-white shadow-md' : 'bg-text-primary shadow-md'}`
                          : `bg-bg-secondary translate-x-0 border-2 ${themeName === 'dark' ? 'border-border-hover shadow-sm' : 'border-border-default shadow-sm'}`
                      }`}
                    />
                  </div>
                </div>
              </label>
            )}
            {/* Toggle de IA */}
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-text-secondary">IA Habilitada</span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={aiTasksEnabled}
                  onChange={(e) => handleToggleAiTasks(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-11 h-6 rounded-full transition-colors border ${
                    aiTasksEnabled 
                      ? 'bg-primary border-primary' 
                      : `${themeName === 'dark' ? 'bg-border-default border-border-hover' : 'bg-border-default border-border-hover'}`
                  }`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                      aiTasksEnabled 
                        ? `translate-x-5 ${themeName === 'dark' ? 'bg-white shadow-md' : 'bg-text-primary shadow-md'}`
                        : `bg-bg-secondary translate-x-0 border-2 ${themeName === 'dark' ? 'border-border-hover shadow-sm' : 'border-border-default shadow-sm'}`
                    }`}
                  />
                </div>
              </div>
            </label>
            {isRunning && (
              <button
                type="button"
                onClick={resetConversation}
                className="px-3 py-1 text-sm bg-bg-tertiary text-text-secondary rounded hover:bg-bg-tertiary/80 transition-colors"
              >
                Reiniciar
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Container principal: Chat e Log lado a lado */}
      <div className="flex flex-1 min-h-0">
        {/* Área do Chat */}
        <div
          className="flex flex-col border-r border-border-default flex-1 min-w-0"
        >

          {/* Área de mensagens */}
          <div className="flow-test-chat-messages flex-1 overflow-y-auto p-4 space-y-4">

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-primary text-white'
                  : 'bg-bg-secondary text-text-primary border border-border-default'
              }`}
            >
              {msg.text && (
                <p className={`whitespace-pre-wrap break-words ${
                  msg.role === 'user' ? 'text-white' : 'text-text-primary'
                }`}>
                  {msg.text}
                </p>
              )}
              
              {/* Renderiza arquivos anexados */}
              {msg.files && msg.files.length > 0 && (
                <div className={`mt-2 space-y-2 ${msg.text ? 'mt-3' : ''}`}>
                  {msg.files.map((file, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-primary/20 border border-primary/30'
                          : 'bg-bg-tertiary border border-border-default'
                      }`}
                    >
                      {/* Preview de imagem */}
                      {file.preview && file.type.startsWith('image/') && (
                        <img
                          src={file.preview}
                          alt={file.name}
                          className="max-w-full h-auto rounded mb-2 max-h-48 object-contain"
                        />
                      )}
                      
                      {/* Informações do arquivo */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{getFileIcon(file.type)}</span>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className={`text-sm font-medium truncate ${
                            msg.role === 'user' ? 'text-white' : 'text-text-primary'
                          }`}>
                            {file.name}
                          </span>
                          <span className={`text-xs ${
                            msg.role === 'user' ? 'text-primary-100' : 'text-text-tertiary'
                          }`}>
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                      </div>
                      
                      {/* Preview de conteúdo de texto (primeiras linhas) */}
                      {file.content && 
                       !file.type.startsWith('image/') && 
                       file.content.length > 0 &&
                       !file.content.startsWith('[') && (
                        <div className={`mt-2 p-2 rounded text-xs max-h-32 overflow-y-auto ${
                          msg.role === 'user'
                            ? 'bg-primary/10 text-primary-100'
                            : 'bg-bg-primary text-text-secondary'
                        }`}>
                          <p className="line-clamp-4 whitespace-pre-wrap break-words">
                            {file.content.substring(0, 500)}
                            {file.content.length > 500 && '...'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {/* Renderiza opções interativas */}
              {msg.options && Array.isArray(msg.options) && msg.options.length > 0 && (
                <div className="mt-3 space-y-2">
                  {msg.optionsType === 'button' && (
                    <div className="flex flex-wrap gap-2">
                      {msg.options.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            if (sendMessage) {
                              sendMessage(option.id);
                            }
                          }}
                          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {msg.optionsType === 'checkbox' && (
                    <div className="space-y-2">
                      {msg.options.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-primary border-border-default rounded focus:ring-primary"
                            onChange={(e) => {
                              // Para checkboxes, precisamos coletar todas as seleções
                              // Por enquanto, vamos enviar apenas quando clicar
                              if (e.target.checked && sendMessage) {
                                sendMessage(option.id);
                              }
                            }}
                          />
                          <span className="text-sm">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  
                  {msg.optionsType === 'radio' && (
                    <div className="space-y-2">
                      {msg.options.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name={`radio-${msg.id}`}
                            className="w-4 h-4 text-primary border-border-default focus:ring-primary"
                            onChange={(e) => {
                              if (e.target.checked && sendMessage) {
                                sendMessage(option.id);
                              }
                            }}
                          />
                          <span className="text-sm">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  
                  {msg.optionsType === 'list' && (
                    <select
                      onChange={(e) => {
                        if (e.target.value && sendMessage) {
                          sendMessage(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 border border-border-default rounded-lg bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Selecione uma opção...</option>
                      {msg.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              
              <p
                className={`text-xs mt-1 ${
                  msg.role === 'user' ? 'text-primary-100' : 'text-text-tertiary'
                }`}
              >
                {new Date(msg.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {/* Indicador de digitação */}
        {isBotProcessing && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              backgroundColor: theme.colors.bg.secondary,
              border: `1px solid ${theme.colors.border.default}`,
              borderRadius: '8px',
              padding: '8px 16px'
            }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  backgroundColor: theme.colors.text.tertiary,
                  borderRadius: '50%',
                  animation: 'bounce 1.4s ease-in-out infinite'
                }} />
                <div style={{
                  width: '8px',
                  height: '8px',
                  backgroundColor: theme.colors.text.tertiary,
                  borderRadius: '50%',
                  animation: 'bounce 1.4s ease-in-out infinite',
                  animationDelay: '0.2s'
                }} />
                <div style={{
                  width: '8px',
                  height: '8px',
                  backgroundColor: theme.colors.text.tertiary,
                  borderRadius: '50%',
                  animation: 'bounce 1.4s ease-in-out infinite',
                  animationDelay: '0.4s'
                }} />
              </div>
            </div>
          </div>
        )}

            <div ref={messagesEndRef} />
          </div>

          {/* Área de input */}
          <div 
            className="flow-test-chat-input p-4 border-t border-border-default bg-bg-secondary"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              
              if (!isRunning || isFinished || attachedFiles.length >= 5) {
                return;
              }

              const files = Array.from(e.dataTransfer.files || []);
              if (files.length > 0) {
                // Cria um evento sintético para reutilizar handleFileSelect
                const syntheticEvent = {
                  target: {
                    files: files,
                  },
                };
                handleFileSelect(syntheticEvent);
              }
            }}
          >
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          {/* Preview de arquivos anexados */}
          {attachedFiles.length > 0 && (
            <div className="space-y-2 pb-2">
              <div className="flex items-center justify-between text-xs text-text-tertiary">
                <span>
                  {attachedFiles.filter(f => f.status === 'ready').length} de {attachedFiles.length} arquivo(s) pronto(s)
                </span>
                {attachedFiles.some(f => f.status === 'processing') && (
                  <span className="animate-pulse">Processando arquivos...</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file) => (
                  <div
                    key={file.id}
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-all max-w-full ${
                      file.status === 'ready'
                        ? 'bg-status-success/10 border-status-success/30'
                        : file.status === 'error'
                        ? 'bg-status-error/10 border-status-error/30'
                        : file.status === 'processing'
                        ? 'bg-status-warning/10 border-status-warning/30'
                        : 'bg-bg-tertiary border-border-default'
                    }`}
                  >
                    <span className="text-sm flex-shrink-0">
                      {file.status === 'processing' ? (
                        <span className="animate-spin">⏳</span>
                      ) : file.status === 'error' ? (
                        '❌'
                      ) : (
                        getFileIcon(file.type)
                      )}
                    </span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-medium text-text-primary truncate" title={file.name}>
                        {file.name}
                      </span>
                    <span className="text-xs text-text-tertiary">
                      {formatFileSize(file.size)}
                      {file.status === 'processing' && (
                        <>
                          <span className="ml-1 text-status-warning">
                            {file.progressMessage || 'processando...'}
                          </span>
                          {file.progress > 0 && (
                            <span className="ml-1 text-status-warning">
                              ({Math.round(file.progress)}%)
                            </span>
                          )}
                        </>
                      )}
                      {file.status === 'error' && (
                        <span className="ml-1 text-status-error" title={file.error}>
                          erro
                        </span>
                      )}
                      {file.status === 'ready' && (
                        <span className="ml-1 text-status-success">✓</span>
                      )}
                    </span>
                    {/* Barra de progresso */}
                    {file.status === 'processing' && file.progress > 0 && (
                      <div className="w-full h-1 bg-bg-tertiary rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-status-warning transition-all duration-300"
                          style={{ width: `${file.progress}%` }}
                        />
                      </div>
                    )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(file.id)}
                      className="text-status-error hover:opacity-80 text-sm px-1 transition-opacity flex-shrink-0"
                      title="Remover arquivo"
                      disabled={file.status === 'processing'}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {/* Botão de anexo */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isRunning || isFinished || attachedFiles.length >= 5}
              className="px-3 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-tertiary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors relative"
              title={
                attachedFiles.length >= 5
                  ? 'Limite de 5 arquivos por mensagem atingido'
                  : 'Anexar arquivo (máx. 5 arquivos)'
              }
            >
              📎
              {attachedFiles.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {attachedFiles.length}
                </span>
              )}
            </button>

            {/* Input de arquivo oculto */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv"
              disabled={!isRunning || isFinished || attachedFiles.length >= 5}
            />

            {/* Input de texto */}
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                isFinished
                  ? 'Conversa encerrada'
                  : isRunning
                  ? 'Digite sua mensagem...'
                  : 'Aguardando início...'
              }
              disabled={!isRunning || isFinished}
              className="flex-1 px-4 py-2 border border-border-default rounded-lg bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!canSend || isFinished}
              className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Enviar
            </button>
          </div>
        </form>
        </div>
      </div>

        {/* Divisor redimensionável */}
        {showExecutionLog && (
          <ResizableDivider
            direction="horizontal-right"
            targetId="executionLogPanel"
            onResize={setExecutionLogWidth}
          />
        )}

        {/* Painel de Log de Execução - EXATAMENTE como o painel direito */}
        <div
          id="executionLogPanel"
          className={`${showExecutionLog ? '' : 'w-12'} min-w-[48px] flex flex-col transition-all duration-200 border-l border-border-default bg-bg-secondary`}
          style={showExecutionLog ? { width: `${executionLogWidth}px` } : {}}
        >
          {/* HEADER - EXATAMENTE como o painel direito */}
          <div className="section-header">
            <div className="flex items-center justify-between w-full">
              {showExecutionLog && (
                <div className="relative ml-2">
                  <button
                    type="button"
                    onClick={handleCopyLog}
                    className="px-2 py-1 text-xs bg-bg-tertiary text-text-secondary rounded hover:bg-bg-tertiary/80 transition-colors"
                    title="Copiar log de execução"
                    aria-label="Copiar log de execução"
                  >
                    {copiedMessage ? '✓ Copiado' : '📋 Copiar'}
                  </button>
                  {copiedMessage && (
                    <div className="absolute top-full left-0 mt-1 px-2 py-1 text-xs bg-green-100 text-green-800 rounded shadow-md z-10 whitespace-nowrap">
                      Copiado!
                    </div>
                  )}
                </div>
              )}
              <button 
                className={`collapse-btn-horizontal collapse-btn-right ${showExecutionLog ? '' : 'collapsed'}`} 
                onClick={() => setShowExecutionLog(!showExecutionLog)}
                title={showExecutionLog ? "Recolher painel de log" : "Expandir painel de log"}
                aria-label={showExecutionLog ? "Recolher painel de log" : "Expandir painel de log"}
              >
              </button>
            </div>
          </div>

          {/* CONTEÚDO - EXATAMENTE como o painel direito */}
          <div className="flex-1 flex flex-col min-h-0 overflow-x-hidden">
            {showExecutionLog ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {executionLog.length === 0 ? (
                  <div className="text-center text-text-tertiary py-8 text-sm">
                    Nenhum evento registrado ainda
                  </div>
                ) : (
                  executionLog.map((logEntry) => (
                  <div
                    key={`${logEntry.step}-${logEntry.timestamp}`}
                    className="p-2 rounded border border-border-default bg-bg-primary text-xs"
                  >
                    <div className="flex items-start gap-2 mb-1">
                      <span className="font-mono font-semibold text-text-tertiary min-w-[2rem]">
                        #{logEntry.step}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${getEventTypeColor(
                          logEntry.eventType,
                        )}`}
                      >
                        {formatEventType(logEntry.eventType)}
                      </span>
                      <span className="text-text-tertiary ml-auto">
                        {new Date(logEntry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="ml-[4.5rem] space-y-0.5">
                      {logEntry.nodeId && (
                        <div className="text-text-secondary">
                          <span className="font-semibold">Nó:</span>{' '}
                          <span className="font-mono">{logEntry.nodeId}</span>
                          {logEntry.nodeType && (
                            <span className="text-text-tertiary"> ({logEntry.nodeType})</span>
                          )}
                        </div>
                      )}
                      {logEntry.action && (
                        <div className="text-text-secondary">
                          <span className="font-semibold">Ação:</span> {logEntry.action}
                        </div>
                      )}
                      {logEntry.input && (
                        <div className="text-text-secondary">
                          <span className="font-semibold">Input do usuário:</span>{' '}
                          <span className="font-mono bg-orange-100 text-orange-800 px-2 py-0.5 rounded border border-orange-200 font-semibold">
                            "{logEntry.input}"
                          </span>
                        </div>
                      )}
                      {logEntry.message && (
                        <div className="text-text-secondary">
                          <span className="font-semibold">Mensagem:</span> {logEntry.message}
                        </div>
                      )}
                      {logEntry.sourceNodeId && logEntry.targetNodeId && (
                        <div className="text-text-secondary">
                          <span className="font-semibold">Rota:</span>{' '}
                          <span className="font-mono">{logEntry.sourceNodeId}</span>
                          <span className="text-text-tertiary"> → </span>
                          <span className="font-mono">{logEntry.targetNodeId}</span>
                        </div>
                      )}
                      {logEntry.result !== undefined && (
                        <div className="text-text-secondary">
                          <span className="font-semibold">Resultado:</span>{' '}
                          <span className={logEntry.result ? 'text-green-600' : 'text-red-600'}>
                            {logEntry.result ? '✓ Verdadeiro' : '✗ Falso'}
                          </span>
                        </div>
                      )}
                      {logEntry.eventType === 'IA_TASK_RESPONSE' && logEntry.result && (
                        <div className="text-text-secondary mt-1">
                          <span className="font-semibold">Resposta da IA:</span>
                          <div className="mt-1 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                            {logEntry.result._noMatch || logEntry.result.value === null ? (
                              <div className="text-orange-700 font-semibold">
                                ⚠ Nenhum match encontrado
                              </div>
                            ) : (
                              <>
                                {logEntry.result.value !== undefined && logEntry.result.value !== null && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-blue-800">Valor:</span>{' '}
                                    <span className="font-mono text-blue-900">{String(logEntry.result.value)}</span>
                                  </div>
                                )}
                                {logEntry.result.confidence !== undefined && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-blue-800">Confiança:</span>{' '}
                                    <span className="font-mono text-blue-900">
                                      {(logEntry.result.confidence * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                )}
                                {logEntry.result.entities && Array.isArray(logEntry.result.entities) && logEntry.result.entities.length > 0 && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-blue-800">Entidades:</span>{' '}
                                    <span className="font-mono text-blue-900">
                                      {JSON.stringify(logEntry.result.entities)}
                                    </span>
                                  </div>
                                )}
                                {logEntry.result.normalized !== undefined && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-blue-800">Normalizado:</span>{' '}
                                    <span className="font-mono text-blue-900">{String(logEntry.result.normalized)}</span>
                                  </div>
                                )}
                                {logEntry.result.response !== undefined && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-blue-800">Resposta:</span>{' '}
                                    <span className="text-blue-900">{String(logEntry.result.response)}</span>
                                  </div>
                                )}
                              </>
                            )}
                            {logEntry.result._fallbackUsed && (
                              <div className="mt-1 pt-1 border-t border-blue-300">
                                <span className="text-orange-700 font-semibold text-xs">
                                  ⚠ Fallback usado
                                  {logEntry.result._reason && ` (${logEntry.result._reason})`}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {logEntry.eventType === 'IA_FALLBACK_USED' && logEntry.originalResponse && (
                        <div className="text-text-secondary mt-1">
                          <span className="font-semibold">Resposta original da IA:</span>
                          <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-xs">
                            {logEntry.originalResponse._noMatch || logEntry.originalResponse.value === null ? (
                              <div className="text-gray-600 italic">
                                Nenhum match encontrado
                              </div>
                            ) : (
                              <>
                                {logEntry.originalResponse.value !== undefined && logEntry.originalResponse.value !== null && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-gray-700">Valor:</span>{' '}
                                    <span className="font-mono text-gray-800">{String(logEntry.originalResponse.value)}</span>
                                  </div>
                                )}
                                {logEntry.originalResponse.confidence !== undefined && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-gray-700">Confiança:</span>{' '}
                                    <span className="font-mono text-gray-800">
                                      {(logEntry.originalResponse.confidence * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {logEntry.error && (
                        <div className="text-red-600">
                          <span className="font-semibold">Erro:</span> {logEntry.error}
                        </div>
                      )}
                      {logEntry.condition && (
                        <div className="text-text-tertiary text-[10px] font-mono bg-bg-tertiary p-1 rounded mt-1">
                          {JSON.stringify(logEntry.condition, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                  ))
                )}
                <div ref={executionLogEndRef} />
              </div>
            ) : (
              // Modo colapsado - textos verticais, EXATAMENTE como o painel direito
              <div className="flex-1 p-2 section-container flex items-center justify-center vertical">
                Execução do Fluxo
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


