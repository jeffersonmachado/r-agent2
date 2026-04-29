import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Dialog } from '../components/Dialog';
import { listRpaReplays, getRpaReplay, deleteRpaReplay, deleteAllRpaReplays } from '../api/flows';
import logger from '../utils/logger';

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
  const [replayStepByStep, setReplayStepByStep] = useState(false);
  const [currentReplayStep, setCurrentReplayStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const [replayInfoCollapsed, setReplayInfoCollapsed] = useState(false);
  
  // Filtros
  const [searchText, setSearchText] = useState('');
  const [filterResult, setFilterResult] = useState('all'); // 'all', 'success', 'failed'
  const [filterDateRange, setFilterDateRange] = useState('all'); // 'all', 'today', 'week', 'month'
  const [sortBy, setSortBy] = useState('date'); // 'date', 'name', 'size', 'duration'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  const [displayMode, setDisplayMode] = useState(() => localStorage.getItem('rpaReplaysDisplayMode') || 'card');
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
  }, [searchText, filterResult, filterDateRange, sortBy, sortOrder, pageSize]);

  // Carrega lista de replays
  useEffect(() => {
    loadReplays();
  }, [currentPage, pageSize, searchText, filterResult, filterDateRange, sortBy, sortOrder]);

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

  const handleViewReplay = async (filename) => {
    setSelectedReplay(filename);
    setShowReplayModal(true);
    setLoadingReplay(true);
    setReplayData(null);
    setReplayStepByStep(false);
    setCurrentReplayStep(0);
    setIsPlaying(false);
    setIsFullscreen(false);

    try {
      console.log('📂 [RpaReplaysPage] Loading replay:', filename);
      const data = await getRpaReplay(filename);
      console.log('✅ [RpaReplaysPage] Replay loaded successfully:', { 
        filename, 
        hasActions: !!data?.actions, 
        hasScreens: !!data?.screens 
      });
      setReplayData(data);
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

  const hasActiveFilters = searchText.trim() || filterResult !== 'all' || filterDateRange !== 'all';
  const totalReplays = pagination.total || replays.length;
  const totalPages = Math.max(1, Math.ceil(totalReplays / (pagination.limit || pageSize || 1)));
  const pageStart = totalReplays === 0 ? 0 : (pagination.offset || 0) + 1;
  const pageEnd = totalReplays === 0 ? 0 : Math.min((pagination.offset || 0) + replays.length, totalReplays);

  const clearFilters = () => {
    setSearchText('');
    setFilterResult('all');
    setFilterDateRange('all');
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
    <div className="h-screen w-full bg-bg-primary flex flex-col overflow-hidden">
      {/* Header fixo */}
      <div className="flex-shrink-0 p-6 border-b border-border-default bg-bg-elevated">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">
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
          setReplayStepByStep(false);
          setCurrentReplayStep(0);
          setIsPlaying(false);
          setIsFullscreen(false);
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
                      >
                        {replayStepByStep ? '📋 Ver Lista Completa' : '▶️ Play'}
                      </Button>
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
                  {replayData.errors?.length > 0 && (
                    <div>
                      <span className="text-text-tertiary block mb-1">Erros:</span>
                      <p className="text-status-error text-xs font-semibold">
                        {replayData.errors.length} erro(s) encontrado(s)
                      </p>
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

              {/* Modo Step-by-Step */}
              {replayStepByStep && totalSteps > 0 && currentStep && (
                <div className="mt-4 space-y-4">
                  {/* Controles de navegação e velocidade */}
                  <div className="bg-bg-primary rounded-lg border border-border-default p-3 space-y-3">
                    {/* Controles de navegação */}
                    <div className="flex items-center justify-between">
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
                          ⏪ Anterior
                        </Button>
                      </div>
                      
                      <div className="flex-1 mx-4">
                        <div className="text-center text-xs text-text-secondary mb-1">
                          Passo {currentReplayStep + 1} de {totalSteps}
                        </div>
                        <div className="w-full bg-bg-secondary rounded-full h-2">
                          <div
                            className="bg-accent-primary h-2 rounded-full transition-all"
                            style={{ width: `${((currentReplayStep + 1) / totalSteps) * 100}%` }}
                          />
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
                          Próximo ⏩
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

                    {/* Controles de reprodução e velocidade */}
                    <div className="flex items-center justify-between pt-2 border-t border-border-default">
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={togglePlayPause}
                          variant={isPlaying ? "danger" : "default"}
                          size="sm"
                          className="text-xs"
                        >
                          {isPlaying ? '⏸️ Pausar' : '▶️ Reproduzir'}
                        </Button>
                        <span className="text-xs text-text-tertiary">
                          {isPlaying ? 'Reproduzindo...' : 'Pausado'}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-text-secondary">
                          Velocidade:
                        </label>
                        <select
                          value={playbackSpeed}
                          onChange={(e) => handleSpeedChange(Number(e.target.value))}
                          className="px-2 py-1 text-xs bg-bg-secondary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                          disabled={isPlaying}
                        >
                          <option value={5000}>🐌 Muito Lento (5s)</option>
                          <option value={2000}>🐢 Lento (2s)</option>
                          <option value={1000}>🚶 Normal (1s)</option>
                          <option value={500}>🏃 Rápido (0.5s)</option>
                          <option value={200}>⚡ Muito Rápido (0.2s)</option>
                          <option value={100}>🚀 Máxima (0.1s)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Conteúdo do passo atual - APENAS Screenshots */}
                  {((currentStep.type === 'screen' && currentStep.data.screenshot) || 
                    (currentStep.type === 'action' && lastScreenshot)) && (
                    <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                      <div className="mb-2">
                        <span className="text-xs font-semibold text-text-tertiary">
                          📸 Tela
                        </span>
                        {(currentStep.type === 'screen' ? currentStep.data.timestamp : lastScreenshot?.timestamp) && (
                          <span className="text-xs text-text-tertiary ml-2">
                            {formatDate(
                              currentStep.type === 'screen' 
                                ? currentStep.data.timestamp 
                                : lastScreenshot.timestamp
                            )}
                          </span>
                        )}
                        {currentStep.type === 'action' && (
                          <span className="text-xs text-text-tertiary ml-2">
                            (última tela)
                          </span>
                        )}
                      </div>
                      <div className="mt-2">
                        <img
                          src={`data:image/png;base64,${currentStep.type === 'screen' ? currentStep.data.screenshot : lastScreenshot.screenshot}`}
                          alt={`Screenshot do passo ${currentReplayStep + 1}`}
                          className="max-w-full h-auto rounded border border-border-default"
                        />
                      </div>
                    </div>
                  )}
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
                        {replaySteps.length} passo(s) registrado(s)
                      </div>
                      {replaySteps.map((step, stepIndex) => {
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

                        if (step.type === 'action') {
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
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 mb-1">
                                    <span className="text-xs">🔧</span>
                                    <div className="font-mono text-text-primary font-semibold truncate">
                                      {action.type}
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
                                  {action.step && (
                                    <div className="text-text-tertiary mt-1 text-xs">
                                      {action.step}
                                    </div>
                                  )}
                                  {action.timestamp && (
                                    <div className="text-text-tertiary mt-1 text-xs">
                                      {formatDate(action.timestamp)}
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
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 mb-1">
                                    <span className="text-xs">📸</span>
                                    <div className="text-text-primary font-semibold">
                                      Tela
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
                                <div className="flex-shrink-0 ml-2">
                                  <span className="text-xs">📸</span>
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

      <ToastContainer />
    </div>
  );
}
