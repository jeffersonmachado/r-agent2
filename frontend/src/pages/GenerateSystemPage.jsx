import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input, Textarea } from '../styles/Input';
import { generateAndValidate, checkRateLimit } from '../api/system';
import { useWebSocketContext } from '../context/WebSocketContext';
import { usePipelineMachine, PipelineStage, PIPELINE_STAGE_ORDER } from '../hooks/usePipelineMachine';
import { useFileUpload } from '../context/FileUploadContext';
import { uploadDocument } from '../api/ragDocuments';
import { processFile } from '../utils/fileProcessor';
import { fetchBlob, fetchJson } from '../api/client';
import { Dialog } from '../components/Dialog';
import * as tenantsApi from '../api/tenants';
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
  buildOrchestratorBuilderContext,
  buildStandardOrchestratorConfigFromPageContext,
  buildTenantOrchestratorConfigFromPageContext,
} from './generate-system/generateSystemOrchestratorConfigBuilders';
import { useGenerateSystemFaq } from './generate-system/useGenerateSystemFaq';
import { useGenerateSystemFileUpload } from './generate-system/useGenerateSystemFileUpload';
import { useGenerateSystemPendingFileProcessing } from './generate-system/useGenerateSystemPendingFileProcessing';
import { useGenerateSystemScrapingTargets } from './generate-system/useGenerateSystemScrapingTargets';
import { useGenerateSystemReportReplay } from './generate-system/useGenerateSystemReportReplay';

/**
 * Tela Única - Centro Operacional da Plataforma
 * 
 * Esta é a única tela que gera, valida, executa e decide.
 * Nada fora dessa tela é considerado válido.
 */
