import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { RpaConfigDialog } from '../components/RpaConfigDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RpaTestGeneratorDialog } from '../components/RpaTestGeneratorDialog';
import { FlowAndRpaTestGeneratorDialog } from '../components/FlowAndRpaTestGeneratorDialog';
import { FlowSelector } from '../components/FlowSelector';
import { Button } from '../styles/Button';
import { listRpaRecordings, executeRpaRecording, getRpaExecutionStatus, cancelRpaExecution, continueRpaExecution, nextRpaStep, deleteRpaRecording } from '../api/rpa';
import { listFlows } from '../api/flows';
import logger from '../utils/logger';

/**
 * Página de testes RPA.
 * Permite selecionar gravações e configurar execução antes de iniciar.
 */
export function RpaTestPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionId, setExecutionId] = useState(null);
  const [executionStatus, setExecutionStatus] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [recordingToDelete, setRecordingToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showRpaTestGenerator, setShowRpaTestGenerator] = useState(false);
  const [showFlowAndRpaTestGenerator, setShowFlowAndRpaTestGenerator] = useState(false);
  const [selectedFlow, setSelectedFlow] = useState(null);
  const [flows, setFlows] = useState([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const logsEndRef = useRef(null);
  const previousStatusRef = useRef(null);

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Carrega gravações disponíveis
  useEffect(() => {
    loadRecordings();
    loadFlows();
  }, []);

  const loadFlows = async () => {
    setLoadingFlows(true);
    try {
      const data = await listFlows();
      setFlows(Array.isArray(data) ? data : []);
    } catch (error) {
      logger.error('Erro ao carregar fluxos', error);
      setFlows([]);
    } finally {
      setLoadingFlows(false);
    }
  };

  const handleFlowSelected = (flow) => {
    setSelectedFlow(flow);
    if (flow) {
      setShowRpaTestGenerator(true);
    }
  };

  // Scroll automático para o final dos logs
  useEffect(() => {
    if (logsEndRef.current && executionStatus?.logs?.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [executionStatus?.logs]);

  // Polling do status de execução com backoff exponencial
  useEffect(() => {
    if (!executionId || !executing) return;

    let timeoutId;
    let pollingTimeoutId;
    let lastProgress = 0;
    let lastProgressTime = Date.now();
    let noProgressCount = 0;
    let currentInterval = 2000; // Começa com 2 segundos
    const minInterval = 2000; // Mínimo de 2 segundos
    const maxInterval = 10000; // Máximo de 10 segundos
    let consecutiveNoChange = 0;
    
    // Timeout de segurança: para o polling após 10 minutos
    timeoutId = setTimeout(() => {
      if (pollingTimeoutId) {
        clearTimeout(pollingTimeoutId);
      }
      setExecuting(false);
      showToast('Timeout: Execução RPA demorou muito tempo', 'warning');
    }, 10 * 60 * 1000); // 10 minutos

    const pollStatus = async () => {
      try {
        const status = await getRpaExecutionStatus(executionId);
        if (!status) {
          // Execução não encontrada, para o polling
          if (pollingTimeoutId) {
            clearTimeout(pollingTimeoutId);
          }
          clearTimeout(timeoutId);
          setExecuting(false);
          showToast('Execução RPA não encontrada', 'warning');
          return;
        }
        
        const previousStatus = previousStatusRef.current?.status;
        const previousProgress = previousStatusRef.current?.progress || 0;
        const previousLogsLength = previousStatusRef.current?.logs?.length || 0;
        
        setExecutionStatus(status);
        previousStatusRef.current = status;

        // Verifica se houve mudanças
        const hasChanged = 
          status.status !== previousStatus || 
          status.progress !== previousProgress ||
          (status.logs?.length || 0) !== previousLogsLength;

        if (hasChanged) {
          // Reset do intervalo quando há mudanças
          currentInterval = minInterval;
          consecutiveNoChange = 0;
        } else {
          // Aumenta o intervalo gradualmente quando não há mudanças
          consecutiveNoChange++;
          if (consecutiveNoChange > 3) {
            // Após 3 verificações sem mudanças, aumenta o intervalo
            currentInterval = Math.min(currentInterval * 1.5, maxInterval);
            consecutiveNoChange = 0; // Reset para permitir mais aumentos
          }
        }

        // Verifica se houve progresso (apenas quando está rodando, não quando pausado)
        if (status.status === 'running') {
          const currentProgress = status.progress || 0;
          const now = Date.now();
          
          if (currentProgress === lastProgress) {
            // Sem progresso
            const timeSinceLastProgress = now - lastProgressTime;
            // Se não houver progresso por mais de 2 minutos, considera travado
            if (timeSinceLastProgress > 2 * 60 * 1000) {
              if (pollingTimeoutId) {
                clearTimeout(pollingTimeoutId);
              }
              clearTimeout(timeoutId);
              setExecuting(false);
              showToast('Execução RPA parece estar travada (sem progresso por 2 minutos)', 'warning');
              return;
            }
          } else {
            // Houve progresso, atualiza
            lastProgress = currentProgress;
            lastProgressTime = now;
            noProgressCount = 0;
            // Quando há progresso, volta ao intervalo mínimo
            currentInterval = minInterval;
          }
        }

        // Quando pausado, continua o polling mas não para a execução
        if (status.status === 'paused') {
          // Continua o polling para detectar quando o usuário clicar em "Continuar"
          // Não para o polling nem a execução
        } else if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          if (pollingTimeoutId) {
            clearTimeout(pollingTimeoutId);
          }
          clearTimeout(timeoutId);
          setExecuting(false);
          setCancelling(false);
          
          if (status.status === 'completed') {
            showToast('Execução RPA concluída com sucesso!', 'success');
          } else if (status.status === 'failed') {
            const errorMsg = status.error || status.results?.errors?.[0]?.error || 'Erro desconhecido';
            // Se a mensagem for sobre navegador fechado pelo usuário, trata como warning
            const isBrowserClosed = errorMsg.includes('Navegador fechado pelo usuário');
            const toastType = isBrowserClosed ? 'warning' : 'error';
            showToast(`Execução RPA falhou: ${errorMsg.substring(0, 100)}${errorMsg.length > 100 ? '...' : ''}`, toastType);
          } else if (status.status === 'cancelled') {
            // Se foi cancelado porque o navegador foi fechado, mostra mensagem específica
            const errorMsg = status.error || '';
            const isBrowserClosed = errorMsg.includes('Navegador fechado pelo usuário');
            const message = isBrowserClosed ? 'Execução RPA cancelada: Navegador fechado pelo usuário' : 'Execução RPA cancelada';
            showToast(message, 'warning');
          }
          return; // Para o polling
        }

        // Agenda próxima verificação
        pollingTimeoutId = setTimeout(pollStatus, currentInterval);
      } catch (error) {
        logger.error('Erro ao verificar status da execução', error);
        noProgressCount++;
        // Se houver muitos erros consecutivos, para o polling
        if (noProgressCount > 10) {
          if (pollingTimeoutId) {
            clearTimeout(pollingTimeoutId);
          }
          clearTimeout(timeoutId);
          setExecuting(false);
          showToast('Erro ao verificar status da execução RPA', 'error');
          return;
        }
        // Em caso de erro, aumenta o intervalo
        currentInterval = Math.min(currentInterval * 2, maxInterval);
        pollingTimeoutId = setTimeout(pollStatus, currentInterval);
      }
    };

    // Inicia o polling
    pollingTimeoutId = setTimeout(pollStatus, minInterval);

    return () => {
      if (pollingTimeoutId) clearTimeout(pollingTimeoutId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [executionId, executing, showToast]);

  const loadRecordings = async () => {
    setLoading(true);
    try {
      console.log('📡 Carregando gravações RPA...');
      const data = await listRpaRecordings();
      console.log('✅ Gravações recebidas:', data?.length || 0, data);
      setRecordings(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0) {
        console.log('📋 Gravações disponíveis:', data.map(r => r.name || r.id).join(', '));
      } else {
        console.warn('⚠️ Nenhuma gravação retornada ou array vazio');
      }
    } catch (error) {
      console.error('❌ Erro ao carregar gravações RPA:', error);
      logger.error('Erro ao carregar gravações RPA', error);
      showToast('Erro ao carregar gravações RPA: ' + (error.message || 'Erro desconhecido'), 'error');
      setRecordings([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecording = (recording) => {
    console.log('📋 Gravação selecionada:', recording?.id || recording?.name);
    if (!recording) {
      console.error('❌ Gravação é null ou undefined');
      return;
    }
    setSelectedRecording(recording);
    console.log('🔧 Definindo showConfigDialog como true...');
    setShowConfigDialog(true);
    console.log('✅ Estado atualizado - diálogo deve abrir');
  };

  const handleDeleteClick = (e, recording) => {
    e.stopPropagation(); // Previne que o clique no botão selecione a gravação
    setRecordingToDelete(recording);
  };

  const handleConfirmDelete = async () => {
    if (!recordingToDelete) return;

    const recordingId = recordingToDelete.id;
    const recordingName = recordingToDelete.name || recordingToDelete.id;

    try {
      setDeleting(true);
      logger.info('🗑️ Removendo gravação RPA', {
        id: recordingId,
        internalId: recordingToDelete.internalId,
        name: recordingName,
      });
      
      const result = await deleteRpaRecording(recordingId);
      
      // Remove imediatamente da lista local sem reload completo
      setRecordings(prev => prev.filter(r => r.id !== recordingId));
      
      // Toast apropriado baseado no resultado
      if (result.alreadyDeleted) {
        logger.info('Gravação já havia sido removida (idempotente)', { recordingId });
        showToast(`Gravação "${recordingName}" já havia sido removida`, 'warning');
      } else {
        logger.info('Gravação removida com sucesso', { recordingId });
        showToast(`Gravação "${recordingName}" removida com sucesso`, 'success');
      }
    } catch (err) {
      logger.error('Erro ao remover gravação RPA', {
        recordingId,
        error: err.message,
        status: err.status,
        url: err.url,
      });
      
      // Determina tipo de erro para toast apropriado
      let errorMessage = err.message || 'Erro desconhecido';
      let toastType = 'error';
      
      if (err.status === 403) {
        errorMessage = 'Sem permissão para remover esta gravação';
        toastType = 'error';
      } else if (err.status === 500) {
        errorMessage = 'Erro interno do servidor ao remover gravação';
        toastType = 'error';
      } else if (err.message?.includes('Failed to fetch') || err.message?.includes('fetch')) {
        errorMessage = 'Não foi possível conectar ao servidor. Verifique se a API está rodando.';
        toastType = 'error';
      }
      
      showToast(`Erro ao remover gravação: ${errorMessage}`, toastType);
    } finally {
      setDeleting(false);
      setRecordingToDelete(null);
    }
  };

  const handleConfigConfirm = async (config) => {
    if (!selectedRecording) return;

    setShowConfigDialog(false);
    setExecuting(true);
    setExecutionStatus({ status: 'running', progress: 0 });

    // Log da configuração
    if (config.stepByStep) {
      logger.info('🎯 Modo Step-by-Step ATIVADO - Overlay será exibido na página do navegador');
      showToast('Modo Step-by-Step ativado! Use os controles na página do navegador.', 'info');
    }

    try {
      const result = await executeRpaRecording(selectedRecording.id, config);
      setExecutionId(result.executionId);
      
      if (result.executionId) {
        showToast('Execução RPA iniciada!', 'success');
      } else {
        // Execução síncrona (completa imediatamente)
        setExecuting(false);
        if (result.success) {
          showToast('Execução RPA concluída com sucesso!', 'success');
        } else {
          showToast('Execução RPA falhou', 'error');
        }
        setExecutionStatus(result);
      }
    } catch (error) {
      logger.error('Erro ao executar RPA', error);
      showToast('Erro ao executar RPA: ' + (error.message || 'Erro desconhecido'), 'error');
      setExecuting(false);
      setExecutionStatus({ status: 'failed', error: error.message });
    }
  };

  const handleCancelExecution = async () => {
    if (!executionId || !executing) return;

    setCancelling(true);
    try {
      await cancelRpaExecution(executionId);
      showToast('Cancelando execução RPA...', 'info');
      // O status será atualizado pelo polling
    } catch (error) {
      logger.error('Erro ao cancelar execução RPA', error);
      showToast('Erro ao cancelar execução RPA: ' + (error.message || 'Erro desconhecido'), 'error');
      setCancelling(false);
    }
  };

  const handleContinueExecution = async () => {
    if (!executionId) return;

    try {
      await continueRpaExecution(executionId);
      showToast('Continuando execução RPA sem pausas...', 'info');
      // O status será atualizado pelo polling
    } catch (error) {
      logger.error('Erro ao continuar execução RPA', error);
      showToast('Erro ao continuar execução RPA: ' + (error.message || 'Erro desconhecido'), 'error');
    }
  };

  const handleNextStep = async () => {
    if (!executionId) return;

    try {
      await nextRpaStep(executionId);
      showToast('Executando próximo passo...', 'info');
      // O status será atualizado pelo polling
    } catch (error) {
      logger.error('Erro ao executar próximo step RPA', error);
      showToast('Erro ao executar próximo step: ' + (error.message || 'Erro desconhecido'), 'error');
    }
  };

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

  return (
    <div className="min-h-screen bg-bg-primary p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">🤖 Testes RPA</h1>
          <p className="text-text-secondary text-sm">
            Execute testes automatizados de interface com configurações personalizadas
          </p>
        </div>

        {/* Gerar Teste RPA por IA */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-semibold text-text-primary mb-2">Gerar Teste RPA por IA</h2>
              <p className="text-text-secondary text-sm">
                Gera automaticamente um teste RPA executável a partir de um fluxo existente ou crie um novo fluxo
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowFlowAndRpaTestGenerator(true)}
                className="flex items-center gap-2"
              >
                <span>✨</span>
                <span>Criar Fluxo e Gerar Teste RPA</span>
              </Button>
              <div className="w-64">
                <FlowSelector
                  onFlowSelected={handleFlowSelected}
                  currentFlowId={selectedFlow?.id}
                  refreshTrigger={0}
                />
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  if (selectedFlow) {
                    setShowRpaTestGenerator(true);
                  } else {
                    showToast('Selecione um fluxo primeiro', 'warning');
                  }
                }}
                disabled={!selectedFlow || loadingFlows}
                className="flex items-center gap-2"
              >
                <span>🤖</span>
                <span>Gerar Teste RPA por IA</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Lista de Gravações */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-text-primary">Gravações Disponíveis</h2>
            <Button
              variant="secondary"
              onClick={loadRecordings}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <span>🔄</span>
              <span>Atualizar</span>
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
              <p className="text-text-secondary">Carregando gravações...</p>
            </div>
          ) : recordings.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-secondary mb-4">Nenhuma gravação encontrada</p>
              <p className="text-text-tertiary text-sm">
                As gravações devem estar em <code className="bg-bg-secondary px-2 py-1 rounded">tests/rpa/recordings/</code>
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recordings.map((recording) => (
                <div
                  key={recording.id}
                  className="relative bg-bg-secondary rounded-lg border border-border-default p-4 hover:border-accent-primary transition-colors cursor-pointer group"
                  onClick={() => handleSelectRecording(recording)}
                >
                  <div className="mb-2">
                    <h3 className="text-lg font-semibold text-text-primary">
                      {recording.name || recording.id}
                    </h3>
                  </div>
                  {recording.description && (
                    <p className="text-text-secondary text-sm mb-2">{recording.description}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-text-tertiary">
                    <span>📝 {recording.steps?.length || 0} ações</span>
                    {recording.version && <span>• v{recording.version}</span>}
                  </div>
                  <span className="absolute bottom-2 right-2 text-2xl">▶️</span>
                  <button
                    onClick={(e) => handleDeleteClick(e, recording)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-status-error/10 hover:bg-status-error/20 text-status-error opacity-0 group-hover:opacity-100 transition-opacity duration-fast flex items-center justify-center text-xs font-bold z-10"
                    title="Remover gravação"
                    disabled={deleting}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs de Execução */}
        {executing && executionStatus && (
          <div className="mt-6 bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-text-primary">📋 Log de Execução</h2>
              <div className="flex items-center gap-4">
                {executionStatus.status === 'paused' && executionStatus.stepByStep && (
                  <div className="flex flex-col gap-2">
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-status-info/20 text-status-info pulse-paused">
                      ⏸️ Pausado - Use os controles na página do navegador
                    </span>
                    <span className="text-xs text-text-secondary px-3">
                      💡 Verifique a janela do navegador controlado pelo Puppeteer para ver a caixa flutuante com os botões
                    </span>
                  </div>
                )}
                {executionStatus.status === 'paused' && !executionStatus.stepByStep && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={handleNextStep}
                      className="flex items-center gap-2"
                    >
                      <span>⏭️</span>
                      <span>Próximo</span>
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleContinueExecution}
                      className="flex items-center gap-2"
                    >
                      <span>▶️</span>
                      <span>Continuar</span>
                    </Button>
                    <Button
                      variant="danger"
                      onClick={handleCancelExecution}
                      disabled={cancelling}
                      className="flex items-center gap-2"
                    >
                      <span>⏹️</span>
                      <span>{cancelling ? 'Cancelando...' : 'Parar'}</span>
                    </Button>
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-status-warning/20 text-status-warning pulse-paused">
                      ⏸️ Pausado
                    </span>
                  </div>
                )}
                {executionStatus.status === 'running' && (
                  <>
                    <Button
                      variant="danger"
                      onClick={handleCancelExecution}
                      disabled={cancelling}
                      className="flex items-center gap-2"
                    >
                      <span>⏹️</span>
                      <span>{cancelling ? 'Cancelando...' : 'Parar'}</span>
                    </Button>
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-status-info/20 text-status-info">
                      🔄 Em execução
                    </span>
                  </>
                )}
                {executionStatus.status === 'completed' && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-status-success/20 text-status-success">
                    ✅ Concluído
                  </span>
                )}
                {executionStatus.status === 'failed' && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-status-error/20 text-status-error">
                    ❌ Falhou
                  </span>
                )}
                {executionStatus.status === 'cancelled' && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-status-warning/20 text-status-warning">
                    ⏹️ Cancelado
                  </span>
                )}
              </div>
            </div>

            {/* Barra de Progresso */}
            {executionStatus.progress !== undefined && (
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-text-secondary">
                    {executionStatus.currentStep || 'Inicializando...'}
                  </span>
                  <span className="text-sm text-text-secondary">
                    {executionStatus.progress}%
                    {executionStatus.totalSteps && ` (${Math.round((executionStatus.progress / 100) * executionStatus.totalSteps)}/${executionStatus.totalSteps})`}
                  </span>
                </div>
                <div className="w-full bg-bg-secondary rounded-full h-3">
                  <div
                    className="bg-accent-primary h-3 rounded-full transition-all duration-300 flex items-center justify-end pr-2"
                    style={{ width: `${executionStatus.progress}%` }}
                  >
                    {executionStatus.progress > 10 && (
                      <span className="text-xs text-white font-medium">{executionStatus.progress}%</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Logs */}
            <div className="bg-bg-secondary rounded-lg border border-border-default p-4 max-h-[600px] overflow-y-auto font-mono text-sm">
              {executionStatus.logs && executionStatus.logs.length > 0 ? (
                <div className="space-y-1">
                  {executionStatus.logs.map((log, index) => {
                    const time = new Date(log.timestamp).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    });
                    
                    const levelColors = {
                      info: 'text-text-secondary',
                      success: 'text-status-success',
                      error: 'text-status-error',
                      warning: 'text-status-warning',
                    };
                    
                    const levelIcons = {
                      info: 'ℹ️',
                      success: '✅',
                      error: '❌',
                      warning: '⚠️',
                    };
                    
                    return (
                      <div
                        key={index}
                        className={`flex items-start gap-2 py-1 px-2 rounded hover:bg-bg-primary transition-colors ${levelColors[log.level] || levelColors.info}`}
                      >
                        <span className="text-xs text-text-tertiary min-w-[80px]">{time}</span>
                        <span className="min-w-[20px]">{levelIcons[log.level] || 'ℹ️'}</span>
                        <span className="flex-1">{log.message}</span>
                        {log.step && (
                          <span className="text-xs text-text-tertiary min-w-[60px] text-right">
                            Step {log.step}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div ref={logsEndRef} />
                </div>
              ) : (
                <div className="text-center py-8 text-text-secondary">
                  <p>Aguardando logs...</p>
                </div>
              )}
            </div>

            {/* Resumo ao finalizar */}
            {executionStatus.status !== 'running' && executionStatus.results && (
              <div className="mt-4 p-4 bg-bg-secondary rounded-lg border border-border-default">
                <h3 className="font-medium text-text-primary mb-3">📊 Resumo da Execução</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-text-secondary">Total de ações:</span>
                    <span className="ml-2 font-medium text-text-primary">
                      {executionStatus.results.steps?.length || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-secondary">Sucesso:</span>
                    <span className="ml-2 font-medium text-status-success">
                      {executionStatus.results.steps?.filter(s => s.success).length || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-secondary">Falhas:</span>
                    <span className="ml-2 font-medium text-status-error">
                      {executionStatus.results.steps?.filter(s => !s.success).length || 0}
                    </span>
                  </div>
                </div>
                {executionStatus.results.duration && (
                  <div className="mt-2 text-sm">
                    <span className="text-text-secondary">Duração:</span>
                    <span className="ml-2 font-medium text-text-primary">
                      {(executionStatus.results.duration / 1000).toFixed(2)}s
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Erro se houver */}
            {(executionStatus.error || (executionStatus.results && executionStatus.results.errors && executionStatus.results.errors.length > 0)) && (
              <div className="mt-4 p-4 bg-status-error/10 border border-status-error/30 rounded-lg">
                <p className="text-status-error text-sm font-medium">Erro:</p>
                {executionStatus.error && (
                  <p className="text-status-error text-sm mt-1">{executionStatus.error}</p>
                )}
                {executionStatus.results && executionStatus.results.errors && executionStatus.results.errors.length > 0 && (
                  <div className="mt-2">
                    {executionStatus.results.errors.map((err, idx) => (
                      <p key={idx} className="text-status-error text-sm mt-1">
                        Step {err.step} ({err.action}): {err.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Diálogo de Configuração */}
        <RpaConfigDialog
          isOpen={showConfigDialog}
          onClose={() => {
            console.log('❌ Diálogo fechado pelo usuário');
            setShowConfigDialog(false);
            setSelectedRecording(null);
          }}
          onConfirm={(config) => {
            console.log('✅ Configuração confirmada:', config);
            handleConfigConfirm(config);
          }}
          defaultConfig={{
            slowMo: 500, // Velocidade padrão mais lenta para visualização
            headless: false, // SEMPRE mostra o navegador (não pode ser desabilitado)
            timeout: 30000,
            screenshotOnFailure: true,
            maxRetries: 3,
            retryDelay: 1000,
          }}
        />

        {/* Diálogo de Confirmação de Remoção */}
        <ConfirmDialog
          isOpen={!!recordingToDelete}
          onClose={() => !deleting && setRecordingToDelete(null)}
          onConfirm={handleConfirmDelete}
          title="Remover Gravação"
          message={`Tem certeza que deseja remover a gravação "${recordingToDelete?.name || recordingToDelete?.id}"?\n\nEsta ação não pode ser desfeita.`}
          confirmLabel={deleting ? 'Removendo...' : 'Remover'}
          cancelLabel="Cancelar"
          variant="danger"
          disabled={deleting}
        />

        {/* Diálogo de Geração de Teste RPA por IA */}
        {showRpaTestGenerator && selectedFlow && (
          <RpaTestGeneratorDialog
            flowId={selectedFlow.id}
            flowName={selectedFlow.name}
            flowVersion={selectedFlow.version}
            onTestGenerated={(rpaTest, result) => {
              logger.info('Teste RPA gerado e salvo', { testId: rpaTest?.id });
              setShowRpaTestGenerator(false);
              showToast('Teste RPA gerado e salvo com sucesso!', 'success', 3000);
              // Recarrega gravações para mostrar o novo teste
              loadRecordings();
            }}
            onCancel={() => {
              setShowRpaTestGenerator(false);
              setSelectedFlow(null);
            }}
          />
        )}

        {/* Diálogo de Criação de Fluxo e Geração de Teste RPA */}
        {showFlowAndRpaTestGenerator && (
          <FlowAndRpaTestGeneratorDialog
            onComplete={({ flow, rpaTest, saveResult }) => {
              logger.info('Fluxo e teste RPA criados com sucesso', { 
                flowId: flow?.id, 
                testId: rpaTest?.id 
              });
              setShowFlowAndRpaTestGenerator(false);
              showToast('Fluxo e teste RPA criados com sucesso!', 'success', 3000);
              // Recarrega gravações e fluxos
              loadRecordings();
              loadFlows();
            }}
            onCancel={() => setShowFlowAndRpaTestGenerator(false)}
          />
        )}

        <ToastContainer />
      </div>
    </div>
  );
}

