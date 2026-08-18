import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input, Textarea } from '../styles/Input';

import { usePipelineMachine, PipelineStage, PIPELINE_STAGE_ORDER } from '../hooks/usePipelineMachine';
import { useFileUpload } from '../context/FileUploadContext';
import { uploadDocument } from '../api/ragDocuments';
import { processFile } from '../utils/fileProcessor';
import { fetchBlob, fetchJson } from '../api/client';
import { Dialog } from '../components/Dialog';

import logger from '../utils/logger';
import { getFallbackFlag } from '../utils/fallbacksConfig';
import { getRpaReplay, createFlow, listRpaReplays } from '../api/flows';
import { executeRpaRecording } from '../api/rpa';
import { getBasePath } from '../utils';
import { fetchQuestionGenerationRules } from '../utils/fetchQuestionGenerationRules';
import { AutoInitialGraphCanvas } from '../components/AutoInitialGraphCanvas';
import { usePipelineSocket } from '../hooks/usePipelineSocket';
import { CrudPageBase } from '../modules/crud-base';
import {
  GenerateSystemFileDetailsDialog,
  GenerateSystemGeneratedFlowDialog,
  GenerateSystemInitialFlowDialog,
} from './generate-system/GenerateSystemDialogs';
import { GenerateSystemKnowledgeFaqSection } from './generate-system/GenerateSystemKnowledgeFaqSection';
import { GenerateSystemPipelineResultSection } from './generate-system/GenerateSystemPipelineResultSection';
import { GenerateSystemReportModal } from './generate-system/GenerateSystemReportModal';
import { GenerateSystemFormSection } from './generate-system/GenerateSystemFormSection';
import { GenerateSystemHeader } from './generate-system/GenerateSystemHeader';
import {
  buildPipelineResetState,
  collectUploadedFileNames,
  ensurePipelineExecution,
  enforceLocalRateLimitBeforeExecution,
  handleGenericExecutionFailure,
  handleExecutionRateLimitError,
  initializeStandardExecutionState,
  initializeTenantExecutionState,
  persistTenantTargetContentBestEffort,
  persistDryRunEphemeralContext,
  prepareExecutionQuestions,
  prepareTenantDryRunDescription,
  processPendingFilesPipelineStep,
  requestInitialFlowGeneration,
  resetArtifactGenerationPipelineSteps,
  requestDescriptionSuggestion,
  reuseSuccessfulUploadedFilesAsEvidence,
  startTenantInitialFlowBestEffort,
  validateTenantPipelinePrereqs,
  validateTenantExecutionInput,
  verifyServerRateLimitBeforeExecution,
  verifyServerHealthBeforeExecution,
} from './generate-system/generateSystemExecutionUtils';
import { buildFinalStatus } from './generate-system/generateSystemResultUtils';
import { validateUrl } from './generate-system/generateSystemFileUtils';
import {
  appendScrapedTextChunks,
  executeTenantPostDescriptionScraping,
  executeWebScrapingBatch,
  getValidHttpUrls,
  persistWebScrapingOnTargetTenant,
} from './generate-system/generateSystemWebScrapingUtils';
import { executeTenantModeOrchestration } from './generate-system/generateSystemTenantModeOrchestrator';
import { executeStandardModeOrchestration } from './generate-system/generateSystemStandardModeOrchestrator';
import {
  buildStandardOrchestratorConfigFromPageContext,
  buildTenantOrchestratorConfigFromPageContext,
} from './generate-system/generateSystemOrchestratorConfigBuilders';
import { useGenerateSystemFaq } from './generate-system/useGenerateSystemFaq';
import { useGenerateSystemFileUpload } from './generate-system/useGenerateSystemFileUpload';
import { useGenerateSystemPendingFileProcessing } from './generate-system/useGenerateSystemPendingFileProcessing';
import { useGenerateSystemScrapingTargets } from './generate-system/useGenerateSystemScrapingTargets';
import { useGenerateSystemReportReplay } from './generate-system/useGenerateSystemReportReplay';
import { useGenerateSystemPipelineRealtime } from './generate-system/useGenerateSystemPipelineRealtime';
import { PIPELINE_LABELS, getStepMessage } from './generate-system/generateSystemPipelineUiConfig';
import {
  derivePreValidationStatus,
} from './generate-system/generateSystemValidationUtils';

