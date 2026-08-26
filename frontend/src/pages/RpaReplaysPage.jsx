import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Dialog } from '../components/Dialog';
import { listRpaReplays, getRpaReplay, deleteRpaReplay, deleteAllRpaReplays, listRpaRecordings, listRpaExecutionArtifacts, downloadRpaExecutionArtifact, getRpaExecutionArtifactJson } from '../api/flows';
import logger from '../utils/logger';
import { ReplayPlayer, normalizeReplaySteps, normalizeTypedEntries, normalizeReplayEvidence } from '../components/replay';

const STRICT_REASON_LABELS = {
  page_null_blocking_journey: 'Page nula em jornada blocking',
  browser_launch_failed: 'Falha ao iniciar browser real',
  initial_navigation_failed: 'Falha na navegação inicial',
  blocking_step_missing_evidence: 'Step sem evidência obrigatória',
  network_events_missing: 'Sem eventos de rede para o step',
  mutation_linkage_missing: 'Sem vínculo de mutação operacional',
  screenshot_before_capture_failed: 'Falha no screenshot before',
  screenshot_after_capture_failed: 'Falha no screenshot after',
  dom_snapshot_capture_failed: 'Falha no snapshot de DOM',
  step_execution_failed: 'Falha de execução do step',
  support_required_selector_missing: 'Selector obrigatório ausente (support)',
  fitness_required_selector_missing: 'Selector obrigatório ausente (fitness)',
};

function formatStrictReason(reason, metadata = null) {
  const key = String(reason || '').trim();
  if (!key) return 'unknown_strict_reason';
  const label = STRICT_REASON_LABELS[key] || key.replace(/_/g, ' ');
  if (!metadata || typeof metadata !== 'object') return label;
  const selector = metadata.selector ? ` · selector:${metadata.selector}` : '';
  const field = metadata.field ? ` · field:${metadata.field}` : '';
  return `${label}${selector}${field}`;
}

/**
 * Página para listar e visualizar todos os arquivos de replay RPA.
 */
