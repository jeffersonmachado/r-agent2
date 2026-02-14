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
import { getRpaReplay, createFlow } from '../api/flows';
import { executeRpaRecording } from '../api/rpa';
import { getBasePath } from '../utils';
import { fetchQuestionGenerationRules } from '../utils/fetchQuestionGenerationRules';
import { generateQuestionsFromContent, mergeUniqueQuestions, parseQuestionsFromText, getDefaultQuestionGenerationRules } from '../utils/ragQuestionGenerator';
import { AutoInitialGraphCanvas } from '../components/AutoInitialGraphCanvas';
import { usePipelineSocket } from '../hooks/usePipelineSocket';

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

      const resp = await fetchJson('/system/generate-initial-flow', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: contextTenantId,
          executionId: execId,
          targetTenantId: tenantTargetId,
          dryRun: executionMode === 'dry-run',
          persistFlow: executionMode !== 'dry-run',
          // Cobertura: além do FAQ interno, inclui as perguntas geradas (quando existirem)
          questions: Array.isArray(questionsList) ? questionsList.slice(0, 200) : [],
          ...(executionMode === 'dry-run' && useInlineChunksForSuggestRef.current
            ? { chunks: (ephemeralChunksRef.current || []).slice(0, 30).map(c => ({ ...c, text: (c?.text || '').slice(0, 5000) })) }
            : {}),
        }),
        // Essa chamada envolve múltiplas etapas de IA; 12s abortava com frequência.
        timeoutMs: 60000,
        silent: true,
      });

      const flow = resp?.initialFlow || resp?.data?.initialFlow || null;
      const entities = resp?.entities || resp?.data?.entities || null;
      if (entities && typeof entities === 'object') setInitialFlowEntities(entities);
      if (flow && typeof flow === 'object') {
        setInitialFlow(flow);
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
  
  // Modal de Relatório
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(null);
  
  // Modo step-by-step do replay
  const [replayStepByStep, setReplayStepByStep] = useState(false);
  const [currentReplayStep, setCurrentReplayStep] = useState(0);

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

  const handleAddQuestionsFromText = () => {
    const parsed = parseQuestionsFromText(questionsText);
    if (parsed.length === 0) return;
    setQuestionsList((prev) => mergeUniqueQuestions(prev, parsed, 50));
    setQuestionsText('');
                      // Lista manual: invalida agrupamento/coverage anterior
    setFaqGroups(null);
    setFaqCoverage(null);
    setFaqCoverageMeta(null);
    setFaqExclusions(null);
    setShowFaqExclusions(false);
                      setInitialFlow(null);
  };

  const suggestQuestionsAutoList = async () => {
    const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const normalizeQuestionRules = (maybeRules) => {
      const defaults = getDefaultQuestionGenerationRules();
      if (!isPlainObject(maybeRules)) return defaults;

      // Alguns formatos externos podem vir como flags (ex.: titleBased: true).
      // Se a estrutura não for compatível, usamos defaults para evitar gerar 0 perguntas.
      if (!isPlainObject(maybeRules.titleBased)) return defaults;

      const merged = {
        titleBased: { ...defaults.titleBased, ...(isPlainObject(maybeRules.titleBased) ? maybeRules.titleBased : {}) },
        keywordPatterns: { ...defaults.keywordPatterns, ...(isPlainObject(maybeRules.keywordPatterns) ? maybeRules.keywordPatterns : {}) },
        domainCoverage: {
          ...defaults.domainCoverage,
          ...(isPlainObject(maybeRules.domainCoverage) ? maybeRules.domainCoverage : {}),
          entities: {
            ...defaults.domainCoverage.entities,
            ...(isPlainObject(maybeRules.domainCoverage?.entities) ? maybeRules.domainCoverage.entities : {}),
          },
          templates: {
            ...defaults.domainCoverage.templates,
            ...(isPlainObject(maybeRules.domainCoverage?.templates) ? maybeRules.domainCoverage.templates : {}),
          },
          triggers: {
            ...defaults.domainCoverage.triggers,
            ...(isPlainObject(maybeRules.domainCoverage?.triggers) ? maybeRules.domainCoverage.triggers : {}),
          },
        },
        contentBased: { ...defaults.contentBased, ...(isPlainObject(maybeRules.contentBased) ? maybeRules.contentBased : {}) },
        deduplication: { ...defaults.deduplication, ...(isPlainObject(maybeRules.deduplication) ? maybeRules.deduplication : {}) },
        limits: { ...defaults.limits, ...(isPlainObject(maybeRules.limits) ? maybeRules.limits : {}) },
      };

      // Garantia mínima: se por algum motivo desabilitar tudo, cai no default.
      const anyEnabled =
        merged.titleBased?.enabled ||
        merged.keywordPatterns?.enabled ||
        merged.domainCoverage?.enabled ||
        merged.contentBased?.enabled;
      return anyEnabled ? merged : defaults;
    };

    const rules = normalizeQuestionRules(questionGenerationRules);

    // 1) Preferência: usar gerador do backend (embeddings + clusterização + ranking + coverage)
    try {
      const tenantId = agent?.tenantId || null;
      if (tenantId) {
        // executionId é obrigatório nas rotas do pipeline (mesmo em ações isoladas como gerar perguntas)
        if (!pipelineExecutionIdRef.current) {
          const id = `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          pipelineExecutionIdRef.current = id;
          pipelineMachine.start(id);
          pipelineSocket.subscribe(id);
        }
        const uploadedFileNames = Array.from(new Set(
          (Array.isArray(uploadedFiles) ? uploadedFiles : [])
            .map(f => (typeof f?.name === 'string' ? f.name.trim() : ''))
            .filter(Boolean)
        ));
        const validUrls = (Array.isArray(scrapingTargets) ? scrapingTargets : [])
          .filter(url => validateUrl(url));

        const resp = await fetchJson('/system/generate-faq', {
          method: 'POST',
          body: JSON.stringify({
            name: name?.trim() || null,
            description: description?.trim() || null,
            tenantId,
            urls: validUrls.slice(0, 5),
            fileNames: uploadedFileNames.slice(0, 10),
            // Pipeline visível 100% pelo backend: sempre enviar executionId quando disponível.
            executionId: pipelineExecutionIdRef.current,
            // Indica ao backend que esta chamada representa "Perguntas geradas" (não o FAQ do tenant).
            pipelineStage: 'questionsGenerated',
            contextMode: executionMode === 'dry-run' ? 'ephemeral' : 'auto',
            ...(executionMode === 'dry-run' && useInlineChunksForSuggestRef.current
              ? { chunks: (ephemeralChunksRef.current || []).slice(0, 30).map(c => ({ ...c, text: (c?.text || '').slice(0, 5000) })) }
              : {}),
            rules,
          }),
          // Pode envolver embeddings + LLM (exclusões/categorias). 20s tende a abortar e ficar “estranho”.
          timeoutMs: 60000,
          silent: true,
        });

        const faq = Array.isArray(resp?.faq)
          ? resp.faq
          : (Array.isArray(resp?.data?.faq) ? resp.data.faq : null);
        const coverage = (typeof resp?.coverage === 'number')
          ? resp.coverage
          : (typeof resp?.data?.coverage === 'number' ? resp.data.coverage : null);
        const exclusions = Array.isArray(resp?.exclusions)
          ? resp.exclusions
          : (Array.isArray(resp?.data?.exclusions) ? resp.data.exclusions : null);
        const flat = Array.isArray(resp?.flatQuestions)
          ? resp.flatQuestions
          : (Array.isArray(resp?.data?.flatQuestions) ? resp.data.flatQuestions : null);

        if (Array.isArray(faq) && faq.length > 0) {
          setFaqGroups(faq);
          setFaqCoverage(typeof coverage === 'number' ? coverage : null);
          setFaqCoverageMeta(resp?.meta && typeof resp.meta === 'object' ? resp.meta : (resp?.data?.meta && typeof resp.data.meta === 'object' ? resp.data.meta : null));
          setFaqExclusions(Array.isArray(exclusions) && exclusions.length > 0 ? exclusions : null);
          setShowFaqExclusions(false);
          if (Array.isArray(flat) && flat.length > 0) return mergeUniqueQuestions([], flat, 50);
          // fallback: achata pelo cliente
          const flattened = faq.flatMap(g => Array.isArray(g?.questions) ? g.questions : []);
          return mergeUniqueQuestions([], flattened, 50);
        }
      }
    } catch (e) {
      // Regra arquitetural: se o backend falhou para gerar perguntas (ex.: 422 QUESTIONS_GENERATION_FAILED),
      // o pipeline deve encerrar e o frontend NÃO deve "inventar" perguntas via fallback local.
      throw e;
    }
  };

  const handleSuggestQuestionsFromDescription = async () => {
    let suggested = null;
    try {
      suggested = await suggestQuestionsAutoList();
    } catch (e) {
      const msg = e?.message || 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.';
      setError(msg);
      showToast?.(msg, 'error');
      return;
    }
    if (!suggested || suggested.length === 0) return;
    const hadExisting = Array.isArray(questionsList) && questionsList.length > 0;
    if (hadExisting) {
      // Se já havia perguntas manuais, o agrupamento calculado pode não refletir o merge.
      setFaqGroups(null);
      setFaqCoverage(null);
      setFaqCoverageMeta(null);
      setFaqExclusions(null);
      setShowFaqExclusions(false);
    }
    setQuestionsList((prev) => mergeUniqueQuestions(hadExisting ? prev : [], suggested, 50));
  };

  const handleRemoveQuestion = (index) => {
    setQuestionsList((prev) => prev.filter((_, i) => i !== index));
    setFaqGroups(null);
    setFaqCoverage(null);
    setFaqCoverageMeta(null);
    setFaqExclusions(null);
    setShowFaqExclusions(false);
                  setInitialFlow(null);
  };

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

    // Se estiver no modo tenant, primeiro cria o tenant, depois gera artefatos se solicitado
    if (isTenantMode) {
      // Validação do nome (sempre obrigatório)
      if (!name || !name.trim() || name.trim().length < 3) {
        setError('Por favor, preencha o nome do tenant (mínimo 3 caracteres)');
        return;
      }
      // Validação da descrição (obrigatória apenas no modo real)
      if (executionMode === 'real') {
        if (!description || !description.trim() || description.trim().length < 10) {
          setError('Por favor, preencha a descrição do tenant (mínimo 10 caracteres) - obrigatória no modo execução real');
          return;
        }
      } else if (description.trim() && description.trim().length < 10) {
        // No dry-run, se preencheu mas está muito curta, avisa
        setError('A descrição do tenant deve ter pelo menos 10 caracteres');
        return;
      }
      // No dry-run, se descrição estiver vazia, será sugerida pela IA

      setExecuting(true);
      setError(null);
      setResult(null);
      pipelineAbortRef.current = false;
      // Reset do fluxo inicial e modal para permitir reabrir a cada execução
      setInitialFlow(null);
      setInitialFlowEntities(null);
      setShowInitialFlowModal(false);
      setInitialFlowModalSize({ width: null, height: null });
      lastInitialFlowSignatureRef.current = null;
      setInitialGraphLoading(false);
      
      // Reseta pipeline status
      const resetStatus = {
        providerValidated: false,
        ragValidated: false,
        webScraping: false,
        descriptionSuggested: false,
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
        providerValidated: { status: 'pending', timestamp: null, message: null, progress: 0 },
        ragValidated: { status: 'pending', timestamp: null, message: null, progress: 0 },
        webScraping: { status: 'pending', timestamp: null, message: null, progress: 0 },
        descriptionSuggested: { status: 'pending', timestamp: null, message: null, progress: 0, meta: null },
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

      // tenantId do contexto (header X-Tenant-Id / tenant do agente) para chamadas do pipeline.
      // No tenant-mode (super-admin), este NÃO é o tenant de persistência do novo tenant.
      let validatedTenantId = null;
      // Guard para evitar rodar scraping duas vezes no mesmo fluxo
      let webScrapingDone = false;

      // executionId único por execução do pipeline (real e dry-run), reutilizado em todas as chamadas.
      // Importante: deve ser estável para correlacionar eventos `pipeline.status`.
      const pipelineExecutionId = `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      pipelineExecutionIdRef.current = pipelineExecutionId;
      pipelineMachine.start(pipelineExecutionId);
      pipelineSocket.subscribe(pipelineExecutionId);

      try {
        // Pipeline visível 100% pelo backend: garantir WS autenticado antes do backend emitir eventos.
        const wsOk = await ensureWebSocketAuthenticated(6000);
        if (!wsOk) {
          logger.warn('[WebSocket] WS não autenticou a tempo; o pipeline visível pode não atualizar', {
            executionId: pipelineExecutionId,
            connected: wsStateRef.current.connected,
            authenticated: wsStateRef.current.authenticated,
          });
        }

        // Pré-requisitos do pipeline (backend-only): provider + rag (gating).
        const tenantId = agent?.tenantId;
        if (!tenantId) {
          setError('Tenant não identificado. Faça login novamente e tente novamente.');
          setExecuting(false);
          return;
        }
        validatedTenantId = tenantId; // tenant de contexto (ex.: system)
        targetTenantIdRef.current = null; // sempre reseta no início da execução
        await fetchJson('/system/pipeline/validate-prereqs', {
          method: 'POST',
          body: JSON.stringify({ executionId: pipelineExecutionId, useRag: true }),
          timeoutMs: 15000,
        });
      } catch (prereqErr) {
        const msg = prereqErr?.body?.message || prereqErr?.message || 'Falha ao validar pré-requisitos do pipeline';
        logger.error('[TenantMode] Falha ao validar pré-requisitos do pipeline', { error: prereqErr, message: msg });
        setError(msg);
        showToast?.(msg, 'error');
        setExecuting(false);
        return;
      }
      // Observação: a sugestão de descrição (dry-run) acontece no fluxo principal abaixo.
      // Mantemos apenas UM pipeline de (arquivos -> scraping -> sugestão) para evitar duplicidade.

      try {
        // Se está em dry-run, mostra a etapa de sugestão (mesmo que descrição já esteja preenchida)
        let finalDescription = description.trim();
        useInlineChunksForSuggestRef.current = false;
        ephemeralChunksRef.current = [];
        const dryRunExecutionId = (executionMode === 'dry-run') ? pipelineExecutionId : null;
        const ephemeralChunks = ephemeralChunksRef.current;
        
        // ETAPA 0 (tenant): sempre processa arquivos pendentes ANTES de web scraping / sugestão.
        // Também marca o step como concluído quando não houver arquivos pendentes,
        // para o pipeline visual não ficar "pendente" indefinidamente.
        const pendingFiles = uploadedFiles.filter(f => f.status === 'pending');
        if (pendingFiles.length > 0) {
          // Reset de rastreamento de erros de inferência (para refletir warning no step)
          fileCategoryInferenceIssuesRef.current = { count: 0, last: null };

          logger.info('[TenantMode] Processando arquivos pendentes antes de continuar pipeline', {
            pendingFilesCount: pendingFiles.length,
            files: pendingFiles.map(f => ({ id: f.id, name: f.name })),
          });
          
          updatePipelineWithDetails({
            filesInferred: { status: 'in_progress', progress: 0, message: `Processando ${pendingFiles.length} arquivo(s) antes de continuar...` }
          }, 'file-processing');
          
          // Importante: evitar tempestade de chamadas para IA (429) — processamos em série.
          // Isso melhora a previsibilidade e reduz risco de quota/rate-limit, especialmente quando
          // inferFileCategoryWithAI chama /api/ai/generate.
          let processedCount = 0;
          for (const fileObj of pendingFiles) {
            try {
              setPipelineDetails(prev => ({
                ...prev,
                filesInferred: {
                  status: 'in_progress',
                  timestamp: prev.filesInferred.timestamp || new Date().toISOString(),
                  message: `Processando: ${fileObj.name}`,
                  progress: prev.filesInferred.progress || 0,
                },
              }));

              const inferredCategory = await inferFileCategoryWithAI(fileObj.file);
              updateUploadedFile(fileObj.id, { category: inferredCategory });

              const uploadRes = await handleFileUpload({ ...fileObj, category: inferredCategory });
              // No tenant-mode, antes do tenant alvo existir, coletamos evidências localmente (sem persistência no RAG).
              const shouldCollectEvidence = executionMode === 'dry-run' || (executionMode !== 'dry-run' && isTenantMode);
              if (shouldCollectEvidence && uploadRes && uploadRes.ok && uploadRes.text) {
                ephemeralChunks.push({
                  sourceType: uploadRes.sourceType || 'uploaded_file',
                  sourceId: uploadRes.sourceId || fileObj.name,
                  text: uploadRes.text,
                });
              }
            } catch (error) {
              logger.error(`[TenantMode] Erro ao processar arquivo ${fileObj.name}`, {
                error: error.message,
                stack: error.stack,
                fileId: fileObj.id,
              });
              updateUploadedFile(fileObj.id, { status: FileStatus.error, error: error.message || 'Erro ao processar arquivo', progress: 0 });
            } finally {
              processedCount += 1;
              const progress = Math.round((processedCount / pendingFiles.length) * 100);
              setPipelineDetails(prev => ({
                ...prev,
                filesInferred: {
                  status: 'in_progress',
                  timestamp: prev.filesInferred.timestamp || new Date().toISOString(),
                  message: `Processados ${processedCount}/${pendingFiles.length} arquivo(s) (último: ${fileObj.name})`,
                  progress,
                },
              }));
            }
          }
          
          const issuesCount = Number(fileCategoryInferenceIssuesRef.current?.count) || 0;
          const lastIssue = fileCategoryInferenceIssuesRef.current?.last || null;
          const baseMessage = executionMode === 'dry-run'
            ? `${pendingFiles.length} arquivo(s) processado(s) (dry-run: não indexado(s) no RAG)`
            : (isTenantMode
                ? `${pendingFiles.length} arquivo(s) processado(s) (pré-criação: persistência/indexação no tenant alvo ocorre após criar o tenant)`
                : `${pendingFiles.length} arquivo(s) processado(s) e indexado(s) no RAG`);
          const warningMessage = issuesCount > 0
            ? `${baseMessage}. Categoria de ${issuesCount} arquivo(s) inferida via fallback (IA indisponível: ${lastIssue?.code || lastIssue?.httpStatus || 'erro'}).`
            : baseMessage;

          updatePipelineWithDetails({
            filesInferred: {
              status: issuesCount > 0 ? 'warning' : 'completed',
              progress: 100,
              message: warningMessage,
              timestamp: new Date().toISOString(),
              ...(issuesCount > 0 ? { warning: { issuesCount, lastIssue } } : {}),
            }
          }, 'file-processing');

          // Aguarda indexação completar
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          updatePipelineWithDetails({
            filesInferred: {
              status: 'completed',
              progress: 100,
              message: 'Nenhum arquivo pendente para inferir/indexar',
              timestamp: new Date().toISOString(),
            }
          }, 'file-processing');

        }
        
        if (executionMode === 'dry-run') {
          // Importante: em dry-run, se os arquivos já estavam com status "success" (execução anterior),
          // não haverá "pendingFiles" para reprocessar e, portanto, `ephemeralChunks` ficaria vazio.
          // Isso causaria fallback no /system/suggest-description (NO_INDEXED_CONTEXT_FALLBACK/LOW_CONFIDENCE).
          // Reaproveitamos o `extractedContent` já salvo no state como evidência local.
          try {
            const seen = new Set(ephemeralChunks.map(c => `${c?.sourceType || 'unknown'}|${c?.sourceId || ''}`));
            const existingFileChunks = (Array.isArray(uploadedFiles) ? uploadedFiles : [])
              .filter(f => f && f.status === 'success')
              .map(f => ({
                sourceType: 'uploaded_file',
                sourceId: (typeof f?.name === 'string' && f.name.trim()) ? f.name.trim() : (f?.id || 'arquivo'),
                text: (typeof f?.extractedContent === 'string' ? f.extractedContent : '').trim(),
              }))
              .filter(c => c.text && c.text.length >= 20)
              .slice(0, 30);

            for (const c of existingFileChunks) {
              const k = `${c.sourceType}|${c.sourceId}`;
              if (seen.has(k)) continue;
              seen.add(k);
              ephemeralChunks.push({ ...c, text: c.text.slice(0, 5000) });
            }
          } catch {
            // ignora (apenas melhoria de qualidade; não pode quebrar a execução)
          }

          // Se descrição está vazia, executa a sugestão
          if (!description.trim()) {
          try {
            // Arquivos já foram processados na ETAPA 0 acima.
            
            // ETAPA 1: Processa web scraping ANTES de sugerir descrição (se houver URLs)
            const validUrls = scrapingTargets.filter(url => url && url.trim() && url.trim().startsWith('http'));
            
            if (useWebScraping && validUrls.length > 0) {
              webScrapingDone = true;
              updatePipelineWithDetails({ 
                webScraping: {
                  status: 'in_progress',
                  progress: 0,
                  message: `Processando web scraping (dry-run) de ${validUrls.length} URL(s)...`,
                  urlsTotal: validUrls.length,
                }
              }, 'webScrapingStarted');

              try {
                const scrapingStartedAt = Date.now();
                const scrapingResponse = await fetchJson('/web-scraping/scrape-batch', {
                  method: 'POST',
                  headers: validatedTenantId ? { 'X-Tenant-Id': validatedTenantId } : undefined,
                  body: JSON.stringify({
                    urls: validUrls,
                    executionId: pipelineExecutionId,
                    dryRun: true,
                    autoIndex: false,
                    source: 'web_scraping',
                    category: 'general',
                  }),
                  // Playwright/web scraping pode ser lento em alguns sites; em dry-run queremos resiliente.
                  timeoutMs: 60000,
                });
                const durationMs = Date.now() - scrapingStartedAt;

                const results = Array.isArray(scrapingResponse?.results) ? scrapingResponse.results : [];
                const successCount = Number.isFinite(scrapingResponse?.success)
                  ? Number(scrapingResponse.success)
                  : results.filter(r => r && r.success).length;
                const failedCount = Number.isFinite(scrapingResponse?.failed)
                  ? Number(scrapingResponse.failed)
                  : (validUrls.length - successCount);

                // Captura texto extraído para contexto efêmero
                for (const r of results) {
                  const url = r?.url;
                  const text = (r?.extractedText || '').trim();
                  if (url && text && text.length >= 20) {
                    ephemeralChunks.push({ sourceType: 'web_scraping', sourceId: url, text });
                  }
                }

                // Gate: em dry-run, só aborta se não houver qualquer outra evidência local (ex.: arquivos/OCR).
                if (successCount === 0) {
                  const hasOtherEvidence = Array.isArray(ephemeralChunks) && ephemeralChunks.some(c => c && typeof c.text === 'string' && c.text.trim().length >= 20);
                  if (hasOtherEvidence) {
                    updatePipelineWithDetails({
                      webScraping: {
                        status: 'warning',
                        progress: 100,
                        message: 'Nenhuma URL foi raspada com sucesso. Continuando com evidências dos arquivos (dry-run).',
                        timestamp: new Date().toISOString(),
                        urlsTotal: validUrls.length,
                        successCount,
                        failedCount,
                        durationMs,
                      }
                    }, 'webScrapingCompleted');
                    // segue o pipeline sem abortar
                  } else {
                    setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
                  updatePipelineWithDetails({
                    webScraping: {
                      status: 'error',
                      progress: 0,
                      message: 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.',
                      timestamp: new Date().toISOString(),
                      urlsTotal: validUrls.length,
                      successCount,
                      failedCount,
                      durationMs,
                    }
                  }, 'webScrapingCompleted');
                  setExecuting(false);
                  return;
                  }
                }

                updatePipelineWithDetails({
                  webScraping: {
                    status: 'completed',
                    progress: 100,
                    message: `Web scraping (dry-run) concluído: ${successCount}/${validUrls.length} URL(s) processada(s)`,
                    timestamp: new Date().toISOString(),
                    urlsTotal: validUrls.length,
                    successCount,
                    failedCount,
                    durationMs,
                  }
                }, 'webScrapingCompleted');
              } catch (scrapingError) {
                logger.warn('[TenantMode] Web scraping dry-run falhou', scrapingError);
                const hasOtherEvidence = Array.isArray(ephemeralChunks) && ephemeralChunks.some(c => c && typeof c.text === 'string' && c.text.trim().length >= 20);
                if (hasOtherEvidence) {
                  updatePipelineWithDetails({
                    webScraping: {
                      status: 'warning',
                      progress: 100,
                      message: 'Web scraping falhou. Continuando com evidências dos arquivos (dry-run).',
                      timestamp: new Date().toISOString(),
                      urlsTotal: validUrls.length,
                      successCount: 0,
                      failedCount: validUrls.length,
                      error: scrapingError?.message || 'erro',
                    }
                  }, 'webScrapingCompleted');
                  // segue o pipeline sem abortar
                } else {
                  updatePipelineWithDetails({
                    webScraping: {
                      status: 'error',
                      progress: 0,
                      message: 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.',
                      timestamp: new Date().toISOString(),
                      urlsTotal: validUrls.length,
                      successCount: 0,
                      failedCount: validUrls.length,
                      error: scrapingError?.message || 'erro',
                    }
                  }, 'webScrapingCompleted');
                  setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
                  setExecuting(false);
                  return;
                }
              }
            } else if (useWebScraping && validUrls.length > 0 && executionMode !== 'dry-run') {
              webScrapingDone = true;
              updatePipelineWithDetails({ 
                webScraping: {
                  status: 'in_progress',
                  progress: 0,
                  message: `Processando web scraping de ${validUrls.length} URL(s)...`,
                  urlsTotal: validUrls.length,
                }
              }, 'webScrapingStarted');
              
              logger.info('[TenantMode] Processando web scraping antes de sugerir descrição', { 
                urlsCount: validUrls.length,
                urls: validUrls 
              });
              
              try {
                const scrapingStartedAt = Date.now();
                // Processa web scraping em batch
                const scrapingResponse = await fetchJson('/web-scraping/scrape-batch', {
                  method: 'POST',
                  headers: validatedTenantId ? { 'X-Tenant-Id': validatedTenantId } : undefined,
                  body: JSON.stringify({
                    urls: validUrls,
                    executionId: pipelineExecutionId,
                    autoIndex: true, // Indexa automaticamente no RAG
                    source: 'web_scraping',
                    category: 'general',
                  }),
                  // Playwright/web scraping pode ser lento em alguns sites; evita timeout do client
                  timeoutMs: 60000,
                });
                const durationMs = Date.now() - scrapingStartedAt;
                
                if (scrapingResponse && Array.isArray(scrapingResponse.results)) {
                  const successCount = Number.isFinite(scrapingResponse?.success)
                    ? Number(scrapingResponse.success)
                    : scrapingResponse.results.filter(r => r.success).length;
                  const failedCount = Number.isFinite(scrapingResponse?.failed)
                    ? Number(scrapingResponse.failed)
                    : (validUrls.length - successCount);
                  const duplicateCount = Number.isFinite(scrapingResponse?.duplicates)
                    ? Number(scrapingResponse.duplicates)
                    : scrapingResponse.results.filter(r => r.success && r.isDuplicate).length;
                  const newCount = Number.isFinite(scrapingResponse?.new)
                    ? Number(scrapingResponse.new)
                    : (successCount - duplicateCount);

                  const errorSummary = Array.isArray(scrapingResponse?.errorSummary)
                    ? scrapingResponse.errorSummary
                    : scrapingResponse.results
                        .filter(r => !r.success)
                        .map(r => ({
                          url: r.url,
                          name: r.error?.name || 'Error',
                          message: r.error?.message || (typeof r.error === 'string' ? r.error : 'Erro desconhecido'),
                        }));
                  
                  logger.info('[Pipeline][webScraping] Web scraping concluído', {
                    urlsTotal: validUrls.length,
                    successCount,
                    failedCount,
                    durationMs,
                    errorSummary,
                  });

                  // Avisos do scraping não geram toast local — o backend é a fonte do feedback via WS.

                  // Gate: não continua se nenhuma URL foi raspada com sucesso
                  if (successCount === 0) {
                    setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
                    console.error('[TenantMode][webScraping] Nenhuma URL raspada com sucesso. Resumo de erros:', errorSummary);

                    updatePipelineWithDetails({
                      webScraping: {
                        status: 'error',
                        progress: 0,
                        message: 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.',
                        timestamp: new Date().toISOString(),
                        urlsTotal: validUrls.length,
                        successCount,
                        failedCount,
                        durationMs,
                        errorSummary,
                      }
                    }, 'webScrapingCompleted');

                    setExecuting(false);
                    return;
                  }
                  
                  let message = `Web scraping concluído: ${successCount}/${validUrls.length} URL(s) processada(s)`;
                  if (duplicateCount > 0) {
                    message += ` (${newCount} nova(s), ${duplicateCount} duplicada(s) - usando existente)`;
                  } else {
                    message += ` e indexada(s)`;
                  }
                  
                  updatePipelineWithDetails({ 
                    webScraping: { 
                      status: 'completed', 
                      progress: 100, 
                      message: message,
                      timestamp: new Date().toISOString(),
                      urlsTotal: validUrls.length,
                      successCount,
                      failedCount,
                      durationMs,
                      errorSummary,
                    }
                  }, 'webScrapingCompleted');
                  
                  // Aguarda um pouco para garantir que o conteúdo foi indexado
                  // Aumenta o tempo de espera para garantir que a indexação foi concluída
                  logger.info('[Pipeline] Aguardando indexação completar...', { 
                    waitTime: 2000 
                  });
                  await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                  logger.warn('[TenantMode] Resposta de web scraping inválida', scrapingResponse);
                }
              } catch (scrapingError) {
                logger.error('[TenantMode] Erro ao processar web scraping', scrapingError);
                updatePipelineWithDetails({ 
                  webScraping: { 
                    status: 'error', 
                    progress: 0, 
                    message: 'Erro ao processar web scraping. Verifique os logs do scraping.',
                    timestamp: new Date().toISOString()
                  }
                }, 'webScrapingCompleted');

                setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
                setExecuting(false);
                return;
              }
            }
            
            // ETAPA 2: Sugere descrição usando conteúdo indexado (arquivos + web scraping)
            updatePipelineWithDetails({ 
              descriptionSuggested: { status: 'in_progress', progress: 0, message: 'Sugerindo descrição do tenant com IA usando conteúdo indexado...' }
            }, 'description-suggestion');

            // Dry-run: envia evidências para Redis+TTL e pede sugestão baseada no contexto efêmero.
            // Importante: se o backend cair em fallback "memory" (sem Redis pronto),
            // o contexto pode NÃO estar disponível na próxima requisição (restart/nodemon/múltiplas instâncias).
            // Nesses casos, enviamos chunks inline para garantir que a sugestão tenha evidências.
            let useInlineChunksForSuggest = false;
            if (executionMode === 'dry-run' && dryRunExecutionId) {
              try {
                if (!ephemeralChunks || ephemeralChunks.length === 0) {
                  logger.warn('[TenantMode] Nenhum chunk efêmero para persistir (dry-run). Isso pode causar fallback no suggest-description.', {
                    tenantId: validatedTenantId,
                    executionId: dryRunExecutionId,
                  });
                } else {
                  logger.info('[TenantMode] Persistindo contexto efêmero (dry-run) no backend...', {
                    tenantId: validatedTenantId,
                    executionId: dryRunExecutionId,
                    chunksToSend: ephemeralChunks.length,
                  });
                }

                const ephRes = await fetchJson('/rag/ephemeral/context', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tenantId: validatedTenantId,
                    executionId: dryRunExecutionId,
                    chunks: ephemeralChunks,
                    replace: true,
                  }),
                  timeoutMs: 15000,
                });

                logger.info('[TenantMode] Contexto efêmero persistido (dry-run)', {
                  tenantId: validatedTenantId,
                  executionId: dryRunExecutionId,
                  stored: ephRes?.stored ?? null,
                  used: ephRes?.used ?? null,
                  key: ephRes?.key ?? null,
                  stats: ephRes?.stats ?? null,
                });

                // Se NÃO foi persistido em Redis, não confiamos no "memory" para a próxima chamada.
                // Preferimos enviar inline para evitar NO_INDEXED_CONTEXT_FALLBACK/LOW_CONFIDENCE por falta de evidências.
                if (ephRes?.used && String(ephRes.used) !== 'redis') {
                  useInlineChunksForSuggest = true;
                  useInlineChunksForSuggestRef.current = true;
                  logger.warn('[TenantMode] Contexto efêmero não persistido em Redis. Enviando chunks inline para sugestão.', {
                    tenantId: validatedTenantId,
                    executionId: dryRunExecutionId,
                    used: ephRes?.used,
                  });
                }
              } catch (e) {
                // Importante: se Redis falhar e continuarmos enviando contextMode=ephemeral,
                // o backend NÃO terá contexto e cairá em fallback. Então mandamos os chunks inline.
                useInlineChunksForSuggest = true;
                useInlineChunksForSuggestRef.current = true;
                logger.warn('[TenantMode] Falha ao persistir contexto efêmero (Redis). Enviando chunks inline para sugestão.', e);
              }
            }
            
            // O backend gera a descrição (institucional ou técnica) via RAG + consolidação.
            
            // Chama API para sugerir descrição do tenant
            const uploadedFileNames = Array.from(new Set(
              uploadedFiles
                .map(f => (typeof f?.name === 'string' ? f.name.trim() : ''))
                .filter(Boolean)
            ));

            const suggestionResponse = await fetchJson('/system/suggest-description', {
              method: 'POST',
              body: JSON.stringify({ 
                name: name.trim(),
                tenantId: validatedTenantId,
                urls: validUrls, // Envia URLs para referência
                fileNames: uploadedFileNames, // Ajuda o backend a montar query do RAG incluindo docs enviados
                mode: descriptionMode,
                dryRun: executionMode === 'dry-run',
                // Sempre envia executionId para permitir correlacionar falhas via websocket.
                executionId: pipelineExecutionId,
                ...(executionMode === 'dry-run'
                  ? (useInlineChunksForSuggest
                      ? { chunks: ephemeralChunks.slice(0, 30).map(c => ({ ...c, text: (c?.text || '').slice(0, 5000) })) }
                      : { contextMode: 'ephemeral' })
                  : {}),
              }),
              timeoutMs: 60000,
            });

            // Avisos/entidades não geram toast local — o backend é a fonte do feedback via WS.

            const confidence = (typeof suggestionResponse?.confidence === 'number')
              ? suggestionResponse.confidence
              : (typeof suggestionResponse?.entityProfile?.confidence === 'number' ? suggestionResponse.entityProfile.confidence : null);
            // Baixa confiança não gera toast local — feedback vem do backend via WS.
            
            if (suggestionResponse?.suggestion) {
              finalDescription = suggestionResponse.suggestion.trim();
              setDescription(finalDescription);

              // Se o backend retornou fluxo inicial, renderiza imediatamente no canvas (editor existente)
              if (suggestionResponse?.initialFlow && typeof suggestionResponse.initialFlow === 'object') {
                setInitialFlow(suggestionResponse.initialFlow);
              }

              const meta = getDescriptionSuggestionMeta(suggestionResponse);
              
              logger.info('[TenantMode] Descrição sugerida e aplicada', { 
                suggestedLength: finalDescription.length 
              });
            } else {
              // Se não conseguir sugerir, para o processamento
              const errorMsg = 'A IA não retornou uma descrição sugerida. Não é possível continuar sem descrição.';
              logger.error('[TenantMode] Descrição não sugerida', { suggestionResponse });
              
              setError(errorMsg);
              setExecuting(false);
              return;
            }
          } catch (suggestionError) {
            logger.error('[TenantMode] Erro ao sugerir descrição', suggestionError);
            const msg = suggestionError?.body?.message || suggestionError?.message || 'Erro ao sugerir descrição. Não é possível continuar sem descrição.';
            updatePipelineWithDetails({
              descriptionSuggested: { status: 'error', progress: 0, message: msg, timestamp: new Date().toISOString() }
            }, 'description-suggestion-error');
            setError(msg);

            // Em tenant mode, sem descrição não pode continuar
            setExecuting(false);
            return;
          }
          } else {
            // Descrição já preenchida, marca como concluída (não precisa sugerir)
            // (Pipeline visível é alimentado apenas por WS/backend)
          }
        } else {
          finalDescription = description.trim();
        }

        // Web scraping (tenant): roda mesmo quando descrição já foi fornecida (gate obrigatório)
        const validUrlsForScraping = scrapingTargets.filter(url => url && url.trim() && url.trim().startsWith('http'));
        if (useWebScraping && validUrlsForScraping.length > 0 && !webScrapingDone) {
          webScrapingDone = true;
          if (executionMode !== 'dry-run') {
          const scrapingStartedAt = Date.now();
          try {
            // No modo tenant (super-admin), antes do tenant alvo existir, NÃO persistimos no RAG.
            // Apenas extraímos conteúdo para uso como evidência (descrição/FAQ/fluxo inicial).
            const shouldPersistScraping = !isTenantMode;
            const scrapingResponse = await fetchJson('/web-scraping/scrape-batch', {
              method: 'POST',
              headers: validatedTenantId ? { 'X-Tenant-Id': validatedTenantId } : undefined,
              body: JSON.stringify({
                urls: validUrlsForScraping,
                autoIndex: shouldPersistScraping,
                source: 'web_scraping',
                category: 'general',
                executionId: pipelineExecutionIdRef.current || null,
                dryRun: !shouldPersistScraping,
              }),
              // Playwright/web scraping pode ser lento em alguns sites; evita timeout do client
              timeoutMs: 60000,
            });
            const durationMs = Date.now() - scrapingStartedAt;

            const results = Array.isArray(scrapingResponse?.results) ? scrapingResponse.results : [];
            const successCount = Number.isFinite(scrapingResponse?.success)
              ? Number(scrapingResponse.success)
              : results.filter(r => r.success).length;
            const failedCount = Number.isFinite(scrapingResponse?.failed)
              ? Number(scrapingResponse.failed)
              : (validUrlsForScraping.length - successCount);
            const errorSummary = Array.isArray(scrapingResponse?.errorSummary)
              ? scrapingResponse.errorSummary
              : results
                  .filter(r => !r.success)
                  .map(r => ({
                    url: r.url,
                    name: r.error?.name || 'Error',
                    message: r.error?.message || (typeof r.error === 'string' ? r.error : 'Erro desconhecido'),
                  }));

            logger.info('[Pipeline][webScraping] Web scraping concluído', {
              urlsTotal: validUrlsForScraping.length,
              successCount,
              failedCount,
              durationMs,
              errorSummary,
            });

            if (successCount === 0) {
              setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
              console.error('[TenantMode][webScraping] Nenhuma URL raspada com sucesso. Resumo de erros:', errorSummary);

              setExecuting(false);
              return;
            }

            // Captura texto extraído para contexto efêmero (tenant-mode, pré-criação)
            try {
              if (isTenantMode && !shouldPersistScraping) {
                const resultsForChunks = Array.isArray(results) ? results : [];
                for (const r of resultsForChunks) {
                  const url = r?.url;
                  const text = (r?.extractedText || '').trim();
                  if (url && text && text.length >= 20) {
                    ephemeralChunksRef.current.push({ sourceType: 'web_scraping', sourceId: url, text });
                  }
                }
              }
            } catch (_) {
              // noop
            }

            // Aguarda indexação completar
            if (shouldPersistScraping) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } catch (scrapingError) {
            const durationMs = Date.now() - scrapingStartedAt;
            logger.error('[TenantMode] Erro ao processar web scraping', scrapingError);

            setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
            console.error('[TenantMode][webScraping] Falha no scraping (request crash). URLs:', validUrlsForScraping, scrapingError);

            setExecuting(false);
            return;
          }
          }
        }
        
        // Gera tenant por IA usando a descrição (sugerida ou fornecida)
        updatePipelineWithDetails({ 
          aiExecuted: { status: 'in_progress', progress: 0, message: 'Executando IA para gerar tenant...' }
        }, 'tenant-generation');
        
        const firstUrl = (Array.isArray(scrapingTargets) ? scrapingTargets : []).find(u => typeof u === 'string' && u.trim().startsWith('http')) || '';
        const siteHint = firstUrl ? `Site: ${firstUrl.trim()}\n\n` : '';
        const descriptionForTenantAi = name.trim()
          ? `Nome: ${name.trim()}\n\n${siteHint}${finalDescription}`
          : `${siteHint}${finalDescription}`;

        // Em modo real, pedimos criação em safe-mode (draft para aprovação / pending_review).
        const generateResult = await tenantsApi.generateTenantByAI(descriptionForTenantAi, {
          create: executionMode === 'real',
          executionId: pipelineExecutionIdRef.current,
        });
        
        if (generateResult.tenant) {
          // Marca IA como concluída com sucesso
          updatePipelineWithDetails({ 
            aiExecuted: { 
              status: 'completed', 
              progress: 100, 
              message: 'IA executada com sucesso',
              timestamp: new Date().toISOString()
            }
          }, 'tenant-generation');
          let createdTenant;
          
          // Em modo dry-run, não cria o tenant de fato, apenas simula
          logger.info('[TenantMode] Verificando modo de execução antes de criar tenant', { 
            executionMode, 
            isDryRun: executionMode === 'dry-run',
            tenantData: { name: generateResult?.tenant?.name, site: generateResult?.tenant?.site }
          });
          
          if (executionMode === 'dry-run') {
            logger.info('[TenantMode] Modo dry-run: simulando criação do tenant (não será persistido)');
            // Simula criação do tenant sem persistir
            createdTenant = {
              tenant: {
                ...(generateResult.tenant || {}),
                // Permite sobrescrever o nome informado no formulário para o cenário de simulação
                name: name.trim() || generateResult?.tenant?.name,
                id: `tenant-dry-run-${Date.now()}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              dryRun: true,
            };
            updatePipelineWithDetails({ 
              payloadValid: true,
              dryRun: true,
              message: 'Tenant simulado (modo dry-run - não foi persistido)'
            }, 'tenant-creation');
          } else {
            // Modo real: tenant já é criado pelo endpoint /tenants/generate-by-ai com create=true (safe-mode)
            const tenantFromServer = generateResult?.createdTenant || generateResult?.existingTenant || null;
            if (!tenantFromServer) {
              throw new Error('Tenant não foi criado/reutilizado no modo seguro (createdTenant/existingTenant ausente).');
            }
            if (tenantFromServer.status !== 'pending_review') {
              throw new Error('Tenant existente para este site não está em modo draft (pending_review). Não é seguro continuar.');
            }
            createdTenant = { tenant: tenantFromServer, dryRun: false };
            logger.info(
              generateResult?.existingTenant ? '[TenantMode] Tenant existente reaproveitado (site duplicado)' : '[TenantMode] Tenant criado em modo seguro (pending_review)',
              { tenantId: createdTenant?.tenant?.id }
            );
            updatePipelineWithDetails({
              payloadValid: true,
              message: generateResult?.existingTenant
                ? 'Tenant existente reaproveitado (site já cadastrado)'
                : 'Tenant criado em modo seguro (pendente de aprovação)',
            }, 'tenant-creation');
          }

          // -------------------------------------------------------------------
          // Tenant-mode (real): após criar/reutilizar o tenant alvo, persistimos RAG nele.
          // Importante:
          // - Mantemos o tenant de contexto (validatedTenantId / system) para o pipeline/WS
          // - Persistimos no tenant alvo via persistTenantId
          // -------------------------------------------------------------------
          if (executionMode !== 'dry-run') {
            const contextTenantId = validatedTenantId || agent?.tenantId || null;
            const tenantTargetId = createdTenant?.tenant?.id || null;
            if (contextTenantId && tenantTargetId) {
              targetTenantIdRef.current = tenantTargetId;
              try {
                // 1) Persistir uploads (se houver)
                const filesSnapshot = Array.isArray(uploadedFilesRef.current) ? uploadedFilesRef.current : [];
                const filesToPersist = filesSnapshot
                  .filter(f => f && f.status === 'success')
                  .filter(f => !f.documentId); // ainda não persistido

                for (const f of filesToPersist) {
                  try {
                    const res = await uploadDocument(f.file, {
                      executionId: pipelineExecutionIdRef.current,
                      tenantId: contextTenantId, // contexto/WS
                      persistTenantId: tenantTargetId, // persistência no tenant alvo
                      headers: { 'X-Tenant-Id': contextTenantId },
                      category: f.category,
                      tags: [f.category, 'generate-system'],
                      metadata: {
                        uploadedFrom: 'generate-system',
                        originalFileName: f.name,
                        fileName: f.name,
                        fileSize: f.size,
                        extractedContent: (typeof f.extractedContent === 'string' ? f.extractedContent : null),
                        deferredPersist: true,
                        deferredPersistReason: f.deferredPersistReason || 'tenant_mode_pre_creation',
                      },
                      autoIndex: true,
                    });

                    updateUploadedFile(f.id, {
                      documentId: res?.document?.id || res?.id || null,
                      isDuplicate: !!(res?.isDuplicate),
                      deferredPersist: false,
                      persistedTenantId: tenantTargetId,
                    });
                  } catch (e) {
                    logger.warn('[TenantMode] Falha ao persistir arquivo no tenant alvo', {
                      fileName: f?.name,
                      tenantTargetId,
                      error: e?.message || String(e),
                    });
                  }
                }

                // 2) Persistir web scraping (se houver URLs válidas)
                const validUrlsToPersist = (Array.isArray(scrapingTargets) ? scrapingTargets : [])
                  .filter(url => url && String(url).trim().startsWith('http'));
                if (useWebScraping && validUrlsToPersist.length > 0) {
                  await fetchJson('/web-scraping/scrape-batch', {
                    method: 'POST',
                    headers: { 'X-Tenant-Id': contextTenantId },
                    body: JSON.stringify({
                      urls: validUrlsToPersist,
                      autoIndex: true,
                      source: 'web_scraping',
                      category: 'general',
                      executionId: pipelineExecutionIdRef.current || null,
                      dryRun: false,
                      persistTenantId: tenantTargetId,
                    }),
                    timeoutMs: 60000,
                    silent: true,
                  });

                  // Aguarda indexação completar (best-effort)
                  await new Promise(resolve => setTimeout(resolve, 2000));
                }
              } catch (e) {
                logger.warn('[TenantMode] Falha ao persistir conteúdo no tenant alvo (best-effort)', {
                  tenantTargetId,
                  error: e?.message || String(e),
                });
              }
            }
          }
          
          const startInitialFlowBestEffort = () => {
            // Não inicia se já houve abort.
            if (pipelineAbortRef.current) return;

            setInitialGraphLoading(true);
            (async () => {
              const tenantTargetId = createdTenant?.tenant?.id || null;
              if (!tenantTargetId) return;

              const contextTenantId = validatedTenantId || agent?.tenantId || null;
              const execId = pipelineExecutionId;
              if (!contextTenantId || !execId) return;

              const resp = await fetchJson('/system/generate-initial-flow', {
                method: 'POST',
                body: JSON.stringify({
                  tenantId: contextTenantId,
                  executionId: execId,
                  targetTenantId: tenantTargetId,
                  dryRun: executionMode === 'dry-run',
                  persistFlow: executionMode !== 'dry-run',
                  // Cobertura: além do FAQ interno, inclui as perguntas geradas (quando existirem)
                  questions: Array.isArray(questionsList) ? questionsList.slice(0, 200) : [],
                  ...(executionMode === 'dry-run' && useInlineChunksForSuggestRef.current
                    ? { chunks: (ephemeralChunksRef.current || []).slice(0, 30).map(c => ({ ...c, text: (c?.text || '').slice(0, 5000) })) }
                    : {}),
                }),
                timeoutMs: 120000,
                silent: true,
              });

              // Se a execução foi abortada por falha anterior, não aplica resultados/toasts.
              if (pipelineAbortRef.current) return;

              if (resp?.entities && Array.isArray(resp.entities.services) && resp.entities.services.length === 0) {
                // Sem toast local: feedback visual vem do backend via WS.
              }
              if (resp?.entities && typeof resp.entities === 'object') {
                setInitialFlowEntities(resp.entities);
              }

              const flow = resp?.initialFlow || resp?.data?.initialFlow || null;
              if (flow && typeof flow === 'object') {
                setInitialFlow(flow);
              }
            })().catch((graphErr) => {
              logger.warn('[TenantMode] Falha ao gerar fluxo inicial automaticamente (best-effort)', {
                error: graphErr?.message || String(graphErr),
              });
            }).finally(() => {
              setInitialGraphLoading(false);
            });
          };

          // Se o usuário selecionou gerar fluxo/RPA/seed, executa a geração completa
          if (generateFlow || generateRpa || generateSeed) {
            // Sem toast local: feedback visual vem do backend via WS.

            // IMPORTANTE (coerência do pipeline visível):
            // Até aqui, o pipeline também foi usado para mostrar progresso de "criar tenant" (que pode
            // usar IA). Antes de iniciar o generate-and-validate (artefatos), resetamos apenas os steps
            // de artefatos para evitar "resíduos" (ex.: flowGenerated preso com mensagem de IA do tenant).
            setPipelineStatus(prev => ({
              ...prev,
              contractValid: false,
              contextBuilt: false,
              aiExecuted: false,
              flowGenerated: false,
              seedGenerated: false,
              rpaGenerated: false,
              rpaExecuted: false,
              approved: false,
            }));
            setPipelineDetails(prev => ({
              ...prev,
              contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
              contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
              aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
              flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
              seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
              rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
              rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
              approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
            }));
            
            // Gera payload para criação de artefatos
            const payload = generatePayload();
            // Atualiza o nome do tenant no payload
            payload.name = name.trim();
            // Não define payload.tenantId - o servidor deve usar o tenant do usuário logado
            // (que tem o provider de IA configurado) ao invés do tenant recém-criado

            // Perguntas (FAQ): auto-gerar como o "sugerir descrição"
            if (payload.includeQuestions === true && (!Array.isArray(payload.questions) || payload.questions.length === 0)) {
              try {
                const autoQuestions = await suggestQuestionsAutoList();
                if (!autoQuestions || autoQuestions.length === 0) {
                  pipelineAbortRef.current = true;
                  const msg = 'Não foi possível gerar perguntas automaticamente. Adicione ao menos 1 pergunta.';
                  setError(msg);
                  showToast?.(msg, 'error');
                  setExecuting(false);
                  return;
                }
                setQuestionsList(autoQuestions);
                payload.questions = autoQuestions.slice(0, 50);
                // Só inicia fluxo inicial após as perguntas terem passado (evita gastar IA em background quando aborta aqui).
                startInitialFlowBestEffort();
              } catch (e) {
                logger.warn('[Questions] Falha ao gerar perguntas automaticamente (tenant mode)', { error: e?.message });
                pipelineAbortRef.current = true;
                const msg = e?.message || 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.';
                setError(msg);
                showToast?.(msg, 'error');
                setExecuting(false);
                return;
              }
            } else if (payload.includeQuestions === true && Array.isArray(payload.questions) && payload.questions.length > 0) {
              // Perguntas já presentes no payload
              // (Pipeline visível é alimentado apenas por WS/backend)
              // Mesmo com perguntas existentes, podemos iniciar o fluxo inicial aqui (a partir daqui não deve abortar por perguntas).
              startInitialFlowBestEffort();
            }
            
            // Arquivos já foram processados antes da sugestão de descrição
            // Não precisa processar novamente aqui
            logger.info('[TenantMode] Arquivos já processados antes da sugestão de descrição', {
              totalFiles: uploadedFiles.length,
              filesByStatus: {
                pending: uploadedFiles.filter(f => f.status === 'pending').length,
                processing: uploadedFiles.filter(f => f.status === 'processing').length,
                success: uploadedFiles.filter(f => f.status === 'success').length,
                error: uploadedFiles.filter(f => f.status === 'error').length,
              },
            });
            
            // Em modo real, verifica se o servidor está disponível antes de executar
            // e aguarda um pouco para evitar problemas com reinicializações do servidor (nodemon)
            if (executionMode === 'real') {
              try {
                logger.info('[TenantMode] Verificando saúde do servidor antes de executar em modo real...');
                await fetchJson('/health', {
                  method: 'GET',
                  timeoutMs: 5000,
                });
                logger.info('[TenantMode] Servidor está disponível, aguardando 2s para garantir estabilidade...');
                // Aguarda um pouco para evitar problemas com reinicializações do servidor (nodemon)
                // que podem ocorrer após criação de tenant
                await new Promise(resolve => setTimeout(resolve, 2000));
                logger.info('[TenantMode] Prosseguindo com execução');
              } catch (healthError) {
                logger.error('[TenantMode] Servidor não está disponível', healthError);
                const errorMessage = 'Servidor não está respondendo. Verifique se o servidor está rodando e tente novamente.';
                setError(errorMessage);
                showToast?.(errorMessage, 'error');
                updatePipelineWithDetails({ 
                  aiExecuted: { 
                    status: 'error', 
                    progress: 0, 
                    message: 'Servidor não está disponível',
                    timestamp: new Date().toISOString()
                  }
                }, 'server-unavailable');
                setExecuting(false);
                return;
              }
            }
            
            // Executa geração de artefatos
            // Opção A: mantém um único executionId para todo o pipeline tenant,
            // incluindo generate-initial-flow (intents) e generate-and-validate (artefatos).
            payload.executionId = pipelineExecutionId;
            payload.tenantPipeline = true;

            // UX: o backend só marca `contractValid` quando chega na etapa; para não parecer "travado"
            // até o primeiro evento WS, marcamos o card como "em progresso" localmente (sem completar).
            const response = await generateAndValidate(payload);
            
            // Se o orquestrador retornou flowDefinition, disponibiliza no modal/canvas também.
            // Isso garante botão/modal mesmo quando o best-effort de /system/generate-initial-flow falhar.
            try {
              const flowFromArtifacts = response?.flowDefinition || null;
              if (flowFromArtifacts && typeof flowFromArtifacts === 'object') {
                setInitialFlow(prev => (prev ? prev : flowFromArtifacts));
              }
            } catch (_) {
              // noop
            }

            setResult({
              success: true,
              tenant: createdTenant.tenant,
              generated: true,
              ...response,
            });
          } else {
            // Apenas cria o tenant, sem gerar artefatos
            // Mas ainda processa arquivos se houver (para indexar no RAG)
            const pendingFiles = uploadedFiles.filter(f => f.status === 'pending');
            if (pendingFiles.length > 0) {
              logger.info('[TenantMode] Processando arquivos pendentes (sem gerar artefatos)', {
                pendingFilesCount: pendingFiles.length,
                files: pendingFiles.map(f => ({ id: f.id, name: f.name })),
              });
              
              // Processa arquivos em background (não bloqueia a criação do tenant)
              (async () => {
                for (let i = 0; i < pendingFiles.length; i++) {
                  const fileObj = pendingFiles[i];
                  try {
                    logger.debug(`[TenantMode] Processando arquivo ${i + 1}/${pendingFiles.length}`, {
                      fileName: fileObj.name,
                      fileId: fileObj.id,
                    });
                    
                    // Infere categoria
                    const inferredCategory = await inferFileCategoryWithAI(fileObj.file);
                    logger.info(`[TenantMode] Categoria inferida: ${inferredCategory}`, {
                      fileName: fileObj.name,
                      category: inferredCategory,
                    });
                    
                    // Atualiza a categoria do arquivo no estado
                    updateUploadedFile(fileObj.id, { category: inferredCategory });
                    
                    // Cria uma cópia do objeto com a categoria inferida para usar no upload
                    const fileObjWithCategory = {
                      ...fileObj,
                      category: inferredCategory,
                    };
                    
                    // Faz upload imediatamente após inferir
                    logger.debug(`[TenantMode] Fazendo upload do arquivo ${fileObj.name}`);
                    await handleFileUpload(fileObjWithCategory);
                    logger.info(`[TenantMode] Upload concluído para arquivo ${fileObj.name}`);
                  } catch (error) {
                    logger.error(`[TenantMode] Erro ao processar arquivo ${fileObj.name}`, {
                      error: error.message,
                      stack: error.stack,
                      fileId: fileObj.id,
                    });
                    // Marca como erro no estado
                    updateUploadedFile(fileObj.id, { status: FileStatus.error, error: error.message || 'Erro ao processar arquivo', progress: 0 });
                  }
                }
                
                logger.info('[TenantMode] Todos os arquivos processados (sem gerar artefatos)', {
                  totalFiles: uploadedFiles.length,
                  processedFiles: pendingFiles.length,
                  successFiles: uploadedFiles.filter(f => f.status === 'success').length,
                  errorFiles: uploadedFiles.filter(f => f.status === 'error').length,
                });
              })();
            }
            
            setResult({
              success: true,
              tenant: createdTenant.tenant,
              generated: true,
            });
            
            // Navega de volta para a página de tenants após 2 segundos
            setTimeout(() => {
              navigate('/tenants');
            }, 2000);
          }
        } else {
          throw new Error('A IA não retornou dados válidos');
        }
      } catch (err) {
        logger.error('[TenantMode] Erro ao gerar/criar tenant', err);
        
        // Marca IA como erro no pipeline
        updatePipelineWithDetails({ 
          aiExecuted: { 
            status: 'error', 
            progress: 0, 
            message: 'Erro na execução da IA',
            timestamp: new Date().toISOString()
          }
        }, 'tenant-generation-error');
        
        // Extrai mensagem de erro de forma mais robusta
        let errorMessage = 'Erro ao gerar tenant por IA';
        
        const body = err?.body;
        if (body) {
          errorMessage =
            body?.error?.message ||
            body?.message ||
            body?.details ||
            body?.error ||
            errorMessage;
        } else if (err?.message) {
          errorMessage = err.message;
        }

        // Garante string (evita crash em errorMessage.includes quando vier object/array)
        if (typeof errorMessage !== 'string') {
          try {
            errorMessage = JSON.stringify(errorMessage);
          } catch {
            errorMessage = String(errorMessage);
          }
        }
        
        // Mensagens mais amigáveis para erros comuns
        if (errorMessage.includes('Nenhum provider de IA configurado')) {
          errorMessage = 'Provider de IA não configurado. Configure um provider de IA no sistema antes de usar esta funcionalidade.';
        } else if (errorMessage.includes('Provider de IA não disponível')) {
          errorMessage = 'Nenhum provider de IA está disponível. Verifique a configuração de IA no sistema.';
        }
        
        setError(errorMessage);
      } finally {
        setExecuting(false);
      }
      return;
    }

    setExecuting(true);
    setError(null);
    setResult(null);
    // executionId obrigatório para todas as rotas do pipeline (backend é a fonte da verdade)
    if (!pipelineExecutionIdRef.current) {
      const pipelineExecutionId = `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      pipelineExecutionIdRef.current = pipelineExecutionId;
      pipelineMachine.start(pipelineExecutionId);
      pipelineSocket.subscribe(pipelineExecutionId);
    }
      // Sem polling: progresso do pipeline é via WebSocket
    // Reset do fluxo inicial e modal para permitir reabrir a cada execução
    setInitialFlow(null);
    setInitialFlowEntities(null);
    setShowInitialFlowModal(false);
    setInitialFlowModalSize({ width: null, height: null });
    lastInitialFlowSignatureRef.current = null;
    setInitialGraphLoading(false);
    
    // Reseta pipeline status
    const resetStatus = {
      webScraping: false,
      descriptionSuggested: false,
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
      webScraping: { status: 'pending', timestamp: null, message: null, progress: 0 },
      descriptionSuggested: { status: 'pending', timestamp: null, message: null, progress: 0, meta: null },
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
    
    // Se precisa sugerir descrição, executa essa etapa primeiro
    if (needsDescriptionSuggestion && !isTenantMode) {
      // Valida que o tenantId existe (sem fallback)
      if (!agent?.tenantId) {
        const errorMsg = 'Tenant não identificado. Faça login novamente e tente novamente.';
        setError(errorMsg);
        setExecuting(false);
        return;
      }
      
      try {
        updatePipelineWithDetails({ 
          descriptionSuggested: { status: 'in_progress', progress: 0, message: 'Sugerindo descrição com IA...' }
        }, 'description-suggestion');
        
        // Gera descrição sugerida via RAG + consolidação (backend)
        const uploadedFileNames = Array.from(new Set(
          uploadedFiles
            .map(f => (typeof f?.name === 'string' ? f.name.trim() : ''))
            .filter(Boolean)
        ));
        
        // Chama API para sugerir descrição (sem fallback de tenantId)
        const suggestionResponse = await fetchJson('/system/suggest-description', {
          method: 'POST',
          body: JSON.stringify({ 
            name: name.trim(),
            tenantId: agent.tenantId,
            fileNames: uploadedFileNames,
            mode: descriptionMode,
            executionId: pipelineExecutionIdRef.current,
          }),
          timeoutMs: 60000,
        });

        // Sem toast local: avisos vêm do backend via WS.

        const confidence = (typeof suggestionResponse?.confidence === 'number')
          ? suggestionResponse.confidence
          : (typeof suggestionResponse?.entityProfile?.confidence === 'number' ? suggestionResponse.entityProfile.confidence : null);
        // Sem toast local: baixa confiança vem do backend via WS.
        
        if (suggestionResponse?.suggestion) {
          // Atualiza a descrição com a sugestão
          const suggestedDescription = suggestionResponse.suggestion.trim();
          setDescription(suggestedDescription);

          const meta = getDescriptionSuggestionMeta(suggestionResponse);
          
          updatePipelineWithDetails({ 
            descriptionSuggested: { 
              status: 'completed', 
              progress: 100, 
              message: 'Descrição sugerida pela IA e aplicada automaticamente',
              meta,
              timestamp: new Date().toISOString()
            }
          }, 'description-suggestion');
          
          logger.info('[Pipeline] Descrição sugerida e aplicada', { 
            suggestedLength: suggestedDescription.length 
          });
        } else {
          throw new Error('A IA não retornou uma descrição sugerida');
        }
      } catch (suggestionError) {
        logger.error('[Pipeline] Erro ao sugerir descrição', suggestionError);
        const msg = suggestionError?.body?.message || suggestionError?.message || 'Erro ao sugerir descrição.';
        const code = suggestionError?.body?.error?.code || suggestionError?.body?.code || suggestionError?.code || null;
        updatePipelineWithDetails({
          descriptionSuggested: { status: 'error', progress: 0, message: msg, timestamp: new Date().toISOString() }
        }, 'description-suggestion');
        setError(msg);

        // Sem contexto indexado: aborta pipeline (não deve seguir)
        if (code === 'NO_INDEXED_CONTEXT') {
          setExecuting(false);
          return;
        }

        // Continua mesmo se a sugestão falhar (outros erros)
      }
    }
    
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
        
        // Verifica se é super-admin (rate limit é apenas informativo)
        const isSuperAdminUser = agent?.role === 'super_admin' || 
                                 (agent?.tenantId === 'system' && agent?.role === 'admin');
        
        if (isSuperAdminUser) {
          // Para super-admins: apenas informativo, não bloqueia
          let message = `ℹ️ Limite de execuções atingido (apenas informativo para super-admin)`;
          if (operationType === 'BOOTSTRAP') {
            message += `\n\nModo Bootstrap: 1 execução a cada 5 minutos\nNormalmente seria necessário aguardar ${remaining} segundos, mas como super-admin você pode continuar.`;
          } else if (operationType === 'GENERATION_REAL') {
            message += `\n\nModo Real: 5 execuções por minuto\nNormalmente seria necessário aguardar ${remaining} segundos, mas como super-admin você pode continuar.`;
          } else {
            message += `\n\nModo Dry-Run: 50 execuções por minuto\nNormalmente seria necessário aguardar ${remaining} segundos, mas como super-admin você pode continuar.`;
          }
          
          logger.warn('[Execute] Rate limit local excedido (super-admin - apenas informativo)', {
            remaining,
            operationType,
          });
          // Limpa o rate limit local para permitir continuar
          setRateLimitUntil(null);
          setRateLimitSecondsRemaining(0);
          // Continua execução para super-admin
        } else {
          // Para usuários normais: bloqueia
          let message = `Limite de execuções atingido`;
          if (operationType === 'BOOTSTRAP') {
            message += ` (modo Bootstrap: 1 execução a cada 5 minutos)`;
          } else if (operationType === 'GENERATION_REAL') {
            message += ` (modo Real: 5 execuções por minuto)`;
          }
          message += `. Tente novamente em ${remaining} segundos.`;
          
          setError(message);
          setExecuting(false);
          return;
        }
      }

      // Gera payload antes de processar arquivos
      const payload = generatePayload();
      
      // Verificação proativa do rate limit no servidor ANTES de processar arquivos
      // Isso evita processar arquivos se o rate limit já foi excedido
      try {
        logger.debug('[Execute] Verificando rate limit no servidor antes de executar');
        const rateLimitCheck = await checkRateLimit(payload);
        
        // Verifica se é super-admin (rate limit é apenas informativo)
        const isSuperAdminUser = agent?.role === 'super_admin' || 
                                 (agent?.tenantId === 'system' && agent?.role === 'admin') ||
                                 rateLimitCheck?.isSuperAdmin ||
                                 rateLimitCheck?.informativeOnly;
        
        if (!rateLimitCheck.allowed) {
          const retryAfter = rateLimitCheck.retryAfter || 60;
          const operationType = bootstrap ? 'BOOTSTRAP' : (executionMode === 'dry-run' ? 'DRY_RUN' : 'GENERATION_REAL');
          
          if (isSuperAdminUser) {
            // Para super-admins: apenas informativo, não bloqueia
            let message = `ℹ️ Limite de execuções atingido (apenas informativo para super-admin)`;
            if (operationType === 'BOOTSTRAP') {
              message += `\n\nModo Bootstrap: 1 execução a cada 5 minutos\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin você pode continuar.`;
            } else if (operationType === 'GENERATION_REAL') {
              message += `\n\nModo Real: 5 execuções por minuto\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin você pode continuar.`;
            } else {
              message += `\n\nModo Dry-Run: 50 execuções por minuto\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin você pode continuar.`;
            }
            
            logger.warn('[Execute] Rate limit excedido (super-admin - apenas informativo)', {
              retryAfter,
              remainingPoints: rateLimitCheck.remainingPoints,
              totalPoints: rateLimitCheck.totalPoints,
              operationType,
            });
            // Continua execução para super-admin
          } else {
            // Para usuários normais: bloqueia
            const until = Date.now() + (retryAfter * 1000);
            setRateLimitUntil(until);
            setRateLimitSecondsRemaining(retryAfter);
            
            let message = `Limite de execuções atingido`;
            if (operationType === 'BOOTSTRAP') {
              message += ` (modo Bootstrap: 1 execução a cada 5 minutos)`;
            } else if (operationType === 'GENERATION_REAL') {
              message += ` (modo Real: 5 execuções por minuto)`;
            }
            message += `. Tente novamente em ${retryAfter} segundos.`;
            
            setError(message);
            setExecuting(false);
            logger.warn('[Execute] Rate limit verificado no servidor: bloqueado', {
              retryAfter,
              remainingPoints: rateLimitCheck.remainingPoints,
              totalPoints: rateLimitCheck.totalPoints,
            });
            return;
          }
        } else if (isSuperAdminUser && rateLimitCheck.remainingPoints !== undefined) {
          // Para super-admins, mostra informação sobre rate limit mesmo quando permitido
          const remaining = rateLimitCheck.remainingPoints || 0;
          const total = rateLimitCheck.totalPoints || 0;
          // Sem toast local: feedback visual vem do backend via WS.
        }
        
        logger.debug('[Execute] Rate limit verificado no servidor: permitido', {
          remainingPoints: rateLimitCheck.remainingPoints,
          totalPoints: rateLimitCheck.totalPoints,
          isSuperAdmin: isSuperAdminUser,
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
            updateUploadedFile(fileObj.id, { category: inferredCategory });
            
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
            updateUploadedFile(fileObj.id, { status: FileStatus.error, error: error.message || 'Erro ao processar arquivo', progress: 0 });
          }
        }
        
        logger.info('[Execute] ETAPA 0 concluída: Todos os arquivos processados', {
          totalFiles: uploadedFiles.length,
          processedFiles: pendingFiles.length,
          successFiles: uploadedFiles.filter(f => f.status === 'success').length,
          errorFiles: uploadedFiles.filter(f => f.status === 'error').length,
        });
        updatePipelineWithDetails({ filesInferred: true }, 'execute');
      } else {
        logger.info('[Execute] ETAPA 0: Nenhum arquivo pendente, pulando etapa', {
          totalFiles: uploadedFiles.length,
          filesByStatus: {
            pending: uploadedFiles.filter(f => f.status === 'pending').length,
            processing: uploadedFiles.filter(f => f.status === 'processing').length,
            success: uploadedFiles.filter(f => f.status === 'success').length,
            error: uploadedFiles.filter(f => f.status === 'error').length,
          },
        });
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
      
      // Em modo real, verifica se o servidor está disponível antes de executar
      // e aguarda um pouco para evitar problemas com reinicializações do servidor (nodemon)
      if (executionMode === 'real') {
        try {
          logger.info('[Execute] Verificando saúde do servidor antes de executar em modo real...');
          await fetchJson('/health', {
            method: 'GET',
            timeoutMs: 5000,
          });
          logger.info('[Execute] Servidor está disponível, aguardando 2s para garantir estabilidade...');
          // Aguarda um pouco para evitar problemas com reinicializações do servidor (nodemon)
          await new Promise(resolve => setTimeout(resolve, 2000));
          logger.info('[Execute] Prosseguindo com execução');
        } catch (healthError) {
          logger.error('[Execute] Servidor não está disponível', healthError);
          const errorMessage = 'Servidor não está respondendo. Verifique se o servidor está rodando e tente novamente.';
          setError(errorMessage);
          updatePipelineWithDetails({ 
            aiExecuted: { 
              status: 'error', 
              progress: 0, 
              message: 'Servidor não está disponível',
              timestamp: new Date().toISOString()
            }
          }, 'server-unavailable');
          setExecuting(false);
          return;
        }
      }
      
      // Perguntas (FAQ): auto-gerar como o "sugerir descrição"
      if (payload.includeQuestions === true && (!Array.isArray(payload.questions) || payload.questions.length === 0)) {
        try {
          updatePipelineWithDetails({
            questionsGenerated: {
              status: 'in_progress',
              progress: 0,
              message: getStepMessage('questionsGenerated', 'in_progress'),
              timestamp: new Date().toISOString(),
            },
          }, 'questions-auto');
          const autoQuestions = await suggestQuestionsAutoList();
          if (!autoQuestions || autoQuestions.length === 0) {
            updatePipelineWithDetails({
              questionsGenerated: {
                status: 'error',
                progress: 0,
                message: 'Não foi possível gerar perguntas automaticamente',
                timestamp: new Date().toISOString(),
              },
            }, 'questions-auto');
            setError('Não foi possível gerar perguntas automaticamente. Adicione ao menos 1 pergunta.');
            setExecuting(false);
            return;
          }
          setQuestionsList(autoQuestions);
          payload.questions = autoQuestions.slice(0, 50);
          updatePipelineWithDetails({ questionsGenerated: true }, 'questions-auto');
        } catch (e) {
          logger.warn('[Questions] Falha ao gerar perguntas automaticamente', { error: e?.message });
          updatePipelineWithDetails({
            questionsGenerated: {
              status: 'error',
              progress: 0,
              message: 'Falha ao gerar perguntas automaticamente',
              timestamp: new Date().toISOString(),
            },
          }, 'questions-auto');
          setError(e?.message || 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.');
          setExecuting(false);
          return;
        }
      } else if (payload.includeQuestions === true && Array.isArray(payload.questions) && payload.questions.length > 0) {
        updatePipelineWithDetails({ questionsGenerated: true }, 'questions-existing');
      }

      logger.info('[Execute] Chamando generateAndValidate');
      // IMPORTANTÍSSIMO (Opção A):
      // usa o MESMO executionId do pipeline tenant para correlacionar TODOS os steps
      // (generate-faq, generate-initial-flow, generate-and-validate) e só marcar "Aprovado"
      // quando tudo terminar.
      payload.executionId = pipelineExecutionId;
      payload.tenantPipeline = isTenantMode === true;
      const response = await generateAndValidate(payload);
      
      logger.info('[Execute] generateAndValidate concluído', {
        success: response?.success,
        rpaPassed: response?.rpaPassed,
        flowGenerated: response?.flowGenerated,
        seedGenerated: response?.seedGenerated,
        rpaGenerated: response?.rpaGenerated,
        rpaExecuted: response?.rpaExecuted,
      });

      setResult(response);

      // Feedback UX: sucesso parcial (warnings / RPA falhou) não deve virar erro.
      try {
        const warnings = Array.isArray(response?.warnings) ? response.warnings : [];
        if (response?.success && (warnings.length > 0 || response?.rpaPassed === false)) {
          const msg =
            warnings.length > 0
              ? `Concluído com avisos (${warnings.length}). Revisão humana recomendada.`
              : 'Concluído, mas o teste RPA não passou. Revisão humana recomendada.';
          showToast?.(msg, 'warning', 10000);
        }
      } catch {
        // best-effort
      }
    } catch (err) {
      logger.error('Erro ao executar geração', err);
      
      // Trata erro de rate limit
      if (err.status === 429 || (err.body && err.body.error === 'rate_limit_exceeded')) {
        const retryAfter = err.body?.retryAfter || err.retryAfter || 60;
        
        // Verifica se é super-admin (rate limit é apenas informativo)
        // Pode vir do header HTTP ou do erro
        const isSuperAdminUser = agent?.role === 'super_admin' || 
                                 (agent?.tenantId === 'system' && agent?.role === 'admin') ||
                                 err.isSuperAdmin ||
                                 (err.body && err.body.isSuperAdmin);
        
        // Mensagem mais detalhada baseada no tipo de operação
        const operationType = bootstrap ? 'BOOTSTRAP' : (executionMode === 'dry-run' ? 'DRY_RUN' : 'GENERATION_REAL');
        
        if (isSuperAdminUser) {
          // Para super-admins: apenas informativo, não bloqueia
          let message = `ℹ️ Limite de execuções atingido durante execução (apenas informativo para super-admin)`;
          if (operationType === 'BOOTSTRAP') {
            message += `\n\nModo Bootstrap: 1 execução a cada 5 minutos\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin a execução continua.`;
          } else if (operationType === 'GENERATION_REAL') {
            message += `\n\nModo Real: 5 execuções por minuto\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin a execução continua.`;
          } else {
            message += `\n\nModo Dry-Run: 50 execuções por minuto\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin a execução continua.`;
          }
          
          logger.warn('[Execute] Rate limit excedido durante execução (super-admin - apenas informativo)', {
            operationType,
            retryAfter,
            bootstrap,
            executionMode,
            severity: 'LOW',
            alert: 'RATE_LIMIT_EXCEEDED_DURING_EXECUTION_SUPER_ADMIN',
          });
          // Não bloqueia para super-admin, continua processamento
        } else {
          // Para usuários normais: bloqueia
          const until = Date.now() + (retryAfter * 1000);
          setRateLimitUntil(until);
          setRateLimitSecondsRemaining(retryAfter);
          
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
          setExecuting(false);
          return;
        }
      } else {
        // Marca IA como erro no pipeline se estiver em progresso
        const currentAiStatus = pipelineDetails.aiExecuted?.status;
        if (currentAiStatus === 'in_progress' || currentAiStatus === 'pending') {
          updatePipelineWithDetails({ 
            aiExecuted: { 
              status: 'error', 
              progress: 0, 
              message: 'Erro na execução da IA',
              timestamp: new Date().toISOString()
            }
          }, 'execute-error');
        }
        
        // Trata erros de conexão de forma mais clara
        if (err.connectionRefused || err.status === 0 || err.message === 'Failed to fetch') {
          const errorMessage = 'Servidor não está respondendo. Verifique se o servidor está rodando e tente novamente.';
          setError(errorMessage);
          updatePipelineWithDetails({ 
            aiExecuted: { 
              status: 'error', 
              progress: 0, 
              message: 'Servidor não está disponível',
              timestamp: new Date().toISOString()
            }
          }, 'server-unavailable');
        } else {
          if (err?.code) {
            // Se o pipeline abortou, tenta inferir qual etapa realmente falhou
            // (ex.: RPA) para evitar UI "travada" em contractValid.
            let inferredStepKey = 'aiExecuted';
            try {
              const details = err?.details ?? err?.body?.error?.details ?? null;
              const code = err?.code || err?.body?.error?.code || null;
              if (code === 'PIPELINE_ABORTED' && details) {
                const rpa = details?.rpa || null;
                if (rpa?.executed) inferredStepKey = 'rpaExecuted';
                else if (rpa?.generated) inferredStepKey = 'rpaGenerated';
                else if (details?.contextBuilt === false) inferredStepKey = 'contextBuilt';
                else if (details?.contractValid === false) inferredStepKey = 'contractValid';
              }
            } catch (e) {
              // best-effort
            }

            const msg = err?.body?.message || err?.message || 'Erro na execução do pipeline';
            updatePipelineWithDetails({
              [inferredStepKey]: {
                status: 'error',
                progress: 0,
                message: msg,
                timestamp: new Date().toISOString(),
              },
            }, 'execute-error');
            setError(msg);
          } else {
            setError(err.message || 'Erro desconhecido');
          }
        }
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
    if (files.length === 0) {
      logger.warn('[FileSelect] Nenhum arquivo selecionado');
      return;
    }

    logger.info('[FileSelect] Arquivos selecionados', {
      filesCount: files.length,
      fileNames: files.map(f => f.name),
      fileSizes: files.map(f => f.size),
    });

    // Adiciona arquivos via FileUploadContext (pending → processing → success|error)
    const newFiles = addSelectedFiles(files);

    logger.info('[FileSelect] Arquivos adicionados à lista de upload', {
      newFilesCount: newFiles.length,
      totalFilesCount: uploadedFiles.length + newFiles.length,
      fileIds: newFiles.map(f => f.id),
    });
    
    // Não faz inferência nem upload automaticamente - será feito ao clicar em Executar
    logger.debug('[FileSelect] Arquivos adicionados, aguardando execução para processar');
  };

  const handleFileUpload = async (fileObj) => {
    try {
      // Atualiza status para processing (sub-state machine)
      updateUploadedFile(fileObj.id, { status: FileStatus.processing, progress: 0, error: null });

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
            // Atualiza status com progresso (nunca volta para pending)
            const raw = Number(progress);
            const pct = Number.isFinite(raw) ? Math.round(raw) : 0;
            const safePct = Math.max(0, Math.min(100, pct));
            updateUploadedFile(fileObj.id, { status: FileStatus.processing, progress: safePct });
          },
        });
        
        processedFile = processed.file;
        preview = processed.preview;
        extractedContent = processed.content;

        // Log do conteúdo extraído
        if (extractedContent) {
        logger.info(`[FileUpload] Conteúdo extraído do arquivo ${fileObj.name}`, {
          contentLength: extractedContent.length,
          preview: extractedContent.substring(0, 200),
          hasContent: extractedContent && extractedContent.length > 0,
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
        if (!extractedContent || extractedContent.trim().length === 0) {
          logger.warn('[FileUpload] Conteúdo extraído está vazio, usando placeholder', {
            fileName: fileObj.name,
            fileType: fileObj.file.type,
            extractedContentLength: extractedContent?.length || 0,
          });
          extractedContent = `[Arquivo: ${fileObj.name} - Tipo: ${fileObj.file.type}]\n\nNão foi possível extrair conteúdo automaticamente.`;
        }
        
        // Valida que o conteúdo extraído tem tamanho mínimo
        if (extractedContent.trim().length < 10) {
          logger.warn('[FileUpload] Conteúdo extraído muito curto, pode não ser indexado corretamente', {
            fileName: fileObj.name,
            contentLength: extractedContent.trim().length,
            contentPreview: extractedContent.substring(0, 100),
          });
        }
      }

      // DRY-RUN: não grava no banco / não indexa no RAG. Mantém apenas extração local para UX.
      if (executionMode === 'dry-run') {
        updateUploadedFile(fileObj.id, {
          status: FileStatus.success,
          documentId: null,
          preview,
          progress: 100,
          extractedContent, // mantém para visualização
          isDuplicate: false,
          dryRun: true,
        });
        return {
          ok: true,
          sourceType: 'uploaded_file',
          sourceId: fileObj.name,
          text: extractedContent,
        };
      }

      // Obtém tenantId do agente (tenant de contexto / provider).
      if (!agent?.tenantId) {
        const errorMsg = 'Tenant não identificado. Faça login novamente e tente novamente.';
        setError(errorMsg);
        throw new Error(errorMsg);
      }
      const contextTenantId = agent.tenantId;

      // Tenant-mode (super-admin): antes do tenant alvo existir, NÃO persistimos no RAG.
      // Mantemos extração local e marcamos como "deferredPersist" para persistir depois do create.
      if (isTenantMode && !targetTenantIdRef.current) {
        updateUploadedFile(fileObj.id, {
          status: FileStatus.success,
          documentId: null,
          preview,
          progress: 100,
          extractedContent,
          isDuplicate: false,
          dryRun: false,
          deferredPersist: true,
          deferredPersistReason: 'tenant_mode_pre_creation',
        });
        return {
          ok: true,
          sourceType: 'uploaded_file',
          sourceId: fileObj.name,
          text: extractedContent,
        };
      }
      const persistTenantId = (isTenantMode && targetTenantIdRef.current)
        ? targetTenantIdRef.current
        : contextTenantId;
      
      logger.info('[FileUpload] Preparando upload para RAG', {
        fileName: fileObj.name,
        tenantId: contextTenantId,
        persistTenantId: persistTenantId,
        hasExtractedContent: !!extractedContent,
        extractedContentLength: extractedContent?.length || 0,
        autoIndex: true,
      });
      
      // Faz upload do arquivo processado com conteúdo extraído
      const result = await uploadDocument(processedFile, {
        executionId: pipelineExecutionIdRef.current,
        tenantId: contextTenantId, // compatibilidade (o header já define o tenant de contexto)
        ...(persistTenantId && persistTenantId !== contextTenantId ? { persistTenantId } : {}),
        headers: contextTenantId ? { 'X-Tenant-Id': contextTenantId } : undefined,
        category: fileObj.category,
        tags: [fileObj.category, 'generate-system'],
        metadata: {
          uploadedFrom: 'generate-system',
          originalFileName: fileObj.name,
          fileName: fileObj.name, // Nome do arquivo para verificação de duplicação
          fileSize: fileObj.file.size, // Tamanho para verificação de duplicação
          isImage: isImage,
          isPdf: isPdf,
          isText: isText,
          extractedContent: extractedContent, // Conteúdo extraído (OCR, PDF, texto, etc.)
        },
        autoIndex: true, // Indexa automaticamente no RAG
      });

      // Avisos (PDF/OCR/etc.) não geram toast local — o backend é a fonte do feedback visual via WS.
      
      logger.info('[FileUpload] Upload concluído', {
        fileName: fileObj.name,
        documentId: result.document?.id || result.id,
        isDuplicate: result.isDuplicate || false,
        success: !!result,
      });

      // Verifica se é duplicata
      const isDuplicate = result.isDuplicate || false;

      // Atualiza status para success com preview se disponível
      updateUploadedFile(fileObj.id, {
        status: FileStatus.success,
        documentId: result.document?.id || result.id,
        preview,
        progress: 100,
        extractedContent, // Salva conteúdo extraído para exibição
        isDuplicate, // Marca se é duplicata
      });

      if (isDuplicate) {
        logger.info('[FileUpload] Arquivo duplicado detectado', {
          fileName: fileObj.name,
          documentId: result.document?.id || result.id,
        });
      }
    } catch (error) {
      logger.error('Erro ao fazer upload do arquivo:', error);
      
      // Atualiza status para error
      updateUploadedFile(fileObj.id, { status: FileStatus.error, error: error.message || 'Erro desconhecido', progress: 0 });

      const msg = `Erro ao processar arquivo "${fileObj.name}": ${error.message}`;
      setError(msg);
      showToast?.(msg, 'error');
      return { ok: false, error: error.message || 'Erro ao processar arquivo' };
    }
  };

  const downloadRagOriginalFile = async (documentId, filenameHint = null, mode = 'download') => {
    if (!documentId) return;
    try {
      const path = `/rag/documents/${encodeURIComponent(documentId)}/download`;
      const res = await fetchBlob(path, { method: 'GET', timeoutMs: 45000 });
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (mode === 'open') {
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
        // Revoga depois para dar tempo do navegador carregar
        setTimeout(() => {
          try { URL.revokeObjectURL(objectUrl); } catch {}
        }, 15000);
        return;
      }

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filenameHint || `documento-${documentId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      const status = e?.status;
      if (status === 404) {
        setError('Arquivo original não encontrado no banco (404).');
        return;
      }
      setError('Não foi possível baixar/abrir o arquivo original do RAG.');
    }
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

      // Obtém tenantId do agente (obrigatório)
      const tenantId = agent?.tenantId;
      if (!tenantId) {
        throw new Error('Tenant ID é obrigatório para gerar categoria');
      }

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
      // Rastreia problema para refletir no pipeline visual (ex.: quota/rate limit)
      try {
        const code = error?.body?.error?.code || error?.code || null;
        const httpStatus = error?.status || error?.body?.error?.httpStatus || null;
        fileCategoryInferenceIssuesRef.current = {
          count: (Number(fileCategoryInferenceIssuesRef.current?.count) || 0) + 1,
          last: {
            code: code ? String(code) : null,
            httpStatus: httpStatus ? Number(httpStatus) : null,
            message: String(error?.message || error?.body?.error?.message || ''),
          },
        };
      } catch (_) {
        // noop
      }
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
      
      // Log informações sobre o replay carregado
      const replayData = data.replayData || data;
      if (replayData) {
        const actionsCount = replayData.actions?.length || 0;
        const screensCount = replayData.screens?.length || 0;
        logger.info('Replay carregado', {
          replayId: replayData.id,
          recordingId: replayData.recordingId,
          actionsCount,
          screensCount,
          hasActions: actionsCount > 0,
          hasScreens: screensCount > 0,
          startTime: replayData.startTime,
          endTime: replayData.endTime,
        });
      }
      
      setReportData(data);
    } catch (err) {
      logger.error('Erro ao carregar relatório', err);
      setReportError(err.message || 'Erro ao carregar relatório');
    } finally {
      setLoadingReport(false);
    }
  };

  // Executa um replay ao clicar no Replay ID e abre a tela de reprodução
  const handleReplayClick = async (replayId, detail) => {
    if (!replayId) {
      setError('Replay ID não encontrado');
      return;
    }

    try {
      // Sem toast local: feedback visual do pipeline vem do backend via WS.

      // Tenta usar o recordingId diretamente do detail se disponível
      let recordingId = detail?.recordingId;
      let replayFilename = null;
      let replayLink = null;
      
      // Primeiro, encontra o arquivo de replay para obter o replayLink
      const replayPath = detail?.replayPath;
      if (replayPath) {
        // Extrai o nome do arquivo do caminho
        replayFilename = replayPath.split('/').pop();
        if (replayFilename) {
          replayLink = `/tests/rpa/replay/${replayFilename}`;
        }
      }
      
      // Se não tiver replayPath, busca na lista de replays
      if (!replayFilename) {
        try {
          const { listRpaReplays } = await import('../api/flows');
          const replaysList = await listRpaReplays();
          
          // Busca o arquivo de replay que contém o replayId
          for (const file of replaysList.files || []) {
            try {
              const replayData = await getRpaReplay(file.filename);
              if (replayData?.id === replayId) {
                replayFilename = file.filename;
                replayLink = `/tests/rpa/replay/${file.filename}`;
                if (!recordingId) {
                  recordingId = replayData?.recordingId;
                }
                break;
              }
            } catch (err) {
              // Continua procurando em outros arquivos
              continue;
            }
          }
        } catch (err) {
          logger.warn('Erro ao buscar replay na lista', { error: err.message });
        }
      }
      
      // Se ainda não tiver recordingId, tenta buscar do arquivo de replay
      if (!recordingId && replayFilename) {
        try {
          const replayData = await getRpaReplay(replayFilename);
          recordingId = replayData?.recordingId;
        } catch (err) {
          logger.warn('Erro ao buscar replay pelo filename', { replayFilename, error: err.message });
        }
      }
      
      // Abre a tela de reprodução primeiro
      if (replayLink) {
        await handleViewReport(replayLink);
      } else {
        setError('Não foi possível encontrar o arquivo de replay');
        logger.warn('ReplayLink não encontrado', { replayId, detail });
      }
      
      // Executa o replay se tiver recordingId
      if (recordingId) {
        // Sem toast local: feedback visual do pipeline vem do backend via WS.

        // Executa o recording
        const result = await executeRpaRecording(recordingId, {}, {});
        
        if (result && result.success !== false) {
          logger.info('Replay executado com sucesso', { replayId, recordingId, result });
        } else {
          setError('Erro ao executar replay');
          logger.error('Erro ao executar replay', { replayId, recordingId, result });
        }
      } else {
        logger.warn('RecordingId não encontrado, apenas abrindo tela de reprodução', { replayId, detail });
      }
    } catch (err) {
      logger.error('Erro ao executar replay', err);
      setError(err.message || 'Erro ao executar replay');
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
          <h1>{isTenantMode ? '🤖 Criar Tenant por IA' : '🎯 Gerar Sistema / Fluxo / RPA / Seed'}</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          {isTenantMode 
            ? 'Crie um tenant baseado em uma empresa real. Configure todos os blocos conforme necessário para gerar o tenant e seus artefatos (fluxo, RPA, seed).'
            : 'Esta é a única tela que gera, valida, executa e decide. Nada fora dessa tela é considerado válido.'}
        </p>
        {isTenantMode && (
          <div className="bg-status-info/10 border border-status-info/30 rounded-lg p-4 mb-4">
            <p className="text-sm text-text-primary">
              <strong>💡 Modo de Geração de Tenant:</strong>
            </p>
            <ul className="mt-2 text-xs text-text-secondary list-disc list-inside space-y-1">
              <li>Preencha o nome e a descrição do tenant (empresa real)</li>
              <li>Configure as fontes de conhecimento (RAG e/ou Web Scraping) para obter informações da empresa</li>
              <li>Selecione quais artefatos deseja gerar (Fluxo, RPA, Seed)</li>
              <li>A IA irá gerar os dados do tenant e, se solicitado, os artefatos configurados</li>
              <li>O tenant será criado automaticamente após a geração</li>
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-6">

        {/* BLOCO 1 - Intenção do Usuário */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
            <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 1 — Intenção do Usuário</h2>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={bootstrap}
                  onChange={(e) => setBootstrap(e.target.checked)}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span className="font-bold">Gerar tudo do zero (Bootstrap)</span>
              </label>
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
                  checked={bootstrap ? true : includeQuestions}
                  onChange={(e) => setIncludeQuestions(e.target.checked)}
                  disabled={bootstrap}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Incluir perguntas (FAQ) no fluxo</span>
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
            </div>
          {bootstrap && (
            <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg text-status-warning">
              ⚠️ Modo Bootstrap ativo: Fluxo, RPA e Seed serão gerados automaticamente. RAG desativado. FAQ habilitado automaticamente.
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
                            : fileObj.status === 'processing'
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
                            {fileObj.status === 'processing' && (
                              <span className="text-xs text-status-warning animate-pulse">⏳ Processando...</span>
                            )}
                            {fileObj.status === 'success' && (
                              <>
                                {fileObj.isDuplicate ? (
                                  <span className="text-xs text-status-warning">⚠ Duplicado (usando existente)</span>
                                ) : (
                                  <span className="text-xs text-status-success">✓ Indexado</span>
                                )}
                              </>
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
                            {fileObj.status === 'processing' &&
                              typeof fileObj.progress === 'number' &&
                              Number.isFinite(fileObj.progress) && (
                                <> • {Math.max(0, Math.min(100, Math.round(fileObj.progress)))}%</>
                              )}
                          </p>
                          {fileObj.status === 'processing' &&
                            typeof fileObj.progress === 'number' &&
                            Number.isFinite(fileObj.progress) && (
                              <div className="mt-2 h-2 w-full bg-bg-secondary border border-border-default rounded overflow-hidden">
                                <div
                                  className="h-full bg-status-warning"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, Math.round(fileObj.progress)))}%`,
                                    transition: 'width 180ms ease-out',
                                  }}
                                />
                              </div>
                            )}
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
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            {isTenantMode ? 'Descrição do Tenant' : 'Dados Básicos'}
          </h2>
          <div className="mb-4">
            <label className="block mb-2 font-semibold text-text-primary">
              {isTenantMode ? 'Nome do Tenant' : 'Nome do Sistema/Fluxo'}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isTenantMode ? "Ex: Empresa XYZ" : "Ex: Sistema de Atendimento"}
              className="w-full"
            />
          </div>
          <div>
            <label className="block mb-2 font-semibold text-text-primary">
              {isTenantMode 
                ? (executionMode === 'real' ? 'Descrição do Tenant *' : 'Descrição do Tenant (opcional no modo dry-run)')
                : executionMode === 'real' 
                  ? 'Descrição *' 
                  : 'Descrição (opcional no modo dry-run)'}
            </label>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm text-text-secondary">Modo da sugestão:</span>
              <select
                value={descriptionMode}
                onChange={(e) => setDescriptionMode(e.target.value)}
                className="px-3 py-2 rounded-lg bg-bg-secondary border border-border-default text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              >
                <option value="institutional">Institucional (padrão)</option>
                <option value="technical">Técnico (auditoria)</option>
              </select>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isTenantMode 
                ? "Ex: Uma empresa de e-commerce que vende produtos de tecnologia e quer automatizar o atendimento ao cliente para reduzir tempo de resposta e aumentar a satisfação dos clientes."
                : executionMode === 'dry-run' && !description.trim()
                  ? "💡 No modo dry-run, a descrição é opcional. Se deixar em branco, a IA irá sugerir uma descrição baseada no nome e nas fontes de conhecimento selecionadas. Descreva o sistema, fluxo ou funcionalidade que deseja gerar..."
                  : "Descreva o sistema, fluxo ou funcionalidade que deseja gerar..."}
              rows={5}
              className="w-full"
            />
            {isTenantMode && (
              <p className="mt-2 text-xs text-text-secondary">
                💡 Seja específico! Inclua informações sobre o ramo de atividade, tipo de negócio e objetivos.
              </p>
            )}
            {executionMode === 'dry-run' && !description.trim() && (
              <p className="mt-2 text-xs text-status-info bg-status-info/10 border border-status-info/30 rounded-lg p-2">
                💡 <strong>Modo Dry-Run:</strong> A descrição é opcional. Se deixar em branco, a IA irá sugerir uma descrição automaticamente baseada no {isTenantMode ? 'nome do tenant' : 'nome do sistema'} e nas fontes de conhecimento selecionadas.
              </p>
            )}
            {executionMode === 'real' && (
              <p className="mt-2 text-xs text-text-secondary">
                ⚠️ <strong>Modo Execução Real:</strong> A descrição é obrigatória e deve ter pelo menos 10 caracteres.
              </p>
            )}
          </div>
        </div>

        {/* BLOCO 3 - Perguntas (FAQ / Aprendizado Adaptivo) */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 3 — Perguntas (FAQ / Aprendizado Adaptivo)</h2>

          {(includeQuestions || bootstrap) && (
            <div className="mt-4">
              <p className="text-sm text-text-secondary mb-3">
                Adicione perguntas que o bot deve ser capaz de responder. Elas serão incorporadas na geração do fluxo.
              </p>

              <div className="flex flex-wrap gap-2 mb-3">
                <Button
                  onClick={handleSuggestQuestionsFromDescription}
                  disabled={!name.trim() && !description.trim()}
                >
                  Sugerir
                </Button>
                <Button
                  onClick={() => {
                    setQuestionsList([]);
                    setFaqGroups(null);
                    setFaqCoverage(null);
                    setFaqExclusions(null);
                    setShowFaqExclusions(false);
                    setInitialFlow(null);
                  }}
                  disabled={questionsList.length === 0}
                >
                  Limpar lista
                </Button>
              </div>

              {(() => {
                const hasExclusions = Array.isArray(faqExclusions) && faqExclusions.length > 0;
                const count = hasExclusions ? faqExclusions.length : 0;
                return (
                  <div className="mb-3 border border-border-default rounded-lg bg-bg-secondary p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-text-primary">
                        Exclusões dinâmicas (anti-ruído)
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => (hasExclusions ? setShowFaqExclusions((v) => !v) : null)}
                          className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1 hover:bg-bg-hover"
                          title={hasExclusions
                            ? 'Termos inferidos para excluir ruído técnico das perguntas'
                            : 'Os termos serão inferidos após gerar o FAQ'}
                          disabled={!hasExclusions}
                        >
                          {count} termo(s) {showFaqExclusions && hasExclusions ? '▲' : '▼'}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-accent-primary hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={!hasExclusions}
                          onClick={async () => {
                            if (!hasExclusions) return;
                            try {
                              const txt = faqExclusions.join('\n');
                              if (navigator?.clipboard?.writeText) {
                                await navigator.clipboard.writeText(txt);
                              } else {
                                setError('Clipboard indisponível');
                              }
                            } catch {
                              setError('Falha ao copiar exclusões');
                            }
                          }}
                        >
                          Copiar
                        </button>
                      </div>
                    </div>

                    {!hasExclusions && (
                      <div className="mt-2 text-xs text-text-tertiary">
                        Ainda não há termos inferidos. Eles aparecem automaticamente quando você gerar o FAQ (via “Sugerir”).
                      </div>
                    )}

                    {showFaqExclusions && hasExclusions && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {faqExclusions.slice(0, 30).map((t) => (
                          <span key={t} className="text-xs border border-border-default rounded-full px-2 py-0.5 text-text-secondary">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              <Textarea
                value={questionsText}
                onChange={(e) => setQuestionsText(e.target.value)}
                placeholder="Digite uma pergunta por linha. Ex.:&#10;Como resetar minha senha?&#10;Quais são as formas de pagamento?"
                rows={4}
                className="w-full"
              />

              <div className="flex items-center gap-3 mt-2">
                <Button onClick={handleAddQuestionsFromText} disabled={!questionsText.trim()}>
                  Adicionar perguntas
                </Button>
                <span className="text-xs text-text-tertiary">
                  {questionsList.length} pergunta(s) na lista
                </span>
              </div>

              {questionsList.length > 0 && (
                <div className="mt-4 border border-border-default rounded-lg bg-bg-secondary p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-sm font-semibold text-text-primary">Perguntas incluídas</div>
                    {typeof faqCoverage === 'number' && (
                      <span className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1">
                        Cobertura do conhecimento: {Math.round(Math.max(0, Math.min(1, faqCoverage)) * 100)}%
                        {Number.isFinite(Number(faqCoverageMeta?.chunkTextsEffective)) ? (
                          <span className="text-text-tertiary">
                            {' '}
                            ({Number(faqCoverageMeta.chunkTextsEffective)} chunks {faqCoverageMeta?.chunkCoverageMode === 'relevant' ? 'relevantes' : 'totais'})
                          </span>
                        ) : null}
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 max-h-56 overflow-y-auto">
                    {Array.isArray(faqGroups) && faqGroups.length > 0 ? (
                      faqGroups.map((group, gIdx) => (
                        <div key={`${gIdx}-${group?.category || 'categoria'}`} className="border border-border-default/60 rounded-lg p-2">
                          <div className="text-xs font-semibold text-text-secondary">
                            {group?.category || 'Outros'}
                          </div>
                          <div className="space-y-2 mt-2">
                            {(Array.isArray(group?.questions) ? group.questions : []).map((q) => {
                              const idx = questionsList.indexOf(q);
                              return (
                                <div key={q} className="flex items-start justify-between gap-3">
                                  <div className="text-sm text-text-primary whitespace-pre-wrap">{q}</div>
                                  <button
                                    type="button"
                                    onClick={() => (idx >= 0 ? handleRemoveQuestion(idx) : null)}
                                    className="text-status-error hover:opacity-80 text-sm flex-shrink-0"
                                    title="Remover"
                                  >
                                    ✕
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      questionsList.map((q, idx) => (
                        <div key={`${idx}-${q}`} className="flex items-start justify-between gap-3">
                          <div className="text-sm text-text-primary whitespace-pre-wrap">{q}</div>
                          <button
                            type="button"
                            onClick={() => handleRemoveQuestion(idx)}
                            className="text-status-error hover:opacity-80 text-sm flex-shrink-0"
                            title="Remover"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fluxo inicial (auto) - Canvas Rete */}
        {(initialGraphLoading || initialFlow) && (
          isTenantMode ? (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-xl font-semibold text-text-primary">Fluxo inicial (auto)</h2>
                <div className="flex items-center gap-2">
                  {initialGraphLoading && (
                    <span className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1">
                      Gerando...
                    </span>
                  )}
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => {
                      if (!initialFlow) return;
                      const execId = pipelineExecutionIdRef.current || 'sem-execucao';
                      const tenantId = validatedTenantId || agent?.tenantId || 'tenant';
                      downloadJsonFile(initialFlow, `initial-flow-${tenantId}-${execId}`);
                    }}
                    disabled={!initialFlow}
                    title={!initialFlow ? 'Aguardando fluxo inicial...' : 'Baixar JSON do fluxo inicial'}
                  >
                    Exportar JSON
                  </Button>
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => setShowInitialFlowModal(true)}
                    disabled={!initialFlow}
                    title={!initialFlow ? 'Aguardando fluxo inicial...' : 'Abrir fluxo em modal'}
                  >
                    Abrir em modal
                  </Button>
                </div>
              </div>

              <p className="text-sm text-text-secondary">
                No modo tenant, o fluxo é exibido em um <strong>modal redimensionável</strong> para não ocupar a tela inteira.
              </p>

              {!initialFlow && initialGraphLoading && (
                <div className="mt-3 text-sm text-text-secondary">
                  Gerando grafo visual automaticamente a partir do FAQ...
                </div>
              )}
            </div>
          ) : (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-xl font-semibold text-text-primary">
                  Fluxo inicial (auto)
                </h2>
                <div className="flex items-center gap-2">
                  {initialGraphLoading && (
                    <span className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1">
                      Gerando...
                    </span>
                  )}
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => {
                      if (!initialFlow) return;
                      const execId = pipelineExecutionIdRef.current || 'sem-execucao';
                      const tenantId = validatedTenantId || agent?.tenantId || 'tenant';
                      downloadJsonFile(initialFlow, `initial-flow-${tenantId}-${execId}`);
                    }}
                    disabled={!initialFlow}
                    title={!initialFlow ? 'Aguardando fluxo inicial...' : 'Baixar JSON do fluxo inicial'}
                  >
                    Exportar JSON
                  </Button>
                </div>
              </div>
              {initialFlow && (
                <AutoInitialGraphCanvas flow={initialFlow} />
              )}
              {!initialFlow && initialGraphLoading && (
                <div className="text-sm text-text-secondary">
                  Gerando grafo visual automaticamente a partir do FAQ...
                </div>
              )}
            </div>
          )
        )}

        {/* BLOCO 4 - Configuração da Execução */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 4 — Configuração da Execução</h2>
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

        {/* BLOCO 5 - Validações Automáticas */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 5 — Validações Automáticas</h2>
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
              ...(isTenantMode ? [
                { key: 'providerValidated', label: 'Provider de IA validado' },
                { key: 'ragValidated', label: 'Serviço RAG validado' },
              ] : []),
              { key: 'filesInferred', label: executionMode === 'dry-run' ? 'Arquivos processados (dry-run)' : 'Arquivos inferidos e indexados' },
              ...(isTenantMode && useWebScraping ? [{ key: 'webScraping', label: 'Web scraping' }] : []),
              ...(needsDescriptionSuggestion ? [{ key: 'descriptionSuggested', label: 'Sugerir descrição' }] : []),
              ...((includeQuestions || bootstrap) ? [{ key: 'questionsGenerated', label: 'Perguntas geradas' }] : []),
              ...(isTenantMode ? [
                { key: 'faqGenerated', label: 'FAQ gerado (tenant)' },
                { key: 'initialFlowGenerated', label: 'Fluxo inicial gerado (tenant)' },
              ] : []),
              { key: 'payloadValid', label: 'Payload válido' },
              { key: 'contractValid', label: 'Contrato válido' },
              { key: 'contextBuilt', label: 'Contexto montado' },
              ...(useRag && !bootstrap ? [{ key: 'ragContextBuilt', label: 'Contexto RAG construído' }] : []),
              { key: 'flowGenerated', label: 'Fluxo gerado' },
              { key: 'seedGenerated', label: 'Seed gerado' },
              ...(isTenantMode
                ? [{ key: 'rpa', label: 'RPA' }]
                : [
                    { key: 'rpaGenerated', label: 'RPA gerado' },
                    { key: 'rpaExecuted', label: 'RPA executado' },
                  ]),
              { key: 'approved', label: 'Aprovado' },
            ].map(({ key, label }) => {
              const { detail, status } = (() => {
                if (key !== 'rpa') {
                  // Fonte única de verdade (pipeline): máquina de estados via websocket
                  if (PIPELINE_STAGE_ORDER.includes(key) || key === PipelineStage.failed) {
                    const completed = pipelineMachine.state.completedStages.has(key);
                    const failed = pipelineMachine.state.stage === PipelineStage.failed;
                    const meta = pipelineMachine.state.stageMeta?.[key] || null;
                    const failedStage = pipelineMachine.state.failedStage || null;
                    const isCurrentStage =
                      pipelineMachine.state.executionStatus === 'running' &&
                      pipelineMachine.state.currentStage === key &&
                      pipelineMachine.state.currentStageStatus === 'in_progress';
                    const isApprovedStageCompleted =
                      key === PipelineStage.approved && pipelineMachine.state.executionStatus === 'approved';

                    const keyIdx = PIPELINE_STAGE_ORDER.indexOf(key);
                    const failedIdx = failedStage ? PIPELINE_STAGE_ORDER.indexOf(failedStage) : -1;
                    const isAfterFailure =
                      failed && failedIdx >= 0 && keyIdx >= 0 && keyIdx > failedIdx;

                    // Se falhou:
                    // - Apenas a etapa que falhou fica em erro
                    // - Etapas posteriores ficam pendentes (não executadas)
                    const isFailedStage = failed && !!failedStage && key === failedStage;
                    const derivedStatusBase = completed
                      ? 'completed'
                      : isApprovedStageCompleted
                        ? 'completed'
                        : (isCurrentStage ? 'in_progress' : (
                          failed
                            ? (isFailedStage ? 'error' : (isAfterFailure ? 'pending' : 'pending'))
                            : 'pending'
                        ));

                    // Progresso de upload (filesInferred) pode acontecer *antes* do primeiro evento WS.
                    // Nesses casos, usamos o progresso local para alimentar a UI do pipeline.
                    const localDetail = pipelineDetails?.[key] || null;
                    const localInProgress = localDetail && localDetail.status === 'in_progress';
                    const allowLocalOverride =
                      (key === 'filesInferred' || key === 'initialFlowGenerated') &&
                      localInProgress &&
                      (pipelineMachine.state.executionStatus !== 'running' || !pipelineMachine.state.currentStage);

                    const derivedStatus = allowLocalOverride ? 'in_progress' : derivedStatusBase;

                    const derivedDetail = {
                      status: derivedStatus,
                      timestamp:
                        (derivedStatus === 'in_progress'
                          ? ((allowLocalOverride ? (localDetail?.timestamp || null) : null) || pipelineMachine.state.currentStageTimestamp || meta?.timestamp)
                          : meta?.timestamp) || null,
                      message:
                        (derivedStatus === 'in_progress'
                          ? ((allowLocalOverride ? (localDetail?.message || null) : null) || (isCurrentStage ? pipelineMachine.state.currentStageMessage : null) || meta?.message)
                          : ((isFailedStage && !completed ? (pipelineMachine.state.failedReason || 'Pipeline falhou') : null) || meta?.message)) || null,
                      progress:
                        completed
                          ? 100
                          : (derivedStatus === 'in_progress'
                            ? ((key === 'filesInferred' || key === 'initialFlowGenerated')
                              ? (Number.isFinite(localDetail?.progress) ? localDetail.progress : 0)
                              : 0)
                            : 0),
                    };

                    return { detail: derivedDetail, status: completed };
                  }

                  // Steps auxiliares (fora do state machine) permanecem locais por enquanto
                  return { detail: pipelineDetails[key], status: pipelineStatus[key] };
                }

                const genDetail = pipelineDetails?.rpaGenerated || null;
                const execDetail = pipelineDetails?.rpaExecuted || null;

                const genStatus = genDetail?.status;
                const execStatus = execDetail?.status;

                const rpaGeneratedDone = pipelineMachine.state.completedStages.has(PipelineStage.rpaGenerated);
                const rpaExecutedDone = pipelineMachine.state.completedStages.has(PipelineStage.rpaExecuted);
                const isCurrentRpaStage =
                  pipelineMachine.state.executionStatus === 'running' &&
                  (pipelineMachine.state.currentStage === PipelineStage.rpaGenerated || pipelineMachine.state.currentStage === PipelineStage.rpaExecuted) &&
                  pipelineMachine.state.currentStageStatus === 'in_progress';

                const failed = pipelineMachine.state.stage === PipelineStage.failed;
                const failedStage = pipelineMachine.state.failedStage || null;
                const failedAtRpa =
                  failedStage === PipelineStage.rpaGenerated || failedStage === PipelineStage.rpaExecuted;

                const derivedStatus =
                  (execStatus === 'error' || genStatus === 'error')
                    ? 'error'
                    : (failed && failedAtRpa)
                      ? 'error'
                      : (execStatus === 'in_progress' || genStatus === 'in_progress' || isCurrentRpaStage)
                      ? 'error'
                      : (execStatus === 'in_progress' || genStatus === 'in_progress' || isCurrentRpaStage)
                        ? 'in_progress'
                        : (rpaExecutedDone || rpaGeneratedDone)
                          ? 'completed'
                          : 'pending';

                const progress = Math.max(
                  typeof genDetail?.progress === 'number' ? genDetail.progress : 0,
                  typeof execDetail?.progress === 'number' ? execDetail.progress : 0
                );

                const timestamp =
                  execDetail?.timestamp ||
                  genDetail?.timestamp ||
                  pipelineMachine.state.currentStageTimestamp ||
                  pipelineMachine.state.stageMeta?.[PipelineStage.rpaExecuted]?.timestamp ||
                  pipelineMachine.state.stageMeta?.[PipelineStage.rpaGenerated]?.timestamp ||
                  null;

                const [fallbackStep, fallbackStatus] = (() => {
                  if (execStatus === 'error') return ['rpaExecuted', 'error'];
                  if (genStatus === 'error') return ['rpaGenerated', 'error'];
                  if (execStatus === 'in_progress') return ['rpaExecuted', 'in_progress'];
                  if (genStatus === 'in_progress') return ['rpaGenerated', 'in_progress'];
                  if (pipelineStatus?.rpaExecuted) return ['rpaExecuted', 'completed'];
                  if (pipelineStatus?.rpaGenerated) return ['rpaGenerated', 'completed'];
                  return [null, null];
                })();

                const message =
                  execDetail?.message ||
                  genDetail?.message ||
                  (isCurrentRpaStage ? pipelineMachine.state.currentStageMessage : null) ||
                  pipelineMachine.state.stageMeta?.[PipelineStage.rpaExecuted]?.message ||
                  pipelineMachine.state.stageMeta?.[PipelineStage.rpaGenerated]?.message ||
                  ((failed && failedAtRpa) ? (pipelineMachine.state.failedReason || 'Pipeline falhou') : null) ||
                  (fallbackStep && fallbackStatus ? getStepMessage(fallbackStep, fallbackStatus) : null);

                const derivedDetail = {
                  status: derivedStatus,
                  timestamp,
                  message,
                  progress,
                };

                const derivedCompleted = !!(rpaExecutedDone || rpaGeneratedDone);

                return { detail: derivedDetail, status: derivedCompleted };
              })();
              const isCompleted = status === true;
              const isInProgress = detail?.status === 'in_progress';
              const hasError = detail?.status === 'error';
              const isWarning = detail?.status === 'warning';
              const showProgressAfterComplete = key === 'filesInferred' && isCompleted && (detail?.progress || 0) > 0;
              const showProgress = (isInProgress && detail.progress > 0) || showProgressAfterComplete;
              
              return (
                <div
                  key={key}
                  className={`p-3 rounded-lg border ${
                    hasError
                      ? 'bg-status-error/10 border-status-error/30'
                      : isInProgress
                      ? 'bg-status-warning/10 border-status-warning/30'
                      : isWarning
                      ? 'bg-status-warning/10 border-status-warning/30'
                      : isCompleted
                      ? 'bg-status-success/10 border-status-success/30'
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
                      ) : isWarning ? (
                        <span className="text-status-warning text-lg">!</span>
                      ) : (
                        <span className="text-text-tertiary text-lg">○</span>
                      )}
                    </div>
                    
                    {/* Label e mensagem */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-text-primary">{label}</span>
                        {isTenantMode && key === 'initialFlowGenerated' && (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-xs"
                            onClick={() => ensureInitialFlowLoaded()}
                            disabled={initialGraphLoading}
                            title={
                              initialGraphLoading
                                ? 'Gerando fluxo inicial...'
                                : (initialFlow ? 'Abrir fluxo em modal' : 'Gerar/carregar fluxo inicial')
                            }
                          >
                            {initialFlow ? 'Abrir fluxo →' : 'Carregar fluxo →'}
                          </Button>
                        )}
                        {key === 'descriptionSuggested' && detail?.meta && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary border border-border-default text-text-tertiary">
                              modo: <strong className="text-text-secondary">{detail.meta.mode}</strong>
                            </span>
                            {detail.meta.fallback && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-warning/10 border border-status-warning/30 text-status-warning">
                                fallback
                              </span>
                            )}
                            {typeof detail.meta.confidence === 'number' && (
                              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                detail.meta.confidence < 0.5
                                  ? 'bg-status-warning/10 border-status-warning/30 text-status-warning'
                                  : 'bg-status-success/10 border-status-success/30 text-status-success'
                              }`}>
                                confiança: <strong>{Math.round(detail.meta.confidence * 100)}%</strong>
                              </span>
                            )}
                            {Number.isFinite(detail.meta.warningsCount) && detail.meta.warningsCount > 0 && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary border border-border-default text-text-tertiary">
                                avisos: <strong className="text-text-secondary">{detail.meta.warningsCount}</strong>
                              </span>
                            )}
                          </div>
                        )}
                        {showProgress && (
                          <span className="text-xs text-text-tertiary">({detail.progress}%)</span>
                        )}
                      </div>
                      {detail?.message && (
                        <p className={`text-xs mt-1 ${
                          hasError ? 'text-status-error' :
                          isInProgress ? 'text-status-warning' :
                          isWarning ? 'text-status-warning' :
                          isCompleted ? 'text-status-success' :
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
                    
                    {/* Barra de progresso */}
                    {showProgress && (
                      <div className="flex-shrink-0 w-24">
                        <div className="w-full bg-bg-secondary rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-300 ${
                              isInProgress ? 'bg-status-warning' : 'bg-status-success'
                            }`}
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
                <span>
                  Pipeline em execução...
                  {/* Sem fallback de polling: progresso vem apenas via WS */}
                </span>
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
              
              {/* Informações do Tenant Criado */}
              {result.tenant && (
                <div className="mt-4 p-4 bg-bg-secondary rounded-lg border border-border-default">
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>🏢</span> Tenant Criado
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-text-tertiary">Nome:</span>
                      <p className="text-text-primary font-medium">{result.tenant.name || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-text-tertiary">Tenant ID:</span>
                      <p className="text-text-primary font-mono text-xs break-all">
                        {result.tenant.id || result.tenant.tenantId || result.tenantId || 'N/A'}
                      </p>
                    </div>
                    {result.tenant.site && (
                      <div>
                        <span className="text-text-tertiary">Site:</span>
                        <p className="text-text-primary">
                          <a 
                            href={result.tenant.site} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-accent-primary hover:underline"
                          >
                            {result.tenant.site}
                          </a>
                        </p>
                      </div>
                    )}
                    {result.tenant.plan && (
                      <div>
                        <span className="text-text-tertiary">Plano:</span>
                        <p className="text-text-primary font-medium capitalize">{result.tenant.plan}</p>
                      </div>
                    )}
                    {result.tenant.active !== undefined && (
                      <div>
                        <span className="text-text-tertiary">Status:</span>
                        <p className={`font-medium ${result.tenant.active ? 'text-status-success' : 'text-status-error'}`}>
                          {result.tenant.active ? '✓ Ativo' : '✗ Inativo'}
                        </p>
                      </div>
                    )}
                  </div>
                  {result.tenant.description && (
                    <div className="mt-3">
                      <span className="text-text-tertiary text-sm">Descrição:</span>
                      <p className="text-text-primary text-sm mt-1">{result.tenant.description}</p>
                    </div>
                  )}
                  <div className="mt-4">
                    <Button
                      onClick={() => navigate('/tenants')}
                      variant="default"
                      size="sm"
                      className="text-sm"
                    >
                      📋 Ver Todos os Tenants
                    </Button>
                  </div>
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

              {/* Artefatos Gerados */}
              {(result.flowDefinition || result.rpaTest || result.seed) && (
                <div className="mt-6 p-4 bg-bg-secondary rounded-lg border border-border-default">
                  <h4 className="text-sm font-semibold text-text-primary mb-3">📦 Artefatos Gerados</h4>
                  <div className="space-y-3">
                    {result.flowDefinition && (
                      <div className="p-3 bg-bg-primary rounded border border-border-default">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h5 className="text-sm font-semibold text-text-primary mb-1">
                              🔄 Fluxo (Flow)
                            </h5>
                            <p className="text-xs text-text-secondary font-mono mb-1">
                              ID: {result.flowDefinition.id}
                            </p>
                            <p className="text-xs text-text-primary">
                              Nome: {result.flowDefinition.name || 'Sem nome'}
                            </p>
                            {result.flowDefinition.nodes && (
                              <p className="text-xs text-text-tertiary mt-1">
                                {result.flowDefinition.nodes.length} node(s)
                              </p>
                            )}
                          </div>
                          {result.flowDefinition.id && (
                            <Button
                              onClick={() => {
                                if (isTenantMode) {
                                  const flow = result.flowDefinition;
                                  setGeneratedFlowForModal(flow);
                                  // Se for super-admin, passamos tenantId via querystring para o editor,
                                  // que fará chamadas com X-Tenant-Id por requisição (sem mutar localStorage).
                                  const flowTenantId =
                                    flow?.tenantId ||
                                    result?.tenant?.id ||
                                    result?.tenantId ||
                                    null;
                                  const basePath = getBasePath() || '';
                                  const flowId = flow?.id || '';
                                  const tenantParam = flowTenantId ? `&tenantId=${encodeURIComponent(flowTenantId)}` : '';
                                  setGeneratedFlowEditorUrl(`${basePath}/editor?flowId=${encodeURIComponent(flowId)}${tenantParam}`);
                                  setShowGeneratedFlowModal(true);
                                  return;
                                }
                                navigate(`/flows/${result.flowDefinition.id}`);
                              }}
                              variant="ghost"
                              size="xs"
                              className="text-xs"
                            >
                              Ver →
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {result.rpaTest && (
                      <div className="p-3 bg-bg-primary rounded border border-border-default">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h5 className="text-sm font-semibold text-text-primary mb-1">
                              🤖 Teste RPA
                            </h5>
                            <p className="text-xs text-text-secondary font-mono mb-1">
                              ID: {result.rpaTest.id}
                            </p>
                            {result.rpaTest.steps && (
                              <p className="text-xs text-text-tertiary mt-1">
                                {result.rpaTest.steps.length} passo(s)
                              </p>
                            )}
                            {result.rpaTest.asserts && (
                              <p className="text-xs text-text-tertiary">
                                {result.rpaTest.asserts.length} assert(s)
                              </p>
                            )}
                            {result.rpaTest.filePath && (
                              <p className="text-xs text-text-tertiary font-mono mt-1 break-all">
                                📁 {result.rpaTest.filePath}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {result.seed && (
                      <div className="p-3 bg-bg-primary rounded border border-border-default">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h5 className="text-sm font-semibold text-text-primary mb-1">
                              🌱 Seed
                            </h5>
                            <p className="text-xs text-text-secondary font-mono mb-1">
                              ID: {result.seed.id || 'N/A'}
                            </p>
                            {result.seed.name && (
                              <p className="text-xs text-text-primary">
                                Nome: {result.seed.name}
                              </p>
                            )}
                            {result.seed.filePath && (
                              <p className="text-xs text-text-tertiary font-mono mt-1 break-all">
                                📁 {result.seed.filePath}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {result.dependencies && result.dependencies.length > 0 && (
                      <div className="p-3 bg-bg-primary rounded border border-border-default">
                        <h5 className="text-sm font-semibold text-text-primary mb-1">
                          🔗 Dependências
                        </h5>
                        <p className="text-xs text-text-tertiary">
                          {result.dependencies.length} dependência(s) resolvida(s)
                        </p>
                      </div>
                    )}

                    {result.validation && (
                      <div className="p-3 bg-bg-primary rounded border border-border-default">
                        <h5 className="text-sm font-semibold text-text-primary mb-2">
                          ✅ Validações
                        </h5>
                        <div className="space-y-1 text-xs">
                          {result.validation.flow && (
                            <p className={`${result.validation.flow.valid ? 'text-status-success' : 'text-status-error'}`}>
                              {result.validation.flow.valid ? '✓' : '✗'} Fluxo: {result.validation.flow.valid ? 'Válido' : 'Inválido'}
                            </p>
                          )}
                          {result.validation.contract && (
                            <p className={`${result.validation.contract.valid ? 'text-status-success' : 'text-status-error'}`}>
                              {result.validation.contract.valid ? '✓' : '✗'} Contrato: {result.validation.contract.valid ? 'Válido' : 'Inválido'}
                            </p>
                          )}
                          {result.validation.bootstrap !== null && (
                            <p className={`${result.validation.bootstrap ? 'text-status-success' : 'text-status-error'}`}>
                              {result.validation.bootstrap ? '✓' : '✗'} Bootstrap: {result.validation.bootstrap ? 'Aprovado' : 'Reprovado'}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
                    selectedFileDetails.status === 'processing' ? 'text-status-warning' :
                    'text-text-secondary'
                  }`}>
                    {selectedFileDetails.status === 'success' ? '✓ Indexado' :
                     selectedFileDetails.status === 'error' ? '✗ Erro' :
                     selectedFileDetails.status === 'processing' ? '⏳ Processando...' :
                     '⏸ Pendente'}
                  </p>
                </div>
                {selectedFileDetails.documentId && (
                  <div className="col-span-2">
                    <span className="text-text-tertiary">ID do Documento RAG:</span>
                    <p className="text-text-primary font-mono text-xs break-all">{selectedFileDetails.documentId}</p>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                        onClick={() => downloadRagOriginalFile(
                          selectedFileDetails.documentId,
                          selectedFileDetails.name,
                          'open'
                        )}
                        title="Abrir o arquivo original salvo no RAG em nova aba"
                      >
                        🔎 Abrir original (RAG)
                      </button>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                        onClick={() => downloadRagOriginalFile(
                          selectedFileDetails.documentId,
                          selectedFileDetails.name,
                          'download'
                        )}
                        title="Baixar o arquivo original salvo no RAG"
                      >
                        ⬇️ Baixar original (RAG)
                      </button>
                    </div>
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

      {/* Modal do Fluxo Inicial (modo tenant) */}
      {isTenantMode && initialFlow && (
        <Dialog
          isOpen={showInitialFlowModal}
          onClose={() => {
            setShowInitialFlowModal(false);
            setInitialFlowModalSize({ width: null, height: null });
            setIsInitialFlowFullscreen(false);
            setIsInitialFlowMinimized(false);
            setShowInitialFlowObjectiveEditor(false);
            setInitialFlowObjectiveDraft('');
          }}
          title={<span>Fluxo inicial (auto)</span>}
          headerActions={
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowInitialFlowObjectiveEditor((v) => !v);
                }}
                className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                title={showInitialFlowObjectiveEditor ? 'Fechar objetivo' : 'Ver/editar objetivo do fluxo'}
                disabled={isInitialFlowMinimized}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4h10M11 8h10M4 12h17M4 16h17M4 20h17" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Minimizar sempre sai do fullscreen
                  if (!isInitialFlowMinimized && isInitialFlowFullscreen) setIsInitialFlowFullscreen(false);
                  setIsInitialFlowMinimized((v) => !v);
                }}
                className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                title={isInitialFlowMinimized ? 'Restaurar' : 'Minimizar'}
              >
                {isInitialFlowMinimized ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14h16M4 10h16" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18h12" />
                  </svg>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Fullscreen sempre des-minimiza
                  if (!isInitialFlowFullscreen && isInitialFlowMinimized) setIsInitialFlowMinimized(false);
                  setIsInitialFlowFullscreen(!isInitialFlowFullscreen);
                }}
                className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                title={isInitialFlowFullscreen ? 'Sair da tela cheia (F11)' : 'Tela cheia (F11)'}
                disabled={isInitialFlowMinimized}
              >
                {isInitialFlowFullscreen ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                )}
              </button>
            </div>
          }
          size={isInitialFlowFullscreen ? "full" : "xl"}
          draggable={!isInitialFlowFullscreen}
          resizable={!isInitialFlowFullscreen && !isInitialFlowMinimized}
          dynamicSize={
            isInitialFlowMinimized
              ? { width: 420, isCollapsed: true }
              : (isInitialFlowFullscreen ? { width: window.innerWidth - 32, isCollapsed: false } : null)
          }
          onSizeChange={(size) => setInitialFlowModalSize(size)}
        >
          {(() => {
            const rawFlowId = initialFlow?.id || null;
            const isDryRunId = rawFlowId && String(rawFlowId).includes('dry-run');
            const flowId = rawFlowId && !isDryRunId ? rawFlowId : null;
            const basePath = getBasePath() || '';
            const contentHeight = isInitialFlowFullscreen
              ? 'calc(100vh - 6rem)'
              : (initialFlowModalSize?.height ? Math.max(260, initialFlowModalSize.height - 140) : 600);
            const targetTenantId =
              initialFlow?.tenantId ||
              extractTenantFromInitialFlowId(rawFlowId) ||
              result?.tenant?.id ||
              result?.tenantId ||
              null;
            // Em modo tenant, para super-admin, passamos tenantId via querystring para o editor,
            // que fará chamadas com X-Tenant-Id por requisição (sem mutar localStorage/token).
            const tenantParam =
              agent?.role === 'super_admin' && targetTenantId
                ? `&tenantId=${encodeURIComponent(targetTenantId)}`
                : '';
            const editorUrl = flowId ? `${basePath}/editor?flowId=${encodeURIComponent(flowId)}${tenantParam}` : '';

            const warnings = initialFlow?.validationWarnings || null;
            const warningCount = Array.isArray(warnings?.errors) ? warnings.errors.length : 0;
            const hasWarnings = warnings && warnings.valid === false && warningCount > 0;

            const Badges = () => (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-info/10 border border-status-info/30 text-status-info">
                  IA
                </span>
                {isDryRunId && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-warning/10 border border-status-warning/30 text-status-warning">
                    dry-run
                  </span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary border border-border-default text-text-tertiary">
                  nós: <strong className="text-text-secondary">{Array.isArray(initialFlow?.nodes) ? initialFlow.nodes.length : 0}</strong>
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary border border-border-default text-text-tertiary">
                  arestas: <strong className="text-text-secondary">{Array.isArray(initialFlow?.edges) ? initialFlow.edges.length : 0}</strong>
                </span>
                {hasWarnings && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-warning/10 border border-status-warning/30 text-status-warning">
                    avisos: <strong>{warningCount}</strong>
                  </span>
                )}
              </div>
            );

            const ObjectiveEditor = () => (
              <div className="rounded-lg border border-border-default bg-bg-secondary p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
                    Objetivo do fluxo (o que ele vai atender)
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={async () => {
                        try {
                          const txt = String(initialFlowObjectiveDraft || '').trim();
                          if (!txt) return;
                          if (navigator?.clipboard?.writeText) {
                            await navigator.clipboard.writeText(txt);
                          }
                        } catch {
                          // best-effort
                        }
                      }}
                      disabled={!String(initialFlowObjectiveDraft || '').trim()}
                      title="Copiar objetivo"
                    >
                      Copiar
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowInitialFlowObjectiveEditor(false)}
                      title="Fechar"
                    >
                      Fechar
                    </Button>
                  </div>
                </div>
                <textarea
                  value={initialFlowObjectiveDraft}
                  onChange={(e) => setInitialFlowObjectiveDraft(e.target.value)}
                  placeholder="Descreva o objetivo/escopo do atendimento deste fluxo..."
                  className="w-full p-3 border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
                  rows={5}
                />
                <div className="text-xs text-text-tertiary">
                  Dica: escreva em 2–5 frases (serviços atendidos, público-alvo, regras e o que não deve atender).
                </div>
              </div>
            );

            const ValidationWarnings = () => (
              hasWarnings ? (
                <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
                  <strong>Avisos de validação:</strong> {warningCount} item(ns).
                </div>
              ) : null
            );

            const StatusRow = () => {
              if (flowId) {
                return (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-bg-secondary px-3 py-2">
                    <div className="text-sm text-text-secondary">
                      Fluxo persistido. Abrindo editor embutido no modal.
                    </div>
                    {editorUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => {
                          try {
                            window.open(editorUrl, '_blank', 'noopener,noreferrer');
                          } catch {
                            // best-effort
                          }
                        }}
                        title="Abrir o editor em uma nova aba"
                      >
                        Abrir em nova aba
                      </Button>
                    ) : null}
                  </div>
                );
              }

              return (
                <div className="flex items-center justify-between gap-3 bg-status-warning/10 border border-status-warning/30 rounded-lg p-3 text-sm">
                  <div className="text-text-secondary">
                    Este fluxo inicial não está persistido (normal em <strong>dry-run</strong>). Para abrir no editor completo, é preciso <strong>persistir</strong> o fluxo.
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    type="button"
                    disabled={isPersistingInitialFlow}
                    onClick={async () => {
                      if (isPersistingInitialFlow) return;
                      setIsPersistingInitialFlow(true);
                      try {
                        const safeName = initialFlow?.name || 'Fluxo inicial (auto)';
                        // Importante: não envia id \"fake\" (dry-run). Deixa o backend gerar um id real.
                        const { id: _ignoredId, ...payload } = (initialFlow || {});
                        const saved = await createFlow({ ...payload, name: safeName });
                        if (saved && typeof saved === 'object') {
                          setInitialFlow(saved);
                        } else {
                          throw new Error('Resposta inválida ao persistir fluxo');
                        }
                      } catch (e) {
                        const msg = e?.body?.message || e?.message || 'Falha ao persistir fluxo para abrir no editor.';
                        setError(msg);
                      } finally {
                        setIsPersistingInitialFlow(false);
                      }
                    }}
                    title="Persistir o fluxo e abrir no editor"
                  >
                    {isPersistingInitialFlow ? 'Persistindo...' : 'Persistir e abrir'}
                  </Button>
                </div>
              );
            };

            return (
              <div className="space-y-3">
                <Badges />
                {showInitialFlowObjectiveEditor && <ObjectiveEditor />}
                <ValidationWarnings />
                <StatusRow />
                <div
                  className="w-full overflow-hidden rounded-lg border border-border-default bg-bg-primary"
                  style={{ height: contentHeight }}
                >
                  {flowId ? (
                    <iframe
                      title="Editor de Fluxos"
                      src={editorUrl}
                      className="w-full h-full"
                      style={{ border: 0 }}
                    />
                  ) : (
                    <AutoInitialGraphCanvas
                      flow={initialFlow}
                      height="100%"
                    />
                  )}
                </div>
              </div>
            );
          })()}
        </Dialog>
      )}

      {/* Modal do Fluxo Gerado (artefato) - modo tenant */}
      {isTenantMode && generatedFlowForModal && (
        <Dialog
          isOpen={showGeneratedFlowModal}
          onClose={() => {
            setShowGeneratedFlowModal(false);
            setGeneratedFlowModalSize({ width: null, height: null });
            setGeneratedFlowEditorUrl('');
            setIsGeneratedFlowFullscreen(false);
          }}
          title={<span>Fluxo gerado (artefato)</span>}
          headerActions={
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsGeneratedFlowFullscreen(!isGeneratedFlowFullscreen);
              }}
              className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              title={isGeneratedFlowFullscreen ? 'Sair da tela cheia (F11)' : 'Tela cheia (F11)'}
            >
              {isGeneratedFlowFullscreen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          }
          size={isGeneratedFlowFullscreen ? "full" : "xl"}
          draggable={!isGeneratedFlowFullscreen}
          resizable={!isGeneratedFlowFullscreen}
          dynamicSize={isGeneratedFlowFullscreen ? { width: window.innerWidth - 32, isCollapsed: false } : null}
          onSizeChange={(size) => setGeneratedFlowModalSize(size)}
        >
          <div
            className="w-full overflow-hidden rounded-lg border border-border-default bg-bg-primary"
            style={{
              height: isGeneratedFlowFullscreen
                ? 'calc(100vh - 6rem)'
                : (generatedFlowModalSize?.height ? Math.max(260, generatedFlowModalSize.height - 140) : 600),
            }}
          >
            {/* Abre o editor completo (/editor) dentro do modal */}
            {(() => {
              return (
                <iframe
                  title="Editor de Fluxos"
                  src={generatedFlowEditorUrl}
                  className="w-full h-full"
                  style={{ border: 0 }}
                />
              );
            })()}
          </div>
        </Dialog>
      )}

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
                    const actionsCount = replayData.actions?.length || 0;
                    const screensCount = replayData.screens?.length || 0;
                    const totalSteps = getReplaySteps().length;
                    
                    return (
                      <>
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
                        
                        {/* Informações sobre passos e artefatos */}
                        <div className="bg-bg-secondary rounded-lg p-3 mb-4 border border-border-default">
                          <h4 className="text-xs font-semibold text-text-primary mb-2">📊 Estatísticas do Replay</h4>
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            <div>
                              <span className="text-text-tertiary block">Ações:</span>
                              <p className="text-text-primary font-semibold">{actionsCount}</p>
                            </div>
                            <div>
                              <span className="text-text-tertiary block">Screenshots:</span>
                              <p className="text-text-primary font-semibold">{screensCount}</p>
                            </div>
                            <div>
                              <span className="text-text-tertiary block">Passos:</span>
                              <p className="text-text-primary font-semibold">{totalSteps}</p>
                            </div>
                          </div>
                          {replayData.errors && replayData.errors.length > 0 && (
                            <div className="mt-2">
                              <span className="text-text-tertiary text-xs">Erros:</span>
                              <p className="text-status-error font-semibold text-xs">{replayData.errors.length}</p>
                            </div>
                          )}
                        </div>
                      </>
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
                              <p 
                                className="text-text-primary font-mono text-xs cursor-pointer hover:text-primary-default hover:underline transition-colors"
                                onClick={() => handleReplayClick(detail.replayId, detail)}
                                title="Clique para executar o replay"
                              >
                                {detail.replayId}
                              </p>
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