export function GenerateSystemPage() {
  const { isAuthenticated, loading: authLoading, agent, updateAgent } = useAuth();
  const { navigate, currentPath } = useRouter();
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
  const lastErrorToastRef = useRef(null);
  
  // Rate Limit
  const [rateLimitUntil, setRateLimitUntil] = useState(null); // Timestamp até quando o rate limit está ativo
  const [rateLimitSecondsRemaining, setRateLimitSecondsRemaining] = useState(0);
  
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

  // Preenche o editor de "objetivo" com o melhor texto disponível (best-effort).
  // Prioridade:
  // - entidades extraídas (escopo do atendimento do fluxo)
  // - descrição do tenant criado (modo real)
  // - descrição do formulário (modo dry-run / antes de criar tenant)
  useEffect(() => {
    if (!showInitialFlowModal) return;
    const normalizeWs = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const formatList = (arr, max = 10) => {
      const items = (Array.isArray(arr) ? arr : [])
        .map((x) => normalizeWs(typeof x === 'string' ? x : (x?.name || x?.label || x?.title || '')))
        .filter(Boolean);
      const unique = Array.from(new Set(items.map((x) => x.toLowerCase()))).map((k) => items.find((x) => x.toLowerCase() === k));
      return unique.filter(Boolean).slice(0, max);
    };
    const entities = initialFlowEntities && typeof initialFlowEntities === 'object' ? initialFlowEntities : null;
    const services = formatList(entities?.services, 10);
    const plans = formatList(entities?.plans, 10);
    const prices = formatList(entities?.prices, 8);
    const schedules = formatList(entities?.schedules, 8);

    const objectiveFromEntities = (() => {
      const lines = [];
      if (services.length) lines.push(`Serviços atendidos: ${services.join(', ')}`);
      if (plans.length) lines.push(`Planos: ${plans.join(', ')}`);
      if (prices.length) lines.push(`Preços/condições: ${prices.join(', ')}`);
      if (schedules.length) lines.push(`Horários: ${schedules.join(', ')}`);
      return lines.join('\n');
    })();

    const objective =
      normalizeWs(objectiveFromEntities) ||
      normalizeWs(result?.tenant?.description) ||
      normalizeWs(description) ||
      '';
    // Não sobrescreve se o usuário já editou manualmente.
    setInitialFlowObjectiveDraft((prev) => (prev && prev.trim() ? prev : objective));
  }, [showInitialFlowModal, initialFlowEntities, result?.tenant?.description, description]);

  useEffect(() => {
    executingRef.current = executing;
  }, [executing]);

  // Toast de erro “global” desta página (deduplicado).
  // Importante: vários caminhos usam setError() sem chamar showToast().
  useEffect(() => {
    if (!error) return;
    const msg = typeof error === 'string' ? error.trim() : String(error);
    if (!msg) return;
    if (lastErrorToastRef.current === msg) return;
    lastErrorToastRef.current = msg;
    showToast?.(msg, 'error', 10000);
  }, [error, showToast]);

  // Tenant context swap via localStorage foi removido (ver applyTenantContextForEditor acima).

  // Função auxiliar para atualizar pipeline com detalhes
  const updatePipelineWithDetails = (statusUpdate, source = 'unknown') => {
    const timestamp = new Date().toISOString();
    logger.debug(`[Pipeline] Atualização recebida de ${source}`, { statusUpdate, timestamp });

    // Importante: o pipeline determinístico (etapas centrais) é atualizado SOMENTE via websocket
    // e consumido pela PipelineMachine.
    //
    // Porém, precisamos permitir que o frontend atualize *detalhes/progresso* (mensagem/percentual)
    // dessas etapas (ex.: filesInferred por arquivo, RPA em execução), sem marcar conclusão localmente.
    const machineKeys = new Set([
      'providerValidated',
      'ragValidated',
      'filesInferred',
      'webScraping',
      'descriptionSuggested',
      'payloadValid',
      'contractValid',
      'contextBuilt',
      'questionsGenerated',
      'aiExecuted',
      'flowGenerated',
      'seedGenerated',
      'rpaGenerated',
      'rpaExecuted',
      'approved',
      'failed',
    ]);
    
    // Prepara atualização de status simples (booleanos) baseado nos objetos de detalhes
    const statusUpdateSimple = {};
    const detailsUpdate = {};
    
    Object.keys(statusUpdate).forEach(key => {
      const value = statusUpdate[key];
      const isMachineKey = machineKeys.has(key);
      if (value === true) {
        // Para etapas do state machine, não marcamos como concluídas via update local.
        // (Conclusão vem do websocket/pipeline.status)
        if (!isMachineKey) {
          statusUpdateSimple[key] = true;
          detailsUpdate[key] = {
            status: 'completed',
            timestamp: timestamp,
            message: getStepMessage(key, 'completed') || `Etapa concluída: ${key}`,
            progress: 100,
          };
        }
      } else if (value === false) {
        if (!isMachineKey) {
          statusUpdateSimple[key] = false;
        }
        // IMPORTANTE:
        // Muitos produtores (callback/websocket) enviam o estado completo do pipeline com "false"
        // para etapas ainda não concluídas. Se tratarmos isso como "reset", regressamos etapas já
        // concluídas e o pipeline parece "travado". O reset real é feito explicitamente no início
        // do handleExecute via setPipelineStatus/setPipelineDetails.
        //
        // Portanto, aqui "false" atualiza apenas o booleano (status simples) e NÃO sobrescreve
        // detalhes (timestamp/mensagem/status) já existentes.
      } else if (typeof value === 'object' && value !== null) {
        // Se for um objeto com detalhes
        const { status: rawStatus, timestamp: rawTimestamp, message: rawMessage, progress: rawProgress, ...rest } = value;
        const status = rawStatus || 'pending';
        // A partir de agora, o pipeline visível é 100% alimentado por eventos do backend (WS).
        // Portanto, ignoramos updates locais para etapas do state machine (machineKeys),
        // inclusive detalhes/progresso, para garantir "um tipo só".
        if (!isMachineKey) {
          // Atualiza status simples: true apenas se completed, false caso contrário
          statusUpdateSimple[key] = status === 'completed';
          detailsUpdate[key] = {
            status: status,
            timestamp: rawTimestamp || timestamp,
            message: rawMessage || getStepMessage(key, status),
            progress: rawProgress !== undefined ? rawProgress : (status === 'completed' ? 100 : 0),
            ...rest,
          };
        }
      }
    });
    
    // Atualiza status simples
    setPipelineStatus(prev => {
      const next = { ...prev, ...statusUpdateSimple };
      // Regra: "IA executada" deve vir antes de "Aprovado"
      // (Evita UI mostrar aprovado quando o backend ainda não refletiu aiExecuted por algum motivo)
      if (next.approved === true && next.aiExecuted !== true) {
        next.approved = false;
      }
      return next;
    });
    
    // Atualiza detalhes com timestamps e mensagens (apenas para steps fora do state machine)
    setPipelineDetails(prev => {
      const updated = { ...prev };
      Object.keys(detailsUpdate).forEach(key => {
        // Se a chave não existia (ex.: etapa exibida condicionalmente),
        // ainda assim queremos persistir timestamp/mensagem para o card não ficar "sem hora".
        updated[key] = detailsUpdate[key];
        if (detailsUpdate[key].status === 'completed') {
          logger.info(`[Pipeline] Etapa ${key} concluída`, { timestamp: detailsUpdate[key].timestamp, source });
        } else if (detailsUpdate[key].status === 'error') {
          logger.error(`[Pipeline] Etapa ${key} falhou`, { timestamp: detailsUpdate[key].timestamp, source, message: detailsUpdate[key].message });
        }
      });

      return updated;
    });
  };

  const getDescriptionSuggestionMeta = (suggestionResponse) => {
    const warnings = Array.isArray(suggestionResponse?.warnings) ? suggestionResponse.warnings : [];
    const fallback = warnings.some(w => String(w?.code || '') === 'NO_INDEXED_CONTEXT_FALLBACK');
    const confidence =
      (typeof suggestionResponse?.confidence === 'number')
        ? suggestionResponse.confidence
        : (typeof suggestionResponse?.entityProfile?.confidence === 'number' ? suggestionResponse.entityProfile.confidence : null);
    const mode = suggestionResponse?.mode === 'technical' ? 'technical' : 'institutional';

    return { mode, fallback, confidence, warningsCount: warnings.length };
  };
  
  // Função auxiliar para obter mensagens de cada etapa
  // Verifica se precisa sugerir descrição
  const needsDescriptionSuggestion = useMemo(() => {
    // Mostra a etapa de sugestão sempre no modo dry-run
    return executionMode === 'dry-run';
  }, [executionMode]);

  const getStepMessage = (step, status) => {
    const messages = {
      providerValidated: {
        completed: 'Provider de IA validado',
        in_progress: 'Validando provider de IA...',
        error: 'Provider de IA não configurado',
      },
      ragValidated: {
        completed: 'Serviço RAG validado',
        in_progress: 'Validando serviço RAG...',
        error: 'Serviço RAG não disponível',
      },
      webScraping: {
        completed: 'Web scraping concluído',
        in_progress: 'Raspando URLs (web scraping)...',
        error: 'Nenhuma URL foi raspada com sucesso',
      },
      descriptionSuggested: {
        completed: 'Descrição sugerida pela IA',
        in_progress: 'Sugerindo descrição com IA...',
        error: 'Erro ao sugerir descrição',
      },
      questionsGenerated: {
        completed: 'Perguntas geradas',
        in_progress: 'Gerando perguntas...',
        error: 'Erro ao gerar perguntas',
      },
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
      ragContextBuilt: {
        completed: 'Contexto RAG construído',
        in_progress: 'Buscando evidências no RAG...',
        error: 'Evidência insuficiente no RAG',
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

  const PIPELINE_LABELS = useMemo(() => ({
    providerValidated: 'Provider de IA validado',
    ragValidated: 'Serviço RAG validado',
    webScraping: 'Web scraping',
    descriptionSuggested: 'Sugerir descrição',
    questionsGenerated: 'Perguntas geradas',
    filesInferred: 'Arquivos inferidos e indexados',
    payloadValid: 'Payload válido',
    contractValid: 'Contrato válido',
    contextBuilt: 'Contexto montado',
    ragContextBuilt: 'Contexto RAG construído',
    aiExecuted: 'Executando IA (geração do fluxo)',
    flowGenerated: 'Fluxo gerado',
    seedGenerated: 'Seed gerado',
    rpaGenerated: 'RPA gerado',
    rpaExecuted: 'RPA executado',
    approved: 'Aprovado',
  }), []);

  const ws = useWebSocketContext({
    enabled: true,
    onEvent: (event, data) => {
      if (event === 'pipeline.status') {
        logger.debug('[WebSocket] pipeline.status recebido', { event, data });
        pipelineMachine.dispatch({ type: 'PIPELINE_STATUS', payload: data });
      }
    },
    subscribeEvents: ['pipeline.status'],
  });

  // Garantia: antes de iniciar um pipeline "backend-only", precisamos que o WS esteja autenticado,
  // senão o backend vai broadcastar para 0 clientes (tenant não associado no servidor).
  const wsStateRef = useRef({ connected: false, authenticated: false });
  // Marca que a execução atual foi abortada (para suprimir efeitos colaterais de tarefas em background)
  const pipelineAbortRef = useRef(false);
  useEffect(() => {
    wsStateRef.current = { connected: !!ws?.connected, authenticated: !!ws?.authenticated };
  }, [ws?.connected, ws?.authenticated]);

  const ensureWebSocketAuthenticated = useCallback(async (timeoutMs = 5000) => {
    const start = Date.now();

    // Se já estiver autenticado, ok.
    if (wsStateRef.current.connected && wsStateRef.current.authenticated) return true;

    // Tenta reconectar (vai re-enviar auth com token atual no onopen).
    try {
      ws?.reconnect?.();
    } catch (_) {
      // best-effort
    }

    // Aguarda autenticação (polling curto).
    while (Date.now() - start < timeoutMs) {
      if (wsStateRef.current.connected && wsStateRef.current.authenticated) return true;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }, [ws]);

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
    } else {
      // Quando bootstrap não está ativo, todas as opções do BLOCO 2 devem estar marcadas
      setUseRag(true);
      setRagSources({ flows: true, qa: true, docs: true });
      setUseWebScraping(true);
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

  // Função para obter mensagem de erro de validação
  const getValidationError = useMemo(() => {
    // Nome obrigatório (tanto no modo tenant quanto normal)
    if (!name.trim() || name.trim().length < 3) {
      return 'O nome deve ter pelo menos 3 caracteres';
    }
    
    // No modo tenant, descrição é obrigatória apenas no modo execução real
    if (isTenantMode) {
      if (executionMode === 'real') {
        // No modo real, descrição é obrigatória
        if (!description || !description.trim()) {
          return 'A descrição do tenant é obrigatória no modo execução real';
        }
        if (description.trim().length < 10) {
          return `A descrição do tenant deve ter pelo menos 10 caracteres (atual: ${description.trim().length})`;
        }
      } else if (executionMode === 'dry-run' && description.trim() && description.trim().length < 10) {
        // No dry-run, se preencheu mas está muito curta, avisa
        return `A descrição do tenant deve ter pelo menos 10 caracteres (atual: ${description.trim().length})`;
      }
      // No dry-run, se estiver vazia, não é erro (será sugerida pela IA)
    } else {
      // Descrição obrigatória apenas no modo execução real (modo normal)
      if (executionMode === 'real') {
        if (!description.trim() || description.trim().length < 10) {
          return 'A descrição deve ter pelo menos 10 caracteres (obrigatória no modo execução real)';
        }
      } else if (executionMode === 'dry-run' && description.trim() && description.trim().length < 10) {
        // No dry-run, se preencheu mas está muito curta, avisa
        return 'A descrição deve ter pelo menos 10 caracteres';
      }
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
  }, [isTenantMode, name, description, bootstrap, useRag, ragSources, useWebScraping, scrapingTargets, validationStatus, executionMode]);

  // Validação completa do formulário
  const isValid = useMemo(() => {
    return getValidationError === null;
  }, [getValidationError]);

  const resetInitialFlowUiState = useCallback(() => {
    setInitialFlow(null);
    setInitialFlowEntities(null);
    setShowInitialFlowModal(false);
    setInitialFlowModalSize({ width: null, height: null });
    lastInitialFlowSignatureRef.current = null;
    setInitialGraphLoading(false);
  }, []);

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

    if (bootstrap || includeQuestions) {
      payload.includeQuestions = true;
      payload.questions = Array.isArray(questionsList) ? questionsList.slice(0, 50) : [];
    }

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
        logger.info('[RateLimit] Rate limit limpo com sucesso', response);
      } else {
        throw new Error(response.message || 'Erro ao limpar rate limit');
      }
    } catch (err) {
      logger.error('[RateLimit] Erro ao limpar rate limit', err);
      if (err.status === 403) {
        setError('Este recurso está disponível apenas em desenvolvimento');
      } else {
        setError(`Erro ao limpar rate limit: ${err.message || 'Erro desconhecido'}`);
      }
    }
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

  const orchestratorFormAndFlags = {
    name,
    description,
    descriptionMode,
    executionMode,
    generateFlow,
    generateRpa,
    generateSeed,
    bootstrap,
    useWebScraping,
    needsDescriptionSuggestion,
  };

  const orchestratorState = {
    uploadedFiles,
    scrapingTargets,
    questionsList,
    pipelineDetails,
    rateLimitUntil,
    agent,
  };

  const orchestratorActions = {
    setExecuting,
    setError,
    setResult,
    setDescription,
    setQuestionsList,
    setInitialFlow,
    setInitialFlowEntities,
    setInitialGraphLoading,
    resetInitialFlowUiState,
    setPipelineStatus,
    setPipelineDetails,
    updatePipelineWithDetails,
    setRateLimitUntil,
    setRateLimitSecondsRemaining,
  };

  const orchestratorPipelineRefs = {
    pipelineAbortRef,
    wsStateRef,
    pipelineExecutionIdRef,
    targetTenantIdRef,
    ephemeralChunksRef,
    useInlineChunksForSuggestRef,
    uploadedFilesRef,
    pipelineMachine,
    pipelineSocket,
  };

  const orchestratorSharedServices = {
    processPendingFilesPipelineStep,
    prepareExecutionQuestions,
    verifyServerHealthBeforeExecution,
    generatePayload,
    generateAndValidate,
    processPendingFilesWithPipeline,
    fetchJson,
    logger,
    showToast,
    suggestQuestionsAutoList,
  };

  const orchestratorTenantServices = {
    ensureWebSocketAuthenticated,
    validateTenantExecutionInput,
    initializeTenantExecutionState,
    ensurePipelineExecution,
    validateTenantPipelinePrereqs,
    reuseSuccessfulUploadedFilesAsEvidence,
    prepareTenantDryRunDescription,
    getValidHttpUrls,
    executeTenantPostDescriptionScraping,
    appendScrapedTextChunks,
    persistDryRunEphemeralContext,
    persistTenantTargetContentBestEffort,
    startTenantInitialFlowBestEffort,
    resetArtifactGenerationPipelineSteps,
    persistWebScrapingOnTargetTenant,
    processPendingFilesInBackground,
    navigate,
    tenantsApi,
    uploadDocument,
    updateUploadedFile,
  };

  const orchestratorStandardServices = {
    initializeStandardExecutionState,
    enforceLocalRateLimitBeforeExecution,
    verifyServerRateLimitBeforeExecution,
    handleExecutionRateLimitError,
    handleGenericExecutionFailure,
    collectUploadedFileNames,
    requestDescriptionSuggestion,
    getDescriptionSuggestionMeta,
    checkRateLimit,
    getStepMessage,
  };

  const orchestratorBuilderContext = buildOrchestratorBuilderContext({
    formAndFlags: orchestratorFormAndFlags,
    state: orchestratorState,
    actions: orchestratorActions,
    pipelineRefs: orchestratorPipelineRefs,
    sharedServices: orchestratorSharedServices,
    tenantServices: orchestratorTenantServices,
    standardServices: orchestratorStandardServices,
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