import { useGenerateSystemPipelineDetailsUpdater } from './generate-system/useGenerateSystemPipelineDetailsUpdater';
import { useGenerateSystemRateLimit } from './generate-system/useGenerateSystemRateLimit';
import { useGenerateSystemInitialFlowObjective } from './generate-system/useGenerateSystemInitialFlowObjective';
import { useGenerateSystemErrorToast } from './generate-system/useGenerateSystemErrorToast';
import { useGenerateSystemBootstrapMode } from './generate-system/useGenerateSystemBootstrapMode';
import { useGenerateSystemAuthGuard } from './generate-system/useGenerateSystemAuthGuard';
import { useGenerateSystemExecutingRefSync } from './generate-system/useGenerateSystemExecutingRefSync';
import { useGenerateSystemInitialFlowUiReset } from './generate-system/useGenerateSystemInitialFlowUiReset';
import { useGenerateSystemValidationGate } from './generate-system/useGenerateSystemValidationGate';
import { useGenerateSystemPayloadBuilder } from './generate-system/useGenerateSystemPayloadBuilder';
import { useGenerateSystemOrchestratorContext } from './generate-system/useGenerateSystemOrchestratorContext';

/**
 * Tela Única - Centro Operacional da Plataforma
 * 
 * Esta é a única tela que gera, valida, executa e decide.
 * Nada fora dessa tela é considerado válido.
 */
