import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { RpaConfigDialog } from '../components/RpaConfigDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RpaTestGeneratorDialog } from '../components/RpaTestGeneratorDialog';
import { FlowAndRpaTestGeneratorDialog } from '../components/FlowAndRpaTestGeneratorDialog';
import { FlowSelector } from '../components/FlowSelector';
import { Button } from '../styles/Button';
import { Input, Textarea } from '../styles/Input';
import { listRpaRecordings, executeRpaRecording, getRpaExecutionStatus, cancelRpaExecution, continueRpaExecution, nextRpaStep, deleteRpaRecording } from '../api/rpa';
import { listFlows, generateFlowWithOrchestrator } from '../api/flows';
import { uploadDocument } from '../api/ragDocuments';
import { validateFlowRpaPayload } from '../utils/flowRpaValidator';
import logger from '../utils/logger';

/**
 * Página de geração e execução de fluxos e testes RPA.
 * Interface completa para gerar fluxos e testes RPA por IA, além de executar testes existentes.
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

  // Estados para geração completa de fluxo e RPA
  const [showFullGenerator, setShowFullGenerator] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [useRag, setUseRag] = useState(false);
  const [ragSources, setRagSources] = useState([]);
  const [useWebScraping, setUseWebScraping] = useState(false);
  const [scrapingTargets, setScrapingTargets] = useState(['']);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [generateRpaTest, setGenerateRpaTest] = useState(false);
  const [rpaMode, setRpaMode] = useState('infer');
  const [bootstrap, setBootstrap] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [payload, setPayload] = useState({});
  const [generating, setGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState(null);
  const [generationError, setGenerationError] = useState(null);

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

  // Lógica automática do modo Bootstrap
  useEffect(() => {
    if (bootstrap) {
      setUseRag(false);
      setRagSources([]);
      setGenerateRpaTest(true);
    }
  }, [bootstrap]);

  // Gera payload sempre que os dados mudarem
  useEffect(() => {
    if (!showFullGenerator) return;

    const effectiveUseRag = bootstrap ? false : useRag;
    const effectiveRagSources = bootstrap ? [] : (useRag ? ragSources : []);
    const effectiveGenerateRpaTest = bootstrap ? true : generateRpaTest;

    const newPayload = {
      name: name.trim(),
      description: description.trim(),
      useRag: effectiveUseRag,
      ragSources: effectiveRagSources.length > 0 ? effectiveRagSources : undefined,
      useWebScraping,
      scrapingTargets: useWebScraping ? scrapingTargets.filter(url => url.trim()) : undefined,
      generateRpaTest: effectiveGenerateRpaTest,
      rpaMode: effectiveGenerateRpaTest ? rpaMode : undefined,
    };

    if (bootstrap) {
      newPayload.bootstrap = true;
      newPayload.generate = {
        flow: true,
        seed: true,
        rpa: true,
      };
    }

    Object.keys(newPayload).forEach(key => {
      if (newPayload[key] === undefined) {
        delete newPayload[key];
      }
    });

    setPayload(newPayload);
  }, [name, description, useRag, ragSources, useWebScraping, scrapingTargets, generateRpaTest, rpaMode, bootstrap, showFullGenerator]);

  // Validação em tempo real
  useEffect(() => {
    if (showFullGenerator && payload && Object.keys(payload).length > 0) {
      const validation = validateFlowRpaPayload(payload);
      setValidationErrors(validation.errors || {});
    } else {
      setValidationErrors({});
    }
  }, [payload, showFullGenerator]);

  // Verifica se o formulário é válido
  const isValid = useMemo(() => {
    if (!showFullGenerator) return false;
    if (!name.trim() || name.trim().length < 3) return false;
    if (!description.trim() || description.trim().length < 10) return false;
    
    if (bootstrap) {
      if (!useWebScraping) return false;
      const validUrls = scrapingTargets.filter(url => {
        try {
          new URL(url.trim());
          return url.trim().length > 0;
        } catch {
          return false;
        }
      });
      if (validUrls.length === 0) return false;
      return true;
    }
    
    if (!useRag && !useWebScraping) return false;
    if (useRag && ragSources.length === 0) return false;
    
    if (useWebScraping) {
      const validUrls = scrapingTargets.filter(url => {
        try {
          new URL(url.trim());
          return url.trim().length > 0;
        } catch {
          return false;
        }
      });
      if (validUrls.length === 0) return false;
    }

    return true;
  }, [name, description, useRag, ragSources, useWebScraping, scrapingTargets, bootstrap, showFullGenerator]);

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

  // Handlers para geração completa
  const handleRagSourceToggle = (source) => {
    if (ragSources.includes(source)) {
      setRagSources(ragSources.filter(s => s !== source));
    } else {
      setRagSources([...ragSources, source]);
    }
  };

  const handleScrapingTargetChange = (index, value) => {
    const newTargets = [...scrapingTargets];
    newTargets[index] = value;
    setScrapingTargets(newTargets);
  };

  const addScrapingTarget = () => {
    setScrapingTargets([...scrapingTargets, '']);
  };

  const removeScrapingTarget = (index) => {
    if (scrapingTargets.length > 1) {
      setScrapingTargets(scrapingTargets.filter((_, i) => i !== index));
    }
  };

  const validateUrl = (url) => {
    if (!url.trim()) return null;
    try {
      new URL(url.trim());
      return true;
    } catch {
      return false;
    }
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setUploadingDocuments(true);
    const newDocuments = [];

    try {
      for (const file of files) {
        try {
          const result = await uploadDocument(file, {
            metadata: { source: 'flow_generator_upload' },
            autoIndex: true,
          });
          
          newDocuments.push({
            id: result.id,
            title: result.title,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          });
          
          showToast(`Documento "${file.name}" carregado com sucesso!`, 'success');
        } catch (error) {
          logger.error('Erro ao fazer upload de documento', error);
          showToast(`Erro ao carregar "${file.name}": ${error.message}`, 'error');
        }
      }

      setUploadedDocuments([...uploadedDocuments, ...newDocuments]);
      
      if (newDocuments.length > 0 && !useRag) {
        setUseRag(true);
        if (!ragSources.includes('docs')) {
          setRagSources([...ragSources, 'docs']);
        }
      }
    } finally {
      setUploadingDocuments(false);
      event.target.value = '';
    }
  };

  const removeUploadedDocument = (documentId) => {
    setUploadedDocuments(uploadedDocuments.filter(doc => doc.id !== documentId));
  };

  const handleGenerateSubmit = async () => {
    if (!isValid) {
      showToast('Por favor, preencha todos os campos obrigatórios corretamente', 'error');
      return;
    }

    try {
      setGenerating(true);
      setGenerationError(null);
      setGenerationResult(null);

      if (bootstrap) {
        showToast('Iniciando geração em modo Bootstrap... Isso pode levar alguns minutos.', 'info');
      } else {
        showToast('Gerando fluxo e teste RPA...', 'info');
      }

      const result = await generateFlowWithOrchestrator(payload);

      setGenerationResult(result);

      if (result.success) {
        if (bootstrap && result.validation?.bootstrap?.success) {
          showToast('✅ Bootstrap concluído com sucesso! Fluxo, seed e RPA foram gerados e validados.', 'success', 5000);
        } else if (bootstrap) {
          showToast('⚠️ Bootstrap executado, mas a validação RPA falhou. Nada foi persistido.', 'warning', 5000);
        } else {
          showToast('✅ Fluxo e teste RPA gerados com sucesso!', 'success', 5000);
        }

        // Recarrega gravações e fluxos
        loadRecordings();
        loadFlows();
      } else {
        throw new Error(result.error || 'Erro desconhecido na geração');
      }

    } catch (error) {
      logger.error('Erro ao gerar fluxo', error);
      setGenerationError(error.message || 'Erro ao gerar fluxo e teste RPA. Tente novamente.');
      
      if (bootstrap) {
        showToast(`❌ Erro no Bootstrap: ${error.message}. Nada foi persistido.`, 'error', 5000);
      } else {
        showToast(`❌ Erro: ${error.message}`, 'error', 5000);
      }
    } finally {
      setGenerating(false);
    }
  };

  const copyPayload = () => {
    if (!payload) return;
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    showToast('Payload copiado para a área de transferência!', 'success');
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
    <div className="h-screen bg-bg-primary flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-6 border-b border-border-default bg-bg-elevated">
        <div className="max-w-full mx-auto">
          <h1 className="text-3xl font-bold text-text-primary mb-2">🚀 Flow & RPA Generator</h1>
          <p className="text-text-secondary text-sm">
            Interface completa para gerar fluxos e testes RPA por IA, além de executar testes automatizados
          </p>
        </div>
      </div>

      {/* Layout de duas colunas */}
      <div className="flex-1 flex overflow-hidden">
        {/* Coluna Esquerda: Gravações */}
        <div className="w-80 flex-shrink-0 border-r border-border-default bg-bg-elevated overflow-y-auto">
          <div className="p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-text-primary">📋 Gravações</h2>
              <Button
                variant="secondary"
                onClick={loadRecordings}
                disabled={loading}
                className="flex items-center gap-1 text-xs px-2 py-1"
              >
                <span>🔄</span>
                <span>Atualizar</span>
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-2"></div>
                <p className="text-text-secondary text-xs">Carregando...</p>
              </div>
            ) : recordings.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-text-secondary text-sm mb-2">Nenhuma gravação</p>
                <p className="text-text-tertiary text-xs">
                  Gravações em <code className="bg-bg-secondary px-1 py-0.5 rounded text-xs">tests/rpa/recordings/</code>
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recordings.map((recording) => (
                  <div
                    key={recording.id}
                    className="relative bg-bg-secondary rounded-lg border border-border-default p-3 hover:border-accent-primary transition-colors cursor-pointer group"
                    onClick={() => handleSelectRecording(recording)}
                  >
                    <div className="mb-1">
                      <h3 className="text-sm font-semibold text-text-primary truncate">
                        {recording.name || recording.id}
                      </h3>
                    </div>
                    {recording.description && (
                      <p className="text-text-secondary text-xs mb-1 line-clamp-2">{recording.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-text-tertiary">
                      <span>📝 {recording.steps?.length || 0} ações</span>
                      {recording.version && <span>• v{recording.version}</span>}
                    </div>
                    <span className="absolute bottom-2 right-2 text-lg">▶️</span>
                    <button
                      onClick={(e) => handleDeleteClick(e, recording)}
                      className="absolute top-2 right-2 w-5 h-5 rounded-full bg-status-error/10 hover:bg-status-error/20 text-status-error opacity-0 group-hover:opacity-100 transition-opacity duration-fast flex items-center justify-center text-xs font-bold z-10"
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
        </div>

        {/* Coluna Direita: Interface de Geração */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 pb-12">
            {/* Gerar Teste RPA por IA - Interface Completa */}
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mb-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-text-primary mb-2">🚀 Flow & RPA Generator</h2>
                  <p className="text-text-secondary text-sm">
                    Interface completa para gerar fluxos e testes RPA com suporte a Bootstrap, RAG, scraping e upload de documentos
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant={showFullGenerator ? "secondary" : "primary"}
                    onClick={() => {
                      setShowFullGenerator(!showFullGenerator);
                      if (!showFullGenerator) {
                        // Reset form when opening
                        setName('');
                        setDescription('');
                        setUseRag(false);
                        setRagSources([]);
                        setUseWebScraping(false);
                        setScrapingTargets(['']);
                        setUploadedDocuments([]);
                        setGenerateRpaTest(false);
                        setRpaMode('infer');
                        setBootstrap(false);
                        setGenerationResult(null);
                        setGenerationError(null);
                      }
                    }}
                    className="flex items-center gap-2"
                  >
                    <span>{showFullGenerator ? '▼' : '▶'}</span>
                    <span>{showFullGenerator ? 'Ocultar Interface Completa' : 'Mostrar Interface Completa'}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowFlowAndRpaTestGenerator(true)}
                    className="flex items-center gap-2"
                  >
                    <span>✨</span>
                    <span>Usar Diálogo Rápido</span>
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
                    <span>Gerar RPA de Fluxo Existente</span>
                  </Button>
                </div>
              </div>

              {/* Interface Completa de Geração */}
              {showFullGenerator && (
                <div className="mt-6 space-y-6 border-t border-border-default pt-6">
                  {/* Seção 1: Dados do Fluxo */}
                  <div className="bg-bg-secondary rounded-xl border border-border-default p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Dados do Fluxo</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block mb-2 text-sm font-medium text-text-primary">
                      Nome do fluxo <span className="text-status-error">*</span>
                    </label>
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Fluxo de Atendimento ao Cliente"
                      className="w-full"
                      disabled={generating}
                    />
                    {name.trim() && name.trim().length < 3 && (
                      <p className="text-xs text-status-error mt-1">
                        O nome deve ter pelo menos 3 caracteres
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block mb-2 text-sm font-medium text-text-primary">
                      Descrição funcional <span className="text-status-error">*</span>
                    </label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Descreva o fluxo que deseja criar em linguagem natural..."
                      rows={6}
                      className="w-full"
                      disabled={generating}
                    />
                    {description.trim() && description.trim().length < 10 && (
                      <p className="text-xs text-status-error mt-1">
                        A descrição deve ter pelo menos 10 caracteres
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Seção 2: Fonte de Conhecimento da IA */}
              <div className="bg-bg-secondary rounded-xl border border-border-default p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Fonte de Conhecimento da IA</h3>
                
                <div className="space-y-6">
                  {/* RAG */}
                  <div className="space-y-3">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useRag}
                        onChange={(e) => {
                          if (!bootstrap) {
                            setUseRag(e.target.checked);
                            if (!e.target.checked) {
                              setRagSources([]);
                            }
                          }
                        }}
                        disabled={bootstrap || generating}
                        className="rounded border-border-default w-4 h-4"
                      />
                      <span className="text-sm font-medium text-text-primary">
                        Usar conhecimento interno (RAG)
                        {bootstrap && <span className="text-xs text-text-tertiary ml-2">(desativado no modo Bootstrap)</span>}
                      </span>
                    </label>
                    
                    {useRag && (
                      <div className="ml-6 space-y-2 p-4 bg-bg-primary rounded-lg border border-border-default">
                        <div className="text-xs text-text-tertiary mb-2">
                          Selecione pelo menos uma fonte:
                        </div>
                        {[
                          { value: 'flows', label: 'Fluxos existentes' },
                          { value: 'qa', label: 'Base de QA' },
                          { value: 'docs', label: 'Documentação' },
                        ].map((source) => (
                          <label key={source.value} className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ragSources.includes(source.value)}
                              onChange={() => handleRagSourceToggle(source.value)}
                              disabled={generating}
                              className="rounded border-border-default w-4 h-4"
                            />
                            <span className="text-sm text-text-secondary">{source.label}</span>
                          </label>
                        ))}
                        {useRag && ragSources.length === 0 && (
                          <p className="text-xs text-status-error mt-2">
                            Selecione pelo menos uma fonte de conhecimento
                          </p>
                        )}

                        {/* Upload de Documentos */}
                        <div className="mt-4 pt-4 border-t border-border-default">
                          <div className="text-xs text-text-tertiary mb-2">
                            Upload de documentos:
                          </div>
                          <label className="flex items-center justify-center w-full p-3 border-2 border-dashed border-border-default rounded-lg cursor-pointer hover:border-accent-primary transition-colors">
                            <input
                              type="file"
                              multiple
                              accept=".txt,.md,.json,.csv,.pdf,.doc,.docx"
                              onChange={handleFileUpload}
                              disabled={uploadingDocuments || bootstrap || generating}
                              className="hidden"
                            />
                            <div className="text-center">
                              <div className="text-sm text-text-primary">
                                {uploadingDocuments ? '📤 Carregando...' : '📄 Clique para fazer upload de documentos'}
                              </div>
                              <div className="text-xs text-text-tertiary mt-1">
                                Formatos: TXT, MD, JSON, CSV, PDF, DOC, DOCX
                              </div>
                            </div>
                          </label>

                          {uploadedDocuments.length > 0 && (
                            <div className="space-y-1 mt-2">
                              {uploadedDocuments.map((doc) => (
                                <div key={doc.id} className="flex items-center justify-between p-2 bg-bg-primary rounded border border-border-default text-xs">
                                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                                    <span>📄</span>
                                    <span className="text-text-primary truncate">{doc.fileName}</span>
                                    <span className="text-text-tertiary">
                                      ({(doc.fileSize / 1024).toFixed(1)} KB)
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeUploadedDocument(doc.id)}
                                    className="ml-2 px-2 py-1 text-status-error hover:bg-status-error/10 rounded transition-colors"
                                    disabled={bootstrap || generating}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Web Scraping */}
                  <div className="space-y-3">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useWebScraping}
                        onChange={(e) => {
                          setUseWebScraping(e.target.checked);
                          if (!e.target.checked) {
                            setScrapingTargets(['']);
                          } else if (scrapingTargets.length === 0) {
                            setScrapingTargets(['']);
                          }
                        }}
                        disabled={generating}
                        className="rounded border-border-default w-4 h-4"
                      />
                      <span className="text-sm font-medium text-text-primary">
                        Usar fontes externas (Raspagem de sites)
                        {bootstrap && <span className="text-xs text-text-tertiary ml-2">(obrigatório no modo Bootstrap)</span>}
                      </span>
                    </label>
                    
                    {useWebScraping && (
                      <div className="ml-6 space-y-2 p-4 bg-bg-primary rounded-lg border border-border-default">
                        <div className="text-xs text-text-tertiary mb-2">
                          URLs de sites para raspagem:
                        </div>
                        <div className="space-y-2">
                          {scrapingTargets.map((url, index) => (
                            <div key={index} className="flex gap-2 items-start">
                              <div className="flex-1">
                                <Input
                                  type="url"
                                  value={url}
                                  onChange={(e) => handleScrapingTargetChange(index, e.target.value)}
                                  placeholder="https://exemplo.com/documentacao"
                                  className="w-full font-mono text-xs"
                                  disabled={generating}
                                />
                                {url.trim() && !validateUrl(url) && (
                                  <p className="text-xs text-status-error mt-1">
                                    URL inválida. Use formato: https://exemplo.com
                                  </p>
                                )}
                                {url.trim() && validateUrl(url) && (
                                  <p className="text-xs text-status-success mt-1">
                                    ✓ URL válida
                                  </p>
                                )}
                              </div>
                              {scrapingTargets.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeScrapingTarget(index)}
                                  disabled={generating}
                                  className="px-3 py-2 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
                                >
                                  Remover
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        
                        <button
                          type="button"
                          onClick={addScrapingTarget}
                          disabled={generating}
                          className="text-sm text-accent-primary hover:text-accent-hover transition-colors flex items-center gap-1"
                        >
                          <span>+</span>
                          <span>Adicionar mais uma URL</span>
                        </button>
                        
                        {useWebScraping && scrapingTargets.filter(url => validateUrl(url)).length === 0 && (
                          <p className="text-xs text-status-error mt-2">
                            {bootstrap 
                              ? '⚠️ No modo Bootstrap, pelo menos uma URL válida é obrigatória'
                              : '⚠️ Adicione pelo menos uma URL válida para raspagem'
                            }
                          </p>
                        )}
                        
                        {useWebScraping && scrapingTargets.filter(url => validateUrl(url)).length > 0 && (
                          <div className="text-xs text-status-success bg-status-success/10 p-2 rounded mt-2">
                            ✓ {scrapingTargets.filter(url => validateUrl(url)).length} URL(s) válida(s) configurada(s)
                          </div>
                        )}
                        
                        <div className="text-xs text-status-warning bg-status-warning/10 p-2 rounded mt-2">
                          ⚠️ <strong>Atenção:</strong> Raspagem de sites requer aprovação e será auditada.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Validação */}
                  {!bootstrap && !useRag && !useWebScraping && (
                    <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                      ⚠️ Selecione pelo menos uma fonte de conhecimento (RAG ou Raspagem)
                    </div>
                  )}
                  {bootstrap && !useWebScraping && (
                    <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                      ⚠️ No modo Bootstrap, pelo menos uma URL de scraping deve ser informada
                    </div>
                  )}
                </div>
              </div>

              {/* Seção 3: Modo Bootstrap */}
              <div className="bg-bg-secondary rounded-xl border border-border-default p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Modo Bootstrap (Gerar tudo do zero)</h3>
                
                <div className="space-y-4">
                  <label className="flex items-start space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bootstrap}
                      onChange={(e) => setBootstrap(e.target.checked)}
                      disabled={generating}
                      className="rounded border-border-default w-4 h-4 mt-1"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-text-primary block">
                        Gerar tudo do zero (Bootstrap)
                      </span>
                      <div className="mt-2 p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-xs">
                        ⚠️ <strong>Aviso obrigatório:</strong> Este modo cria a base do sistema.
                        Nada será salvo se o teste RPA falhar.
                      </div>
                    </div>
                  </label>
                  
                  {bootstrap && (
                    <div className="ml-6 space-y-2 p-4 bg-bg-primary rounded-lg border border-border-default">
                      <div className="text-xs text-text-tertiary mb-2">
                        No modo Bootstrap:
                      </div>
                      <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
                        <li>RAG é automaticamente desativado</li>
                        <li>Fluxo base será gerado</li>
                        <li>Seed base será gerado</li>
                        <li>Teste RPA base será gerado e validado</li>
                        <li>Scraping é obrigatório (pelo menos uma URL)</li>
                        <li>Nada será persistido antes do RPA passar</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Seção 4: Geração de Teste RPA */}
              <div className="bg-bg-secondary rounded-xl border border-border-default p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Geração de Teste RPA</h3>
                
                <div className="space-y-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bootstrap ? true : generateRpaTest}
                      onChange={(e) => {
                        if (!bootstrap) {
                          setGenerateRpaTest(e.target.checked);
                          if (!e.target.checked) {
                            setRpaMode('infer');
                          }
                        }
                      }}
                      disabled={bootstrap || generating}
                      className="rounded border-border-default w-4 h-4"
                    />
                    <span className="text-sm font-medium text-text-primary">
                      Gerar teste RPA automaticamente
                      {bootstrap && <span className="text-xs text-text-tertiary ml-2">(obrigatório no modo Bootstrap)</span>}
                    </span>
                  </label>
                  
                  {(bootstrap || generateRpaTest) && (
                    <div className="ml-6 space-y-2">
                      <label className="block text-sm font-medium text-text-primary">
                        Modo:
                      </label>
                      <div className="space-y-2">
                        {[
                          { value: 'infer', label: 'Inferido pela IA' },
                          { value: 'record', label: 'Gravação assistida' },
                          { value: 'hybrid', label: 'Híbrido' },
                        ].map((mode) => (
                          <label key={mode.value} className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="radio"
                              name="rpaMode"
                              value={mode.value}
                              checked={rpaMode === mode.value}
                              onChange={(e) => setRpaMode(e.target.value)}
                              disabled={generating}
                              className="rounded border-border-default"
                            />
                            <span className="text-sm text-text-secondary">{mode.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Payload Gerado */}
              <div className="bg-bg-secondary rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-text-primary">
                    Payload gerado (somente leitura)
                  </h3>
                  <Button
                    variant="secondary"
                    onClick={copyPayload}
                    disabled={!payload || Object.keys(payload).length === 0}
                  >
                    📋 Copiar payload
                  </Button>
                </div>
                
                <div className="bg-bg-primary rounded-lg border border-border-default p-4 max-h-96 overflow-y-auto">
                  <pre className="text-xs text-text-primary font-mono whitespace-pre-wrap">
                    {payload && Object.keys(payload).length > 0 ? JSON.stringify(payload, null, 2) : 'Preencha o formulário para gerar o payload...'}
                  </pre>
                </div>

                {Object.keys(validationErrors).length > 0 && (
                  <div className="mt-4 p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                    <strong>Erros de validação:</strong>
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      {Object.entries(validationErrors).map(([field, error]) => (
                        <li key={field}>
                          <strong>{field}:</strong> {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Botão de Submit */}
              <div className="flex justify-end gap-3">
                <Button
                  variant="primary"
                  onClick={handleGenerateSubmit}
                  disabled={!isValid || generating}
                  title={!isValid ? 'Preencha todos os campos obrigatórios' : generating ? 'Gerando...' : 'Gerar fluxo e teste RPA'}
                >
                  {generating 
                    ? (bootstrap ? '🔄 Executando Bootstrap...' : '🔄 Gerando...') 
                    : (isValid 
                        ? (bootstrap ? '🚀 Executar Bootstrap' : '✅ Gerar Fluxo e RPA')
                        : '⚠️ Preencha os campos obrigatórios'
                      )
                  }
                </Button>
              </div>

              {/* Resultado da Geração */}
              {generationResult && (
                <div className="bg-bg-secondary rounded-xl border border-border-default p-6">
                  <h3 className="text-lg font-semibold text-text-primary mb-4">
                    Resultado da Geração
                  </h3>
                  
                  <div className="space-y-4">
                    {generationResult.flowDefinition && (
                      <div className="p-4 bg-bg-primary rounded-lg">
                        <div className="text-sm font-medium text-text-primary mb-2">
                          ✅ Fluxo Gerado
                        </div>
                        <div className="text-xs text-text-secondary space-y-1">
                          <div><strong>ID:</strong> {generationResult.flowDefinition.id}</div>
                          <div><strong>Nome:</strong> {generationResult.flowDefinition.name}</div>
                          <div><strong>Nós:</strong> {generationResult.flowDefinition.nodes?.length || 0}</div>
                        </div>
                      </div>
                    )}

                    {generationResult.rpaTest && (
                      <div className="p-4 bg-bg-primary rounded-lg">
                        <div className="text-sm font-medium text-text-primary mb-2">
                          ✅ Teste RPA Gerado
                        </div>
                        <div className="text-xs text-text-secondary space-y-1">
                          <div><strong>ID:</strong> {generationResult.rpaTest.id}</div>
                          <div><strong>Passos:</strong> {generationResult.rpaTest.steps?.length || 0}</div>
                          <div><strong>Asserts:</strong> {generationResult.rpaTest.asserts?.length || 0}</div>
                        </div>
                      </div>
                    )}

                    {bootstrap && generationResult.validation?.bootstrap && (
                      <div className={`p-4 rounded-lg ${
                        generationResult.validation.bootstrap.success 
                          ? 'bg-status-success/10 border border-status-success/20' 
                          : 'bg-status-error/10 border border-status-error/20'
                      }`}>
                        <div className={`text-sm font-medium mb-2 ${
                          generationResult.validation.bootstrap.success 
                            ? 'text-status-success' 
                            : 'text-status-error'
                        }`}>
                          {generationResult.validation.bootstrap.success 
                            ? '✅ Validação Bootstrap: PASSOU' 
                            : '❌ Validação Bootstrap: FALHOU'
                          }
                        </div>
                        {generationResult.validation.bootstrap.error && (
                          <div className="text-xs text-text-secondary">
                            {generationResult.validation.bootstrap.error}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      {generationResult.flowDefinition && (
                        <Button
                          variant="secondary"
                          onClick={() => navigate(`/editor?flowId=${generationResult.flowDefinition.id}`)}
                        >
                          Abrir no Editor
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setGenerationResult(null);
                          setGenerationError(null);
                        }}
                      >
                        Limpar Resultado
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Erro da Geração */}
              {generationError && (
                <div className="bg-bg-secondary rounded-xl border border-status-error/20 p-6">
                  <h3 className="text-lg font-semibold text-status-error mb-4">
                    Erro na Geração
                  </h3>
                  <div className="p-4 bg-status-error/10 rounded-lg text-text-primary text-sm">
                    {generationError}
                  </div>
                  <div className="mt-4">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setGenerationError(null);
                      }}
                    >
                      Fechar
                    </Button>
                  </div>
                </div>
              )}
                </div>
              )}

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
          </div>
        </div>
      </div>

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