export function RpaReplaysPage() {
  const DEFAULT_PAGE_SIZE = 50;
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [replays, setReplays] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, limit: DEFAULT_PAGE_SIZE, offset: 0, hasMore: false });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [selectedReplay, setSelectedReplay] = useState(null);
  const [replayData, setReplayData] = useState(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [showReplayModal, setShowReplayModal] = useState(false);
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [recordingData, setRecordingData] = useState(null);
  const [loadingRecording, setLoadingRecording] = useState(false);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState(null);
  const [screenshotLabel, setScreenshotLabel] = useState('');
  const [replayStepByStep, setReplayStepByStep] = useState(false);
  const [currentReplayStep, setCurrentReplayStep] = useState(0);
  const [focusStepAt, setFocusStepAt] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOnlyFailures, setShowOnlyFailures] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1000); // ms entre passos (1000ms = 1 segundo)
  const [deletingReplay, setDeletingReplay] = useState(null);
  const [deletingAllReplays, setDeletingAllReplays] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [actionsLogCollapsed, setActionsLogCollapsed] = useState(false);
  const [actionsLogWidth, setActionsLogWidth] = useState(() => {
    const saved = localStorage.getItem('replayActionsLogWidth');
    return saved ? parseInt(saved, 10) : 400;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [replayInfoCollapsed, setReplayInfoCollapsed] = useState(true);
  const [replayRoteiro, setReplayRoteiro] = useState(null);
  const [replayRoteiroLoading, setReplayRoteiroLoading] = useState(false);
  const [replayRoteiroCollapsed, setReplayRoteiroCollapsed] = useState(true);
  const [replayEvidenceTab, setReplayEvidenceTab] = useState('states');
  const [trainingMode, setTrainingMode] = useState(false);
  
  // Filtros
  const [searchText, setSearchText] = useState('');
  const [filterResult, setFilterResult] = useState('all'); // 'all', 'success', 'failed'
  const [filterDateRange, setFilterDateRange] = useState('all'); // 'all', 'today', 'week', 'month'
  const [filterSource, setFilterSource] = useState('');
  const [filterWaveId, setFilterWaveId] = useState('');
  const [filterJourneyId, setFilterJourneyId] = useState('');
  const [filterScenarioId, setFilterScenarioId] = useState('');
  const [filterSeedId, setFilterSeedId] = useState('');
  const [filterExecutionId, setFilterExecutionId] = useState('');
  const [sortBy, setSortBy] = useState('date'); // 'date', 'name', 'size', 'duration'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  const [displayMode, setDisplayMode] = useState(() => localStorage.getItem('rpaReplaysDisplayMode') || 'card');
  const [replayKind, setReplayKind] = useState('ui'); // 'ui' (RPA/UI) | 'api' (QA Mesh resumo)
  const [selectedFilenames, setSelectedFilenames] = useState([]);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);

  // Salva largura do painel de log
  useEffect(() => {
    localStorage.setItem('replayActionsLogWidth', actionsLogWidth.toString());
  }, [actionsLogWidth]);

  useEffect(() => {
    localStorage.setItem('rpaReplaysDisplayMode', displayMode);
  }, [displayMode]);

  // Atalho de teclado para tela cheia (F11)
  useEffect(() => {
    if (!showReplayModal) return;

    const handleKeyDown = (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        setIsFullscreen(!isFullscreen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showReplayModal, isFullscreen]);

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      console.log('🔐 [RpaReplaysPage] Not authenticated, redirecting to login');
      navigate('/login');
    } else if (!authLoading && isAuthenticated) {
      // Log authentication state for debugging
      const token = localStorage.getItem('auth_token');
      console.log('✅ [RpaReplaysPage] Authenticated. Token:', token ? 'YES (length: ' + token.length + ')' : 'NO');
      if (!token) {
        console.warn('⚠️  [RpaReplaysPage] isAuthenticated is true but no token in localStorage!');
      }
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, filterResult, filterDateRange, filterSource, filterWaveId, filterJourneyId, filterScenarioId, filterSeedId, filterExecutionId, sortBy, sortOrder, pageSize]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search || '');
    const search = params.get('search');
    const result = params.get('result');
    const dateRange = params.get('dateRange');
    const source = params.get('source');
    const waveId = params.get('waveId');
    const journeyId = params.get('journeyId');
    const scenarioId = params.get('scenarioId');
    const seedId = params.get('seedId');
    const executionId = params.get('executionId');

    if (search) setSearchText(search);
    if (result) setFilterResult(result);
    if (dateRange) setFilterDateRange(dateRange);
    if (source) setFilterSource(source);
    if (waveId) setFilterWaveId(waveId);
    if (journeyId) setFilterJourneyId(journeyId);
    if (scenarioId) setFilterScenarioId(scenarioId);
    if (seedId) setFilterSeedId(seedId);
    if (executionId) setFilterExecutionId(executionId);
  }, []);

  // Carrega lista de replays
  useEffect(() => {
    loadReplays();
  }, [currentPage, pageSize, searchText, filterResult, filterDateRange, filterSource, filterWaveId, filterJourneyId, filterScenarioId, filterSeedId, filterExecutionId, sortBy, sortOrder, replayKind]);

  const loadReplays = async (options = {}) => {
    const requestedPage = options.page || currentPage;
    const requestedPageSize = options.pageSize || pageSize;
    const offset = (requestedPage - 1) * requestedPageSize;

    setLoading(true);
    try {
      // DEBUG: Log para verificar token antes de fazer requisição
      const tokenExists = localStorage.getItem('auth_token');
      if (!tokenExists) {
        console.warn('⚠️  [RpaReplaysPage] Token não encontrado no localStorage!');
        logger.warn('RPA Replays: Token not found in localStorage');
      } else {
        console.log('✅ [RpaReplaysPage] Token present:', tokenExists.substring(0, 30) + '...');
      }

      const result = await listRpaReplays({
        limit: requestedPageSize,
        offset,
        search: searchText.trim(),
        result: filterResult,
        dateRange: filterDateRange,
        source: filterSource,
        waveId: filterWaveId.trim(),
        journeyId: filterJourneyId.trim(),
        scenarioId: filterScenarioId.trim(),
        seedId: filterSeedId.trim(),
        executionId: filterExecutionId.trim(),
        kind: replayKind,
        sortBy,
        sortOrder,
      });

      console.log('✅ [RpaReplaysPage] API returned replays:', result.files?.length || 0);
      
      setReplays(result.files || []);

      const nextPagination = result.pagination || {
        total: result.files?.length || 0,
        limit: requestedPageSize,
        offset,
        hasMore: false,
      };
      setPagination(nextPagination);

      const totalPages = Math.max(1, Math.ceil((nextPagination.total || 0) / (nextPagination.limit || requestedPageSize || 1)));
      if (requestedPage > totalPages) {
        setCurrentPage(totalPages);
      }
    } catch (err) {
      // Enhanced error logging with details
      const errorDetails = {
        message: err?.message,
        status: err?.status,
        statusText: err?.statusText,
        response: err?.response?.substring?.(0, 200),
        stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
      };

      console.error('❌ [RpaReplaysPage] Error loading replays:', errorDetails);
      logger.error('Erro ao carregar replays RPA', errorDetails);

      // Determine error type and show appropriate message
      let errorMessage = 'Erro ao carregar lista de replays';
      
      if (err?.status === 401 || err?.message?.includes('401')) {
        errorMessage = '🔐 Autenticação expirada - faça login novamente';
        console.error('❌ [RpaReplaysPage] 401 Unauthorized - Token may be invalid or expired');
        // Could redirect to login or request re-auth here
      } else if (err?.message?.includes('Network') || err?.message?.includes('fetch')) {
        errorMessage = '⚠️  Erro de rede ao carregar replays';
        console.error('❌ [RpaReplaysPage] Network error:', err.message);
      } else if (err?.message?.includes('JSON')) {
        errorMessage = '⚠️  Resposta inválida do servidor';
        console.error('❌ [RpaReplaysPage] JSON parse error:', err.message);
      }

      showToast(errorMessage, 'error', 5000);
    } finally {
      setLoading(false);
    }
  };

  // --- Artefatos persistidos no banco (roteiro + trace visual + replay) ---
  const [executionArtifacts, setExecutionArtifacts] = useState([]);
  const [loadingExecutionArtifacts, setLoadingExecutionArtifacts] = useState(false);
  const [showExecutionArtifacts, setShowExecutionArtifacts] = useState(false);

  const loadExecutionArtifacts = async () => {
    setLoadingExecutionArtifacts(true);
    try {
      const result = await listRpaExecutionArtifacts();
      setExecutionArtifacts(result.items || []);
    } catch (err) {
      logger.warn('[RpaReplaysPage] Erro ao carregar execuções RPA persistidas:', err);
    } finally {
      setLoadingExecutionArtifacts(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) loadExecutionArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const downloadArtifact = async (executionId, kind, index = null) => {
    try {
      const { blob, filename } = await downloadRpaExecutionArtifact(executionId, kind, index);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('[RpaReplaysPage] Erro ao baixar artefato:', err);
      showToast(`Erro ao baixar ${kind}`, 'error', 5000);
    }
  };

  // --- Visualização inline de artefatos persistidos no banco ---

  const deriveRecordingObjective = (recording) => {
    if (!recording) return '';
    const steps = Array.isArray(recording.steps) ? recording.steps : [];
    if (!steps.length) return '';
    const targetUrl = steps.find((s) => s.type === 'navigate')?.url || '';
    const typeCounts = {};
    steps.forEach((s) => {
      const t = String(s.type || 'action').toLowerCase();
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const typeSummary = Object.entries(typeCounts)
      .map(([t, n]) => (n > 1 ? `${t} ×${n}` : t))
      .join(', ');
    const checks = steps
      .map((s) => {
        if (s.type === 'assert' || s.action === 'assert') {
          return s.textContains || s.text || s.expected || s.value;
        }
        return null;
      })
      .filter(Boolean)
      .map((v) => `"${v}"`);
    const checkSummary = checks.length ? ` — verifica ${checks.join(', ')}` : '';
    return `Executar ${steps.length} passos de UI (${typeSummary})${targetUrl ? ` contra ${targetUrl}` : ''}${checkSummary}.`;
  };

  const formatRecordingText = (recording) => {
    if (!recording) return '';
    const lines = [];
    const name = recording.name || recording.id || '(sem nome)';
    const journey = recording.metadata?.journey || recording.data?.journey || '';
    const vertical = recording.metadata?.vertical || recording.data?.vertical || '';
    const version = recording.version || '';
    lines.push(`Roteiro: ${name}`);
    if (recording.id) lines.push(`Recording ID: ${recording.id}`);
    if (journey) lines.push(`Jornada: ${journey}`);
    if (vertical) lines.push(`Vertical: ${vertical}`);
    if (version) lines.push(`Versão: ${version}`);
    const objective = recording.metadata?.purpose || recording.description || deriveRecordingObjective(recording);
    if (objective) {
      lines.push('');
      lines.push('Objetivo:');
      lines.push(objective);
    }
    const steps = Array.isArray(recording.steps) ? recording.steps : [];
    if (steps.length) {
      lines.push('');
      lines.push(`Passos (${steps.length}):`);
      steps.forEach((step, i) => {
        const type = String(step.type || step.actionType || 'action').toUpperCase();
        const label = step.name || step.description || '(sem nome)';
        const target = step.selector || step.url || '';
        const value = step.value != null && step.value !== ''
          ? `  [valor: ${typeof step.value === 'string' ? step.value : JSON.stringify(step.value)}]`
          : '';
        const critical = step.critical ? '  [crítico]' : '';
        const assertion = [];
        if (step.textContains !== undefined && step.textContains !== null) assertion.push(`contém "${step.textContains}"`);
        if (step.text !== undefined && step.text !== null) assertion.push(`texto "${step.text}"`);
        if (step.exists !== undefined && step.exists !== null) assertion.push(`existe=${step.exists}`);
        if (step.visible !== undefined && step.visible !== null) assertion.push(`visível=${step.visible}`);
        if (step.count !== undefined && step.count !== null) assertion.push(`contagem=${step.count}`);
        const assertionText = assertion.length ? `  [${assertion.join('; ')}]` : '';
        lines.push(`${String(i + 1).padStart(2, '0')}. ${type} — ${label}${target ? ` → ${target}` : ''}${value}${assertionText}${critical}`);
      });
    }
    return lines.join('\n');
  };

  // Carrega o roteiro (gravação de origem) associado a um replay para exibição
  // inline no modal do replay — não em seção separada.
  const loadReplayRoteiro = async (recordingId) => {
    setReplayRoteiro(null);
    setReplayRoteiroLoading(true);
    try {
      if (!recordingId) return;
      const { recordings } = await listRpaRecordings();
      const list = Array.isArray(recordings) ? recordings : [];
      const match = list.find((r) => r.id === recordingId || r.fileNameId === recordingId);
      if (match?.recording) {
        setReplayRoteiro(match.recording);
      }
    } catch (err) {
      logger.warn('[RpaReplaysPage] Erro ao carregar roteiro do replay:', err);
    } finally {
      setReplayRoteiroLoading(false);
    }
  };

  const handleViewRecording = async (executionId) => {
    setShowRecordingModal(true);
    setRecordingData(null);
    setLoadingRecording(true);
    try {
      const data = await getRpaExecutionArtifactJson(executionId, 'recording');
      setRecordingData(data);
    } catch (err) {
      logger.error('[RpaReplaysPage] Erro ao carregar roteiro da execução:', err);
      showToast('Erro ao carregar roteiro da execução', 'error', 4000);
    } finally {
      setLoadingRecording(false);
    }
  };

  const handleViewExecutionReplay = async (executionId, recordingId) => {
    setSelectedReplay(recordingId || executionId);
    setShowReplayModal(true);
    setLoadingReplay(true);
    setReplayData(null);
    setReplayRoteiro(null);
    setReplayRoteiroCollapsed(true);
    setReplayStepByStep(false);
    setCurrentReplayStep(0);
    setIsPlaying(false);
    setShowOnlyFailures(false);
    setIsFullscreen(false);
    setReplayEvidenceTab('states');
    try {
      const data = await getRpaExecutionArtifactJson(executionId, 'replay');
      const resolved = await unifyExecutionReplay(data, executionId);
      setReplayData(resolved);
      loadReplayRoteiro(resolved?.recordingId || recordingId);
    } catch (err) {
      logger.error('[RpaReplaysPage] Erro ao carregar replay da execução:', err);
      showToast('Erro ao carregar replay da execução', 'error', 4000);
    } finally {
      setLoadingReplay(false);
    }
  };

  const handleViewScreenshot = async (executionId, index) => {
    try {
      const { blob } = await downloadRpaExecutionArtifact(executionId, 'screenshot', index);
      const url = URL.createObjectURL(blob);
      setScreenshotUrl(url);
      setScreenshotLabel(`${executionId} — ${Number(index) + 1}`);
      setShowScreenshotModal(true);
    } catch (err) {
      logger.error('[RpaReplaysPage] Erro ao carregar screenshot:', err);
      showToast('Erro ao carregar screenshot', 'error', 4000);
    }
  };

  /**
   * Unifica o replay persistido no banco para o padrão único de exibição:
   * - as telas (screenshots) viram itens próprios na lista de passos (modelo .json);
   * - os passos mantêm a tela no display (screenshotBefore/After resolvido para
   *   objectURL), para não remover a imagem do passo;
   * - cada tela recebe um timestamp único para a sincronização log↔player não
   *   confundir a tela com o passo pai.
   */
  const unifyExecutionReplay = async (data, executionId) => {
    const shots = Array.isArray(data?.screenshots) ? data.screenshots : [];
    const steps = Array.isArray(data?.steps) ? data.steps : [];
    if (!shots.length || !steps.length) return data;

    const pathToIndex = new Map();
    shots.forEach((p, i) => { if (typeof p === 'string') pathToIndex.set(p, i); });

    // Associa cada screenshot (before/after) ao seu passo pai (nome + timestamp).
    const metaForIndex = new Map();
    for (const step of steps) {
      for (const key of ['screenshotBefore', 'screenshotAfter']) {
        const v = step?.[key];
        if (typeof v === 'string' && pathToIndex.has(v) && !metaForIndex.has(pathToIndex.get(v))) {
          metaForIndex.set(pathToIndex.get(v), {
            stepName: step.name || step.action || null,
            timestamp: step.timestamp || step.startedAt || null,
            kind: key === 'screenshotBefore' ? 'Antes' : 'Depois',
          });
        }
      }
    }
    if (!metaForIndex.size) return data;

    const urlByIndex = new Map();
    await Promise.all(Array.from(metaForIndex.keys()).map(async (idx) => {
      try {
        const { blob } = await downloadRpaExecutionArtifact(executionId, 'screenshot', idx);
        urlByIndex.set(idx, URL.createObjectURL(blob));
      } catch (_) {
        // screenshot indisponível: mantém null (placeholder sem imagem)
      }
    }));
    if (!urlByIndex.size) return data;

    const resolve = (v) => {
      if (typeof v !== 'string') return v;
      if (pathToIndex.has(v)) return urlByIndex.get(pathToIndex.get(v)) || null;
      return v;
    };

    // Passos mantêm a tela no display (screenshotBefore/After → objectURL).
    const mappedSteps = steps.map((step) => (step && typeof step === 'object'
      ? { ...step, screenshotBefore: resolve(step.screenshotBefore), screenshotAfter: resolve(step.screenshotAfter) }
      : step));

    // Telas (screens) com timestamp único: deslocado do passo pai para nunca
    // colidir na busca por timestamp do player.
    const screens = [];
    let screenCounter = 0;
    for (const [idx, meta] of metaForIndex.entries()) {
      const url = urlByIndex.get(idx);
      if (!url) continue;
      const baseMs = meta.timestamp ? new Date(meta.timestamp).getTime() : Date.now();
      const at = new Date(baseMs + screenCounter + 1).toISOString();
      screenCounter += 1;
      screens.push({
        screenId: `screen-${idx + 1}`,
        step: `${meta.kind}: ${meta.stepName || 'passo'}`,
        timestamp: at,
        screenshot: url,
      });
    }

    return { ...data, steps: mappedSteps, screens };
  };

  const handleViewReplay = async (filename) => {
    setSelectedReplay(filename);
    setShowReplayModal(true);
    setLoadingReplay(true);
    setReplayData(null);
    setReplayRoteiro(null);
    setReplayRoteiroCollapsed(true);
    setReplayStepByStep(false);
    setCurrentReplayStep(0);
    setIsPlaying(false);
    setShowOnlyFailures(false);
    setIsFullscreen(false);
    setReplayEvidenceTab('states');

    try {
      console.log('📂 [RpaReplaysPage] Loading replay:', filename);
      const data = await getRpaReplay(filename);
      console.log('✅ [RpaReplaysPage] Replay loaded successfully:', { 
        filename, 
        hasActions: !!data?.actions, 
        hasScreens: !!data?.screens 
      });
      setReplayData(data);
      loadReplayRoteiro(data?.recordingId || data?.id);
    } catch (err) {
      const errorDetails = {
        filename,
        message: err?.message,
        status: err?.status,
        response: err?.response?.substring?.(0, 200),
      };

      console.error('❌ [RpaReplaysPage] Error loading replay:', errorDetails);
      logger.error('Erro ao carregar replay individual', errorDetails);

      let errorMessage = 'Erro ao carregar replay';
      if (err?.status === 401 || err?.message?.includes('401')) {
        errorMessage = '🔐 Sessão expirada - faça login novamente';
      } else if (err?.message?.includes('404') || err?.message?.includes('not found')) {
        errorMessage = '📁 Arquivo de replay não encontrado';
      } else if (err?.message?.includes('Network')) {
        errorMessage = '⚠️  Erro de rede ao carregar replay';
      }

      showToast(errorMessage, 'error', 4000);
    } finally {
      setLoadingReplay(false);
    }
  };

  // Funções para navegação step-by-step do replay
  const getReplaySteps = () => {
    if (!replayData) return [];

    if (Array.isArray(replayData.steps) && replayData.steps.length > 0) {
      const traceSteps = replayData.steps.map((step, index) => ({
        type: 'trace-step',
        index,
        data: step,
        timestamp: step.startedAt || step.timestamp || step.at,
      }));
      // Passo a passo das telas da UI (ações RPA: navigate/click/fill/assert
      // com screenshots ANTES/DEPOIS inline) — entra na mesma navegação de passos
      const uiTraceSteps = (replayData.uiTrace || []).map((step, index) => ({
        type: 'trace-step',
        index,
        data: { ...step, isUiStep: true },
        timestamp: step.startedAt || step.finishedAt,
      }));
      // Inclui eventos de timeline como entradas de log junto com os trace-steps
      const timelineEvents = (replayData.timeline || replayData.logs || []).map((event, index) => ({
        type: 'log-event',
        index,
        data: event,
        timestamp: event.timestamp,
      }));
      const screenItems = (replayData.screens || []).map((screen, index) => ({
        type: 'screen',
        index,
        data: screen,
        timestamp: screen.timestamp,
      }));
      return [...traceSteps, ...uiTraceSteps, ...timelineEvents, ...screenItems].sort((a, b) => {
        const tA = new Date(a.timestamp || 0).getTime();
        const tB = new Date(b.timestamp || 0).getTime();
        return tA - tB;
      });
    }
    
    const actions = replayData.actions || [];
    const screens = replayData.screens || [];
    
    const steps = [];
    
    // Combina ações e telas em uma sequência ordenada por timestamp
    actions.forEach((action, index) => {
      steps.push({
        type: 'action',
        index,
        data: action,
        timestamp: action.timestamp,
      });
    });
    
    screens.forEach((screen, index) => {
      steps.push({
        type: 'screen',
        index,
        data: screen,
        timestamp: screen.timestamp,
      });
    });
    
    // Ordena por timestamp
    return steps.sort((a, b) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
      return timeA - timeB;
    });
  };

  const replaySteps = getReplaySteps();
  const currentStep = replaySteps[currentReplayStep];
  const totalSteps = replaySteps.length;
  const operationalTimeline = useMemo(() => {
    if (!replayData) return [];
    if (Array.isArray(replayData.operationalTimeline) && replayData.operationalTimeline.length > 0) {
      return replayData.operationalTimeline;
    }
    const fallback = replayData.stateMutation || replayData.stateSnapshotContract || replayData.beforeSnapshot || replayData.afterSnapshot
      ? [
          {
            id: 'initial_state',
            type: 'state',
            label: 'ANTES',
            state: replayData.beforeSnapshot?.state || replayData.initialState || null,
            status: replayData.beforeSnapshot ? 'captured' : 'missing',
            evidence: replayData.beforeSnapshot || null,
          },
          {
            id: 'transition',
            type: 'transition',
            label: 'TRANSICAO',
            from: replayData.beforeSnapshot?.state || replayData.initialState || null,
            to: replayData.afterSnapshot?.state || replayData.finalState || null,
            status: replayData.stateMutation?.valid && replayData.stateSnapshotContract?.valid ? 'GO' : 'NO_GO',
            blockers: replayData.stateSnapshotContract?.missing || replayData.governanceBlockers || [],
          },
          {
            id: 'final_state',
            type: 'state',
            label: 'DEPOIS',
            state: replayData.afterSnapshot?.state || replayData.finalState || null,
            status: replayData.afterSnapshot ? 'captured' : 'missing',
            evidence: replayData.afterSnapshot || null,
          },
          {
            id: 'side_effects',
            type: 'side_effects',
            label: 'SIDE EFFECTS',
            status: replayData.stateMutation?.valid ? 'GO' : 'NO_GO',
            sideEffects: replayData.stateMutation?.observedSideEffects || [],
            observedSideEffects: replayData.stateMutation?.observedSideEffects || [],
            requiredSideEffects: replayData.stateMutation?.requiredSideEffects || replayData.stateSnapshotContract?.contract?.requiredSideEffects || [],
            evidence: replayData.afterSnapshot || null,
            technicalEvidence: {
              mutationCount: replayData.stateMutation?.mutationCount || 0,
              snapshotContract: replayData.stateSnapshotContract?.valid ? 'passed' : 'failed',
            },
          },
        ]
      : [];
    return fallback;
  }, [replayData]);
  const qaMeshSummary = useMemo(() => {
    if (!replayData) return null;
    const isSummary = replayData.type === 'qa_mesh_replay_summary'
      || replayData.summaryType === 'api_replay_summary'
      || replayData.summaryType === 'hybrid_replay_summary';
    if (!isSummary) return null;
    const flowLabel = replayData.flow || replayData.training?.businessFlow || replayData.scenarioId || '—';
    const domainLabel = replayData.training?.domain || '';
    const commandText = Array.isArray(replayData.command)
      ? replayData.command.join(' ')
      : (typeof replayData.command === 'string' ? replayData.command : '');
    const assertions = Array.isArray(replayData.assertions) ? replayData.assertions : [];
    const errors = Array.isArray(replayData.errors) ? replayData.errors : [];
    const adapterLabel = (replayData.summaryType === 'hybrid_replay_summary' || replayData.source === 'hybrid')
      ? 'hybrid'
      : 'api';
    return {
      flowLabel,
      domainLabel,
      commandText,
      assertions,
      errors,
      adapterLabel,
      passed: errors.length === 0,
    };
  }, [replayData]);
  const mutationDiffEntries = useMemo(() => {
    const before = replayData?.beforeSnapshot || {};
    const after = replayData?.afterSnapshot || {};
    const rows = [];
    const walk = (left, right, basePath = '') => {
      const leftObj = left && typeof left === 'object' && !Array.isArray(left) ? left : {};
      const rightObj = right && typeof right === 'object' && !Array.isArray(right) ? right : {};
      const keys = new Set([...Object.keys(leftObj), ...Object.keys(rightObj)]);
      keys.forEach((key) => {
        const path = basePath ? `${basePath}.${key}` : key;
        const prev = leftObj[key];
        const next = rightObj[key];
        const bothObjects = prev && next && typeof prev === 'object' && typeof next === 'object' && !Array.isArray(prev) && !Array.isArray(next);
        if (bothObjects) {
          walk(prev, next, path);
          return;
        }
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
          rows.push({ path, before: prev, after: next });
        }
      });
    };
    walk(before, after, '');
    return rows.slice(0, 120);
  }, [replayData]);
  const sideEffectProof = useMemo(() => {
    const required = replayData?.stateMutation?.requiredSideEffects
      || replayData?.stateSnapshotContract?.contract?.requiredSideEffects
      || [];
    const observed = replayData?.stateMutation?.observedSideEffects || [];
    return {
      required,
      observed,
      missing: required.filter((item) => !observed.includes(item)),
    };
  }, [replayData]);
  const normalizedReplaySteps = useMemo(() => normalizeReplaySteps(replayData), [replayData]);
  // Padrão único de exibição: título "Passo N"; o nome/step original vira descrição.
  const displayReplaySteps = useMemo(() => normalizedReplaySteps.map((s, i) => {
    const title = `Passo ${i + 1}`;
    const name = s.title && s.title !== title ? s.title : null;
    return {
      ...s,
      title,
      description: name ? (s.description ? `${name} — ${s.description}` : name) : s.description,
    };
  }), [normalizedReplaySteps]);
  const normalizedReplayTyped = useMemo(() => normalizeTypedEntries(replayData), [replayData]);
  const normalizedReplayEvidence = useMemo(
    () => normalizeReplayEvidence(replayData, normalizedReplaySteps),
    [replayData, normalizedReplaySteps],
  );
  const handlePlayerStepChange = (index, step) => {
    if (!step?.at) return;
    const found = replaySteps.findIndex((item) => item.timestamp === step.at);
    if (found >= 0) setCurrentReplayStep(found);
  };
  const replayEvidenceMap = useMemo(() => {
    const steps = Array.isArray(replayData?.steps) ? replayData.steps : [];
    const mutations = replayData?.mutations || replayData?.mutationDiff || replayData?.stateDiff || [];
    const seedEvidence = replayData?.seedEvidence || replayData?.metadata?.seedEvidence || null;
    const contract = replayData?.stateSnapshotContract || null;
    const sideEffects = replayData?.stateMutation?.observedSideEffects || [];
    const requiredSideEffects = replayData?.stateMutation?.requiredSideEffects || replayData?.stateSnapshotContract?.contract?.requiredSideEffects || [];
    return steps.slice(0, 120).map((step, index) => {
      const stepId = step?.id || `step-${index + 1}`;
      const semanticContract = step?.semanticContract || step?.evidence?.semanticContract || null;
      const actionType = semanticContract?.actionType || step?.actionType || step?.action || step?.type || 'n/a';
      const url = step?.url || step?.page || step?.route || step?.path || step?.input?.url || step?.evidence?.url || 'n/a';
      const timestamp = step?.timestamp || step?.startedAt || step?.at || 'n/a';
      const screenshotBefore = step?.screenshotBefore || step?.evidence?.screenshotBefore || null;
      const screenshotAfter = step?.screenshotAfter || step?.screenshot || step?.evidence?.screenshotAfter || step?.evidence?.screenshot || null;
      const selectorUsed = step?.selectorUsed || step?.selector || step?.evidence?.selectorUsed || step?.dataTestId || null;
      const networkEvents = Array.isArray(step?.networkEvents)
        ? step.networkEvents
        : Array.isArray(step?.evidence?.networkEvents)
          ? step.evidence.networkEvents
          : [];
      const stepResult = step?.stepResult || step?.evidence?.stepResult || null;
      const evidenceId = step?.evidenceId || step?.evidence?.evidenceId || null;
      const mutationLinkage = step?.mutationLinkage || step?.evidence?.mutationLinkage || null;
      const sideEffectLinkage = step?.sideEffectLinkage || step?.evidence?.sideEffectLinkage || null;
      const evidenceClassification = step?.evidenceClassification || step?.evidence?.evidenceClassification || 'operational';
      const mutationProvenance = Array.isArray(step?.mutationProvenance)
        ? step.mutationProvenance
        : Array.isArray(step?.evidence?.mutationProvenance)
          ? step.evidence.mutationProvenance
          : [];
      const incrementalDiff = step?.incrementalDiff || step?.evidence?.incrementalDiff || null;
      const governanceReasoning = step?.proofBlockers || step?.blockers || step?.postStateProof?.blockers || [];
      const networkCorrelation = Array.isArray(step?.networkCorrelation)
        ? step.networkCorrelation
        : Array.isArray(step?.postStateProof?.networkCorrelation)
          ? step.postStateProof.networkCorrelation
          : Array.isArray(step?.evidence?.networkCorrelation)
            ? step.evidence.networkCorrelation
            : [];
      const proofResult = step?.proofResult || step?.evidence?.proofResult || null;
      // Mutation associada ao step (por id ou índice)
      const linkedMutation = Array.isArray(mutations)
        ? mutations.find((m) => m?.stepId === stepId || m?.step === stepId || m?.stepIndex === index) || null
        : null;
      // Fontes de evidência do step
      const sourceEvidence = step?.evidence?.metadata?.sources
        || step?.evidence?.sources
        || step?.technicalEvidence?.sources
        || {};
      // Blockers do step
      const blockers = Array.isArray(step?.blockers) ? step.blockers : [];
      const missingEvidence = Array.isArray(step?.missingEvidence) ? step.missingEvidence : [];
      const hasBlocker = blockers.length > 0 || missingEvidence.length > 0;
      const goNoGo = step?.goNoGo || (hasBlocker ? 'NO_GO' : null);
      const strictReasonCandidates = [];
      if (typeof step?.error === 'string' && step.error.trim()) strictReasonCandidates.push({ reason: step.error });
      if (typeof step?.stepResult?.error === 'string' && step.stepResult.error.trim()) strictReasonCandidates.push({ reason: step.stepResult.error, metadata: step.stepResult?.metadata || null });
      blockers.forEach((blocker) => {
        if (blocker?.reason) strictReasonCandidates.push({ reason: blocker.reason, metadata: blocker });
      });
      missingEvidence.forEach((field) => {
        strictReasonCandidates.push({ reason: `step_missing_${field}`, metadata: { field } });
      });
      const strictReasons = Array.from(
        new Set(
          strictReasonCandidates
            .map((item) => formatStrictReason(item.reason, item.metadata))
            .filter(Boolean)
        )
      ).slice(0, 6);
      return {
        id: stepId,
        actionType,
        semanticContract,
        url,
        timestamp,
        screenshot: screenshotAfter,
        screenshotBefore,
        screenshotAfter,
        selectorUsed,
        networkEvents,
        networkEventsCount: networkEvents.length,
        stepResult,
        evidenceId,
        mutationLinkage,
        sideEffectLinkage,
        evidenceClassification,
        mutationProvenance,
        incrementalDiff,
        governanceReasoning,
        networkCorrelation,
        proofResult,
        linkedMutation,
        sourceEvidence,
        seedEvidence,
        contract,
        sideEffects,
        requiredSideEffects,
        blockers,
        missingEvidence,
        strictReasons,
        hasBlocker,
        goNoGo,
      };
    });
  }, [replayData]);
  const visibleReplaySteps = showOnlyFailures
    ? replaySteps.filter((step) => {
      if (step?.type === 'trace-step') {
        const st = String(step?.data?.status || '').toLowerCase();
        return st === 'failed' || st === 'timeout' || !!step?.data?.error;
      }
      if (step?.type === 'action') {
        return step?.data?.success === false;
      }
      if (step?.type === 'log-event') {
        return step?.data?.level === 'error' || step?.data?.level === 'warning';
      }
      return false;
    })
    : replaySteps;

  // Encontra o último screenshot antes do passo atual
  const getLastScreenshot = () => {
    if (!replaySteps || currentReplayStep < 0) return null;
    
    // Procura de trás para frente a partir do passo atual
    for (let i = currentReplayStep; i >= 0; i--) {
      const step = replaySteps[i];
      if (step?.type === 'screen' && step.data?.screenshot) {
        return step.data;
      }
    }
    return null;
  };

  const lastScreenshot = getLastScreenshot();
  const getTimelineScreenshot = (item) => {
    if (item?.screenshotAfter || item?.screenshot) return item.screenshotAfter || item.screenshot;
    if (item?.evidence?.screenshotAfter || item?.evidence?.screenshot) return item.evidence.screenshotAfter || item.evidence.screenshot;
    return lastScreenshot?.screenshot || lastScreenshot?.data || null;
  };
  const getEvidenceSources = (item) => {
    const sources = item?.evidence?.metadata?.sources || item?.technicalEvidence?.sources || {};
    return Object.entries(sources)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}:${value === true ? 'ok' : 'unavailable'}`);
  };
  const getEvidenceEntities = (item) => {
    const evidence = item?.evidence || {};
    const entities = [];
    if (evidence.db && Object.keys(evidence.db).length > 0) entities.push(`DB ${Object.keys(evidence.db).join(', ')}`);
    if (evidence.api && Object.keys(evidence.api).length > 0) entities.push(`API ${Object.keys(evidence.api).join(', ')}`);
    if (evidence.crm && Object.keys(evidence.crm).length > 0) entities.push(`CRM ${Object.keys(evidence.crm).join(', ')}`);
    if (evidence.events && Object.keys(evidence.events).length > 0) entities.push(`Eventos ${Object.keys(evidence.events).join(', ')}`);
    if (evidence.devices && Object.keys(evidence.devices).length > 0) entities.push(`Device ${Object.keys(evidence.devices).join(', ')}`);
    return entities;
  };

  const goToStep = (stepIndex) => {
    if (stepIndex >= 0 && stepIndex < totalSteps) {
      setCurrentReplayStep(stepIndex);
    }
  };

  const goToFirst = () => {
    setCurrentReplayStep(0);
    setIsPlaying(false);
  };
  const goToPrevious = () => {
    if (currentReplayStep > 0) {
      setCurrentReplayStep(currentReplayStep - 1);
      setIsPlaying(false);
    }
  };
  const goToNext = () => {
    if (currentReplayStep < totalSteps - 1) {
      setCurrentReplayStep(currentReplayStep + 1);
    } else {
      setIsPlaying(false); // Para quando chegar ao fim
    }
  };
  const goToLast = () => {
    setCurrentReplayStep(totalSteps - 1);
    setIsPlaying(false);
  };

  // Scroll automático para passo atual no painel de log
  useEffect(() => {
    if (!replayStepByStep || !replayData || currentReplayStep >= replaySteps.length) return;
    
    const stepElement = document.getElementById(`step-${currentReplayStep}`);
    const container = document.getElementById('actions-log-container');
    
    if (stepElement && container) {
      // Aguarda um pouco para garantir que o DOM foi atualizado
      setTimeout(() => {
        stepElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [currentReplayStep, replayStepByStep, replayData, replaySteps]);

  // Reprodução automática
  useEffect(() => {
    if (!isPlaying || !replayStepByStep || totalSteps === 0) return;

    const interval = setInterval(() => {
      setCurrentReplayStep((prev) => {
        if (prev >= totalSteps - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, replayStepByStep, totalSteps, playbackSpeed]);

  const togglePlayPause = () => {
    if (currentReplayStep >= totalSteps - 1) {
      // Se está no último passo, volta ao início
      setCurrentReplayStep(0);
    }
    setIsPlaying(!isPlaying);
  };

  const jumpToFirstErrorStep = () => {
    const errorIndex = replaySteps.findIndex((step) => {
      if (!step?.data) return false;
      if (step.type === 'trace-step') {
        const st = String(step.data.status || '').toLowerCase();
        return st === 'failed' || st === 'timeout' || !!step.data.error;
      }
      if (step.type === 'action') {
        return step.data.success === false;
      }
      return false;
    });
    if (errorIndex >= 0) {
      setReplayStepByStep(true);
      setCurrentReplayStep(errorIndex);
      setIsPlaying(false);
    }
  };

  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    // Pausa e retoma para aplicar nova velocidade
    if (isPlaying) {
      setIsPlaying(false);
      setTimeout(() => setIsPlaying(true), 50);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
  };

  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getReplayDurationMs = (replay) => {
    const directDuration = Number(replay?.duration);
    if (Number.isFinite(directDuration) && directDuration > 0) {
      return directDuration;
    }

    const start = new Date(replay?.startTime || replay?.startedAt || 0).getTime();
    const end = new Date(replay?.endTime || replay?.finishedAt || 0).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      return end - start;
    }

    return 0;
  };

  const handleDeleteReplay = async (filename, event) => {
    event.stopPropagation(); // Previne que o clique abra o modal
    setShowDeleteConfirm(filename);
  };

  const confirmDeleteReplay = async () => {
    const filename = showDeleteConfirm;
    if (!filename) return;

    setDeletingReplay(filename);
    try {
      await deleteRpaReplay(filename);
      showToast(`Replay "${filename}" removido com sucesso`, 'success', 3000);
      setShowDeleteConfirm(null);
      const remainingItemsOnPage = Math.max(replays.length - 1, 0);
      if (remainingItemsOnPage === 0 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        await loadReplays();
      }
    } catch (err) {
      logger.error('Erro ao remover replay', err);
      showToast('Erro ao remover replay', 'error', 3000);
    } finally {
      setDeletingReplay(null);
    }
  };

  const filteredReplays = replays;
  const sortedReplays = useMemo(() => {
    const normalizeText = (value) => String(value || '').toLowerCase();
    const extractDate = (replay) => {
      const raw = replay.modifiedAt || replay.modified || replay.startTime || replay.createdAt;
      const timestamp = new Date(raw || 0).getTime();
      return Number.isNaN(timestamp) ? 0 : timestamp;
    };

    const list = [...filteredReplays];
    list.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = normalizeText(a.filename).localeCompare(normalizeText(b.filename));
      } else if (sortBy === 'replayId') {
        comparison = normalizeText(a.replayId || a.id).localeCompare(normalizeText(b.replayId || b.id));
      } else if (sortBy === 'executionId') {
        comparison = normalizeText(a.executionId).localeCompare(normalizeText(b.executionId));
      } else if (sortBy === 'scenarioId') {
        comparison = normalizeText(a.scenarioId).localeCompare(normalizeText(b.scenarioId));
      } else if (sortBy === 'size') {
        comparison = (Number(a.size) || 0) - (Number(b.size) || 0);
      } else if (sortBy === 'duration') {
        comparison = getReplayDurationMs(a) - getReplayDurationMs(b);
      } else if (sortBy === 'result') {
        comparison = normalizeText(a.result).localeCompare(normalizeText(b.result));
      } else if (sortBy === 'startTime') {
        comparison = new Date(a.startTime || a.startedAt || 0).getTime() - new Date(b.startTime || b.startedAt || 0).getTime();
      } else if (sortBy === 'endTime') {
        comparison = new Date(a.endTime || a.finishedAt || 0).getTime() - new Date(b.endTime || b.finishedAt || 0).getTime();
      } else if (sortBy === 'mode') {
        comparison = normalizeText(a.mode).localeCompare(normalizeText(b.mode));
      } else if (sortBy === 'actionCount') {
        comparison = (Number(a.actionCount) || 0) - (Number(b.actionCount) || 0);
      } else if (sortBy === 'screenCount') {
        comparison = (Number(a.screenCount) || 0) - (Number(b.screenCount) || 0);
      } else if (sortBy === 'errorCount') {
        comparison = (Number(a.errorCount) || 0) - (Number(b.errorCount) || 0);
      } else {
        comparison = extractDate(a) - extractDate(b);
      }

      if (comparison === 0) {
        return normalizeText(a.filename).localeCompare(normalizeText(b.filename));
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [filteredReplays, sortBy, sortOrder]);

  useEffect(() => {
    setSelectedFilenames((prev) => prev.filter((filename) => replays.some((r) => r.filename === filename)));
  }, [replays]);

  const requestColumnSort = (column) => {
    const nextSortBy = column;
    if (sortBy === nextSortBy) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(nextSortBy);
    setSortOrder(column === 'name' ? 'asc' : 'desc');
  };

  const switchKind = (kind) => {
    if (kind === replayKind) return;
    setReplayKind(kind);
    setCurrentPage(1);
  };

  const toggleReplaySelection = (filename) => {
    setSelectedFilenames((prev) => {
      if (prev.includes(filename)) return prev.filter((item) => item !== filename);
      return [...prev, filename];
    });
  };

  const selectAllVisible = () => {
    setSelectedFilenames(sortedReplays.map((replay) => replay.filename));
  };

  const clearSelection = () => {
    setSelectedFilenames([]);
  };

  const allVisibleSelected = sortedReplays.length > 0 && sortedReplays.every((replay) => selectedFilenames.includes(replay.filename));

  const confirmDeleteSelected = async () => {
    if (selectedFilenames.length === 0) return;

    setDeletingSelected(true);
    try {
      const targets = [...selectedFilenames];
      await Promise.all(targets.map((filename) => deleteRpaReplay(filename)));
      showToast(`${targets.length} replay(s) removido(s) com sucesso`, 'success', 3000);
      setShowDeleteSelectedConfirm(false);
      setSelectedFilenames([]);
      const remainingItemsOnPage = Math.max(replays.length - targets.length, 0);
      if (remainingItemsOnPage === 0 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        await loadReplays();
      }
    } catch (err) {
      logger.error('Erro ao remover replays selecionados', err);
      showToast('Erro ao remover replays selecionados', 'error', 3000);
    } finally {
      setDeletingSelected(false);
    }
  };

  const hasActiveFilters = searchText.trim()
    || filterResult !== 'all'
    || filterDateRange !== 'all'
    || filterSource.trim()
    || filterWaveId.trim()
    || filterJourneyId.trim()
    || filterScenarioId.trim()
    || filterSeedId.trim()
    || filterExecutionId.trim();
  const totalReplays = pagination.total || replays.length;
  const totalPages = Math.max(1, Math.ceil(totalReplays / (pagination.limit || pageSize || 1)));
  const pageStart = totalReplays === 0 ? 0 : (pagination.offset || 0) + 1;
  const pageEnd = totalReplays === 0 ? 0 : Math.min((pagination.offset || 0) + replays.length, totalReplays);

  const clearFilters = () => {
    setSearchText('');
    setFilterResult('all');
    setFilterDateRange('all');
    setFilterSource('');
    setFilterWaveId('');
    setFilterJourneyId('');
    setFilterScenarioId('');
    setFilterSeedId('');
    setFilterExecutionId('');
    setSortBy('date');
    setSortOrder('desc');
  };

  const confirmDeleteAllReplays = async () => {
    setDeletingAllReplays(true);
    try {
      const result = await deleteAllRpaReplays();
      showToast(`Todos os replays foram removidos (${result.deletedCount})`, 'success', 3000);
      setShowDeleteAllConfirm(false);
      setCurrentPage(1);
      await loadReplays({ page: 1 });
    } catch (err) {
      logger.error('Erro ao remover todos os replays', err);
      showToast('Erro ao remover todos os replays', 'error', 3000);
    } finally {
      setDeletingAllReplays(false);
    }
  };

  return (
    <div className="h-screen w-full bg-bg-primary flex flex-col overflow-hidden" data-testid="rpa-replays-page">
      {/* Header fixo */}
      <div className="flex-shrink-0 p-6 border-b border-border-default bg-bg-elevated">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-2" data-testid="rpa-replays-title">
              📋 Replays RPA
            </h1>
            <p className="text-text-secondary">
              Visualize todos os arquivos de replay de testes RPA executados
              {hasActiveFilters && (
                <span className="ml-2 text-accent-primary">
                  (filtros aplicados no servidor)
                </span>
              )}
            </p>
            <p className="text-text-tertiary text-sm mt-1">
              Exibindo {pageStart}-{pageEnd} de {totalReplays} replay{totalReplays !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded border border-border-default bg-bg-primary p-1">
              <button
                type="button"
                onClick={() => switchKind('ui')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  replayKind === 'ui'
                    ? 'bg-accent-primary text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
                }`}
                title="Replays de interface/execução RPA (browser)"
              >
                🖥️ Replays RPA
              </button>
              <button
                type="button"
                onClick={() => switchKind('api')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  replayKind === 'api'
                    ? 'bg-accent-primary text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
                }`}
                title="Resumos de execução do QA Mesh (adapter API)"
              >
                🔌 QA Mesh (API)
              </button>
            </div>
            <div className="flex items-center gap-2 rounded border border-border-default bg-bg-primary p-1">
              <button
                type="button"
                onClick={() => setDisplayMode('list')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  displayMode === 'list'
                    ? 'bg-accent-primary text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
                }`}
                title="Visualização em lista"
              >
                📄 Lista
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('card')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  displayMode === 'card'
                    ? 'bg-accent-primary text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
                }`}
                title="Visualização em cards"
              >
                🗂️ Cards
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span>Por página</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setCurrentPage(1);
                  setPageSize(Number(e.target.value));
                }}
                className="px-2 py-1 text-sm bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
            <Button
              onClick={allVisibleSelected ? clearSelection : selectAllVisible}
              variant="default"
              size="sm"
              disabled={loading || sortedReplays.length === 0}
            >
              {allVisibleSelected ? '❎ Limpar Seleção' : '✅ Selecionar Visíveis'}
            </Button>
            <Button
              onClick={() => setShowDeleteSelectedConfirm(true)}
              variant="danger"
              size="sm"
              disabled={loading || deletingSelected || selectedFilenames.length === 0}
            >
              🗑️ Excluir Selecionados ({selectedFilenames.length})
            </Button>
            <Button
              onClick={() => loadReplays()}
              variant="default"
              size="sm"
              disabled={loading}
            >
              🔄 Atualizar Lista
            </Button>
            <Button
              onClick={() => setShowDeleteAllConfirm(true)}
              variant="danger"
              size="sm"
              disabled={loading || deletingAllReplays || totalReplays === 0}
            >
              🗑️ Remover Todos
            </Button>
          </div>
        </div>

        {/* Painel de Artefatos RPA persistidos no banco (roteiro + trace visual) */}
        <div className="bg-bg-secondary rounded-lg border border-border-default mb-4">
          <div className="flex items-center justify-between p-4 border-b border-border-default">
            <button
              onClick={() => {
                setShowExecutionArtifacts(!showExecutionArtifacts);
                if (!showExecutionArtifacts) loadExecutionArtifacts();
              }}
              className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-accent-primary transition-colors"
            >
              <span className={`collapse-btn-vertical ${showExecutionArtifacts ? '' : 'collapsed'}`}></span>
              <span>🗄️ Roteiros + Traces visuais (Banco de dados)</span>
            </button>
            <span className="text-xs text-text-tertiary">
              {loadingExecutionArtifacts ? 'Carregando…' : `${executionArtifacts.length} execução(ões)`}
            </span>
          </div>

          {showExecutionArtifacts && (
            <div className="p-4 overflow-x-auto">
              {executionArtifacts.length === 0 && !loadingExecutionArtifacts ? (
                <p className="text-sm text-text-tertiary py-2">
                  Nenhuma execução RPA persistida ainda. Execute uma gravação RPA para gerar roteiro + trace visual.
                </p>
              ) : (
                <table className="w-full text-sm text-text-primary">
                  <thead>
                    <tr className="text-left text-xs text-text-tertiary border-b border-border-default">
                      <th className="py-2 pr-4">Execução</th>
                      <th className="py-2 pr-4">Gravação (roteiro)</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Início</th>
                      <th className="py-2 pr-4">Artefatos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executionArtifacts.map((item) => (
                      <tr key={item.executionId} className="border-b border-border-default last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{item.executionId}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{item.recordingId || '—'}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            item.status === 'completed'
                              ? 'bg-green-500/15 text-green-400'
                              : 'bg-red-500/15 text-red-400'
                          }`}>
                            {item.status || 'unknown'}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs text-text-secondary">
                          {item.startedAt ? new Date(item.startedAt).toLocaleString() : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {item.hasRecording && (
                              <Button size="sm" variant="default" onClick={() => handleViewRecording(item.executionId)}>
                                📜 Roteiro
                              </Button>
                            )}
                            {item.hasTrace && (
                              <Button size="sm" variant="default" onClick={() => downloadArtifact(item.executionId, 'trace')}>
                                🎬 Trace (.zip)
                              </Button>
                            )}
                            {item.hasReplay && (
                              <Button size="sm" variant="default" onClick={() => handleViewExecutionReplay(item.executionId, item.recordingId)}>
                                ▶️ Replay
                              </Button>
                            )}
                            {Array.from({ length: Number(item.screenshots || 0) }).map((_, idx) => (
                              <Button key={idx} size="sm" variant="default" onClick={() => handleViewScreenshot(item.executionId, idx)}>
                                📸 {idx + 1}
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Painel de Filtros */}
        <div className="bg-bg-secondary rounded-lg border border-border-default">
          <div className="flex items-center justify-between p-4 border-b border-border-default">
            <button
              onClick={() => setFiltersCollapsed(!filtersCollapsed)}
              className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-accent-primary transition-colors"
            >
              <span className={`collapse-btn-vertical ${filtersCollapsed ? 'collapsed' : ''}`}></span>
              <span>🔍 Filtros e Ordenação</span>
            </button>
            {hasActiveFilters && !filtersCollapsed && (
              <Button
                onClick={clearFilters}
                variant="default"
                size="sm"
                className="text-xs"
              >
                🗑️ Limpar Filtros
              </Button>
            )}
          </div>

          {!filtersCollapsed && (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Busca por texto */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Buscar
              </label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Nome, ID ou Gravação..."
                className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
              />
            </div>

            {/* Filtro por resultado */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Resultado
              </label>
              <select
                value={filterResult}
                onChange={(e) => setFilterResult(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
              >
                <option value="all">Todos</option>
                <option value="success">✓ Sucesso</option>
                <option value="failed">✗ Falhou</option>
              </select>
            </div>

            {/* Filtro por data */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Período
              </label>
              <select
                value={filterDateRange}
                onChange={(e) => setFilterDateRange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
              >
                <option value="all">Todos</option>
                <option value="today">Hoje</option>
                <option value="week">Últimos 7 dias</option>
                <option value="month">Últimos 30 dias</option>
              </select>
            </div>

            {/* Ordenação */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Ordenar por
              </label>
              <div className="flex gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="date">Data</option>
                  <option value="name">Nome</option>
                  <option value="size">Tamanho</option>
                  <option value="duration">Duração</option>
                </select>
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary hover:bg-bg-secondary transition-colors"
                  title={sortOrder === 'asc' ? 'Crescente' : 'Decrescente'}
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t border-border-default/60">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Origem</label>
                  <select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  >
                    <option value="">Todas</option>
                    <option value="qa-waves">QA Waves</option>
                    <option value="qa_waves">QA Waves (legacy)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Wave ID</label>
                  <input
                    type="text"
                    value={filterWaveId}
                    onChange={(e) => setFilterWaveId(e.target.value)}
                    placeholder="fitness-wave-01"
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Journey ID</label>
                  <input
                    type="text"
                    value={filterJourneyId}
                    onChange={(e) => setFilterJourneyId(e.target.value)}
                    placeholder="journey-01"
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Scenario ID</label>
                  <input
                    type="text"
                    value={filterScenarioId}
                    onChange={(e) => setFilterScenarioId(e.target.value)}
                    placeholder="scenario-01"
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Seed ID</label>
                  <input
                    type="text"
                    value={filterSeedId}
                    onChange={(e) => setFilterSeedId(e.target.value)}
                    placeholder="seed-01"
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Execution ID</label>
                  <input
                    type="text"
                    value={filterExecutionId}
                    onChange={(e) => setFilterExecutionId(e.target.value)}
                    placeholder="mesh-..."
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Conteúdo scrollável */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-2"></div>
            <p className="text-text-secondary">Carregando replays...</p>
          </div>
        ) : replays.length === 0 ? (
          <div className="bg-bg-secondary rounded-lg border border-border-default p-8 text-center">
            <p className="text-text-secondary text-lg mb-2">
              Nenhum replay encontrado
            </p>
            <p className="text-text-tertiary text-sm">
              Execute alguns testes RPA para gerar replays
            </p>
          </div>
        ) : filteredReplays.length === 0 ? (
          <div className="bg-bg-secondary rounded-lg border border-border-default p-8 text-center">
            <p className="text-text-secondary text-lg mb-2">
              Nenhum replay corresponde aos filtros
            </p>
            <p className="text-text-tertiary text-sm mb-4">
              Tente ajustar os filtros ou limpar para ver todos os replays
            </p>
            {hasActiveFilters && (
              <Button
                onClick={clearFilters}
                variant="default"
                size="sm"
              >
                🗑️ Limpar Filtros
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {displayMode === 'list' ? (
              <div className="bg-bg-secondary rounded-lg border border-border-default overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-bg-primary border-b border-border-default">
                      <tr>
                        <th className="px-3 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={() => (allVisibleSelected ? clearSelection() : selectAllVisible())}
                            aria-label="Selecionar todos os replays visíveis"
                          />
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('name')} className="hover:text-text-primary transition-colors">
                            Arquivo {sortBy === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('replayId')} className="hover:text-text-primary transition-colors">
                            Replay ID {sortBy === 'replayId' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('executionId')} className="hover:text-text-primary transition-colors">
                            Execution ID {sortBy === 'executionId' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('scenarioId')} className="hover:text-text-primary transition-colors">
                            Cenário {sortBy === 'scenarioId' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('date')} className="hover:text-text-primary transition-colors">
                            Data {sortBy === 'date' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('startTime')} className="hover:text-text-primary transition-colors">
                            Início {sortBy === 'startTime' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('endTime')} className="hover:text-text-primary transition-colors">
                            Fim {sortBy === 'endTime' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('size')} className="hover:text-text-primary transition-colors">
                            Tamanho {sortBy === 'size' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('result')} className="hover:text-text-primary transition-colors">
                            Resultado {sortBy === 'result' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('mode')} className="hover:text-text-primary transition-colors">
                            Modo {sortBy === 'mode' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('actionCount')} className="hover:text-text-primary transition-colors">
                            Ações {sortBy === 'actionCount' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('screenCount')} className="hover:text-text-primary transition-colors">
                            Telas {sortBy === 'screenCount' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('errorCount')} className="hover:text-text-primary transition-colors">
                            Erros {sortBy === 'errorCount' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-left font-semibold text-text-secondary">
                          <button type="button" onClick={() => requestColumnSort('duration')} className="hover:text-text-primary transition-colors">
                            Tempo {sortBy === 'duration' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="px-3 py-3 text-right font-semibold text-text-secondary">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedReplays.map((replay) => {
                        const isSelected = selectedFilenames.includes(replay.filename);
                        return (
                          <tr
                            key={replay.filename}
                            data-testid="rpa-replay-item"
                            data-replay-id={replay.replayId || replay.id || ''}
                            className={`border-b border-border-default/60 hover:bg-bg-primary/60 transition-colors ${isSelected ? 'bg-accent-primary/10' : ''}`}
                          >
                            <td className="px-3 py-3 align-middle">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleReplaySelection(replay.filename)}
                                aria-label={`Selecionar ${replay.filename}`}
                              />
                            </td>
                            <td className="px-3 py-3 align-middle">
                              <button
                                type="button"
                                className="font-medium text-text-primary hover:text-accent-primary transition-colors text-left"
                                onClick={() => handleViewReplay(replay.filename)}
                                title={replay.filename}
                              >
                                {replay.filename}
                              </button>
                            </td>
                            <td className="px-3 py-3 align-middle text-text-secondary font-mono text-xs">{replay.replayId || replay.id || '-'}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary font-mono text-xs">{replay.executionId || '-'}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{replay.scenarioId || '-'}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{formatDate(replay.modifiedAt || replay.modified || replay.startTime)}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{formatDate(replay.startTime || replay.startedAt)}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{formatDate(replay.endTime || replay.finishedAt)}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{formatFileSize(replay.size || 0)}</td>
                            <td className="px-3 py-3 align-middle">
                              {replay.result ? (
                                <span className={replay.result === 'success' ? 'text-status-success' : 'text-status-error'}>
                                  {replay.result === 'success' ? '✓ Sucesso' : '✗ Falhou'}
                                </span>
                              ) : (
                                <span className="text-text-tertiary">-</span>
                              )}
                            </td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{replay.mode || '-'}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{replay.actionCount ?? 0}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{replay.screenCount ?? 0}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{replay.errorCount ?? 0}</td>
                            <td className="px-3 py-3 align-middle text-text-secondary">{formatDuration(getReplayDurationMs(replay))}</td>
                            <td className="px-3 py-3 align-middle text-right">
                              <Button
                                onClick={(e) => handleDeleteReplay(replay.filename, e)}
                                variant="danger"
                                size="sm"
                                disabled={deletingReplay === replay.filename}
                              >
                                {deletingReplay === replay.filename ? '⏳' : '🗑️'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sortedReplays.map((replay) => {
                  const isSelected = selectedFilenames.includes(replay.filename);
                  return (
                    <div
                      key={replay.filename}
                      data-testid="rpa-replay-item"
                      data-replay-id={replay.replayId || replay.id || ''}
                      className={`bg-bg-secondary rounded-lg border p-4 hover:border-accent-primary transition-colors ${
                        isSelected ? 'border-accent-primary ring-1 ring-accent-primary/40' : 'border-border-default'
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleReplaySelection(replay.filename);
                            }}
                            aria-label={`Selecionar ${replay.filename}`}
                            className="mt-1"
                          />
                          <h3
                            className="text-sm font-semibold text-text-primary truncate flex-1 cursor-pointer"
                            onClick={() => handleViewReplay(replay.filename)}
                            title={replay.filename}
                          >
                            {replay.filename}
                          </h3>
                        </div>
                        <button
                          onClick={(e) => handleDeleteReplay(replay.filename, e)}
                          disabled={deletingReplay === replay.filename}
                          className="text-status-error hover:text-status-error/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                          title="Remover replay"
                        >
                          {deletingReplay === replay.filename ? (
                            <span className="animate-spin">⏳</span>
                          ) : (
                            <span>🗑️</span>
                          )}
                        </button>
                      </div>

                      <div
                        className="cursor-pointer"
                        onClick={() => handleViewReplay(replay.filename)}
                      >
                        <div className="flex items-center justify-between text-xs text-text-tertiary mt-2">
                          <span>{formatFileSize(replay.size || 0)}</span>
                          <span>{formatDate(replay.modifiedAt || replay.modified || replay.startTime)}</span>
                        </div>
                        <div className="mt-2">
                          <span className="inline-flex items-center rounded border border-border-default bg-bg-primary px-2 py-0.5 text-xs text-text-secondary">
                            ⏱️ Tempo: {formatDuration(getReplayDurationMs(replay))}
                          </span>
                        </div>

                        <div className="mt-3 space-y-1 text-xs">
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Replay ID:</span>{' '}
                            <span className="font-mono">{replay.replayId || replay.id || '-'}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Gravação (origem):</span>{' '}
                            <span className="font-mono">{replay.recordingName || replay.recordingId || '-'}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Execution ID:</span>{' '}
                            <span className="font-mono">{replay.executionId || '-'}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Cenário:</span>{' '}
                            <span>{replay.scenarioId || '-'}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Data:</span>{' '}
                            <span>{formatDate(replay.modifiedAt || replay.modified || replay.startTime)}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Início:</span>{' '}
                            <span>{formatDate(replay.startTime || replay.startedAt)}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Fim:</span>{' '}
                            <span>{formatDate(replay.endTime || replay.finishedAt)}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Tamanho:</span>{' '}
                            <span>{formatFileSize(replay.size || 0)}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Resultado:</span>{' '}
                            {replay.result ? (
                              <span className={replay.result === 'success' ? 'text-status-success' : 'text-status-error'}>
                                {replay.result === 'success' ? '✓ Sucesso' : '✗ Falhou'}
                              </span>
                            ) : (
                              <span>-</span>
                            )}
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Modo:</span>{' '}
                            <span>{replay.mode || '-'}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Ações:</span>{' '}
                            <span>{replay.actionCount ?? 0}</span>
                            {' • '}
                            <span className="text-text-tertiary">Telas:</span>{' '}
                            <span>{replay.screenCount ?? 0}</span>
                            {' • '}
                            <span className="text-text-tertiary">Erros:</span>{' '}
                            <span className={replay.errorCount > 0 ? 'text-status-error' : ''}>{replay.errorCount ?? 0}</span>
                          </div>
                          <div className="text-text-secondary">
                            <span className="text-text-tertiary">Tempo:</span>{' '}
                            <span>{formatDuration(getReplayDurationMs(replay))}</span>
                          </div>
                          {replay.recordingId && (
                            <div className="text-text-secondary">
                              <span className="text-text-tertiary">Gravação:</span>{' '}
                              <span className="font-mono">{replay.recordingId}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-bg-secondary rounded-lg border border-border-default p-4">
              <div className="text-sm text-text-secondary">
                Página {currentPage} de {totalPages}
                {hasActiveFilters && (
                  <span className="text-text-tertiary"> • filtros aplicados no servidor</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setCurrentPage(1)}
                  variant="default"
                  size="sm"
                  disabled={loading || currentPage === 1}
                >
                  ⏮️ Primeira
                </Button>
                <Button
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  variant="default"
                  size="sm"
                  disabled={loading || currentPage === 1}
                >
                  ◀️ Anterior
                </Button>
                <Button
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  variant="default"
                  size="sm"
                  disabled={loading || currentPage >= totalPages}
                >
                  Próxima ▶️
                </Button>
                <Button
                  onClick={() => setCurrentPage(totalPages)}
                  variant="default"
                  size="sm"
                  disabled={loading || currentPage >= totalPages}
                >
                  Última ⏭️
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de visualização do replay */}
      <Dialog
        isOpen={showReplayModal}
        onClose={() => {
          setShowReplayModal(false);
          setSelectedReplay(null);
          setReplayData(null);
          setReplayRoteiro(null);
          setReplayStepByStep(false);
          setCurrentReplayStep(0);
          setIsPlaying(false);
          setShowOnlyFailures(false);
          setIsFullscreen(false);
          setReplayEvidenceTab('states');
        }}
        title={
          <div className="flex items-center justify-between w-full pr-8">
            <span>📋 Replay: {selectedReplay || ''}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsFullscreen(!isFullscreen);
              }}
              className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              title={isFullscreen ? 'Sair da tela cheia (F11)' : 'Tela cheia (F11)'}
            >
              {isFullscreen ? (
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
        size={isFullscreen ? "full" : "xl"}
        draggable={!isFullscreen}
        resizable={!isFullscreen}
        dynamicSize={isFullscreen ? { width: window.innerWidth - 32, isCollapsed: false } : null}
      >
        <div className="flex gap-2 flex-1 min-h-0" style={{ height: isFullscreen ? 'calc(100vh - 6rem)' : 'calc(80vh - 8rem)', minHeight: isFullscreen ? 'calc(100vh - 6rem)' : '500px' }}>
          {/* Conteúdo principal */}
          <div className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ${actionsLogCollapsed ? '' : 'mr-2'}`}>
            <div className="space-y-6 overflow-y-auto flex-1">
          {loadingReplay && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-2"></div>
              <p className="text-text-secondary">Carregando replay...</p>
            </div>
          )}

          {replayData && !loadingReplay && (
            <>
              {/* Informações do replay */}
              <div className="bg-bg-secondary rounded-lg border border-border-default">
                <div className="flex items-center justify-between p-4 border-b border-border-default">
                  <button
                    onClick={() => setReplayInfoCollapsed(!replayInfoCollapsed)}
                    className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-accent-primary transition-colors"
                  >
                    <span className={`collapse-btn-vertical ${replayInfoCollapsed ? 'collapsed' : ''}`}></span>
                    <span>📋 Informações do Replay</span>
                  </button>
                  {totalSteps > 0 && (
                    <div className="flex items-center gap-2">
                      {!replayInfoCollapsed && (
                        <span className="text-xs text-text-tertiary">
                          {totalSteps} passo{totalSteps !== 1 ? 's' : ''}
                        </span>
                      )}
                      <Button
                        onClick={() => {
                          setReplayStepByStep(!replayStepByStep);
                          if (!replayStepByStep) {
                            setCurrentReplayStep(0);
                            setIsPlaying(false);
                          }
                        }}
                        variant="default"
                        size="sm"
                        className="text-xs"
                        data-testid="replay-play-button"
                      >
                        {replayStepByStep ? '📋 Ver Lista Completa' : '▶️ Play'}
                      </Button>
                      {replayData?.training?.enabled && (
                        <Button
                          onClick={() => {
                            setTrainingMode(!trainingMode);
                            if (!trainingMode && !replayStepByStep) {
                              setReplayStepByStep(true);
                              setCurrentReplayStep(0);
                              setIsPlaying(false);
                            }
                          }}
                          variant={trainingMode ? 'primary' : 'outline'}
                          size="sm"
                          className="text-xs"
                          title="Modo Treinamento: mostra descrições narrativas e dicas visuais para cada passo"
                        >
                          {trainingMode ? '🎓 Treinando' : '🎓 Treinar'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                
                {!replayInfoCollapsed && (
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  {replayData.id && (
                    <div>
                      <span className="text-text-tertiary block mb-1">ID do Replay:</span>
                      <p className="text-text-primary font-mono text-xs break-all">{replayData.id}</p>
                    </div>
                  )}
                  {replayData.recordingId && (
                    <div>
                      <span className="text-text-tertiary block mb-1">ID da Gravação:</span>
                      <p className="text-text-primary font-mono text-xs break-all">{replayData.recordingId}</p>
                    </div>
                  )}
                  {replayData.startTime && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Início:</span>
                      <p className="text-text-primary text-xs">
                        {formatDate(replayData.startTime)}
                      </p>
                    </div>
                  )}
                  {replayData.endTime && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Fim:</span>
                      <p className="text-text-primary text-xs">
                        {formatDate(replayData.endTime)}
                      </p>
                    </div>
                  )}
                  {replayData.startTime && replayData.endTime && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Duração:</span>
                      <p className="text-text-primary text-xs">
                        {formatDuration(
                          new Date(replayData.endTime).getTime() - 
                          new Date(replayData.startTime).getTime()
                        )}
                      </p>
                    </div>
                  )}
                  {replayData.mode && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Modo:</span>
                      <p className="text-text-primary text-xs">{replayData.mode}</p>
                    </div>
                  )}
                  {replayData.result && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Resultado:</span>
                      <p className={`text-xs font-semibold ${
                        replayData.result === 'success' ? 'text-status-success' : 'text-status-error'
                      }`}>
                        {replayData.result === 'success' ? '✓ Sucesso' : '✗ Falhou'}
                      </p>
                    </div>
                  )}
                  {(replayData.actions?.length !== undefined || replayData.screens?.length !== undefined) && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Estatísticas:</span>
                      <p className="text-text-primary text-xs">
                        {replayData.actions?.length || 0} ação(ões) • {replayData.screens?.length || 0} tela(s)
                      </p>
                    </div>
                  )}
                  {/* ── Resumo de Treinamento ── */}
                  {replayData?.training?.enabled && (
                    <div className="col-span-2 p-3 rounded-lg bg-accent-primary/5 border border-accent-primary/20 space-y-1">
                      <span className="text-xs font-semibold text-accent-primary flex items-center gap-1">
                        🎓 Jornada de Treinamento
                      </span>
                      {replayData.training.domain && (
                        <p className="text-xs text-text-secondary">
                          <span className="text-text-tertiary">Domínio:</span> {replayData.training.domain}
                          {replayData.training.difficulty && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-tertiary border border-border-default">
                              {replayData.training.difficulty}
                            </span>
                          )}
                        </p>
                      )}
                      {replayData.training.businessFlow && (
                        <p className="text-xs text-text-secondary">
                          <span className="text-text-tertiary">Fluxo:</span> {replayData.training.businessFlow}
                        </p>
                      )}
                      {replayData.training.estimatedDuration && (
                        <p className="text-xs text-text-secondary">
                          <span className="text-text-tertiary">Duração estimada:</span> {replayData.training.estimatedDuration}
                        </p>
                      )}
                      {replayData.training.learningObjectives?.length > 0 && (
                        <div className="text-xs text-text-secondary">
                          <span className="text-text-tertiary">Objetivos:</span>
                          <ul className="list-disc list-inside mt-1">
                            {replayData.training.learningObjectives.map((obj, i) => (
                              <li key={i}>{obj}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {/* ── Fim Resumo de Treinamento ── */}
                  {replayData.errors?.length > 0 && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Erros:</span>
                      <p className="text-status-error text-xs font-semibold">
                        {replayData.errors.length} erro(s) encontrado(s)
                      </p>
                    </div>
                  )}
                  {replayData.tracePath && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Trace:</span>
                      <div className="flex items-center gap-2">
                        <p className="text-text-primary text-xs font-mono break-all">{replayData.tracePath}</p>
                        <Button
                          onClick={() => window.open(replayData.tracePath, '_blank', 'noopener,noreferrer')}
                          variant="default"
                          size="sm"
                          className="text-xs"
                        >
                          Abrir trace.zip
                        </Button>
                      </div>
                    </div>
                  )}
                  {(replayData.governanceStatus || replayData.operationalValidation || replayData.stateMutation) && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Governança operacional:</span>
                      <p className={`text-xs font-semibold ${replayData.governanceStatus === 'GO' ? 'text-status-success' : 'text-status-error'}`}>
                        {replayData.governanceStatus || (replayData.operationalValidation?.isOperational ? 'GO' : 'NO_GO')}
                      </p>
                    </div>
                  )}
                  {(replayData.replayHash || replayData.replayChecksum || replayData.governanceSignature) && (
                    <div className="md:col-span-2">
                      <span className="text-text-tertiary block mb-1">Replay integrity:</span>
                      <div className="space-y-1 text-xs font-mono break-all">
                        <div>hash: {replayData.replayHash || 'missing'}</div>
                        <div>checksum: {replayData.replayChecksum || 'missing'}</div>
                        <div>governanceSignature: {replayData.governanceSignature || 'missing'}</div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Informações adicionais em uma linha separada se houver timings */}
                {replayData.timings && (
                  <div className="mt-2 pt-3 border-t border-border-default">
                    <span className="text-text-tertiary text-xs block mb-1">Timings:</span>
                    <p className="text-text-primary text-xs">
                      Total: {formatDuration(replayData.timings.total || 0)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

              {/* Roteiro (gravação de origem) inline no replay */}
              <div className="bg-bg-secondary rounded-lg border border-border-default">
                <button
                  type="button"
                  onClick={() => setReplayRoteiroCollapsed(!replayRoteiroCollapsed)}
                  className="flex items-center gap-2 w-full p-4 text-left text-sm font-semibold text-text-primary hover:text-accent-primary transition-colors"
                >
                  <span className={`collapse-btn-vertical ${replayRoteiroCollapsed ? 'collapsed' : ''}`}></span>
                  <span>📜 Roteiro{replayRoteiro?.id ? `: ${replayRoteiro.id}` : ''}</span>
                  {replayRoteiroLoading && (
                    <span className="ml-2 inline-block animate-spin rounded-full h-3 w-3 border-b-2 border-accent-primary"></span>
                  )}
                </button>
                {!replayRoteiroCollapsed && (
                  <div className="px-4 pb-4">
                    {replayRoteiroLoading ? (
                      <p className="text-xs text-text-tertiary">Carregando roteiro...</p>
                    ) : replayRoteiro ? (
                      <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap bg-bg-primary border border-border-default rounded p-3 max-h-64 overflow-y-auto">
                        {formatRecordingText(replayRoteiro)}
                      </pre>
                    ) : (
                      <p className="text-xs text-text-tertiary">
                        {replayData?.recordingId
                          ? `Roteiro "${replayData.recordingId}" não encontrado.`
                          : 'Este replay não referencia uma gravação (roteiro).'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Resumo do QA Mesh (adapter API) — sem telas/ações por design */}
              {qaMeshSummary && (
                <div className="bg-bg-secondary rounded-lg border border-border-default">
                  <div className="flex items-center justify-between p-4 border-b border-border-default">
                    <div className="text-sm font-semibold text-text-primary">📊 Resumo do QA Mesh</div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-bg-tertiary border border-border-default text-text-secondary">
                      🔌 Adapter: {qaMeshSummary.adapterLabel}
                    </span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <span className="text-text-tertiary text-xs block mb-1">Cenário validado</span>
                      <p className="text-text-primary text-sm font-mono break-all">
                        {qaMeshSummary.flowLabel}
                        {replayData.scenarioId ? ` (${replayData.scenarioId})` : ''}
                      </p>
                    </div>
                    {qaMeshSummary.domainLabel && (
                      <div>
                        <span className="text-text-tertiary text-xs block mb-1">Domínio</span>
                        <p className="text-text-primary text-xs">{qaMeshSummary.domainLabel}</p>
                      </div>
                    )}
                    {qaMeshSummary.commandText && (
                      <div>
                        <span className="text-text-tertiary text-xs block mb-1">Comando executado</span>
                        <pre className="text-xs font-mono bg-bg-primary border border-border-default rounded p-2 whitespace-pre-wrap break-all text-text-primary">
                          {qaMeshSummary.commandText}
                        </pre>
                      </div>
                    )}
                    {qaMeshSummary.assertions.length > 0 && (
                      <div>
                        <span className="text-text-tertiary text-xs block mb-1">Asserções</span>
                        <ul className="space-y-1">
                          {qaMeshSummary.assertions.map((assertion, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              <span className={qaMeshSummary.passed ? 'text-status-success shrink-0' : 'text-status-error shrink-0'}>
                                {qaMeshSummary.passed ? '✓' : '✗'}
                              </span>
                              <span className="text-text-primary break-words">{assertion}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <span className="text-text-tertiary text-xs block mb-1">Resultado</span>
                      <p className={`text-xs font-semibold ${qaMeshSummary.passed ? 'text-status-success' : 'text-status-error'}`}>
                        {qaMeshSummary.passed
                          ? `✓ Sem erros · ${replayData.durationMs != null ? `${replayData.durationMs}ms` : formatDuration(replayData.duration || 0)}`
                          : `✗ ${qaMeshSummary.errors.length} erro(s)`}
                      </p>
                    </div>
                    {qaMeshSummary.errors.length > 0 && (
                      <div>
                        <span className="text-text-tertiary text-xs block mb-1">Erros</span>
                        <ul className="space-y-1">
                          {qaMeshSummary.errors.map((err, i) => (
                            <li key={i} className="text-xs text-status-error break-words">
                              {typeof err === 'string' ? err : (err?.message || err?.error || JSON.stringify(err))}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {operationalTimeline.length > 0 && (
                <div className="bg-bg-secondary rounded-lg border border-border-default mt-4" data-testid="replay-state-timeline">
                  <div className="flex items-center justify-between gap-2 p-3 border-b border-border-default">
                    <div className="text-sm font-semibold text-text-primary">Timeline Operacional</div>
                    <div className="flex items-center gap-1 rounded border border-border-default bg-bg-primary p-1">
                      {[
                        ['states', 'Estados'],
                        ['transitions', 'Transições'],
                        ['sideEffects', 'Side Effects'],
                        ['steps', 'Steps'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setReplayEvidenceTab(id)}
                          className={`px-2 py-1 text-xs rounded ${replayEvidenceTab === id ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {operationalTimeline
                      .filter((item) => {
                        if (replayEvidenceTab === 'states') return item.type === 'state' || item.id === 'initial_state' || item.id === 'final_state';
                        if (replayEvidenceTab === 'transitions') return item.type === 'transition' || item.type === 'action';
                        if (replayEvidenceTab === 'sideEffects') return item.type === 'side_effects';
                        return true;
                      })
                      .map((item) => {
                        const status = String(item.status || '').toUpperCase();
                        const go = status === 'GO' || status === 'CAPTURED' || status === 'SUCCESS';
                        const evidenceSources = getEvidenceSources(item);
                        const evidenceEntities = getEvidenceEntities(item);
                        const timelineScreenshot = getTimelineScreenshot(item);
                        return (
                          <div key={item.id || item.label} className="rounded border border-border-default bg-bg-primary p-3 text-xs" data-testid="replay-state-timeline-item">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-text-primary">{item.label || item.type}</div>
                              <span className={`rounded px-2 py-0.5 font-semibold ${go ? 'bg-status-success/10 text-status-success' : 'bg-status-error/10 text-status-error'}`}>
                                {status || 'N/A'}
                              </span>
                            </div>
                            {item.state ? <div className="mt-1 text-text-secondary">Estado: <span className="font-mono">{item.state}</span></div> : null}
                            {item.action ? <div className="mt-1 text-text-secondary">Ação: <span className="font-mono">{item.action}</span></div> : null}
                            {(item.from || item.to) ? (
                              <div className="mt-1 text-text-secondary">
                                {item.from || 'n/a'} → {item.to || 'n/a'}
                              </div>
                            ) : null}
                            {Array.isArray(item.sideEffects) && item.sideEffects.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.sideEffects.map((effect) => (
                                  <span key={effect} className="rounded border border-border-default bg-bg-secondary px-2 py-0.5 text-text-secondary">
                                    {effect}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {item.technicalEvidence ? (
                              <div className="mt-2 text-text-tertiary">
                                Mutations: {item.technicalEvidence.mutationCount ?? 0} · Snapshot: {item.technicalEvidence.snapshotContract || 'n/a'}
                              </div>
                            ) : null}
                            {(Array.isArray(item.requiredSideEffects) && item.requiredSideEffects.length > 0) || (Array.isArray(item.observedSideEffects) && item.observedSideEffects.length > 0) ? (
                              <div className="mt-2 grid gap-1 text-text-secondary">
                                <div>Obrigatórios: {(item.requiredSideEffects || []).join(', ') || 'n/a'}</div>
                                <div>Observados: {(item.observedSideEffects || item.sideEffects || []).join(', ') || 'n/a'}</div>
                              </div>
                            ) : null}
                            {evidenceEntities.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {evidenceEntities.map((entry) => (
                                  <span key={entry} className="rounded border border-border-default bg-bg-secondary px-2 py-0.5 text-text-tertiary">
                                    {entry}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {evidenceSources.length > 0 ? (
                              <div className="mt-2 text-text-tertiary break-words">
                                Fontes: {evidenceSources.join(' · ')}
                              </div>
                            ) : null}
                            {timelineScreenshot ? (
                              <div className="mt-2 overflow-hidden rounded border border-border-default bg-bg-secondary">
                                <img src={timelineScreenshot} alt="Screenshot da transição operacional" className="max-h-40 w-full object-contain" />
                              </div>
                            ) : null}
                            {Array.isArray(item.blockers) && item.blockers.length > 0 ? (
                              <div className="mt-2 space-y-1">
                                {item.blockers.slice(0, 4).map((blocker, index) => (
                                  <div key={index} className="rounded bg-status-error/5 border border-status-error/20 px-2 py-1 text-status-error break-words">
                                    {formatStrictReason(blocker.reason || blocker.entry || 'unknown_blocker', blocker)}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    {replayData.stateSnapshotContract && (
                      <div className="rounded border border-border-default bg-bg-primary p-3 text-xs">
                        <div className="font-semibold text-text-primary">Contrato de Snapshot</div>
                        <div className="mt-1 text-text-secondary">
                          Status: <span className={replayData.stateSnapshotContract.valid ? 'text-status-success' : 'text-status-error'}>
                            {replayData.stateSnapshotContract.valid ? 'passed' : 'failed'}
                          </span>
                        </div>
                        {Array.isArray(replayData.stateSnapshotContract.missing) && replayData.stateSnapshotContract.missing.length > 0 ? (
                          <div className="mt-2 space-y-1">
                            {replayData.stateSnapshotContract.missing.slice(0, 8).map((item, index) => (
                              <div key={index} className="rounded bg-status-error/5 border border-status-error/20 px-2 py-1 text-status-error break-words">
                                {item.phase || 'contract'} · {item.entry || item.path || item.reason || JSON.stringify(item)}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                    <div className="rounded border border-border-default bg-bg-primary p-3 text-xs" data-testid="mutation-diff-viewer">
                      <div className="font-semibold text-text-primary">Mutation Diff Viewer</div>
                      <div className="mt-1 text-text-secondary">{mutationDiffEntries.length} mutação(ões) detectada(s)</div>
                      {mutationDiffEntries.length > 0 ? (
                        <div className="mt-2 max-h-56 overflow-auto space-y-1">
                          {mutationDiffEntries.map((entry) => (
                            <div key={entry.path} className="rounded border border-border-default bg-bg-secondary px-2 py-1">
                              <div className="font-mono text-text-primary">{entry.path}</div>
                              <div className="text-text-tertiary">before: {JSON.stringify(entry.before)}</div>
                              <div className="text-text-tertiary">after: {JSON.stringify(entry.after)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-status-error">Nenhuma mutação operacional comprovada.</div>
                      )}
                    </div>
                    <div className="rounded border border-border-default bg-bg-primary p-3 text-xs" data-testid="snapshot-compare-viewer">
                      <div className="font-semibold text-text-primary">Snapshot Compare Viewer</div>
                      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                        <div className="rounded border border-border-default bg-bg-secondary p-2">
                          <div className="font-semibold text-text-secondary mb-1">Before Snapshot</div>
                          <pre className="text-text-tertiary whitespace-pre-wrap break-words">{JSON.stringify(replayData.beforeSnapshot || null, null, 2)}</pre>
                        </div>
                        <div className="rounded border border-border-default bg-bg-secondary p-2">
                          <div className="font-semibold text-text-secondary mb-1">After Snapshot</div>
                          <pre className="text-text-tertiary whitespace-pre-wrap break-words">{JSON.stringify(replayData.afterSnapshot || null, null, 2)}</pre>
                        </div>
                      </div>
                    </div>
                    <div className="rounded border border-border-default bg-bg-primary p-3 text-xs" data-testid="side-effect-proof-viewer">
                      <div className="font-semibold text-text-primary">Side Effect Proof Viewer</div>
                      <div className="mt-1 text-text-secondary">Obrigatórios: {sideEffectProof.required.join(', ') || 'n/a'}</div>
                      <div className="mt-1 text-text-secondary">Observados: {sideEffectProof.observed.join(', ') || 'n/a'}</div>
                      {sideEffectProof.missing.length > 0 ? (
                        <div className="mt-2 text-status-error">Ausentes: {sideEffectProof.missing.join(', ')}</div>
                      ) : (
                        <div className="mt-2 text-status-success">Todos os side effects obrigatórios foram comprovados.</div>
                      )}
                    </div>
                    <div className="rounded border border-border-default bg-bg-primary p-3 text-xs" data-testid="replay-evidence-map">
                      <div className="font-semibold text-text-primary">Replay Evidence Map</div>
                      <div className="mt-1 text-text-secondary">Mapeamento step → ação → URL → timestamp → screenshot</div>
                      <div className="mt-2 max-h-56 overflow-auto space-y-1">
                        {replayEvidenceMap.map((entry) => (
                          <div key={entry.id} className={`rounded border px-2 py-1 ${entry.goNoGo === 'NO_GO' ? 'border-status-error/50 bg-status-error/5' : 'border-border-default bg-bg-secondary'}`}>
                            <div className="flex items-center justify-between gap-1">
                              <div className="font-semibold text-text-primary">{entry.id}</div>
                              {entry.goNoGo === 'NO_GO' && (
                                <span className="rounded px-1.5 py-0.5 font-bold text-[10px] bg-status-error text-white">NO_GO</span>
                              )}
                            </div>
                            <div className="text-text-tertiary">actionType: {entry.actionType}</div>
                            <div className="text-text-tertiary break-all">url: {entry.url}</div>
                            <div className="text-text-tertiary">timestamp: {entry.timestamp}</div>
                            <div className="text-text-tertiary break-all">screenshot: {entry.screenshotAfter ? 'ok' : 'missing'}{!entry.screenshotBefore ? ' · before:missing' : ''}</div>
                            {entry.strictReasons.length > 0 && (
                              <div className="mt-1 text-status-error break-words">motivo estrito: {entry.strictReasons.join(' · ')}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* ── Step Evidence Cards — aba Steps ── */}
                    {replayEvidenceTab === 'steps' && (
                      <div className="rounded border border-border-default bg-bg-primary p-3 text-xs" data-testid="step-evidence-cards">
                        <div className="font-semibold text-text-primary">Step Evidence Cards</div>
                        <div className="mt-1 text-text-secondary">Screenshot antes/depois · URL · actionType · mutation · blocker por step</div>
                        {replayEvidenceMap.length === 0 && (
                          <div className="mt-2 text-status-error">Nenhum step operacional encontrado neste replay.</div>
                        )}
                        <div className="mt-2 space-y-3 max-h-[600px] overflow-auto">
                          {replayEvidenceMap.map((entry, idx) => (
                            <div
                              key={entry.id}
                              className={`rounded border p-3 ${
                                entry.goNoGo === 'NO_GO'
                                  ? 'border-status-error/50 bg-status-error/5'
                                  : 'border-border-default bg-bg-secondary'
                              }`}
                              data-testid="step-evidence-card"
                            >
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-text-primary">Step {idx + 1}</span>
                                  <span className="rounded border border-border-default bg-bg-primary px-1.5 py-0.5 text-text-secondary font-mono">{entry.actionType}</span>
                                </div>
                                {entry.goNoGo === 'NO_GO' && (
                                  <span className="rounded px-2 py-0.5 font-bold text-[11px] bg-status-error text-white" data-testid="step-no-go-badge">NO_GO</span>
                                )}
                              </div>
                              <div className="text-text-tertiary break-all mb-1">URL: {entry.url}</div>
                              {entry.semanticContract && (
                                <div className="rounded border border-border-default bg-bg-primary px-2 py-1 mb-2">
                                  <div className="font-semibold text-text-secondary">Semantic Contract</div>
                                  <div className="text-text-tertiary">canonical actionType: {entry.semanticContract.actionType}</div>
                                  <div className="text-text-tertiary">mutationExpected: {String(entry.semanticContract.mutationExpected === true)}</div>
                                </div>
                              )}
                              <div className="text-text-tertiary mb-2">Timestamp: {entry.timestamp}</div>
                              <div className="text-text-tertiary mb-1 break-all">Selector: {entry.selectorUsed || 'n/a'}</div>
                              <div className="text-text-tertiary mb-2 break-all">Evidence ID: {entry.evidenceId || 'missing'}</div>
                              {entry.stepResult && (
                                <div className="text-text-tertiary mb-2">Step Result: {entry.stepResult.status || JSON.stringify(entry.stepResult)}</div>
                              )}
                              <div className="grid grid-cols-2 gap-2 mb-2">
                                <div>
                                  <div className="text-text-secondary font-semibold mb-1">Before</div>
                                  {entry.screenshotBefore
                                    ? <img src={entry.screenshotBefore} alt={`Step ${idx + 1} before`} className="rounded border border-border-default w-full max-h-32 object-contain bg-bg-primary" />
                                    : <div className="rounded border border-border-default bg-bg-primary px-2 py-4 text-center text-text-tertiary">sem screenshot</div>
                                  }
                                </div>
                                <div>
                                  <div className="text-text-secondary font-semibold mb-1">After</div>
                                  {entry.screenshotAfter
                                    ? <img src={entry.screenshotAfter} alt={`Step ${idx + 1} after`} className="rounded border border-border-default w-full max-h-32 object-contain bg-bg-primary" />
                                    : <div className="rounded border border-border-default bg-bg-primary px-2 py-4 text-center text-text-tertiary">sem screenshot</div>
                                  }
                                </div>
                              </div>
                              {entry.linkedMutation && (
                                <div className="rounded border border-border-default bg-bg-primary px-2 py-1 mb-2">
                                  <div className="font-semibold text-text-secondary">Mutation</div>
                                  <div className="font-mono text-text-primary">{entry.linkedMutation.path || entry.linkedMutation.key || JSON.stringify(entry.linkedMutation)}</div>
                                  {entry.linkedMutation.before !== undefined && (
                                    <div className="text-text-tertiary">before: {JSON.stringify(entry.linkedMutation.before)}</div>
                                  )}
                                  {entry.linkedMutation.after !== undefined && (
                                    <div className="text-text-tertiary">after: {JSON.stringify(entry.linkedMutation.after)}</div>
                                  )}
                                </div>
                              )}
                              {entry.mutationLinkage && !entry.linkedMutation && (
                                <div className="rounded border border-border-default bg-bg-primary px-2 py-1 mb-2">
                                  <div className="font-semibold text-text-secondary">Mutation Linkage</div>
                                  <div className="text-text-tertiary">source: {entry.mutationLinkage.source || entry.mutationLinkage.correlatedBy || 'step_incremental'}</div>
                                  <div className="text-text-tertiary break-all">{JSON.stringify(entry.mutationLinkage)}</div>
                                </div>
                              )}
                              {(entry.proofResult || entry.stepExecutionProof || entry.postStateProof) && (() => {
                                const sepProof = Boolean(entry.stepExecutionProof || entry.postStateProof);
                                const stepExec = entry.stepExecutionProof || (entry.proofResult ? { ...entry.proofResult, phase: 'step_execution' } : null);
                                const postState = entry.postStateProof || null;
                                const overallValid = sepProof
                                  ? (stepExec?.valid !== false) && (postState == null || postState.valid !== false)
                                  : entry.proofResult?.valid;
                                const overallGoNoGo = entry.proofGoNoGo || stepExec?.goNoGo || postState?.goNoGo || entry.proofResult?.goNoGo;
                                return (
                                  <div className={`rounded border px-2 py-1 mb-2 ${overallValid ? 'border-status-success' : 'border-status-error'}`}>
                                    <div className="font-semibold text-text-secondary mb-1">
                                      Proof Chain
                                      <span className={`ml-2 text-xs font-bold ${overallValid ? 'text-status-success' : 'text-status-error'}`}>
                                        {overallValid ? '✓ VALID' : `✗ ${overallGoNoGo || 'FAILED'}`}
                                      </span>
                                    </div>
                                    {/* Proof chain summary badges */}
                                    {entry.proofChain && (
                                      <div className="flex flex-wrap gap-1 text-xs mb-2">
                                        {Object.entries(entry.proofChain).filter(([k]) => !['complete','stepExecutionValid','postStateValid'].includes(k)).map(([k, v]) => (
                                          <span key={k} className={`px-1 rounded ${v ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'}`}>
                                            {k}:{v === true ? '✓' : v === false ? '✗' : String(v ?? '—')}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {/* ─── Painel 1: STEP EXECUTION ─────── */}
                                    {stepExec && (
                                      <div className={`rounded border mb-2 px-2 py-1 ${stepExec.valid ? 'border-status-success/40 bg-status-success/5' : 'border-status-error/40 bg-status-error/5'}`}>
                                        <div className="text-xs font-bold text-text-secondary mb-1">
                                          STEP EXECUTION PROOF
                                          <span className={`ml-2 ${stepExec.valid ? 'text-status-success' : 'text-status-error'}`}>
                                            {stepExec.valid ? '✓' : '✗'}
                                          </span>
                                        </div>
                                        {/* Browser fields */}
                                        <div className="flex flex-wrap gap-1 text-xs mb-1">
                                          {stepExec.hasUrl !== undefined && (
                                            <span className={`px-1 rounded ${stepExec.hasUrl ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'}`}>url:{stepExec.hasUrl ? '✓' : '✗'}</span>
                                          )}
                                          {stepExec.hasSelector !== undefined && (
                                            <span className={`px-1 rounded ${stepExec.hasSelector ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'}`}>selector:{stepExec.hasSelector ? '✓' : '✗'}</span>
                                          )}
                                          {(stepExec.missingBrowserFields || []).length > 0 && (
                                            <span className="px-1 rounded bg-status-error/20 text-status-error">missing:{stepExec.missingBrowserFields.join(',')}</span>
                                          )}
                                        </div>
                                        {/* Network proof */}
                                        {stepExec.networkProof && (
                                          <div className="mb-1">
                                            <div className={`text-xs font-semibold ${stepExec.networkProof.valid ? 'text-status-success' : stepExec.networkProof.noContract ? 'text-text-tertiary' : 'text-status-error'}`}>
                                              Network: {stepExec.networkProof.valid ? '✓' : stepExec.networkProof.noContract ? '(sem contrato)' : '✗ FALHOU'}
                                            </div>
                                            {(stepExec.networkProof.expectedEndpoints || []).map((ep, i) => (
                                              <div key={i} className="text-xs text-text-tertiary break-all">↗ {ep}</div>
                                            ))}
                                            {(stepExec.networkProof.observedEndpoints || []).slice(0, 4).map((ep, i) => (
                                              <div key={i} className="text-xs text-text-tertiary break-all">✓ {ep}</div>
                                            ))}
                                          </div>
                                        )}
                                        {/* Step-time blockers */}
                                        {(stepExec.blockers || []).length > 0 && (
                                          <div>
                                            {stepExec.blockers.slice(0, 3).map((b, i) => (
                                              <div key={i} className="text-xs text-status-error break-all">✗ {b.reason}{b.missingField ? ` (${b.missingField})` : ''}</div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* ─── Painel 2: POST STATE ─────────── */}
                                    {postState ? (
                                      <div className={`rounded border mb-1 px-2 py-1 ${postState.valid ? 'border-status-success/40 bg-status-success/5' : postState.afterSnapshotPresent === false ? 'border-border-default bg-bg-primary' : 'border-status-error/40 bg-status-error/5'}`}>
                                        <div className="text-xs font-bold text-text-secondary mb-1">
                                          POST STATE PROOF
                                          <span className={`ml-2 ${postState.valid ? 'text-status-success' : postState.afterSnapshotPresent === false ? 'text-text-tertiary' : 'text-status-error'}`}>
                                            {postState.afterSnapshotPresent === false ? '⏳ aguardando snapshot' : postState.valid ? '✓' : '✗'}
                                          </span>
                                        </div>
                                        {/* Snapshot diff */}
                                        {postState.diff != null && (
                                          <div className={`text-xs mb-1 ${postState.diff.changed ? 'text-status-success' : 'text-status-error'}`}>
                                            snapshot: {postState.diff.changed
                                              ? `${postState.diff.details?.length ?? 0} campo(s) alterado(s)`
                                              : 'before === after (sem mudança)'}
                                          </div>
                                        )}
                                        {(entry.incrementalDiff || postState.diff) && (
                                          <div className="mb-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Incremental diff:</div>
                                            <div className="text-xs text-text-secondary">
                                              changed: {String(entry.incrementalDiff?.changed ?? postState.diff?.changed ?? false)}
                                              {' '}| details: {entry.incrementalDiff?.diff?.details?.length ?? postState.diff?.details?.length ?? 0}
                                            </div>
                                          </div>
                                        )}
                                        <div className="mb-1">
                                          <div className="text-xs text-text-tertiary font-semibold">Evidence classification:</div>
                                          <div className={`text-xs ${entry.evidenceClassification === 'operational' ? 'text-status-success' : 'text-status-warning'}`}>
                                            {entry.evidenceClassification || 'operational'}
                                          </div>
                                          <div className="text-xs text-text-tertiary">
                                            {entry.evidenceClassification === 'operational' ? 'operational proof' : 'diagnostic evidence'}
                                          </div>
                                        </div>
                                        {(entry.networkCorrelation || postState.networkCorrelation || []).length > 0 && (
                                          <div className="mb-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Deterministic network correlation:</div>
                                            {(entry.networkCorrelation || postState.networkCorrelation || []).slice(0, 4).map((event, i) => (
                                              <div key={i} className="text-xs text-status-success break-all">
                                                ✓ {event.method || 'n/a'} {event.url || 'n/a'} [{event.status || 'n/a'}]
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {/* Observed mutations */}
                                        {(postState.observedMutations || []).length > 0 && (
                                          <div className="mb-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Mutações observadas ({postState.mutationCount}):</div>
                                            {postState.observedMutations.slice(0, 5).map((m, i) => (
                                              <div key={i} className="text-xs text-status-success">✓ {m}</div>
                                            ))}
                                          </div>
                                        )}
                                        {/* Expected vs observed mutations */}
                                        {(postState.expectedMutations || []).length > 0 && (
                                          <div className="mb-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Mutações esperadas:</div>
                                            {postState.expectedMutations.map((m, i) => {
                                              const ok = !(postState.missingMutations || []).includes(m);
                                              return (
                                                <div key={i} className={`text-xs ${ok ? 'text-status-success' : 'text-status-error'}`}>{ok ? '✓' : '✗'} {m}</div>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {/* Observed side effects */}
                                        {(postState.observedSideEffects || []).length > 0 && (
                                          <div className="mb-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Side effects observados:</div>
                                            {postState.observedSideEffects.slice(0, 5).map((se, i) => (
                                              <div key={i} className="text-xs text-status-success">✓ {se}</div>
                                            ))}
                                          </div>
                                        )}
                                        {/* Expected side effects */}
                                        {(postState.expectedSideEffects || []).length > 0 && (
                                          <div className="mb-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Side effects esperados:</div>
                                            {postState.expectedSideEffects.map((se, i) => {
                                              const ok = !(postState.missingSideEffects || []).includes(se);
                                              return (
                                                <div key={i} className={`text-xs ${ok ? 'text-status-success' : 'text-status-error'}`}>{ok ? '✓' : '✗'} {se}</div>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {/* Post-state blockers */}
                                        {(postState.blockers || []).length > 0 && (
                                          <div>
                                            {postState.blockers.slice(0, 3).map((b, i) => (
                                              <div key={i} className="text-xs text-status-error break-all">✗ {b.reason}</div>
                                            ))}
                                          </div>
                                        )}
                                        {(entry.governanceReasoning || []).length > 0 && (
                                          <div className="mt-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Governance reasoning:</div>
                                            {(entry.governanceReasoning || []).slice(0, 4).map((item, i) => (
                                              <div key={i} className="text-xs text-status-error break-all">
                                                {item.reason || JSON.stringify(item)}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {(postState.mutationProvenance || entry.mutationProvenance || []).length > 0 && (
                                          <div className="mt-1">
                                            <div className="text-xs text-text-tertiary font-semibold">Deterministic provenance:</div>
                                            {(postState.mutationProvenance || entry.mutationProvenance || []).slice(0, 4).map((record, i) => (
                                              <div key={i} className={`text-xs break-all ${record.valid ? 'text-status-success' : 'text-status-error'}`}>
                                                {record.valid ? '✓' : '✗'} {record.mutation} | {record.correlatedBy || 'n/a'} | {record.originatingNetworkEvent?.method || 'n/a'} {record.originatingNetworkEvent?.url || ''}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ) : (entry.proofResult?.mutationProof || entry.proofResult?.sideEffectProof || entry.proofResult?.realSnapshotDiff) && (
                                      /* fallback: legado proofResult sem separação */
                                      <div className="rounded border border-border-default px-2 py-1 mb-1">
                                        <div className="text-xs font-bold text-text-secondary mb-1">POST STATE PROOF (legado)</div>
                                        {entry.proofResult?.mutationProof && (
                                          <div className="mb-1">
                                            <div className="text-xs text-text-tertiary">mutationCount: {entry.proofResult.mutationProof.mutationCount ?? 'n/a'}</div>
                                            {(entry.proofResult.mutationProof.observedMutations || []).map((m, i) => (
                                              <div key={i} className="text-xs text-status-success">✓ {m}</div>
                                            ))}
                                          </div>
                                        )}
                                        {entry.proofResult?.realSnapshotDiff && (
                                          <div className={`text-xs ${entry.proofResult.realSnapshotDiff.changed ? 'text-status-success' : 'text-text-tertiary'}`}>
                                            snapshot: {entry.proofResult.realSnapshotDiff.changed ? 'changed' : 'UNCHANGED'}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* All blockers summary */}
                                    {(entry.proofBlockers || entry.proofResult?.blockers || []).length > 0 && (
                                      <div className="mt-1">
                                        <div className="text-status-error text-xs font-semibold">Proof Blockers:</div>
                                        {(entry.proofBlockers || entry.proofResult?.blockers || []).slice(0, 5).map((b, i) => (
                                          <div key={i} className="text-xs text-status-error break-all">✗ {b.reason}{b.missingSideEffect ? ` (${b.missingSideEffect})` : ''}</div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              <div className="rounded border border-border-default bg-bg-primary px-2 py-1 mb-2">
                                <div className="font-semibold text-text-secondary">Network Events</div>
                                {entry.networkEventsCount > 0 ? (
                                  <div className="mt-1 space-y-1">
                                    {entry.networkEvents.slice(0, 4).map((event, eventIndex) => (
                                      <div key={eventIndex} className="text-text-tertiary break-all">
                                        {(event.method || 'METHOD')} {(event.status || 'n/a')} {(event.url || 'n/a')}
                                        {event.failureReason ? ` · ${event.failureReason}` : ''}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="mt-1 text-status-error">sem network events</div>
                                )}
                              </div>
                              {Object.keys(entry.sourceEvidence).length > 0 && (
                                <div className="text-text-tertiary mb-1">
                                  Fontes: {Object.entries(entry.sourceEvidence).map(([k, v]) => `${k}:${v}`).join(' · ')}
                                </div>
                              )}
                              {entry.seedEvidence && (
                                <div className="rounded border border-border-default bg-bg-primary px-2 py-1 mb-2">
                                  <div className="font-semibold text-text-secondary">Seed Linkage</div>
                                  <div className="text-text-tertiary break-all">{JSON.stringify(entry.seedEvidence)}</div>
                                </div>
                              )}
                              {entry.contract && (
                                <div className="rounded border border-border-default bg-bg-primary px-2 py-1 mb-2">
                                  <div className="font-semibold text-text-secondary">Contracts</div>
                                  <div className="text-text-tertiary">valid: {entry.contract.valid ? 'true' : 'false'}</div>
                                  {Array.isArray(entry.contract.missing) && entry.contract.missing.length > 0 && (
                                    <div className="text-status-error break-words">missing: {entry.contract.missing.slice(0, 3).map((item) => item.entry || item.path || item.reason || JSON.stringify(item)).join(' · ')}</div>
                                  )}
                                </div>
                              )}
                              {(entry.sideEffects.length > 0 || entry.requiredSideEffects.length > 0) && (
                                <div className="rounded border border-border-default bg-bg-primary px-2 py-1 mb-2">
                                  <div className="font-semibold text-text-secondary">Side Effects</div>
                                  <div className="text-text-tertiary">observados: {entry.sideEffects.join(', ') || 'n/a'}</div>
                                  <div className="text-text-tertiary">obrigatórios: {entry.requiredSideEffects.join(', ') || 'n/a'}</div>
                                </div>
                              )}
                              {entry.missingEvidence.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {entry.missingEvidence.map((field) => (
                                    <span key={field} className="rounded border border-status-error/40 bg-status-error/10 px-1.5 py-0.5 text-status-error text-[11px]">
                                      missing: {field}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {entry.strictReasons.length > 0 && (
                                <div className="mt-2 rounded border border-status-error/30 bg-status-error/5 px-2 py-1">
                                  <div className="font-semibold text-status-error">Motivo estrito</div>
                                  <div className="mt-1 text-status-error break-words">{entry.strictReasons.join(' · ')}</div>
                                </div>
                              )}
                              {entry.blockers.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {entry.blockers.slice(0, 3).map((blocker, bIdx) => (
                                    <div key={bIdx} className="rounded bg-status-error/5 border border-status-error/20 px-2 py-1 text-status-error break-words">
                                      {formatStrictReason(blocker.reason || 'unknown_blocker', blocker)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Modo Step-by-Step */}
              {replayStepByStep && displayReplaySteps.length > 0 && (
                <div className="mt-4">
                  <ReplayPlayer
                    steps={displayReplaySteps}
                    typedEntries={normalizedReplayTyped}
                    evidence={normalizedReplayEvidence}
                    onStepChange={handlePlayerStepChange}
                    focusStepAt={focusStepAt}
                  />
                </div>
              )}

              {/* Modo Lista Completa */}
              {!replayStepByStep && (
                <>
                  {/* Ações do replay - removido da lista completa pois agora está no painel direito */}

                  {/* Screenshots do replay */}
                  {replayData.screens && replayData.screens.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-text-primary mb-2">
                        {replayData.screens.length} tela(s) capturada(s) durante a execução
                      </h4>
                      <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                        {replayData.screens.map((screen, screenIndex) => (
                          <div key={screenIndex} className="border border-border-default rounded p-2">
                            {screen.screenshot && (
                              <img
                                src={`data:image/png;base64,${screen.screenshot}`}
                                alt={`Screenshot ${screenIndex + 1}`}
                                className="max-w-full h-auto rounded"
                              />
                            )}
                            {screen.timestamp && (
                              <div className="text-xs text-text-tertiary mt-1">
                                {formatDate(screen.timestamp)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Erros do replay */}
                  {replayData.errors && replayData.errors.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-status-error mb-2">Erros:</h4>
                      <div className="space-y-2">
                        {replayData.errors.map((error, errorIndex) => (
                          <div
                            key={errorIndex}
                            data-testid="replay-error"
                            className="p-2 rounded border border-status-error/20 bg-status-error/5 text-xs text-status-error"
                          >
                            {error.message || error}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
            </div>
          </div>

          {/* Painel de log de ações colapsável à direita */}
          <div
            className={`${actionsLogCollapsed ? 'w-12' : ''} min-w-[48px] flex flex-col transition-all duration-200 flow-editor-right-panel border-l border-border-default`}
            data-testid="replay-sidebar"
            style={!actionsLogCollapsed ? { width: `${actionsLogWidth}px` } : {}}
          >
            {/* Header do painel */}
            <div className="section-header border-b border-border-default">
              <button
                className={`collapse-btn-horizontal collapse-btn-right ${actionsLogCollapsed ? 'collapsed' : ''}`}
                onClick={() => setActionsLogCollapsed(!actionsLogCollapsed)}
                title={actionsLogCollapsed ? 'Expandir log de ações' : 'Recolher log de ações'}
              >
              </button>
              {!actionsLogCollapsed && (
                <span className="text-xs font-semibold text-text-primary px-2">
                  📋 Log de Passos
                </span>
              )}
            </div>

            {/* Conteúdo do painel */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {actionsLogCollapsed ? (
                <div
                  className="flex-1 p-2 section-container flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                  onClick={() => setActionsLogCollapsed(false)}
                  title="Clique para expandir Log de Passos"
                >
                  <span className="resizable-panel-collapsed-text">Log de Passos</span>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {replayData && replaySteps.length > 0 ? (
                    <div className="flex-1 overflow-y-auto p-3 space-y-2" id="actions-log-container">
                      <div className="text-xs text-text-tertiary mb-2">
                        {visibleReplaySteps.length} passo(s) registrado(s)
                      </div>
                      {visibleReplaySteps.map((step) => {
                        const stepIndex = replaySteps.indexOf(step);
                        const isCurrentStep = replayStepByStep &&
                          currentReplayStep === stepIndex;
                        
                        // Formata o valor corretamente
                        const formatValue = (value) => {
                          if (value === undefined || value === null) return '';
                          if (typeof value === 'object') {
                            try {
                              return JSON.stringify(value, null, 2);
                            } catch {
                              return String(value);
                            }
                          }
                          return String(value);
                        };

                        if (step.type === 'trace-step') {
                          const traceStep = step.data;
                          const isFailed = ['failed', 'timeout'].includes(String(traceStep.status || '').toLowerCase()) || !!traceStep.error;
                          const stepNumber = traceStep.index || stepIndex + 1;
                          const actionLabel = String(traceStep.action || traceStep.name || 'passo')
                            .split('_')
                            .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
                            .join(' ');
                          const statusLabel = String(traceStep.status || (isFailed ? 'failed' : 'success')).toLowerCase();
                          const variantText = traceStep.input?.variants?.[0];
                          const expectedText = traceStep.expected
                            ? Object.entries(traceStep.expected)
                                .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
                                .join(', ')
                            : null;
                          const durationText = traceStep.durationMs !== undefined
                            ? `${traceStep.durationMs}ms`
                            : '0ms (nao registrada)';
                          return (
                            <div
                              key={`trace-step-${traceStep.id || step.index}`}
                              id={`step-${stepIndex}`}
                              data-testid="replay-step"
                              className={`p-2 rounded border text-xs cursor-pointer transition-colors ${
                                isCurrentStep
                                  ? 'bg-accent-primary/30 border-accent-primary border-2 shadow-md'
                                  : isFailed
                                  ? 'bg-status-error/5 border-status-error/20 hover:bg-status-error/10'
                                  : 'bg-status-success/5 border-status-success/20 hover:bg-status-success/10'
                              }`}
                              onClick={() => {
                                setReplayStepByStep(true);
                                setCurrentReplayStep(stepIndex);
                                setFocusStepAt(step.timestamp || null);
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="text-text-primary font-semibold break-words">
                                    {traceStep.isUiStep ? '🖥️' : '📌'} Passo {stepNumber}: {actionLabel}
                                  </div>
                                  <div className="text-text-secondary mt-1 break-words">▶️ Ação: {traceStep.action || '-'}</div>
                                  {traceStep.isUiStep && traceStep.input !== null && traceStep.input !== undefined && typeof traceStep.input !== 'object' && (
                                    <div className="text-text-secondary mt-1 break-words">
                                      📝 Valor preenchido: <span className="font-mono">&quot;{String(traceStep.input)}&quot;</span>
                                    </div>
                                  )}
                                  {variantText && (
                                    <div className="text-text-secondary mt-1 break-words">
                                      📝 Variante: <span className="font-mono">&quot;{variantText}&quot;</span>
                                    </div>
                                  )}
                                  {!variantText && (
                                    <div className="text-text-secondary mt-1 break-words">
                                      🎯 Esperado: {expectedText || '(validar SLA nao especificado)'}
                                    </div>
                                  )}
                                  {traceStep.selector && (
                                    <div className="text-text-secondary mt-1 break-all">
                                      Seletor: <span className="font-mono">{traceStep.selector}</span>
                                    </div>
                                  )}
                                  <div className="text-text-secondary mt-1">{isFailed ? '❌' : '✅'} Status: {statusLabel}</div>
                                  <div className="text-text-tertiary mt-1">⏱️ Duração: {durationText}</div>
                                  {(traceStep.startedAt || traceStep.timestamp) && (
                                    <div className="text-text-tertiary mt-1">{formatDate(traceStep.startedAt || traceStep.timestamp)}</div>
                                  )}
                                  {isFailed && traceStep.error && (
                                    <div className="mt-2 p-2 rounded bg-status-error/10 border border-status-error/30 text-status-error break-all">
                                      {traceStep.error?.message || traceStep.error}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        } else if (step.type === 'action') {
                          const action = step.data;
                          return (
                            <div
                              key={`action-${step.index}`}
                              id={`step-${stepIndex}`}
                              className={`p-2 rounded border text-xs cursor-pointer transition-colors ${
                                isCurrentStep
                                  ? 'bg-accent-primary/30 border-accent-primary border-2 shadow-md'
                                  : action.success !== false
                                  ? 'bg-status-success/5 border-status-success/20 hover:bg-status-success/10'
                                  : 'bg-status-error/5 border-status-error/20 hover:bg-status-error/10'
                              }`}
                              onClick={() => {
                                setReplayStepByStep(true);
                                setCurrentReplayStep(stepIndex);
                                setFocusStepAt(step.timestamp || null);
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 mb-1">
                                    <span className="text-xs">🔧</span>
                                    <div className="font-mono text-text-primary font-semibold truncate">
                                      Passo {stepIndex + 1}: {action.type}
                                    </div>
                                  </div>
                                  {action.selector && (
                                    <div className="text-text-secondary mt-1 break-all">
                                      <span className="text-text-tertiary">Seletor:</span>{' '}
                                      <span className="font-mono text-xs">{action.selector}</span>
                                    </div>
                                  )}
                                  {action.value !== undefined && (
                                    <div className="text-text-secondary mt-1 break-all">
                                      <span className="text-text-tertiary">Valor:</span>{' '}
                                      <span className="text-xs font-mono whitespace-pre-wrap">
                                        {formatValue(action.value).substring(0, 100)}{formatValue(action.value).length > 100 ? '...' : ''}
                                      </span>
                                    </div>
                                  )}
                                  {action.expected != null && (
                                    <div className="text-text-secondary mt-1 break-all">
                                      <span className="text-text-tertiary">🎯 Esperado:</span>{' '}
                                      <span className="text-xs font-mono whitespace-pre-wrap">
                                        {formatValue(action.expected)}
                                      </span>
                                    </div>
                                  )}
                                  {action.actual != null && (
                                    <div className="text-text-secondary mt-1 break-all">
                                      <span className="text-text-tertiary">👁️ Observado:</span>{' '}
                                      <span className="text-xs font-mono whitespace-pre-wrap">
                                        {formatValue(action.actual)}
                                      </span>
                                    </div>
                                  )}
                                  {action.contract != null && (
                                    <div className="text-text-secondary mt-1 break-all">
                                      <span className="text-text-tertiary">📋 Contrato:</span>{' '}
                                      <span className="text-xs font-mono whitespace-pre-wrap">
                                        {formatValue(action.contract)}
                                      </span>
                                    </div>
                                  )}
                                  {action.step && (
                                    <div className="text-text-tertiary mt-1 text-xs">
                                      {action.step}
                                    </div>
                                  )}
                                </div>
                                <div className="flex-shrink-0 ml-2">
                                  {action.success !== false ? (
                                    <span className="text-status-success text-sm">✓</span>
                                  ) : (
                                    <span className="text-status-error text-sm">✗</span>
                                  )}
                                </div>
                              </div>
                              {action.duration && (
                                <div className="text-text-tertiary mt-1 text-xs">
                                  Duração: {action.duration}ms
                                </div>
                              )}
                              {action.timestamp && (
                                <div className="text-text-tertiary mt-1 text-xs">
                                  {formatDate(action.timestamp)}
                                </div>
                              )}
                              {isCurrentStep && (
                                <div className="mt-2 pt-2 border-t border-accent-primary/30">
                                  <div className="text-xs font-semibold text-accent-primary">
                                    ⬅ Passo Atual
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        } else if (step.type === 'screen') {
                          const screen = step.data;
                          return (
                            <div
                              key={`screen-${step.index}`}
                              id={`step-${stepIndex}`}
                              className={`p-2 rounded border text-xs cursor-pointer transition-colors ${
                                isCurrentStep
                                  ? 'bg-accent-primary/30 border-accent-primary border-2 shadow-md'
                                  : 'bg-bg-primary border-border-default hover:bg-bg-secondary'
                              }`}
                              onClick={() => {
                                setReplayStepByStep(true);
                                setCurrentReplayStep(stepIndex);
                                setFocusStepAt(step.timestamp || null);
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 mb-1">
                                    <span className="text-xs">📸</span>
                                    <div className="text-text-primary font-semibold">
                                      Passo {stepIndex + 1}: Tela
                                    </div>
                                  </div>
                                  {screen.step && (
                                    <div className="text-text-tertiary mt-1 text-xs">
                                      {screen.step}
                                    </div>
                                  )}
                                  {screen.timestamp && (
                                    <div className="text-text-tertiary mt-1 text-xs">
                                      {formatDate(screen.timestamp)}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {isCurrentStep && (
                                <div className="mt-2 pt-2 border-t border-accent-primary/30">
                                  <div className="text-xs font-semibold text-accent-primary">
                                    ⬅ Passo Atual
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        } else if (step.type === 'log-event') {
                          const event = step.data;
                          const cls =
                            event.level === 'error' ? 'border-status-error/30 bg-status-error/5' :
                            event.level === 'warning' ? 'border-status-warning/30 bg-status-warning/5' :
                            event.level === 'success' ? 'border-status-success/30 bg-status-success/5' :
                            'border-border-default bg-bg-primary';
                          return (
                            <div
                              key={`log-event-${step.index}`}
                              id={`step-${stepIndex}`}
                              className={`p-2 rounded border text-xs ${cls} ${isCurrentStep ? 'ring-2 ring-accent-primary' : ''}`}
                              onClick={() => { setReplayStepByStep(true); setCurrentReplayStep(stepIndex); setFocusStepAt(step.timestamp || null); }}
                            >
                              <div className="flex gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="text-text-primary break-words">{event.message}</div>
                                  {event.details && (
                                    <div className="text-text-secondary text-[10px] mt-0.5 break-words">{event.details}</div>
                                  )}
                                  {event.errors && Array.isArray(event.errors) && event.errors.length > 0 && (
                                    <div className="mt-1 space-y-0.5">
                                      {event.errors.map((err, i) => (
                                        <div key={i} className="text-[10px] bg-bg-secondary rounded px-1 py-0.5 break-words text-text-secondary">
                                          {err.message || String(err)}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {event.timestamp && (
                                    <div className="text-text-tertiary text-[10px] mt-0.5">{formatDate(event.timestamp)}</div>
                                  )}
                                </div>
                                {event.step !== undefined && (
                                  <span className="text-text-tertiary text-[10px] shrink-0">{event.step}</span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center p-4">
                      <div className="text-center">
                        <p className="text-text-secondary text-sm mb-2">
                          Nenhuma ação registrada
                        </p>
                        <p className="text-text-tertiary text-xs">
                          As ações aparecerão aqui quando disponíveis
                        </p>
                      </div>
                    </div>
                  )}
                  {/* Timeline / Logs da Execução — só exibe quando NÃO há steps (replay RPA puro sem timeline integrada) */}
                  {replayData && !(Array.isArray(replayData.steps) && replayData.steps.length > 0) && (() => {
                    const timeline = replayData.timeline || replayData.logs || [];
                    if (timeline.length === 0) return null;
                    const pageErrors = timeline.filter((e) => e.level === 'warning' || e.level === 'error');
                    return (
                      <div className="border-t border-border-default">
                        <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary">
                          <span className="text-xs font-semibold text-text-secondary">📊 Logs da Execução</span>
                          <span className="text-text-tertiary text-[10px]">{timeline.length} eventos</span>
                          {pageErrors.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-status-warning/20 text-status-warning border border-status-warning/30">
                              ⚠️ {pageErrors.length}
                            </span>
                          )}
                        </div>
                        <div className="overflow-y-auto max-h-80 p-2 space-y-1">
                          {timeline.map((event, idx) => {
                            const cls =
                              event.level === 'error' ? 'border-status-error/30 bg-status-error/5 text-status-error' :
                              event.level === 'warning' ? 'border-status-warning/30 bg-status-warning/5 text-status-warning' :
                              event.level === 'success' ? 'border-status-success/30 bg-status-success/5' :
                              'border-border-default bg-bg-primary';
                            return (
                              <div key={idx} className={`flex gap-2 p-1.5 rounded border text-[11px] ${cls}`}>
                                <span className="text-text-tertiary font-mono shrink-0 text-[10px] pt-px">
                                  {event.timestamp ? new Date(event.timestamp).toLocaleTimeString('pt-BR') : `#${idx + 1}`}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-text-primary break-words">{event.message}</span>
                                  {event.details && (
                                    <span className="text-text-secondary ml-1 break-words">— {event.details}</span>
                                  )}
                                  {event.errors && Array.isArray(event.errors) && event.errors.length > 0 && (
                                    <div className="mt-1 space-y-0.5">
                                      {event.errors.map((err, i) => (
                                        <div key={i} className="text-[10px] bg-bg-secondary rounded px-1 py-0.5 break-words text-text-secondary">
                                          {err.message || String(err)}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {event.step !== undefined && (
                                  <span className="text-text-tertiary text-[10px] shrink-0">{event.step}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </Dialog>

      {/* Modal de confirmação de remoção */}
      <Dialog
        isOpen={showDeleteConfirm !== null}
        onClose={() => setShowDeleteConfirm(null)}
        title="🗑️ Confirmar Remoção"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-text-primary">
            Tem certeza que deseja remover o replay <strong>{showDeleteConfirm}</strong>?
          </p>
          <p className="text-text-secondary text-sm">
            Esta ação não pode ser desfeita.
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              onClick={() => setShowDeleteConfirm(null)}
              variant="default"
              size="sm"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDeleteReplay}
              variant="danger"
              size="sm"
              disabled={deletingReplay !== null}
            >
              {deletingReplay ? 'Removendo...' : 'Remover'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={showDeleteAllConfirm}
        onClose={() => setShowDeleteAllConfirm(false)}
        title="🗑️ Confirmar Remoção Total"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-text-primary">
            Tem certeza que deseja remover <strong>todos os replays</strong>?
          </p>
          <p className="text-text-secondary text-sm">
            Esta ação remove os arquivos de replay da raiz e do diretório system. Não pode ser desfeita.
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              onClick={() => setShowDeleteAllConfirm(false)}
              variant="default"
              size="sm"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDeleteAllReplays}
              variant="danger"
              size="sm"
              disabled={deletingAllReplays}
            >
              {deletingAllReplays ? 'Removendo...' : 'Remover Todos'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={showDeleteSelectedConfirm}
        onClose={() => setShowDeleteSelectedConfirm(false)}
        title="🗑️ Confirmar Remoção em Lote"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-text-primary">
            Tem certeza que deseja remover <strong>{selectedFilenames.length} replay(s) selecionado(s)</strong>?
          </p>
          <p className="text-text-secondary text-sm">
            Esta ação não pode ser desfeita.
          </p>
          {selectedFilenames.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded border border-border-default bg-bg-secondary p-2 text-xs text-text-secondary">
              {selectedFilenames.slice(0, 10).map((filename) => (
                <div key={filename} className="truncate">• {filename}</div>
              ))}
              {selectedFilenames.length > 10 && (
                <div className="text-text-tertiary mt-1">... e mais {selectedFilenames.length - 10}</div>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button
              onClick={() => setShowDeleteSelectedConfirm(false)}
              variant="default"
              size="sm"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDeleteSelected}
              variant="danger"
              size="sm"
              disabled={deletingSelected || selectedFilenames.length === 0}
            >
              {deletingSelected ? 'Removendo...' : 'Remover Selecionados'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Modal de visualização do roteiro (texto formatado) */}
      <Dialog
        isOpen={showRecordingModal}
        onClose={() => {
          setShowRecordingModal(false);
          setRecordingData(null);
        }}
        title={`📜 Roteiro${recordingData?.id ? `: ${recordingData.id}` : ''}`}
        size="xl"
      >
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ minHeight: '420px' }}>
          {loadingRecording ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-2"></div>
              <p className="text-text-secondary">Carregando roteiro...</p>
            </div>
          ) : recordingData ? (
            <pre className="whitespace-pre-wrap font-mono text-sm text-text-primary bg-bg-primary rounded-lg border border-border-default p-4 leading-relaxed">
              {formatRecordingText(recordingData)}
            </pre>
          ) : (
            <p className="text-text-secondary py-8 text-center">Roteiro não disponível.</p>
          )}
        </div>
      </Dialog>

      {/* Modal de visualização de screenshot */}
      <Dialog
        isOpen={showScreenshotModal}
        onClose={() => {
          setShowScreenshotModal(false);
          if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
          setScreenshotUrl(null);
          setScreenshotLabel('');
        }}
        title={`📸 Screenshot ${screenshotLabel}`}
        size="xl"
      >
        <div className="flex-1 min-h-0 overflow-auto p-2 bg-bg-primary rounded-lg" style={{ minHeight: '420px' }}>
          {screenshotUrl ? (
            <img src={screenshotUrl} alt={screenshotLabel} className="mx-auto max-w-full h-auto rounded border border-border-default" />
          ) : (
            <p className="text-text-secondary py-8 text-center">Screenshot não disponível.</p>
          )}
        </div>
      </Dialog>

      <ToastContainer />
    </div>
  );
}