export function GenerateSystemPage() {
  const { isAuthenticated, loading: authLoading, agent, updateAgent } = useAuth();
  const { navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const pipelineSocket = usePipelineSocket(showToast);

  // Estado efêmero do pipeline (reusado por helpers, ex.: FAQ/fluxo no modo tenant)
  const pipelineExecutionIdRef = useRef(null);
  const useInlineChunksForSuggestRef = useRef(false);
  const ephemeralChunksRef = useRef([]);
  const fileCategoryInferenceIssuesRef = useRef({ count: 0, last: null });
  // No modo tenant (super-admin), o tenant de *persistência* pode ser diferente do tenant do agente (contexto/provedor).
  // Guardamos aqui o tenant-alvo (recém-criado) para indexação/persistência posterior.
  const targetTenantIdRef = useRef(null);

  // Detecta se está no modo de geração de tenant
  // Importante: o roteador interno observa apenas `pathname` (não querystring),
  // então precisamos observar `window.location.search` explicitamente para reagir ao ?mode=tenant.
  const [locationSearch, setLocationSearch] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.location.search || '';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const update = () => setLocationSearch(window.location.search || '');
    window.addEventListener('popstate', update);
    // Evento customizado disparado pelo nosso useRouter()
    window.addEventListener('router:change', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('router:change', update);
    };
  }, []);

  const isTenantMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const urlParams = new URLSearchParams(locationSearch || '');
    return urlParams.get('mode') === 'tenant';
  }, [locationSearch]);

  // (effects movidos para após os useState, para evitar TDZ/ReferenceError)

  // BLOCO 1 - Intenção do Usuário
  const [generateFlow, setGenerateFlow] = useState(false);
  const [generateRpa, setGenerateRpa] = useState(false);
  const [generateSeed, setGenerateSeed] = useState(false);
  const [executeFullValidation, setExecuteFullValidation] = useState(true);
  const [bootstrap, setBootstrap] = useState(true);

  // BLOCO 2 - Fonte de Conhecimento da IA
  const [useRag, setUseRag] = useState(true);
  const [ragSources, setRagSources] = useState({
    flows: true,
    qa: true,
    docs: true,
  });
  const [useWebScraping, setUseWebScraping] = useState(true);
  const [scrapingTargets, setScrapingTargets] = useState(['']);
  
  // Upload de arquivos para RAG
  const { files: uploadedFiles, addSelectedFiles, updateFile: updateUploadedFile, removeFile: removeUploadedFile, FileStatus } = useFileUpload();
  const uploadedFilesRef = useRef([]);
  useEffect(() => {
    uploadedFilesRef.current = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  }, [uploadedFiles]);
  const [selectedFileDetails, setSelectedFileDetails] = useState(null); // Arquivo selecionado para ver detalhes

  // BLOCO 3 - Perguntas (FAQ / Aprendizado Adaptivo)
  const [includeQuestions, setIncludeQuestions] = useState(false);
  const [inferQuestions, setInferQuestions] = useState(false);
  const [questionsText, setQuestionsText] = useState('');
  const [questionsList, setQuestionsList] = useState([]);
  const [questionGenerationRules, setQuestionGenerationRules] = useState(null);
  const [faqGroups, setFaqGroups] = useState(null); // [{category, questions}]
  const [faqCoverage, setFaqCoverage] = useState(null); // 0..1
  const [faqCoverageMeta, setFaqCoverageMeta] = useState(null); // {chunkTextsEffective, chunkCoverageMode} (best-effort)
  const [faqExclusions, setFaqExclusions] = useState(null); // string[]
  const [showFaqExclusions, setShowFaqExclusions] = useState(false);
  const [initialFlow, setInitialFlow] = useState(null); // Engine FlowDefinition (será renderizado no editor)
  const [initialFlowEntities, setInitialFlowEntities] = useState(null); // entidades extraídas (escopo do atendimento)
  const [initialGraphLoading, setInitialGraphLoading] = useState(false);
  const [showInitialFlowModal, setShowInitialFlowModal] = useState(false);
  const [initialFlowModalSize, setInitialFlowModalSize] = useState({ width: null, height: null });
  const [showGeneratedFlowModal, setShowGeneratedFlowModal] = useState(false);
  const [generatedFlowModalSize, setGeneratedFlowModalSize] = useState({ width: null, height: null });
  const [generatedFlowForModal, setGeneratedFlowForModal] = useState(null);
  const [generatedFlowEditorUrl, setGeneratedFlowEditorUrl] = useState('');
  const [isPersistingInitialFlow, setIsPersistingInitialFlow] = useState(false);
  const [isInitialFlowFullscreen, setIsInitialFlowFullscreen] = useState(false);
  const [isInitialFlowMinimized, setIsInitialFlowMinimized] = useState(false);
  const [showInitialFlowObjectiveEditor, setShowInitialFlowObjectiveEditor] = useState(false);
  const [initialFlowObjectiveDraft, setInitialFlowObjectiveDraft] = useState('');
  const [isGeneratedFlowFullscreen, setIsGeneratedFlowFullscreen] = useState(false);
  const initialFlowPrevAgentRef = useRef(null);
  const generatedFlowPrevAgentRef = useRef(null);
  const lastInitialFlowSignatureRef = useRef(null);
  const initialFlowRequestInFlightRef = useRef(false);

  const extractTenantFromInitialFlowId = useCallback((flowId) => {
    try {
      const s = String(flowId || '');
      const prefix = 'initial-';
      const marker = '-exec-';
      if (!s.startsWith(prefix)) return null;
      const idx = s.indexOf(marker);
      if (idx <= prefix.length) return null;
      return s.slice(prefix.length, idx) || null;
    } catch {
      return null;
    }
  }, []);

  // Tenant context por localStorage (super-admin) foi desabilitado:
  // - O WebSocket usa o tenant do token (não do localStorage), então trocar localStorage não resolve o roteamento.
  // - Além disso, isso causa efeitos globais (X-Tenant-Id) e pode persistir documentos no tenant errado.
  // Tenant switching deve acontecer via headers por requisição (X-Tenant-Id) e/ou persistTenantId.
  const applyTenantContextForEditor = useCallback(() => false, []);

  const restoreTenantContextAfterEditor = useCallback(() => {}, []);

  const downloadJsonFile = useCallback((data, filenameBase) => {
    try {
      const safeBase = (filenameBase && String(filenameBase).trim()) ? String(filenameBase).trim() : 'export';
      const filename = safeBase.endsWith('.json') ? safeBase : `${safeBase}.json`;
      const payload = JSON.stringify(data ?? null, null, 2);
      const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      logger.warn('[UI] Falha ao exportar JSON', { error: e?.message || String(e) });
      showToast?.('Não foi possível exportar o JSON.', 'error');
    }
  }, [showToast]);

  // Modal desacoplado do fluxo auxiliar:
  // - `generateInitialFlow()` é best-effort
  // - No modo tenant, abre automaticamente quando o fluxo ficar disponível (1x por assinatura)
  const pipelineMachine = usePipelineMachine();
  useEffect(() => {
    if (!isTenantMode) return;
    if (!initialFlow || typeof initialFlow !== 'object') return;

    // Evita reabrir o modal repetidamente se o usuário fechar.
    const signature = JSON.stringify({
      id: initialFlow?.id || null,
      nodes: Array.isArray(initialFlow?.nodes) ? initialFlow.nodes.length : null,
      edges: Array.isArray(initialFlow?.edges) ? initialFlow.edges.length : null,
    });
    if (lastInitialFlowSignatureRef.current === signature) return;
    lastInitialFlowSignatureRef.current = signature;

    setShowInitialFlowModal(true);
  }, [isTenantMode, initialFlow]);

  const ensureInitialFlowLoaded = async () => {
    if (initialFlow && typeof initialFlow === 'object') return initialFlow;
    if (initialFlowRequestInFlightRef.current) return null;

    const contextTenantId = validatedTenantId || agent?.tenantId || null;
    const execId = pipelineExecutionIdRef.current || null;
    // Em dry-run, não temos tenant real para persistência; no real, o tenant alvo é o criado.
    const tenantTargetId = result?.tenant?.id || result?.tenantId || null;

    if (!contextTenantId || !execId) return null;

    initialFlowRequestInFlightRef.current = true;
    setInitialGraphLoading(true);
    // Fallback local: pode demorar até o primeiro snapshot WS refletir currentStage.
    try {
      updatePipelineWithDetails({
        initialFlowGenerated: {
          status: 'in_progress',
          progress: 0,
          message: 'Gerando fluxo inicial (intents + respostas)...',
        },
      }, 'initial-flow-on-demand');
    } catch {
      // best-effort
    }
    try {
      // Abre o modal imediatamente; quando `initialFlow` chegar, o Dialog monta e aparece.
      setShowInitialFlowModal(true);

      const { flow, persisted, entities } = await requestInitialFlowGeneration({
        fetchJson,
        contextTenantId,
        executionId: execId,
        targetTenantId: tenantTargetId,
        executionMode,
        questionsList,
        useInlineChunksForSuggest: useInlineChunksForSuggestRef.current,
        ephemeralChunks: ephemeralChunksRef.current,
        // Essa chamada envolve múltiplas etapas de IA; 12s abortava com frequência.
        timeoutMs: 60000,
        silent: true,
      });

      if (entities && typeof entities === 'object') setInitialFlowEntities(entities);
      if (flow && typeof flow === 'object') {
        setInitialFlow({ ...flow, __persisted: persisted });
        return flow;
      }
      return null;
    } catch (e) {
      logger.warn('[TenantMode] Falha ao carregar/gerar fluxo inicial (on-demand)', { error: e?.message || String(e) });
      setError('Não foi possível carregar o fluxo inicial automaticamente. Tente novamente.');
      try {
        updatePipelineWithDetails({
          initialFlowGenerated: {
            status: 'error',
            progress: 0,
            message: 'Falha ao gerar fluxo inicial.',
          },
        }, 'initial-flow-on-demand-error');
      } catch {
        // best-effort
      }
      return null;
    } finally {
      initialFlowRequestInFlightRef.current = false;
      setInitialGraphLoading(false);
    }
  };

  // Ajusta o comportamento quando está no modo tenant
  useEffect(() => {
    if (!isTenantMode) return;
    // No modo tenant, ativa web scraping por padrão para obter informações do site
    // Mas permite que o usuário configure tudo conforme necessário
    if (!useWebScraping && scrapingTargets.length === 0) {
      setUseWebScraping(true);
    }
  }, [isTenantMode, useWebScraping, scrapingTargets]);

  // Carrega regras de geração de perguntas (best-effort)
  useEffect(() => {
    let mounted = true;
    (async () => {
      const rules = await fetchQuestionGenerationRules();
      if (!mounted) return;
      setQuestionGenerationRules(rules || null);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // BLOCO 4 - Configuração da Execução
  const [executionMode, setExecutionMode] = useState('dry-run'); // 'dry-run' ou 'real'
  const [rpaMode, setRpaMode] = useState('infer'); // 'infer', 'record', 'hybrid'

  // Dados básicos
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionMode, setDescriptionMode] = useState('institutional'); // 'institutional' | 'technical'

  // BLOCO 4 - Validações Automáticas
  const [validationStatus, setValidationStatus] = useState({
    contract: null, // null, 'valid', 'invalid'
    schema: null,
    governance: null,
    rpaPreValidation: null,
  });

  // BLOCO 5 - Pipeline Visível
  const [pipelineStatus, setPipelineStatus] = useState({
    providerValidated: false,
    ragValidated: false,
    webScraping: false,
    descriptionSuggested: false,
    questionsGenerated: false,
    filesInferred: false,
    payloadValid: false,
    contractValid: false,
    contextBuilt: false,
    ragContextBuilt: false,
    aiExecuted: false,
    flowGenerated: false,
    seedGenerated: false,
    rpaGenerated: false,
    rpaExecuted: false,
    approved: false,
  });
  
  // Estado detalhado do pipeline com timestamps e mensagens
  const [pipelineDetails, setPipelineDetails] = useState({
    providerValidated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    ragValidated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    webScraping: { status: 'pending', timestamp: null, message: null, progress: 0 },
    descriptionSuggested: { status: 'pending', timestamp: null, message: null, progress: 0, meta: null },
    questionsGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    filesInferred: { status: 'pending', timestamp: null, message: null, progress: 0 },
    payloadValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
    ragContextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
    aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
  });

  // Progresso do pipeline é 100% via WebSocket (pipeline.status)

  // BLOCO 6 - Resultado Final
  const [executing, setExecuting] = useState(false);
  const executingRef = useRef(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const validatedTenantId = useMemo(() => (
    targetTenantIdRef.current ||
    result?.tenant?.id ||
    result?.tenantId ||
    agent?.tenantId ||
    null
  ), [agent?.tenantId, result]);
  
  const {
    rateLimitUntil,
    setRateLimitUntil,
    rateLimitSecondsRemaining,
    setRateLimitSecondsRemaining,
    clearRateLimit,
  } = useGenerateSystemRateLimit({
    fetchJson,
    logger,
    setError,
  });
  
  const {
    showReportModal,
    setShowReportModal,
    reportData,
    setReportData,
    loadingReport,
    reportError,
    setReportError,
    replayStepByStep,
    setReplayStepByStep,
    currentReplayStep,
    setCurrentReplayStep,
    currentStep,
    totalSteps,
    getReplaySteps,
    goToFirst,
    goToPrevious,
    goToNext,
    goToLast,
    handleViewReport,
    handleReplayClick,
  } = useGenerateSystemReportReplay({
    fetchJson,
    listRpaReplays,
    getRpaReplay,
    executeRpaRecording,
    logger,
    setError,
  });

  useGenerateSystemInitialFlowObjective({
    showInitialFlowModal,
    initialFlowEntities,
    tenantDescription: result?.tenant?.description,
    description,
    setInitialFlowObjectiveDraft,
  });

  useGenerateSystemExecutingRefSync({ executing, executingRef });

  useGenerateSystemErrorToast({ error, showToast });

  // Tenant context swap via localStorage foi removido (ver applyTenantContextForEditor acima).

  const updatePipelineWithDetails = useGenerateSystemPipelineDetailsUpdater({
    logger,
    getStepMessage,
    setPipelineStatus,
    setPipelineDetails,
  });

  // Função auxiliar para obter mensagens de cada etapa
  // Verifica se precisa sugerir descrição
  const needsDescriptionSuggestion = useMemo(() => {
    // Mostra a etapa de sugestão sempre no modo dry-run
    return executionMode === 'dry-run';
  }, [executionMode]);

  // Garantia: antes de iniciar um pipeline "backend-only", precisamos que o WS esteja autenticado,
  // senão o backend vai broadcastar para 0 clientes (tenant não associado no servidor).
  const { wsStateRef, ensureWebSocketAuthenticated } = useGenerateSystemPipelineRealtime({
    pipelineMachine,
  });

  // Marca que a execução atual foi abortada (para suprimir efeitos colaterais de tarefas em background)
  const pipelineAbortRef = useRef(false);

  useGenerateSystemAuthGuard({ isAuthenticated, authLoading, navigate });

  useGenerateSystemBootstrapMode({
    bootstrap,
    scrapingTargets,
    setGenerateFlow,
    setGenerateRpa,
    setGenerateSeed,
    setUseRag,
    setRagSources,
    setUseWebScraping,
    setScrapingTargets,
  });

  const { getValidationError, isValid } = useGenerateSystemValidationGate({
    isTenantMode,
    name,
    description,
    bootstrap,
    useRag,
    ragSources,
    useWebScraping,
    scrapingTargets,
    validationStatus,
    executionMode,
    validateUrl,
  });

  const resetInitialFlowUiState = useGenerateSystemInitialFlowUiReset({
    setInitialFlow,
    setInitialFlowEntities,
    setShowInitialFlowModal,
    setInitialFlowModalSize,
    lastInitialFlowSignatureRef,
    setInitialGraphLoading,
  });

  const {
    suggestQuestionsAutoList,
    handleAddQuestionsFromText,
    handleSuggestQuestionsFromDescription,
    handleRemoveQuestion,
  } = useGenerateSystemFaq({
    agent,
    fetchJson,
    pipelineExecutionIdRef,
    pipelineMachine,
    pipelineSocket,
    uploadedFiles,
    scrapingTargets,
    validateUrl,
    name,
    description,
    executionMode,
    useInlineChunksForSuggestRef,
    ephemeralChunksRef,
    questionGenerationRules,
    inferQuestions,
    questionsText,
    questionsList,
    setQuestionsText,
    setQuestionsList,
    setFaqGroups,
    setFaqCoverage,
    setFaqCoverageMeta,
    setFaqExclusions,
    setShowFaqExclusions,
    setInitialFlow,
    setError,
    showToast,
  });

  const generatePayload = useGenerateSystemPayloadBuilder({
    name,
    description,
    bootstrap,
    executionMode,
    useRag,
    ragSources,
    useWebScraping,
    scrapingTargets,
    validateUrl,
    generateFlow,
    generateSeed,
    generateRpa,
    rpaMode,
    executeFullValidation,
    includeQuestions,
    questionsList,
  });

  // Validação prévia (simulada - será feita pelo backend)
  useEffect(() => {
    setValidationStatus(derivePreValidationStatus({ name, description, generateRpa, bootstrap }));
  }, [name, description, generateRpa, bootstrap]);

  // Executa geração e validação
  const handleExecute = async () => {
    if (!isValid || executing) return;

    // Route to orchestrator based on execution mode
    if (isTenantMode) {
      await executeTenantModeOrchestration(
        buildTenantOrchestratorConfigFromPageContext(orchestratorBuilderContext)
      );
      return;
    }
    
    // Route to standard mode orchestrator
    await executeStandardModeOrchestration(
      buildStandardOrchestratorConfigFromPageContext(orchestratorBuilderContext)
    );
  };

  const {
    addScrapingTarget,
    removeScrapingTarget,
    updateScrapingTarget,
  } = useGenerateSystemScrapingTargets({
    scrapingTargets,
    setScrapingTargets,
  });

  const {
    handleFileSelect,
    handleFileUpload,
    downloadRagOriginalFile,
    inferFileCategoryWithAI,
  } = useGenerateSystemFileUpload({
    agent,
    uploadDocument,
    processFile,
    fetchJson,
    fetchBlob,
    addSelectedFiles,
    uploadedFiles,
    updateUploadedFile,
    FileStatus,
    fileCategoryInferenceIssuesRef,
    logger,
    showToast,
    setError,
    executionMode,
    isTenantMode,
    targetTenantIdRef,
    pipelineExecutionIdRef,
  });

  const {
    processPendingFilesWithPipeline,
    processPendingFilesInBackground,
  } = useGenerateSystemPendingFileProcessing({
    inferFileCategoryWithAI,
    handleFileUpload,
    updateUploadedFile,
    FileStatus,
    logger,
    fileCategoryInferenceIssuesRef,
  });

  const orchestratorBuilderContext = useGenerateSystemOrchestratorContext({
    // form & flags
    name, description, descriptionMode, executionMode, generateFlow, generateRpa,
    generateSeed, bootstrap, useWebScraping, needsDescriptionSuggestion,
    // state
    uploadedFiles, scrapingTargets, questionsList, pipelineDetails, rateLimitUntil, agent,
    // actions
    setExecuting, setError, setResult, setDescription, setQuestionsList, setInitialFlow,
    setInitialFlowEntities, setInitialGraphLoading, resetInitialFlowUiState,
    setPipelineStatus, setPipelineDetails, updatePipelineWithDetails,
    setRateLimitUntil, setRateLimitSecondsRemaining,
    // pipeline refs & machines
    pipelineAbortRef, wsStateRef, pipelineExecutionIdRef, targetTenantIdRef,
    ephemeralChunksRef, useInlineChunksForSuggestRef, uploadedFilesRef,
    pipelineMachine, pipelineSocket,
    // computed functions
    generatePayload, processPendingFilesWithPipeline, processPendingFilesInBackground,
    updateUploadedFile, ensureWebSocketAuthenticated,
    // services
    showToast, suggestQuestionsAutoList, navigate,
  });

  const finalStatus = useMemo(() => buildFinalStatus(result), [result]);

  return (
    <CrudPageBase>
      <GenerateSystemHeader isTenantMode={isTenantMode} onReload={() => window.location.reload()} />

      <div className="space-y-6">

        <GenerateSystemFormSection
          bootstrap={bootstrap}
          setBootstrap={setBootstrap}
          generateFlow={generateFlow}
          setGenerateFlow={setGenerateFlow}
          generateRpa={generateRpa}
          setGenerateRpa={setGenerateRpa}
          generateSeed={generateSeed}
          setGenerateSeed={setGenerateSeed}
          includeQuestions={includeQuestions}
          setIncludeQuestions={setIncludeQuestions}
          inferQuestions={inferQuestions}
          setInferQuestions={setInferQuestions}
          executeFullValidation={executeFullValidation}
          setExecuteFullValidation={setExecuteFullValidation}
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          descriptionMode={descriptionMode}
          setDescriptionMode={setDescriptionMode}
          isTenantMode={isTenantMode}
          executionMode={executionMode}
          initialGraphLoading={initialGraphLoading}
          initialFlow={initialFlow}
          pipelineExecutionIdRef={pipelineExecutionIdRef}
          validatedTenantId={validatedTenantId}
          agent={agent}
          downloadJsonFile={downloadJsonFile}
          setShowInitialFlowModal={setShowInitialFlowModal}
          setExecutionMode={setExecutionMode}
          rpaMode={rpaMode}
          setRpaMode={setRpaMode}
        />

        <GenerateSystemKnowledgeFaqSection
          bootstrap={bootstrap}
          useRag={useRag}
          setUseRag={setUseRag}
          ragSources={ragSources}
          setRagSources={setRagSources}
          handleFileSelect={handleFileSelect}
          uploadedFiles={uploadedFiles}
          setSelectedFileDetails={setSelectedFileDetails}
          removeUploadedFile={removeUploadedFile}
          useWebScraping={useWebScraping}
          setUseWebScraping={setUseWebScraping}
          scrapingTargets={scrapingTargets}
          updateScrapingTarget={updateScrapingTarget}
          removeScrapingTarget={removeScrapingTarget}
          addScrapingTarget={addScrapingTarget}
          includeQuestions={includeQuestions}
          handleSuggestQuestionsFromDescription={handleSuggestQuestionsFromDescription}
          name={name}
          description={description}
          setQuestionsList={setQuestionsList}
          setFaqGroups={setFaqGroups}
          setFaqCoverage={setFaqCoverage}
          setFaqExclusions={setFaqExclusions}
          setShowFaqExclusions={setShowFaqExclusions}
          setInitialFlow={setInitialFlow}
          questionsList={questionsList}
          faqExclusions={faqExclusions}
          showFaqExclusions={showFaqExclusions}
          setShowFaqExclusionsLocal={setShowFaqExclusions}
          setError={setError}
          questionsText={questionsText}
          setQuestionsText={setQuestionsText}
          handleAddQuestionsFromText={handleAddQuestionsFromText}
          faqCoverage={faqCoverage}
          faqCoverageMeta={faqCoverageMeta}
          faqGroups={faqGroups}
          handleRemoveQuestion={handleRemoveQuestion}
        />

        <GenerateSystemPipelineResultSection
          validationStatus={validationStatus}
          isTenantMode={isTenantMode}
          executionMode={executionMode}
          useWebScraping={useWebScraping}
          needsDescriptionSuggestion={needsDescriptionSuggestion}
          includeQuestions={includeQuestions}
          bootstrap={bootstrap}
          useRag={useRag}
          pipelineMachine={pipelineMachine}
          pipelineDetails={pipelineDetails}
          pipelineStatus={pipelineStatus}
          ensureInitialFlowLoaded={ensureInitialFlowLoaded}
          initialGraphLoading={initialGraphLoading}
          initialFlow={initialFlow}
          getStepMessage={getStepMessage}
          executing={executing}
          handleExecute={handleExecute}
          isValid={isValid}
          rateLimitSecondsRemaining={rateLimitSecondsRemaining}
          clearRateLimit={clearRateLimit}
          getValidationError={getValidationError}
          result={result}
          finalStatus={finalStatus}
          navigate={navigate}
          handleViewReport={handleViewReport}
          setGeneratedFlowForModal={setGeneratedFlowForModal}
          setGeneratedFlowEditorUrl={setGeneratedFlowEditorUrl}
          setShowGeneratedFlowModal={setShowGeneratedFlowModal}
          error={error}
        />

        <ToastContainer />
      </div>

      <GenerateSystemFileDetailsDialog
        selectedFileDetails={selectedFileDetails}
        setSelectedFileDetails={setSelectedFileDetails}
        downloadRagOriginalFile={downloadRagOriginalFile}
      />

      <GenerateSystemInitialFlowDialog
        isTenantMode={isTenantMode}
        initialFlow={initialFlow}
        showInitialFlowModal={showInitialFlowModal}
        setShowInitialFlowModal={setShowInitialFlowModal}
        initialFlowModalSize={initialFlowModalSize}
        setInitialFlowModalSize={setInitialFlowModalSize}
        isInitialFlowFullscreen={isInitialFlowFullscreen}
        setIsInitialFlowFullscreen={setIsInitialFlowFullscreen}
        isInitialFlowMinimized={isInitialFlowMinimized}
        setIsInitialFlowMinimized={setIsInitialFlowMinimized}
        showInitialFlowObjectiveEditor={showInitialFlowObjectiveEditor}
        setShowInitialFlowObjectiveEditor={setShowInitialFlowObjectiveEditor}
        initialFlowObjectiveDraft={initialFlowObjectiveDraft}
        setInitialFlowObjectiveDraft={setInitialFlowObjectiveDraft}
        extractTenantFromInitialFlowId={extractTenantFromInitialFlowId}
        result={result}
        validatedTenantId={validatedTenantId}
        agent={agent}
        downloadJsonFile={downloadJsonFile}
        pipelineExecutionIdRef={pipelineExecutionIdRef}
        setInitialFlow={setInitialFlow}
        setError={setError}
      />

      <GenerateSystemGeneratedFlowDialog
        isTenantMode={isTenantMode}
        generatedFlowForModal={generatedFlowForModal}
        showGeneratedFlowModal={showGeneratedFlowModal}
        setShowGeneratedFlowModal={setShowGeneratedFlowModal}
        generatedFlowModalSize={generatedFlowModalSize}
        setGeneratedFlowModalSize={setGeneratedFlowModalSize}
        generatedFlowEditorUrl={generatedFlowEditorUrl}
        setGeneratedFlowEditorUrl={setGeneratedFlowEditorUrl}
        isGeneratedFlowFullscreen={isGeneratedFlowFullscreen}
        setIsGeneratedFlowFullscreen={setIsGeneratedFlowFullscreen}
      />

      <GenerateSystemReportModal
        showReportModal={showReportModal}
        setShowReportModal={setShowReportModal}
        reportData={reportData}
        setReportData={setReportData}
        setReportError={setReportError}
        loadingReport={loadingReport}
        reportError={reportError}
        totalSteps={totalSteps}
        replayStepByStep={replayStepByStep}
        setReplayStepByStep={setReplayStepByStep}
        currentReplayStep={currentReplayStep}
        setCurrentReplayStep={setCurrentReplayStep}
        currentStep={currentStep}
        getReplaySteps={getReplaySteps}
        goToFirst={goToFirst}
        goToPrevious={goToPrevious}
        goToNext={goToNext}
        goToLast={goToLast}
        handleReplayClick={handleReplayClick}
      />
    </CrudPageBase>
  );
}
