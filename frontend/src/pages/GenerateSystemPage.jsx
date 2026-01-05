import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input, Textarea } from '../styles/Input';
import { generateAndValidate, checkRateLimit } from '../api/system';
import { useWebSocketContext } from '../context/WebSocketContext';
import { uploadDocument } from '../api/ragDocuments';
import { processFile } from '../utils/fileProcessor';
import { fetchJson } from '../api/client';
import { Dialog } from '../components/Dialog';
import logger from '../utils/logger';

/**
 * Tela Única - Centro Operacional da Plataforma
 * 
 * Esta é a única tela que gera, valida, executa e decide.
 * Nada fora dessa tela é considerado válido.
 */
export function GenerateSystemPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  // BLOCO 1 - Intenção do Usuário
  const [generateFlow, setGenerateFlow] = useState(false);
  const [generateRpa, setGenerateRpa] = useState(false);
  const [generateSeed, setGenerateSeed] = useState(false);
  const [executeFullValidation, setExecuteFullValidation] = useState(true);
  const [bootstrap, setBootstrap] = useState(false);

  // BLOCO 2 - Fonte de Conhecimento da IA
  const [useRag, setUseRag] = useState(false);
  const [ragSources, setRagSources] = useState({
    flows: false,
    qa: false,
    docs: false,
  });
  const [useWebScraping, setUseWebScraping] = useState(false);
  const [scrapingTargets, setScrapingTargets] = useState(['']);
  
  // Upload de arquivos para RAG
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [selectedFileDetails, setSelectedFileDetails] = useState(null); // Arquivo selecionado para ver detalhes

  // BLOCO 3 - Configuração da Execução
  const [executionMode, setExecutionMode] = useState('dry-run'); // 'dry-run' ou 'real'
  const [rpaMode, setRpaMode] = useState('infer'); // 'infer', 'record', 'hybrid'

  // Dados básicos
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // BLOCO 4 - Validações Automáticas
  const [validationStatus, setValidationStatus] = useState({
    contract: null, // null, 'valid', 'invalid'
    schema: null,
    governance: null,
    rpaPreValidation: null,
  });

  // BLOCO 5 - Pipeline Visível
  const [pipelineStatus, setPipelineStatus] = useState({
    filesInferred: false,
    payloadValid: false,
    contractValid: false,
    contextBuilt: false,
    aiExecuted: false,
    flowGenerated: false,
    seedGenerated: false,
    rpaGenerated: false,
    rpaExecuted: false,
    approved: false,
  });
  
  // Estado detalhado do pipeline com timestamps e mensagens
  const [pipelineDetails, setPipelineDetails] = useState({
    filesInferred: { status: 'pending', timestamp: null, message: null, progress: 0 },
    payloadValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
    aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
  });

  // BLOCO 6 - Resultado Final
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  
  // Rate Limit
  const [rateLimitUntil, setRateLimitUntil] = useState(null); // Timestamp até quando o rate limit está ativo
  const [rateLimitSecondsRemaining, setRateLimitSecondsRemaining] = useState(0);
  
  // Modal de Relatório
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(null);
  
  // Modo step-by-step do replay
  const [replayStepByStep, setReplayStepByStep] = useState(false);
  const [currentReplayStep, setCurrentReplayStep] = useState(0);

  // Função auxiliar para atualizar pipeline com detalhes
  const updatePipelineWithDetails = (statusUpdate, source = 'unknown') => {
    const timestamp = new Date().toISOString();
    logger.debug(`[Pipeline] Atualização recebida de ${source}`, { statusUpdate, timestamp });
    
    // Atualiza status simples
    setPipelineStatus(prev => ({ ...prev, ...statusUpdate }));
    
    // Atualiza detalhes com timestamps e mensagens
    setPipelineDetails(prev => {
      const updated = { ...prev };
      Object.keys(statusUpdate).forEach(key => {
        if (updated[key]) {
          const value = statusUpdate[key];
          if (value === true) {
            updated[key] = {
              status: 'completed',
              timestamp: timestamp,
              message: getStepMessage(key, 'completed'),
              progress: 100,
            };
            logger.info(`[Pipeline] Etapa ${key} concluída`, { timestamp, source });
          } else if (value === false) {
            updated[key] = {
              status: 'pending',
              timestamp: null,
              message: null,
              progress: 0,
            };
          } else if (typeof value === 'object' && value !== null) {
            // Se for um objeto com detalhes
            updated[key] = {
              status: value.status || (value === true ? 'completed' : 'pending'),
              timestamp: value.timestamp || timestamp,
              message: value.message || getStepMessage(key, value.status || 'completed'),
              progress: value.progress || (value === true ? 100 : 0),
            };
          }
        }
      });
      return updated;
    });
  };
  
  // Função auxiliar para obter mensagens de cada etapa
  const getStepMessage = (step, status) => {
    const messages = {
      filesInferred: {
        completed: 'Arquivos processados e indexados no RAG',
        in_progress: 'Processando e indexando arquivos...',
        error: 'Erro ao processar arquivos',
      },
      payloadValid: {
        completed: 'Payload validado com sucesso',
        in_progress: 'Validando payload...',
        error: 'Payload inválido',
      },
      contractValid: {
        completed: 'Contrato validado com sucesso',
        in_progress: 'Validando contrato...',
        error: 'Validação de contrato falhou',
      },
      contextBuilt: {
        completed: 'Contexto montado com sucesso',
        in_progress: 'Montando contexto para IA...',
        error: 'Erro ao montar contexto',
      },
      aiExecuted: {
        completed: 'IA executada com sucesso',
        in_progress: 'Executando IA...',
        error: 'Erro na execução da IA',
      },
      flowGenerated: {
        completed: 'Fluxo gerado com sucesso',
        in_progress: 'Gerando fluxo...',
        error: 'Erro ao gerar fluxo',
      },
      seedGenerated: {
        completed: 'Seed gerado com sucesso',
        in_progress: 'Gerando seed...',
        error: 'Erro ao gerar seed',
      },
      rpaGenerated: {
        completed: 'RPA gerado com sucesso',
        in_progress: 'Gerando teste RPA...',
        error: 'Erro ao gerar RPA',
      },
      rpaExecuted: {
        completed: 'RPA executado com sucesso',
        in_progress: 'Executando teste RPA...',
        error: 'Erro na execução do RPA',
      },
      approved: {
        completed: 'Sistema aprovado',
        in_progress: 'Aguardando aprovação...',
        error: 'Sistema reprovado',
      },
    };
    return messages[step]?.[status] || `${step}: ${status}`;
  };

  // WebSocket para receber atualizações de progresso
  useWebSocketContext({
    enabled: true,
    onEvent: (event, data) => {
      if (event === 'generation.progress') {
        logger.debug('[WebSocket] Progresso recebido via WebSocket', { event, data });
        updatePipelineWithDetails(data, 'websocket');
      }
    },
    subscribeEvents: ['generation.progress'],
  });

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Lógica automática do modo Bootstrap
  useEffect(() => {
    if (bootstrap) {
      setGenerateFlow(true);
      setGenerateRpa(true);
      setGenerateSeed(true);
      setUseRag(false);
      setRagSources({ flows: false, qa: false, docs: false });
      setUseWebScraping(true);
      if (scrapingTargets.length === 0 || scrapingTargets[0] === '') {
        setScrapingTargets(['']);
      }
    }
  }, [bootstrap]);

  // Atualiza contador de rate limit a cada segundo
  useEffect(() => {
    if (!rateLimitUntil) {
      setRateLimitSecondsRemaining(0);
      return;
    }

    const updateCounter = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((rateLimitUntil - now) / 1000));
      setRateLimitSecondsRemaining(remaining);

      if (remaining <= 0) {
        setRateLimitUntil(null);
        setError(null);
      }
    };

    // Atualiza imediatamente
    updateCounter();

    // Atualiza a cada segundo
    const interval = setInterval(updateCounter, 1000);

    return () => clearInterval(interval);
  }, [rateLimitUntil]);

  // Validação de URLs em tempo real
  const validateUrl = (url) => {
    if (!url || url.trim() === '') return false;
    try {
      new URL(url.trim());
      return true;
    } catch {
      return false;
    }
  };

  // Função para obter mensagem de erro de validação
  const getValidationError = useMemo(() => {
    // Nome e descrição obrigatórios
    if (!name.trim() || name.trim().length < 3) {
      return 'O nome deve ter pelo menos 3 caracteres';
    }
    if (!description.trim() || description.trim().length < 10) {
      return 'A descrição deve ter pelo menos 10 caracteres';
    }

    // Se bootstrap, precisa de scraping
    if (bootstrap) {
      const validUrls = scrapingTargets.filter(url => validateUrl(url));
      if (validUrls.length === 0) {
        return 'No modo bootstrap, é necessário adicionar pelo menos uma URL válida para scraping';
      }
      return null;
    }

    // Se não bootstrap, precisa de pelo menos uma fonte
    if (!useRag && !useWebScraping) {
      return 'Selecione pelo menos uma fonte de conhecimento (RAG ou Web Scraping)';
    }
    
    if (useRag) {
      const hasRagSource = Object.values(ragSources).some(v => v === true);
      if (!hasRagSource) {
        return 'Selecione pelo menos uma fonte RAG (Fluxos, QA ou Documentos)';
      }
    }

    if (useWebScraping) {
      const validUrls = scrapingTargets.filter(url => validateUrl(url));
      if (validUrls.length === 0) {
        return 'Adicione pelo menos uma URL válida para Web Scraping';
      }
    }

    // Validações automáticas devem estar OK
    if (validationStatus.contract === 'invalid') {
      return 'Validação de contrato falhou';
    }
    if (validationStatus.schema === 'invalid') {
      return 'Validação de schema falhou';
    }
    if (validationStatus.governance === 'invalid') {
      return 'Validação de governança falhou';
    }
    if (validationStatus.rpaPreValidation === 'invalid') {
      return 'Validação prévia de RPA falhou';
    }

    return null;
  }, [name, description, bootstrap, useRag, ragSources, useWebScraping, scrapingTargets, validationStatus]);

  // Validação completa do formulário
  const isValid = useMemo(() => {
    return getValidationError === null;
  }, [getValidationError]);

  // Gera payload único
  const generatePayload = () => {
    const payload = {
      name: name.trim(),
      description: description.trim(),
      bootstrap: bootstrap || false,
      executionMode: executionMode,
      useRag: bootstrap ? false : useRag,
      ragSources: bootstrap ? [] : (useRag ? Object.keys(ragSources).filter(k => ragSources[k]) : []),
      useWebScraping: useWebScraping,
      scrapingTargets: useWebScraping ? scrapingTargets.filter(url => validateUrl(url)) : [],
      generate: {
        flow: bootstrap ? true : generateFlow,
        seed: bootstrap ? true : generateSeed,
        rpa: bootstrap ? true : generateRpa,
      },
      rpaMode: rpaMode,
      executeFullValidation: executeFullValidation,
    };

    // Remove campos undefined
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    return payload;
  };

  // Validação prévia (simulada - será feita pelo backend)
  useEffect(() => {
    if (name.trim() && description.trim()) {
      // Simula validação - na prática será feita pelo backend
      setValidationStatus({
        contract: 'valid',
        schema: 'valid',
        governance: 'valid',
        rpaPreValidation: generateRpa || bootstrap ? 'valid' : null,
      });
    } else {
      setValidationStatus({
        contract: null,
        schema: null,
        governance: null,
        rpaPreValidation: null,
      });
    }
  }, [name, description, generateRpa, bootstrap]);

  // Executa geração e validação
  const handleExecute = async () => {
    if (!isValid || executing) return;

    setExecuting(true);
    setError(null);
    setResult(null);
    
    // Reseta pipeline status
    const resetStatus = {
      filesInferred: false,
      payloadValid: false,
      contractValid: false,
      contextBuilt: false,
      aiExecuted: false,
      flowGenerated: false,
      seedGenerated: false,
      rpaGenerated: false,
      rpaExecuted: false,
      approved: false,
    };
    setPipelineStatus(resetStatus);
    
    // Reseta pipeline details
    setPipelineDetails({
      filesInferred: { status: 'pending', timestamp: null, message: null, progress: 0 },
      payloadValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
      contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
      contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
      aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
      flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
      seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
      rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
      rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
      approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
    });
    
    logger.info('[Execute] Iniciando execução do pipeline', {
      name,
      bootstrap,
      executionMode,
      generateFlow,
      generateRpa,
      generateSeed,
    });

    try {
      // Verifica rate limit ANTES de processar arquivos (verificação local)
      if (rateLimitUntil && rateLimitUntil > Date.now()) {
        const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
        const operationType = bootstrap ? 'BOOTSTRAP' : (executionMode === 'dry-run' ? 'DRY_RUN' : 'GENERATION_REAL');
        let message = `Limite de execuções atingido`;
        if (operationType === 'BOOTSTRAP') {
          message += ` (modo Bootstrap: 1 execução a cada 5 minutos)`;
        } else if (operationType === 'GENERATION_REAL') {
          message += ` (modo Real: 5 execuções por minuto)`;
        }
        message += `. Tente novamente em ${remaining} segundos.`;
        
        setError(message);
        showToast(message, 'error', 8000);
        setExecuting(false);
        return;
      }

      // Gera payload antes de processar arquivos
      const payload = generatePayload();
      
      // Verificação proativa do rate limit no servidor ANTES de processar arquivos
      // Isso evita processar arquivos se o rate limit já foi excedido
      try {
        logger.debug('[Execute] Verificando rate limit no servidor antes de executar');
        const rateLimitCheck = await checkRateLimit(payload);
        
        if (!rateLimitCheck.allowed) {
          const retryAfter = rateLimitCheck.retryAfter || 60;
          const until = Date.now() + (retryAfter * 1000);
          setRateLimitUntil(until);
          setRateLimitSecondsRemaining(retryAfter);
          
          const operationType = bootstrap ? 'BOOTSTRAP' : (executionMode === 'dry-run' ? 'DRY_RUN' : 'GENERATION_REAL');
          let message = `Limite de execuções atingido`;
          if (operationType === 'BOOTSTRAP') {
            message += ` (modo Bootstrap: 1 execução a cada 5 minutos)`;
          } else if (operationType === 'GENERATION_REAL') {
            message += ` (modo Real: 5 execuções por minuto)`;
          }
          message += `. Tente novamente em ${retryAfter} segundos.`;
          
          setError(message);
          showToast(message, 'error', 8000);
          setExecuting(false);
          logger.warn('[Execute] Rate limit verificado no servidor: bloqueado', {
            retryAfter,
            remainingPoints: rateLimitCheck.remainingPoints,
            totalPoints: rateLimitCheck.totalPoints,
          });
          return;
        }
        
        logger.debug('[Execute] Rate limit verificado no servidor: permitido', {
          remainingPoints: rateLimitCheck.remainingPoints,
          totalPoints: rateLimitCheck.totalPoints,
        });
      } catch (rateLimitError) {
        // Se a verificação de rate limit falhar, ainda tentamos executar
        // mas logamos como warning
        logger.warn('[Execute] Erro ao verificar rate limit no servidor, continuando execução', {
          error: rateLimitError.message,
        });
        // Não bloqueia a execução se a verificação falhar
      }

      // ETAPA 0: Inferir categorias e fazer upload dos arquivos pendentes
      logger.info('[Execute] ETAPA 0: Processando arquivos pendentes');
      const pendingFiles = uploadedFiles.filter(f => f.status === 'pending');
      
      if (pendingFiles.length > 0) {
        logger.info(`[Execute] Encontrados ${pendingFiles.length} arquivo(s) pendente(s)`, {
          files: pendingFiles.map(f => ({ id: f.id, name: f.name })),
        });
        
        updatePipelineWithDetails({ filesInferred: false }, 'execute');
        
        // Atualiza detalhes para mostrar progresso
        setPipelineDetails(prev => ({
          ...prev,
          filesInferred: {
            status: 'in_progress',
            timestamp: new Date().toISOString(),
            message: `Processando ${pendingFiles.length} arquivo(s)...`,
            progress: 0,
          },
        }));
        
        // Infere categoria usando IA para cada arquivo pendente e faz upload
        for (let i = 0; i < pendingFiles.length; i++) {
          const fileObj = pendingFiles[i];
          const fileNumber = i + 1;
          
          try {
            logger.debug(`[Execute] Processando arquivo ${fileNumber}/${pendingFiles.length}`, {
              fileName: fileObj.name,
              fileId: fileObj.id,
            });
            
            // Atualiza progresso
            const progress = Math.round((i / pendingFiles.length) * 100);
            setPipelineDetails(prev => ({
              ...prev,
              filesInferred: {
                status: 'in_progress',
                timestamp: prev.filesInferred.timestamp || new Date().toISOString(),
                message: `Processando arquivo ${fileNumber}/${pendingFiles.length}: ${fileObj.name}`,
                progress: progress,
              },
            }));
            
            // Infere categoria
            logger.debug(`[Execute] Inferindo categoria para arquivo ${fileObj.name}`);
            const inferredCategory = await inferFileCategoryWithAI(fileObj.file);
            logger.info(`[Execute] Categoria inferida: ${inferredCategory}`, {
              fileName: fileObj.name,
              category: inferredCategory,
            });
            
            // Atualiza a categoria do arquivo no estado
            setUploadedFiles(prev => prev.map(f => 
              f.id === fileObj.id ? { ...f, category: inferredCategory } : f
            ));
            
            // Cria uma cópia do objeto com a categoria inferida para usar no upload
            const fileObjWithCategory = {
              ...fileObj,
              category: inferredCategory,
            };
            
            // Faz upload imediatamente após inferir
            logger.debug(`[Execute] Fazendo upload do arquivo ${fileObj.name}`);
            await handleFileUpload(fileObjWithCategory);
            logger.info(`[Execute] Upload concluído para arquivo ${fileObj.name}`);
          } catch (error) {
            logger.error(`[Execute] Erro ao processar arquivo ${fileObj.name}`, {
              error: error.message,
              stack: error.stack,
              fileId: fileObj.id,
            });
            // Marca como erro no estado
            setUploadedFiles(prev => prev.map(f => 
              f.id === fileObj.id 
                ? { ...f, status: 'error', error: error.message || 'Erro ao processar arquivo' } 
                : f
            ));
          }
        }
        
        logger.info('[Execute] ETAPA 0 concluída: Todos os arquivos processados');
        updatePipelineWithDetails({ filesInferred: true }, 'execute');
      } else {
        logger.info('[Execute] ETAPA 0: Nenhum arquivo pendente, pulando etapa');
        // Se não há arquivos pendentes, marca como concluído
        updatePipelineWithDetails({ filesInferred: true }, 'execute');
      }

      // Payload já foi gerado acima
      logger.info('[Execute] Payload gerado', {
        payload: {
          name: payload.name,
          bootstrap: payload.bootstrap,
          executionMode: payload.executionMode,
          useRag: payload.useRag,
          useWebScraping: payload.useWebScraping,
          generate: payload.generate,
        },
      });
      
      // Atualiza pipeline em tempo real
      logger.debug('[Execute] Atualizando status: payloadValid = true');
      updatePipelineWithDetails({ payloadValid: true }, 'execute');
      
      logger.info('[Execute] Chamando generateAndValidate');
      const response = await generateAndValidate(payload, (status) => {
        // Callback para atualizar pipeline em tempo real (combinado com WebSocket)
        logger.debug('[Execute] Callback de progresso recebido', status);
        updatePipelineWithDetails(status, 'callback');
      });
      
      logger.info('[Execute] generateAndValidate concluído', {
        success: response?.success,
        rpaPassed: response?.rpaPassed,
        flowGenerated: response?.flowGenerated,
        seedGenerated: response?.seedGenerated,
        rpaGenerated: response?.rpaGenerated,
        rpaExecuted: response?.rpaExecuted,
      });

      setResult(response);
      
      if (response.success) {
        showToast('Geração concluída com sucesso!', 'success');
      } else {
        showToast('Geração concluída com avisos', 'warning');
      }
    } catch (err) {
      logger.error('Erro ao executar geração', err);
      
      // Trata erro de rate limit
      if (err.status === 429 || (err.body && err.body.error === 'rate_limit_exceeded')) {
        const retryAfter = err.body?.retryAfter || err.retryAfter || 60;
        const until = Date.now() + (retryAfter * 1000);
        setRateLimitUntil(until);
        setRateLimitSecondsRemaining(retryAfter);
        
        // Mensagem mais detalhada baseada no tipo de operação
        const operationType = bootstrap ? 'BOOTSTRAP' : (executionMode === 'dry-run' ? 'DRY_RUN' : 'GENERATION_REAL');
        let message = `⏱️ Limite de execuções atingido`;
        if (operationType === 'BOOTSTRAP') {
          message += `\n\nModo Bootstrap: 1 execução a cada 5 minutos\nTente novamente em ${retryAfter} segundos (${Math.ceil(retryAfter / 60)} minuto${Math.ceil(retryAfter / 60) !== 1 ? 's' : ''})`;
        } else if (operationType === 'GENERATION_REAL') {
          message += `\n\nModo Real: 5 execuções por minuto\nTente novamente em ${retryAfter} segundos`;
        } else {
          message += `\n\nModo Dry-Run: 50 execuções por minuto\nTente novamente em ${retryAfter} segundos`;
        }
        
        // Log estruturado para monitoramento
        logger.warn('[Execute] Rate limit excedido durante execução', {
          operationType,
          retryAfter,
          bootstrap,
          executionMode,
          severity: 'MEDIUM',
          alert: 'RATE_LIMIT_EXCEEDED_DURING_EXECUTION',
        });
        
        setError(message);
        showToast(message, 'error', 10000); // Aumenta duração para 10 segundos
      } else {
        setError(err.message || 'Erro desconhecido');
        showToast(`Erro: ${err.message || 'Erro desconhecido'}`, 'error');
      }
    } finally {
      setExecuting(false);
    }
  };

  // Limpa rate limit (apenas em desenvolvimento)
  const clearRateLimit = async () => {
    try {
      logger.info('[RateLimit] Tentando limpar rate limit');
      const response = await fetchJson('/admin/rate-limit/clear', {
        method: 'POST',
      });
      
      if (response.success) {
        setRateLimitUntil(null);
        setRateLimitSecondsRemaining(0);
        setError(null);
        showToast('Rate limit limpo com sucesso!', 'success');
        logger.info('[RateLimit] Rate limit limpo com sucesso', response);
      } else {
        throw new Error(response.message || 'Erro ao limpar rate limit');
      }
    } catch (err) {
      logger.error('[RateLimit] Erro ao limpar rate limit', err);
      if (err.status === 403) {
        showToast('Este recurso está disponível apenas em desenvolvimento', 'warning');
      } else {
        showToast(`Erro ao limpar rate limit: ${err.message || 'Erro desconhecido'}`, 'error');
      }
    }
  };

  // Adiciona nova URL de scraping
  const addScrapingTarget = () => {
    setScrapingTargets([...scrapingTargets, '']);
  };

  // Remove URL de scraping
  const removeScrapingTarget = (index) => {
    setScrapingTargets(scrapingTargets.filter((_, i) => i !== index));
  };

  // Atualiza URL de scraping
  const updateScrapingTarget = (index, value) => {
    const newTargets = [...scrapingTargets];
    newTargets[index] = value;
    setScrapingTargets(newTargets);
  };

  // Upload de arquivos para RAG
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Adiciona arquivos à lista de upload inicialmente com categoria temporária
    const newFiles = files.map(file => ({
      file,
      id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      size: file.size,
      category: 'outros', // Categoria temporária, será atualizada após inferência
      status: 'pending', // pending, uploading, success, error
      error: null,
    }));

    setUploadedFiles([...uploadedFiles, ...newFiles]);
    
    // Não faz inferência nem upload automaticamente - será feito ao clicar em Executar
  };

  const handleFileUpload = async (fileObj) => {
    try {
      // Atualiza status para uploading
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileObj.id ? { ...f, status: 'uploading' } : f
      ));

      const isImage = fileObj.file.type.startsWith('image/');
      const isPdf = fileObj.file.type === 'application/pdf';
      const isText = fileObj.file.type.startsWith('text/') || 
                     ['txt', 'md', 'json', 'csv'].includes(fileObj.file.name.split('.').pop()?.toLowerCase() || '');

      // Processa TODOS os arquivos para extrair conteúdo
      let processedFile = fileObj.file;
      let preview = null;
      let extractedContent = null;

      try {
        const processed = await processFile(fileObj.file, {
          compressImages: isImage, // Comprime apenas imagens
          extractImageText: isImage, // Extrai texto de imagens usando OCR
          onProgress: (progress, message) => {
            // Atualiza progresso durante processamento
            logger.debug(`Processando arquivo ${fileObj.name}: ${message} (${progress}%)`);
            // Atualiza status com progresso
            setUploadedFiles(prev => prev.map(f => 
              f.id === fileObj.id 
                ? { ...f, status: 'uploading', progress: Math.round(progress) } 
                : f
            ));
          },
        });
        
        processedFile = processed.file;
        preview = processed.preview;
        extractedContent = processed.content;

        // Log do conteúdo extraído
        if (extractedContent) {
          logger.debug(`Conteúdo extraído do arquivo ${fileObj.name}`, {
            contentLength: extractedContent.length,
            preview: extractedContent.substring(0, 200),
          });
        }
      } catch (processError) {
        logger.warn('Erro ao processar arquivo, tentando fallback', {
          fileName: fileObj.name,
          error: processError.message,
        });
        
        // Fallback: tenta criar preview básico para imagens
        if (isImage) {
          try {
            const reader = new FileReader();
            preview = await new Promise((resolve, reject) => {
              reader.onload = (e) => resolve(e.target.result);
              reader.onerror = reject;
              reader.readAsDataURL(fileObj.file);
            });
          } catch (previewError) {
            logger.warn('Erro ao criar preview da imagem', previewError);
          }
        }
        
        // Se não conseguiu extrair conteúdo, usa placeholder
        if (!extractedContent) {
          extractedContent = `[Arquivo: ${fileObj.name} - Tipo: ${fileObj.file.type}]\n\nNão foi possível extrair conteúdo automaticamente.`;
        }
      }

      // Faz upload do arquivo processado com conteúdo extraído
      const result = await uploadDocument(processedFile, {
        category: fileObj.category,
        tags: [fileObj.category, 'generate-system'],
        metadata: {
          uploadedFrom: 'generate-system',
          originalFileName: fileObj.name,
          isImage: isImage,
          isPdf: isPdf,
          isText: isText,
          extractedContent: extractedContent, // Conteúdo extraído (OCR, PDF, texto, etc.)
        },
        autoIndex: true, // Indexa automaticamente no RAG
      });

      // Atualiza status para success com preview se disponível
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileObj.id 
          ? { 
              ...f, 
              status: 'success', 
              documentId: result.document?.id || result.id,
              preview: preview,
              progress: 100,
              extractedContent: extractedContent, // Salva conteúdo extraído para exibição
            } 
          : f
      ));

      showToast(`Arquivo "${fileObj.name}" processado e indexado no RAG com sucesso!`, 'success');
    } catch (error) {
      logger.error('Erro ao fazer upload do arquivo:', error);
      
      // Atualiza status para error
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileObj.id 
          ? { ...f, status: 'error', error: error.message || 'Erro desconhecido', progress: 0 } 
          : f
      ));

      showToast(`Erro ao processar arquivo "${fileObj.name}": ${error.message}`, 'error');
    }
  };

  const removeUploadedFile = (fileId) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  /**
   * Infere a categoria do arquivo usando IA
   * @param {File} file - Arquivo a ser analisado
   * @returns {Promise<string>} Categoria inferida
   */
  const inferFileCategoryWithAI = async (file) => {
    try {
      const fileName = file.name;
      const fileType = file.type;
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
      
      // Lê uma amostra do conteúdo se for arquivo de texto
      let contentSample = '';
      const isTextFile = fileType.startsWith('text/') || 
                        ['txt', 'md', 'json', 'csv', 'doc', 'docx'].includes(fileExtension);
      const isImage = fileType.startsWith('image/') || 
                     ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(fileExtension);
      
      if (isTextFile && file.size > 0 && file.size < 50000) {
        // Lê uma amostra do arquivo de texto (primeiros 2000 caracteres)
        try {
          const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              const fullText = e.target.result || '';
              // Limita a 2000 caracteres para não exceder o limite do prompt
              resolve(fullText.substring(0, 2000));
            };
            reader.onerror = reject;
            // Lê o arquivo completo (mas limitamos o texto depois)
            reader.readAsText(file);
          });
          contentSample = text;
        } catch (readError) {
          logger.warn('Erro ao ler amostra do arquivo para inferência', readError);
        }
      }

      // Constrói prompt para a IA
      let prompt = `Analise o seguinte arquivo e categorize-o em UMA das seguintes categorias: promocoes, avisos, tabelas_preco, imagens, outros.\n\n`;
      prompt += `Nome do arquivo: ${fileName}\n`;
      prompt += `Tipo MIME: ${fileType || 'desconhecido'}\n`;
      prompt += `Extensão: ${fileExtension || 'nenhuma'}\n`;
      
      if (isImage) {
        prompt += `Tipo: Imagem\n`;
      } else if (contentSample) {
        prompt += `Amostra do conteúdo (primeiros 2000 caracteres):\n${contentSample}\n`;
      }
      
      prompt += `\nCategorias disponíveis:\n`;
      prompt += `- promocoes: Arquivos relacionados a promoções, descontos, ofertas, campanhas promocionais\n`;
      prompt += `- avisos: Arquivos relacionados a avisos, comunicados, notícias, anúncios, informações gerais\n`;
      prompt += `- tabelas_preco: Arquivos relacionados a tabelas de preço, planilhas de valores, listas de preços\n`;
      prompt += `- imagens: Arquivos de imagem sem contexto específico de promoção, aviso ou tabela\n`;
      prompt += `- outros: Qualquer outro tipo de arquivo que não se encaixe nas categorias acima\n\n`;
      prompt += `Retorne APENAS o nome da categoria (uma das opções acima) em minúsculas, sem pontuação ou explicação adicional.`;

      // Obtém tenantId do agente ou usa padrão
      const tenantId = agent?.tenantId || 'tenant-demo';

      // Chama a API de IA
      const response = await fetchJson('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          tenantId,
        }),
      });

      if (response?.text) {
        const category = response.text.trim().toLowerCase();
        
        // Valida se a categoria retornada é uma das válidas
        const validCategories = ['promocoes', 'avisos', 'tabelas_preco', 'imagens', 'outros'];
        if (validCategories.includes(category)) {
          logger.debug('Categoria inferida pela IA', { fileName, category });
          return category;
        } else {
          logger.warn('IA retornou categoria inválida, usando fallback', { fileName, category });
        }
      }

      // Fallback: usa inferência básica se IA falhar
      return inferFileCategoryFallback(file);
    } catch (error) {
      logger.error('Erro ao inferir categoria com IA, usando fallback', error);
      // Fallback em caso de erro
      return inferFileCategoryFallback(file);
    }
  };

  /**
   * Inferência básica de categoria (fallback quando IA não está disponível)
   * @param {File} file - Arquivo a ser analisado
   * @returns {string} Categoria inferida
   */
  const inferFileCategoryFallback = (file) => {
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';

    // Palavras-chave para promoções
    const promocaoKeywords = ['promo', 'promocao', 'promoção', 'desconto', 'oferta', 'black', 'friday', 'natal', 'pascoa', 'dia', 'das', 'maes', 'pais'];
    // Palavras-chave para avisos
    const avisoKeywords = ['aviso', 'comunicado', 'noticia', 'notícia', 'anuncio', 'anúncio', 'informacao', 'informação', 'atualizacao', 'atualização'];
    // Palavras-chave para tabelas de preço
    const tabelaPrecoKeywords = ['tabela', 'preco', 'preço', 'price', 'pricing', 'valor', 'custo', 'tarifa', 'planilha', 'spreadsheet', 'excel'];

    // Verifica se é imagem pelo tipo MIME
    if (fileType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(fileExtension)) {
      // Se for imagem mas tiver palavras-chave específicas, usa a categoria específica
      const allKeywords = [...promocaoKeywords, ...avisoKeywords, ...tabelaPrecoKeywords];
      const hasSpecificKeyword = allKeywords.some(keyword => fileName.includes(keyword));
      
      if (!hasSpecificKeyword) {
        return 'imagens';
      }
    }

    // Verifica palavras-chave no nome do arquivo
    if (promocaoKeywords.some(keyword => fileName.includes(keyword))) {
      return 'promocoes';
    }
    
    if (avisoKeywords.some(keyword => fileName.includes(keyword))) {
      return 'avisos';
    }
    
    if (tabelaPrecoKeywords.some(keyword => fileName.includes(keyword))) {
      return 'tabelas_preco';
    }

    // Se for imagem e não tiver palavras-chave específicas, retorna imagens
    if (fileType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(fileExtension)) {
      return 'imagens';
    }

    // Categoria padrão
    return 'outros';
  };

  const getCategoryLabel = (category) => {
    const labels = {
      promocoes: 'Promoções',
      avisos: 'Avisos',
      tabelas_preco: 'Tabelas de Preço',
      imagens: 'Imagens',
      outros: 'Outros',
    };
    return labels[category] || category;
  };

  // Busca o relatório RPA
  const handleViewReport = async (reportLink) => {
    if (!reportLink) return;
    
    setShowReportModal(true);
    setLoadingReport(true);
    setReportData(null);
    setReportError(null);
    setReplayStepByStep(false);
    setCurrentReplayStep(0);

    try {
      // Busca o relatório JSON usando fetchJson que já constrói a URL correta
      // e inclui headers de autenticação automaticamente
      const data = await fetchJson(reportLink);
      setReportData(data);
    } catch (err) {
      logger.error('Erro ao carregar relatório', err);
      setReportError(err.message || 'Erro ao carregar relatório');
    } finally {
      setLoadingReport(false);
    }
  };

  // Funções para navegação step-by-step do replay
  const getReplaySteps = () => {
    if (!reportData) return [];
    
    // O replay pode estar em reportData.replayData ou diretamente em reportData
    const replayData = reportData.replayData || reportData;
    if (!replayData) return [];
    
    const actions = replayData.actions || [];
    const screens = replayData.screens || [];
    
    // Se não há ações, retorna array vazio
    if (actions.length === 0) return [];
    
    // Combina ações e screens em passos ordenados
    const steps = [];
    
    // Cria um mapa de screens por step
    const screensByStep = {};
    screens.forEach(screen => {
      if (screen.step) {
        screensByStep[screen.step] = screen;
      }
    });
    
    // Para cada ação, cria um passo com sua tela correspondente
    actions.forEach((action, index) => {
      const stepNumber = action.step || `step-${index + 1}`;
      // Tenta encontrar screen correspondente por step ou por índice
      const screen = screensByStep[stepNumber] || 
                     screensByStep[`step-${index + 1}`] ||
                     (screens[index] && screens[index].step === stepNumber ? screens[index] : null) ||
                     screens[index]; // Fallback para índice
      
      steps.push({
        index,
        stepNumber,
        action,
        screen,
        timestamp: action.timestamp || action.startTime || screen?.timestamp,
      });
    });
    
    return steps;
  };

  const replaySteps = getReplaySteps();
  const currentStep = replaySteps[currentReplayStep];
  const totalSteps = replaySteps.length;

  const goToStep = (stepIndex) => {
    if (stepIndex >= 0 && stepIndex < totalSteps) {
      setCurrentReplayStep(stepIndex);
    }
  };

  const goToPrevious = () => goToStep(currentReplayStep - 1);
  const goToNext = () => goToStep(currentReplayStep + 1);
  const goToFirst = () => goToStep(0);
  const goToLast = () => goToStep(totalSteps - 1);

  // Determina status final
  const getFinalStatus = () => {
    if (!result) return null;
    
    if (result.success && result.rpaPassed) {
      return { status: 'approved', color: 'green', icon: '🟢', label: 'APROVADO' };
    }
    if (result.success && result.warnings && result.warnings.length > 0) {
      return { status: 'approved_with_warnings', color: 'yellow', icon: '🟡', label: 'APROVADO COM WARNINGS' };
    }
    if (result.success && !result.rpaPassed) {
      return { status: 'rejected', color: 'red', icon: '🔴', label: 'REPROVADO' };
    }
    return { status: 'rejected', color: 'red', icon: '🔴', label: 'REPROVADO' };
  };

  const finalStatus = getFinalStatus();

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🎯 Gerar Sistema / Fluxo / RPA / Seed</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Esta é a única tela que gera, valida, executa e decide. Nada fora dessa tela é considerado válido.
        </p>
      </div>

      <div className="space-y-6">

        {/* BLOCO 1 - Intenção do Usuário */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 1 — Intenção do Usuário</h2>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-text-primary">
              <input
                type="checkbox"
                checked={generateFlow}
                onChange={(e) => setGenerateFlow(e.target.checked)}
                disabled={bootstrap}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span>Gerar Fluxo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-text-primary">
              <input
                type="checkbox"
                checked={generateRpa}
                onChange={(e) => setGenerateRpa(e.target.checked)}
                disabled={bootstrap}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span>Gerar Teste RPA</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-text-primary">
              <input
                type="checkbox"
                checked={generateSeed}
                onChange={(e) => setGenerateSeed(e.target.checked)}
                disabled={bootstrap}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span>Gerar Seed</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-text-primary">
              <input
                type="checkbox"
                checked={executeFullValidation}
                onChange={(e) => setExecuteFullValidation(e.target.checked)}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span>Executar Validação Completa</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-text-primary">
              <input
                type="checkbox"
                checked={bootstrap}
                onChange={(e) => setBootstrap(e.target.checked)}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span className="font-bold">Gerar tudo do zero (Bootstrap)</span>
            </label>
          </div>
          {bootstrap && (
            <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg text-status-warning">
              ⚠️ Modo Bootstrap ativo: Fluxo, RPA e Seed serão gerados automaticamente. RAG desativado.
            </div>
          )}
        </div>

        {/* BLOCO 2 - Fonte de Conhecimento da IA */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 2 — Fonte de Conhecimento da IA</h2>
          
          {/* RAG */}
          <div className="mb-6">
            <label className="flex items-center gap-2 cursor-pointer mb-3 text-text-primary">
              <input
                type="checkbox"
                checked={useRag}
                onChange={(e) => setUseRag(e.target.checked)}
                disabled={bootstrap}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span>RAG (interno)</span>
            </label>
            {useRag && !bootstrap && (
              <div className="ml-6 flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={ragSources.flows}
                    onChange={(e) => setRagSources({ ...ragSources, flows: e.target.checked })}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span>Fluxos</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={ragSources.qa}
                    onChange={(e) => setRagSources({ ...ragSources, qa: e.target.checked })}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span>QA</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={ragSources.docs}
                    onChange={(e) => setRagSources({ ...ragSources, docs: e.target.checked })}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span>Documentação</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={ragSources.uploads || false}
                    onChange={(e) => setRagSources({ ...ragSources, uploads: e.target.checked })}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span>Arquivos Enviados</span>
                </label>
              </div>
            )}
          </div>

          {/* Upload de Arquivos para RAG */}
          <div className="mb-6 border-t border-border-default pt-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">📎 Upload de Arquivos para RAG</h3>
            <p className="text-sm text-text-secondary mb-4">
              Envie arquivos como promoções, avisos, tabelas de preço, imagens, PDFs, documentos, etc. para serem indexados no RAG e utilizados na geração. 
              Todos os arquivos terão seu conteúdo extraído automaticamente: imagens usarão OCR, PDFs terão texto extraído, documentos de texto serão lidos completamente. 
              A categoria será inferida automaticamente usando IA baseada no nome, tipo e conteúdo do arquivo. Todo o conteúdo extraído será indexado no RAG.
            </p>

            <div className="mb-4">
              <label htmlFor="file-upload-input" className="block mb-2 text-sm font-medium text-text-primary">
                Selecione arquivos:
              </label>
              <input
                id="file-upload-input"
                type="file"
                multiple
                onChange={handleFileSelect}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-accent-primary file:text-white hover:file:bg-accent-hover cursor-pointer"
                accept=".txt,.md,.pdf,.json,.csv,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,image/*"
              />
              <p className="text-xs text-text-tertiary mt-2">
                Formatos suportados: TXT, MD, PDF, JSON, CSV, DOC, DOCX, JPG, PNG, GIF, WEBP, BMP, SVG
              </p>
            </div>

            {/* Lista de arquivos enviados */}
            {uploadedFiles.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-text-primary mb-2">Arquivos enviados:</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {uploadedFiles.map((fileObj) => {
                    const isImage = fileObj.file?.type?.startsWith('image/') || fileObj.preview;
                    return (
                      <div
                        key={fileObj.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${
                          fileObj.status === 'success'
                            ? 'bg-status-success/10 border-status-success/30'
                            : fileObj.status === 'error'
                            ? 'bg-status-error/10 border-status-error/30'
                            : fileObj.status === 'uploading'
                            ? 'bg-status-warning/10 border-status-warning/30'
                            : 'bg-bg-secondary border-border-default'
                        } ${fileObj.status === 'success' ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
                        onClick={() => fileObj.status === 'success' && setSelectedFileDetails(fileObj)}
                        title={fileObj.status === 'success' ? 'Clique para ver detalhes e extrações' : ''}
                      >
                        {/* Preview de imagem */}
                        {isImage && fileObj.preview && (
                          <div className="flex-shrink-0">
                            <img
                              src={fileObj.preview}
                              alt={fileObj.name}
                              className="w-16 h-16 object-cover rounded border border-border-default"
                            />
                          </div>
                        )}
                        {isImage && !fileObj.preview && (
                          <div className="flex-shrink-0 w-16 h-16 bg-bg-secondary border border-border-default rounded flex items-center justify-center text-2xl">
                            🖼️
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-text-primary truncate">
                              {fileObj.name}
                              {fileObj.status === 'success' && (
                                <span className="ml-2 text-xs text-text-tertiary">(clique para detalhes)</span>
                              )}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded ${
                              fileObj.status === 'pending'
                                ? 'bg-status-warning/20 text-status-warning border border-status-warning/30'
                                : 'bg-accent-light text-accent-primary'
                            }`}>
                              {fileObj.status === 'pending' ? 'Pendente' : getCategoryLabel(fileObj.category)}
                            </span>
                            {fileObj.status === 'uploading' && (
                              <span className="text-xs text-status-warning animate-pulse">⏳ Enviando...</span>
                            )}
                            {fileObj.status === 'success' && (
                              <span className="text-xs text-status-success">✓ Indexado</span>
                            )}
                            {fileObj.status === 'error' && (
                              <span className="text-xs text-status-error">✗ Erro</span>
                            )}
                          </div>
                          {fileObj.error && (
                            <p className="text-xs text-status-error mt-1">{fileObj.error}</p>
                          )}
                          <p className="text-xs text-text-tertiary mt-1">
                            {(fileObj.size / 1024).toFixed(2)} KB
                            {fileObj.status === 'success' && (
                              <>
                                {isImage && ' • OCR aplicado'}
                                {fileObj.file?.type === 'application/pdf' && ' • Texto extraído'}
                                {fileObj.file?.type?.startsWith('text/') && ' • Conteúdo indexado'}
                                {fileObj.progress !== undefined && ` • ${fileObj.progress}%`}
                              </>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeUploadedFile(fileObj.id);
                          }}
                          className="ml-2 text-status-error hover:opacity-80 text-sm flex-shrink-0"
                          title="Remover"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
                {uploadedFiles.some(f => f.status === 'success') && (
                  <div className="mt-3 p-2 bg-status-success/10 border border-status-success/30 rounded-lg text-status-success text-sm">
                    💡 Arquivos indexados estarão disponíveis quando você selecionar "Arquivos Enviados" nas fontes RAG acima.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scraping */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer mb-3 text-text-primary">
              <input
                type="checkbox"
                checked={useWebScraping}
                onChange={(e) => setUseWebScraping(e.target.checked)}
                className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
              />
              <span>Raspagem (externo)</span>
            </label>
            {useWebScraping && (
              <div className="ml-6">
                {scrapingTargets.map((url, index) => (
                  <div key={index} className="flex gap-2 mb-2 items-center">
                    <Input
                      type="url"
                      value={url}
                      onChange={(e) => updateScrapingTarget(index, e.target.value)}
                      placeholder="https://exemplo.com"
                      className="flex-1"
                    />
                    {validateUrl(url) && <span className="text-status-success">✓</span>}
                    {!validateUrl(url) && url.trim() !== '' && <span className="text-status-error">✗</span>}
                    {scrapingTargets.length > 1 && (
                      <Button
                        onClick={() => removeScrapingTarget(index)}
                        className="px-4 py-2"
                      >
                        Remover
                      </Button>
                    )}
                  </div>
                ))}
                <Button onClick={addScrapingTarget} className="mt-2">
                  + Adicionar URL
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Dados Básicos */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Dados Básicos</h2>
          <div className="mb-4">
            <label className="block mb-2 font-semibold text-text-primary">
              Nome do Sistema/Fluxo
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Sistema de Atendimento"
              className="w-full"
            />
          </div>
          <div>
            <label className="block mb-2 font-semibold text-text-primary">
              Descrição
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o sistema, fluxo ou funcionalidade que deseja gerar..."
              rows={5}
              className="w-full"
            />
          </div>
        </div>

        {/* BLOCO 3 - Configuração da Execução */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 3 — Configuração da Execução</h2>
          <div className="mb-4">
            <label className="block mb-2 font-semibold text-text-primary">
              Modo de execução:
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="radio"
                  name="executionMode"
                  value="dry-run"
                  checked={executionMode === 'dry-run'}
                  onChange={(e) => setExecutionMode(e.target.value)}
                  className="w-4 h-4 text-accent-primary border-border-default focus:ring-accent-primary"
                />
                <span>DRY-RUN (padrão)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="radio"
                  name="executionMode"
                  value="real"
                  checked={executionMode === 'real'}
                  onChange={(e) => setExecutionMode(e.target.value)}
                  className="w-4 h-4 text-accent-primary border-border-default focus:ring-accent-primary"
                />
                <span>Execução real</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block mb-2 font-semibold text-text-primary">
              Modo de geração de RPA:
            </label>
            <select
              value={rpaMode}
              onChange={(e) => setRpaMode(e.target.value)}
              className="px-3 py-2 rounded-lg bg-bg-secondary border border-border-default text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="infer">infer</option>
              <option value="record">record</option>
              <option value="hybrid">hybrid</option>
            </select>
          </div>
        </div>

        {/* BLOCO 4 - Validações Automáticas */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 4 — Validações Automáticas</h2>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-text-primary">
              {validationStatus.contract === 'valid' && <span className="text-status-success">✔</span>}
              {validationStatus.contract === 'invalid' && <span className="text-status-error">✗</span>}
              <span>Validação de contrato</span>
            </div>
            <div className="flex items-center gap-2 text-text-primary">
              {validationStatus.schema === 'valid' && <span className="text-status-success">✔</span>}
              {validationStatus.schema === 'invalid' && <span className="text-status-error">✗</span>}
              <span>Validação de schema</span>
            </div>
            <div className="flex items-center gap-2 text-text-primary">
              {validationStatus.governance === 'valid' && <span className="text-status-success">✔</span>}
              {validationStatus.governance === 'invalid' && <span className="text-status-error">✗</span>}
              <span>Validação de governança</span>
            </div>
            <div className="flex items-center gap-2 text-text-primary">
              {validationStatus.rpaPreValidation === 'valid' && <span className="text-status-success">✔</span>}
              {validationStatus.rpaPreValidation === 'invalid' && <span className="text-status-error">✗</span>}
              <span>Pré-validação de RPA</span>
            </div>
          </div>
        </div>

        {/* BLOCO 5 - Pipeline Visível */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 5 — Pipeline Visível</h2>
          <div className="flex flex-col gap-3">
            {[
              { key: 'filesInferred', label: 'Arquivos inferidos e indexados' },
              { key: 'payloadValid', label: 'Payload válido' },
              { key: 'contractValid', label: 'Contrato válido' },
              { key: 'contextBuilt', label: 'Contexto montado' },
              { key: 'aiExecuted', label: 'IA executada' },
              { key: 'flowGenerated', label: 'Fluxo gerado' },
              { key: 'seedGenerated', label: 'Seed gerado' },
              { key: 'rpaGenerated', label: 'RPA gerado' },
              { key: 'rpaExecuted', label: 'RPA executado' },
              { key: 'approved', label: 'Aprovado' },
            ].map(({ key, label }) => {
              const detail = pipelineDetails[key];
              const status = pipelineStatus[key];
              const isCompleted = status === true;
              const isInProgress = detail?.status === 'in_progress';
              const hasError = detail?.status === 'error';
              
              return (
                <div
                  key={key}
                  className={`p-3 rounded-lg border ${
                    isCompleted
                      ? 'bg-status-success/10 border-status-success/30'
                      : isInProgress
                      ? 'bg-status-warning/10 border-status-warning/30'
                      : hasError
                      ? 'bg-status-error/10 border-status-error/30'
                      : 'bg-bg-secondary border-border-default'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Ícone de status */}
                    <div className="flex-shrink-0">
                      {isCompleted ? (
                        <span className="text-status-success text-lg">✔</span>
                      ) : isInProgress ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-status-warning"></div>
                      ) : hasError ? (
                        <span className="text-status-error text-lg">✗</span>
                      ) : (
                        <span className="text-text-tertiary text-lg">○</span>
                      )}
                    </div>
                    
                    {/* Label e mensagem */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-text-primary">{label}</span>
                        {isInProgress && detail.progress > 0 && (
                          <span className="text-xs text-text-tertiary">({detail.progress}%)</span>
                        )}
                      </div>
                      {detail?.message && (
                        <p className={`text-xs mt-1 ${
                          isCompleted ? 'text-status-success' :
                          isInProgress ? 'text-status-warning' :
                          hasError ? 'text-status-error' :
                          'text-text-tertiary'
                        }`}>
                          {detail.message}
                        </p>
                      )}
                      {detail?.timestamp && (
                        <p className="text-xs text-text-tertiary mt-1">
                          {new Date(detail.timestamp).toLocaleTimeString('pt-BR')}
                        </p>
                      )}
                    </div>
                    
                    {/* Barra de progresso (se em progresso) */}
                    {isInProgress && detail.progress > 0 && (
                      <div className="flex-shrink-0 w-24">
                        <div className="w-full bg-bg-secondary rounded-full h-2">
                          <div
                            className="bg-status-warning h-2 rounded-full transition-all duration-300"
                            style={{ width: `${detail.progress}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Resumo do pipeline */}
          {executing && (
            <div className="mt-4 p-3 bg-bg-secondary rounded-lg border border-border-default">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent-primary"></div>
                <span>Pipeline em execução...</span>
              </div>
            </div>
          )}
        </div>

        {/* Botão Executar */}
        <div className="mb-8">
          <Button
            onClick={handleExecute}
            disabled={!isValid || executing || rateLimitSecondsRemaining > 0}
            className={`w-full py-4 text-lg font-bold ${(!isValid || executing || rateLimitSecondsRemaining > 0) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {executing ? 'Executando...' : rateLimitSecondsRemaining > 0 ? `Aguarde ${rateLimitSecondsRemaining}s...` : 'Executar'}
          </Button>
          {rateLimitSecondsRemaining > 0 && (
            <div className="mt-3 p-4 bg-status-error/10 border border-status-error/30 rounded-lg">
              <div className="flex items-center justify-between gap-2 text-status-error">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⏱️</span>
                  <div>
                    <p className="font-semibold">Limite de execuções atingido</p>
                    <p className="text-sm mt-1">
                      Aguarde <strong>{rateLimitSecondsRemaining}</strong> segundo{rateLimitSecondsRemaining !== 1 ? 's' : ''} antes de tentar novamente.
                    </p>
                  </div>
                </div>
                {import.meta.env.DEV && (
                  <Button
                    onClick={clearRateLimit}
                    className="px-4 py-2 text-sm bg-status-warning hover:bg-status-warning/80 text-white"
                  >
                    Limpar (Dev)
                  </Button>
                )}
              </div>
            </div>
          )}
          {!isValid && rateLimitSecondsRemaining === 0 && !executing && getValidationError && (
            <div className="mt-3 p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg">
              <div className="flex items-center gap-2 text-status-warning">
                <span className="text-lg">ℹ️</span>
                <div>
                  <p className="font-semibold">Complete o formulário para executar</p>
                  <p className="text-sm mt-1">{getValidationError}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BLOCO 6 - Resultado Final */}
        {result && (
          <div className={`rounded-xl border p-6 mb-6 ${
            finalStatus?.color === 'green' 
              ? 'bg-status-success/10 border-status-success/30 text-status-success' 
              : finalStatus?.color === 'yellow' 
              ? 'bg-status-warning/10 border-status-warning/30 text-status-warning' 
              : 'bg-status-error/10 border-status-error/30 text-status-error'
          }`}>
            <h2 className="text-xl font-semibold mb-4">BLOCO 6 — Resultado Final</h2>
            <div className="mb-4">
              {finalStatus && (
                <div className="text-2xl font-bold mb-2">
                  {finalStatus.icon} {finalStatus.label}
                </div>
              )}
              {result.motivo && (
                <div className="mt-2">
                  <strong>Motivo:</strong> {result.motivo}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                {result.replayLink && (
                  <Button
                    onClick={() => handleViewReport(result.replayLink)}
                    variant="default"
                    size="sm"
                    className="text-sm"
                  >
                    📋 Ver Log do Teste RPA
                  </Button>
                )}
                {result.reportLink && (
                  <Button
                    onClick={() => handleViewReport(result.reportLink)}
                    variant="default"
                    size="sm"
                    className="text-sm"
                  >
                    📊 Ver Relatório
                  </Button>
                )}
              </div>
            </div>
            {result.warnings && result.warnings.length > 0 && (
              <div className="mt-4">
                <strong>Avisos:</strong>
                <ul className="list-disc list-inside mt-2">
                  {result.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && rateLimitSecondsRemaining === 0 && (
          <div className="rounded-xl border border-status-error p-6 mb-6 bg-status-error/10 text-status-error">
            <h3 className="text-lg font-semibold mb-2">Erro</h3>
            <p>{error}</p>
          </div>
        )}

        <ToastContainer />
      </div>

      {/* Modal de Detalhes do Arquivo */}
      <Dialog
        isOpen={selectedFileDetails !== null}
        onClose={() => setSelectedFileDetails(null)}
        title={`📄 Detalhes do Arquivo: ${selectedFileDetails?.name || ''}`}
        size="xl"
        draggable={true}
        resizable={true}
      >
        {selectedFileDetails && (
          <div className="space-y-6 max-h-[80vh] overflow-y-auto">
            {/* Informações Básicas */}
            <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
              <h3 className="text-sm font-semibold text-text-primary mb-3">📋 Informações Básicas</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-text-tertiary">Nome:</span>
                  <p className="text-text-primary font-medium">{selectedFileDetails.name}</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Tamanho:</span>
                  <p className="text-text-primary font-medium">{(selectedFileDetails.size / 1024).toFixed(2)} KB</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Tipo MIME:</span>
                  <p className="text-text-primary font-medium">{selectedFileDetails.file?.type || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Status:</span>
                  <p className={`font-medium ${
                    selectedFileDetails.status === 'success' ? 'text-status-success' :
                    selectedFileDetails.status === 'error' ? 'text-status-error' :
                    selectedFileDetails.status === 'uploading' ? 'text-status-warning' :
                    'text-text-secondary'
                  }`}>
                    {selectedFileDetails.status === 'success' ? '✓ Indexado' :
                     selectedFileDetails.status === 'error' ? '✗ Erro' :
                     selectedFileDetails.status === 'uploading' ? '⏳ Enviando...' :
                     '⏸ Pendente'}
                  </p>
                </div>
                {selectedFileDetails.documentId && (
                  <div className="col-span-2">
                    <span className="text-text-tertiary">ID do Documento RAG:</span>
                    <p className="text-text-primary font-mono text-xs break-all">{selectedFileDetails.documentId}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Categoria Inferida */}
            <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
              <h3 className="text-sm font-semibold text-text-primary mb-3">🏷️ Categoria</h3>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-3 py-1 rounded font-medium ${
                  selectedFileDetails.status === 'pending'
                    ? 'bg-status-warning/20 text-status-warning border border-status-warning/30'
                    : 'bg-accent-light text-accent-primary'
                }`}>
                  {selectedFileDetails.status === 'pending' 
                    ? 'Pendente' 
                    : getCategoryLabel(selectedFileDetails.category)}
                </span>
                {selectedFileDetails.status !== 'pending' && (
                  <span className="text-xs text-text-tertiary">
                    (Inferida automaticamente usando IA)
                  </span>
                )}
              </div>
              {selectedFileDetails.status !== 'pending' && (
                <p className="text-xs text-text-tertiary mt-2">
                  A categoria foi inferida analisando o nome do arquivo, tipo MIME e conteúdo extraído.
                </p>
              )}
              {selectedFileDetails.status === 'pending' && (
                <p className="text-xs text-text-tertiary mt-2">
                  A categoria será inferida automaticamente quando você clicar em "Executar".
                </p>
              )}
            </div>

            {/* Preview da Imagem */}
            {selectedFileDetails.preview && (
              <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                <h3 className="text-sm font-semibold text-text-primary mb-3">🖼️ Preview</h3>
                <div className="flex justify-center">
                  <img
                    src={selectedFileDetails.preview}
                    alt={selectedFileDetails.name}
                    className="max-w-full max-h-64 rounded border border-border-default object-contain"
                  />
                </div>
              </div>
            )}

            {/* Conteúdo Extraído */}
            {selectedFileDetails.extractedContent && (
              <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                <h3 className="text-sm font-semibold text-text-primary mb-3">
                  📝 Conteúdo Extraído
                  {selectedFileDetails.file?.type?.startsWith('image/') && ' (OCR)'}
                  {selectedFileDetails.file?.type === 'application/pdf' && ' (PDF)'}
                  {selectedFileDetails.file?.type?.startsWith('text/') && ' (Texto)'}
                </h3>
                <div className="bg-bg-primary rounded p-3 border border-border-default max-h-96 overflow-y-auto">
                  <pre className="text-xs text-text-primary whitespace-pre-wrap font-mono">
                    {selectedFileDetails.extractedContent}
                  </pre>
                </div>
                <p className="text-xs text-text-tertiary mt-2">
                  {selectedFileDetails.extractedContent.length} caracteres extraídos
                </p>
              </div>
            )}

            {/* Metadados Adicionais */}
            <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
              <h3 className="text-sm font-semibold text-text-primary mb-3">🔍 Metadados</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Tipo de Arquivo:</span>
                  <span className="text-text-primary">
                    {selectedFileDetails.file?.type?.startsWith('image/') ? 'Imagem' :
                     selectedFileDetails.file?.type === 'application/pdf' ? 'PDF' :
                     selectedFileDetails.file?.type?.startsWith('text/') ? 'Texto' :
                     'Outro'}
                  </span>
                </div>
                {selectedFileDetails.file?.type?.startsWith('image/') && (
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">OCR Aplicado:</span>
                    <span className="text-status-success">✓ Sim</span>
                  </div>
                )}
                {selectedFileDetails.file?.type === 'application/pdf' && (
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Texto Extraído:</span>
                    <span className="text-status-success">✓ Sim</span>
                  </div>
                )}
                {selectedFileDetails.progress !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Progresso:</span>
                    <span className="text-text-primary">{selectedFileDetails.progress}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Informações de Indexação */}
            {selectedFileDetails.status === 'success' && (
              <div className="bg-status-success/10 rounded-lg p-4 border border-status-success/30">
                <h3 className="text-sm font-semibold text-status-success mb-2">✓ Indexado no RAG</h3>
                <p className="text-xs text-text-secondary">
                  Este arquivo foi processado, teve seu conteúdo extraído e foi indexado no RAG. 
                  Ele estará disponível para consultas quando você selecionar "Arquivos Enviados" nas fontes RAG.
                </p>
              </div>
            )}

            {/* Erro se houver */}
            {selectedFileDetails.error && (
              <div className="bg-status-error/10 rounded-lg p-4 border border-status-error/30">
                <h3 className="text-sm font-semibold text-status-error mb-2">✗ Erro</h3>
                <p className="text-xs text-status-error">{selectedFileDetails.error}</p>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Modal de Relatório/Log RPA */}
      <Dialog
        isOpen={showReportModal}
        onClose={() => {
          setShowReportModal(false);
          setReportData(null);
          setReportError(null);
        }}
        title={reportData?.replayData ? "📋 Log do Teste RPA" : "📊 Relatório de Teste RPA"}
        size="xl"
        draggable={true}
        resizable={true}
      >
        <div className="space-y-6 max-h-[80vh] overflow-y-auto">
          {loadingReport && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-2"></div>
              <p className="text-text-secondary">Carregando relatório...</p>
            </div>
          )}

          {reportError && (
            <div className="bg-status-error/10 rounded-lg p-4 border border-status-error/30">
              <h3 className="text-sm font-semibold text-status-error mb-2">✗ Erro</h3>
              <p className="text-xs text-status-error">{reportError}</p>
            </div>
          )}

          {reportData && !loadingReport && (
            <>
              {/* Se for um replay/log, exibe informações do replay */}
              {(reportData.replayData || (reportData.actions && reportData.screens)) && (
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-text-primary">📋 Log/Replay do Teste RPA</h3>
                    {totalSteps > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-tertiary">
                          {totalSteps} passo{totalSteps !== 1 ? 's' : ''}
                        </span>
                        <Button
                          onClick={() => {
                            setReplayStepByStep(!replayStepByStep);
                            if (!replayStepByStep) {
                              setCurrentReplayStep(0);
                            }
                          }}
                          variant="default"
                          size="sm"
                          className="text-xs"
                        >
                          {replayStepByStep ? '📋 Ver Lista Completa' : '▶️ Modo Step-by-Step'}
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  {(() => {
                    const replayData = reportData.replayData || reportData;
                    return (
                      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                        {replayData.id && (
                          <div>
                            <span className="text-text-tertiary block">ID do Replay:</span>
                            <p className="text-text-primary font-mono text-xs">{replayData.id}</p>
                          </div>
                        )}
                        {replayData.recordingId && (
                          <div>
                            <span className="text-text-tertiary block">ID da Gravação:</span>
                            <p className="text-text-primary font-mono text-xs">{replayData.recordingId}</p>
                          </div>
                        )}
                        {replayData.startTime && (
                          <div>
                            <span className="text-text-tertiary block">Início:</span>
                            <p className="text-text-primary">
                              {new Date(replayData.startTime).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        )}
                        {replayData.endTime && (
                          <div>
                            <span className="text-text-tertiary block">Fim:</span>
                            <p className="text-text-primary">
                              {new Date(replayData.endTime).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Modo Step-by-Step */}
                  {replayStepByStep && totalSteps > 0 && currentStep && (
                    <div className="mt-4 space-y-4">
                      {/* Controles de navegação */}
                      <div className="flex items-center justify-between p-3 bg-bg-primary rounded-lg border border-border-default">
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={goToFirst}
                            disabled={currentReplayStep === 0}
                            variant="default"
                            size="sm"
                            className="text-xs"
                          >
                            ⏮️ Primeiro
                          </Button>
                          <Button
                            onClick={goToPrevious}
                            disabled={currentReplayStep === 0}
                            variant="default"
                            size="sm"
                            className="text-xs"
                          >
                            ◀️ Anterior
                          </Button>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-text-primary">
                            Passo {currentReplayStep + 1} de {totalSteps}
                          </span>
                          <div className="w-48 bg-bg-secondary rounded-full h-2">
                            <div
                              className="bg-accent-primary h-2 rounded-full transition-all duration-300"
                              style={{ width: `${((currentReplayStep + 1) / totalSteps) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={goToNext}
                            disabled={currentReplayStep >= totalSteps - 1}
                            variant="default"
                            size="sm"
                            className="text-xs"
                          >
                            Próximo ▶️
                          </Button>
                          <Button
                            onClick={goToLast}
                            disabled={currentReplayStep >= totalSteps - 1}
                            variant="default"
                            size="sm"
                            className="text-xs"
                          >
                            Último ⏭️
                          </Button>
                        </div>
                      </div>

                      {/* Screenshot do passo atual */}
                      {currentStep.screen?.screenshot && (
                        <div className="bg-bg-primary rounded-lg p-4 border border-border-default">
                          <h4 className="text-xs font-semibold text-text-primary mb-2">
                            📸 Tela Capturada (Antes da Ação)
                          </h4>
                          <div className="flex justify-center">
                            <img
                              src={`data:image/png;base64,${currentStep.screen.screenshot}`}
                              alt={`Screenshot do passo ${currentReplayStep + 1}`}
                              className="max-w-full max-h-96 rounded border border-border-default object-contain"
                            />
                          </div>
                          {currentStep.screen.timestamp && (
                            <p className="text-xs text-text-tertiary mt-2 text-center">
                              Capturada em: {new Date(currentStep.screen.timestamp).toLocaleString('pt-BR')}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Detalhes da ação do passo atual */}
                      <div className={`bg-bg-primary rounded-lg p-4 border ${
                        currentStep.action.success !== false
                          ? 'border-status-success/30 bg-status-success/5'
                          : 'border-status-error/30 bg-status-error/5'
                      }`}>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-text-primary">
                            🎯 Ação Executada
                          </h4>
                          <div className="flex items-center gap-2">
                            {currentStep.action.success !== false ? (
                              <span className="text-status-success text-lg">✓</span>
                            ) : (
                              <span className="text-status-error text-lg">✗</span>
                            )}
                            <span className={`text-xs font-semibold ${
                              currentStep.action.success !== false ? 'text-status-success' : 'text-status-error'
                            }`}>
                              {currentStep.action.success !== false ? 'SUCESSO' : 'FALHA'}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <span className="text-xs text-text-tertiary block">Tipo de Ação:</span>
                            <p className="text-sm font-semibold text-text-primary uppercase">
                              {currentStep.action.type || currentStep.action.action || 'Ação'}
                            </p>
                          </div>

                          {currentStep.action.selector && (
                            <div>
                              <span className="text-xs text-text-tertiary block">Seletor:</span>
                              <p className="text-xs font-mono text-text-primary bg-bg-secondary p-2 rounded">
                                {currentStep.action.selector}
                              </p>
                            </div>
                          )}

                          {currentStep.action.value !== undefined && currentStep.action.value !== null && (
                            <div>
                              <span className="text-xs text-text-tertiary block">Valor:</span>
                              <p className="text-xs text-text-primary bg-bg-secondary p-2 rounded break-all">
                                {typeof currentStep.action.value === 'string' 
                                  ? currentStep.action.value 
                                  : JSON.stringify(currentStep.action.value)}
                              </p>
                            </div>
                          )}

                          {currentStep.action.url && (
                            <div>
                              <span className="text-xs text-text-tertiary block">URL:</span>
                              <p className="text-xs text-text-primary bg-bg-secondary p-2 rounded break-all">
                                {currentStep.action.url}
                              </p>
                            </div>
                          )}

                          {currentStep.timestamp && (
                            <div>
                              <span className="text-xs text-text-tertiary block">Timestamp:</span>
                              <p className="text-xs text-text-primary">
                                {new Date(currentStep.timestamp).toLocaleString('pt-BR')}
                              </p>
                            </div>
                          )}

                          {currentStep.action.duration && (
                            <div>
                              <span className="text-xs text-text-tertiary block">Duração:</span>
                              <p className="text-xs text-text-primary">
                                {typeof currentStep.action.duration === 'number'
                                  ? `${currentStep.action.duration}ms`
                                  : currentStep.action.duration}
                              </p>
                            </div>
                          )}

                          {currentStep.action.error && (
                            <div className="mt-3 pt-3 border-t border-status-error/30">
                              <span className="text-xs font-semibold text-status-error block mb-2">Erro:</span>
                              <div className="p-2 bg-status-error/10 rounded border border-status-error/30">
                                <p className="text-xs text-status-error">
                                  {typeof currentStep.action.error === 'string'
                                    ? currentStep.action.error
                                    : JSON.stringify(currentStep.action.error)}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Modo Lista Completa */}
                  {!replayStepByStep && (
                    <>
                      {/* Ações do replay */}
                      {(() => {
                        const replayData = reportData.replayData || reportData;
                        return replayData.actions && replayData.actions.length > 0 && (
                          <div className="mt-4">
                            <h4 className="text-xs font-semibold text-text-primary mb-2">Ações Executadas:</h4>
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                              {replayData.actions.map((action, actionIndex) => (
                              <div
                                key={actionIndex}
                                className={`p-2 rounded border text-xs ${
                                  action.success !== false
                                    ? 'bg-status-success/5 border-status-success/20'
                                    : 'bg-status-error/5 border-status-error/20'
                                }`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-mono text-text-tertiary">#{actionIndex + 1}</span>
                                      <span className="font-semibold text-text-primary uppercase">
                                        {action.type || action.action || 'Ação'}
                                      </span>
                                      {action.success !== false ? (
                                        <span className="text-status-success">✓</span>
                                      ) : (
                                        <span className="text-status-error">✗</span>
                                      )}
                                    </div>
                                    {action.selector && (
                                      <p className="text-text-secondary font-mono text-xs mb-1">
                                        {action.selector}
                                      </p>
                                    )}
                                    {action.value && (
                                      <p className="text-text-secondary text-xs mb-1">
                                        Valor: {typeof action.value === 'string' ? action.value.substring(0, 100) : JSON.stringify(action.value).substring(0, 100)}
                                      </p>
                                    )}
                                    {action.timestamp && (
                                      <p className="text-text-tertiary text-xs">
                                        {new Date(action.timestamp).toLocaleTimeString('pt-BR')}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {action.error && (
                                  <div className="mt-2 p-2 bg-status-error/10 rounded border border-status-error/30">
                                    <p className="text-status-error text-xs">{action.error}</p>
                                  </div>
                                )}
                              </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Telas capturadas */}
                      {(() => {
                        const replayData = reportData.replayData || reportData;
                        return replayData.screens && replayData.screens.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-border-default">
                            <h4 className="text-xs font-semibold text-text-primary mb-2">Telas Capturadas:</h4>
                            <p className="text-xs text-text-tertiary mb-2">
                              {replayData.screens.length} tela(s) capturada(s) durante a execução
                            </p>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {/* Erros do replay */}
                  {(() => {
                    const replayData = reportData.replayData || reportData;
                    return replayData.errors && replayData.errors.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border-default">
                      <h4 className="text-xs font-semibold text-status-error mb-2">Erros Registrados:</h4>
                      <div className="space-y-2">
                        {replayData.errors.map((error, errorIndex) => (
                          <div
                            key={errorIndex}
                            className="p-2 bg-status-error/10 rounded border border-status-error/30"
                          >
                            <p className="text-status-error text-xs">
                              {error.message || error.error || JSON.stringify(error)}
                            </p>
                            {error.stack && (
                              <pre className="text-xs text-text-tertiary mt-1 whitespace-pre-wrap font-mono">
                                {error.stack}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })()}

                  {/* JSON completo (opcional, colapsável) */}
                  <div className="mt-4 pt-4 border-t border-border-default">
                    <details className="cursor-pointer">
                      <summary className="text-xs font-semibold text-text-primary mb-2">
                        📄 Ver JSON Completo do Log
                      </summary>
                      <div className="mt-2 bg-bg-primary rounded p-3 border border-border-default max-h-64 overflow-y-auto">
                        <pre className="text-xs text-text-primary whitespace-pre-wrap font-mono">
                          {JSON.stringify(reportData, null, 2)}
                        </pre>
                      </div>
                    </details>
                  </div>
                </div>
              )}

              {/* Resumo */}
              {reportData.summary && (
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <h3 className="text-sm font-semibold text-text-primary mb-3">📈 Resumo</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-text-tertiary block">Total:</span>
                      <p className="text-text-primary font-semibold text-lg">{reportData.summary.total || 0}</p>
                    </div>
                    <div>
                      <span className="text-text-tertiary block">Passou:</span>
                      <p className="text-status-success font-semibold text-lg">{reportData.summary.passed || 0}</p>
                    </div>
                    <div>
                      <span className="text-text-tertiary block">Falhou:</span>
                      <p className="text-status-error font-semibold text-lg">{reportData.summary.failed || 0}</p>
                    </div>
                    <div>
                      <span className="text-text-tertiary block">Taxa de Sucesso:</span>
                      <p className="text-text-primary font-semibold text-lg">{reportData.summary.successRate || '0%'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Resultados */}
              {reportData.results && reportData.results.length > 0 && (
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <h3 className="text-sm font-semibold text-text-primary mb-3">✅ Resultados</h3>
                  <div className="space-y-3">
                    {reportData.results.map((result, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border ${
                          result.success
                            ? 'bg-status-success/10 border-status-success/30'
                            : 'bg-status-error/10 border-status-error/30'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-text-primary">
                              {result.recordingName || result.recordingId || `Teste ${index + 1}`}
                            </p>
                            {result.recordingId && (
                              <p className="text-xs text-text-tertiary font-mono mt-1">{result.recordingId}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="text-status-success text-lg">✓</span>
                            ) : (
                              <span className="text-status-error text-lg">✗</span>
                            )}
                            <span className={`text-xs font-semibold ${
                              result.success ? 'text-status-success' : 'text-status-error'
                            }`}>
                              {result.success ? 'PASSOU' : 'FALHOU'}
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-xs mt-3 pt-3 border-t border-border-default">
                          <div>
                            <span className="text-text-tertiary block">Passos:</span>
                            <p className="text-text-primary font-medium">{result.stepsCount || 0}</p>
                          </div>
                          <div>
                            <span className="text-text-tertiary block">Erros:</span>
                            <p className="text-text-primary font-medium">{result.errorsCount || 0}</p>
                          </div>
                          <div>
                            <span className="text-text-tertiary block">Duração:</span>
                            <p className="text-text-primary font-medium">
                              {result.duration ? `${(result.duration / 1000).toFixed(2)}s` : 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detalhes */}
              {reportData.details && reportData.details.length > 0 && (
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <h3 className="text-sm font-semibold text-text-primary mb-3">🔍 Detalhes da Execução</h3>
                  <div className="space-y-4">
                    {reportData.details.map((detail, detailIndex) => (
                      <div key={detailIndex} className="border border-border-default rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-text-primary">
                              {detail.recordingName || detail.recordingId || `Execução ${detailIndex + 1}`}
                            </p>
                            {detail.recordingId && (
                              <p className="text-xs text-text-tertiary font-mono mt-1">{detail.recordingId}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {detail.success ? (
                              <span className="text-status-success text-lg">✓</span>
                            ) : (
                              <span className="text-status-error text-lg">✗</span>
                            )}
                            <span className={`text-xs font-semibold ${
                              detail.success ? 'text-status-success' : 'text-status-error'
                            }`}>
                              {detail.success ? 'SUCESSO' : 'FALHA'}
                            </span>
                          </div>
                        </div>

                        {/* Informações de tempo */}
                        <div className="grid grid-cols-2 gap-4 text-xs mb-3 pb-3 border-b border-border-default">
                          {detail.startTime && (
                            <div>
                              <span className="text-text-tertiary block">Início:</span>
                              <p className="text-text-primary">
                                {new Date(detail.startTime).toLocaleString('pt-BR')}
                              </p>
                            </div>
                          )}
                          {detail.endTime && (
                            <div>
                              <span className="text-text-tertiary block">Fim:</span>
                              <p className="text-text-primary">
                                {new Date(detail.endTime).toLocaleString('pt-BR')}
                              </p>
                            </div>
                          )}
                          {detail.duration && (
                            <div>
                              <span className="text-text-tertiary block">Duração:</span>
                              <p className="text-text-primary font-medium">
                                {(detail.duration / 1000).toFixed(2)}s
                              </p>
                            </div>
                          )}
                          {detail.replayId && (
                            <div>
                              <span className="text-text-tertiary block">Replay ID:</span>
                              <p className="text-text-primary font-mono text-xs">{detail.replayId}</p>
                            </div>
                          )}
                        </div>

                        {/* Passos */}
                        {detail.steps && detail.steps.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-text-primary mb-2">Passos Executados:</h4>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {detail.steps.map((step, stepIndex) => (
                                <div
                                  key={stepIndex}
                                  className={`p-2 rounded border text-xs ${
                                    step.success
                                      ? 'bg-status-success/5 border-status-success/20'
                                      : 'bg-status-error/5 border-status-error/20'
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="font-mono text-text-tertiary">#{step.step}</span>
                                        <span className="font-semibold text-text-primary uppercase">
                                          {step.action}
                                        </span>
                                        {step.success ? (
                                          <span className="text-status-success">✓</span>
                                        ) : (
                                          <span className="text-status-error">✗</span>
                                        )}
                                      </div>
                                      {step.selector && (
                                        <p className="text-text-secondary font-mono text-xs mb-1">
                                          {step.selector}
                                        </p>
                                      )}
                                      {step.timestamp && (
                                        <p className="text-text-tertiary text-xs">
                                          {new Date(step.timestamp).toLocaleTimeString('pt-BR')}
                                          {step.duration && ` • ${step.duration}ms`}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  {step.error && (
                                    <div className="mt-2 p-2 bg-status-error/10 rounded border border-status-error/30">
                                      <p className="text-status-error text-xs">{step.error}</p>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Erros */}
                        {detail.errors && detail.errors.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border-default">
                            <h4 className="text-xs font-semibold text-status-error mb-2">Erros:</h4>
                            <div className="space-y-2">
                              {detail.errors.map((error, errorIndex) => (
                                <div
                                  key={errorIndex}
                                  className="p-2 bg-status-error/10 rounded border border-status-error/30"
                                >
                                  <p className="text-status-error text-xs">{error}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Screenshots */}
                        {detail.screenshots && detail.screenshots.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border-default">
                            <h4 className="text-xs font-semibold text-text-primary mb-2">Screenshots:</h4>
                            <div className="grid grid-cols-2 gap-2">
                              {detail.screenshots.map((screenshot, screenshotIndex) => (
                                <div key={screenshotIndex} className="border border-border-default rounded overflow-hidden">
                                  {typeof screenshot === 'string' ? (
                                    <img
                                      src={screenshot}
                                      alt={`Screenshot ${screenshotIndex + 1}`}
                                      className="w-full h-auto"
                                    />
                                  ) : (
                                    <div className="p-2 text-xs text-text-tertiary">
                                      Screenshot {screenshotIndex + 1}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}

