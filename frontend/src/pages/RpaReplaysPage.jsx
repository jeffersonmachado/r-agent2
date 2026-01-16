import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Dialog } from '../components/Dialog';
import { listRpaReplays, getRpaReplay, deleteRpaReplay } from '../api/flows';
import logger from '../utils/logger';

/**
 * Página para listar e visualizar todos os arquivos de replay RPA.
 */
export function RpaReplaysPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [replays, setReplays] = useState([]);
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [actionsLogCollapsed, setActionsLogCollapsed] = useState(false);
  const [actionsLogWidth, setActionsLogWidth] = useState(() => {
    const saved = localStorage.getItem('replayActionsLogWidth');
    return saved ? parseInt(saved, 10) : 400;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [replayInfoCollapsed, setReplayInfoCollapsed] = useState(false);
  
  // Filtros
  const [searchText, setSearchText] = useState('');
  const [filterResult, setFilterResult] = useState('all'); // 'all', 'success', 'failed'
  const [filterDateRange, setFilterDateRange] = useState('all'); // 'all', 'today', 'week', 'month'
  const [sortBy, setSortBy] = useState('date'); // 'date', 'name', 'size', 'duration'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'

  // Salva largura do painel de log
  useEffect(() => {
    localStorage.setItem('replayActionsLogWidth', actionsLogWidth.toString());
  }, [actionsLogWidth]);

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
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Carrega lista de replays
  useEffect(() => {
    loadReplays();
  }, []);

  const loadReplays = async () => {
    setLoading(true);
    try {
      const result = await listRpaReplays();
      setReplays(result.files || []);
    } catch (err) {
      logger.error('Erro ao carregar replays', err);
      showToast('Erro ao carregar lista de replays', 'error', 3000);
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
      const data = await getRpaReplay(filename);
      setReplayData(data);
    } catch (err) {
      logger.error('Erro ao carregar replay', err);
      showToast('Erro ao carregar replay', 'error', 3000);
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
    return new Date(dateString).toLocaleString('pt-BR');
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
      // Recarrega a lista
      await loadReplays();
    } catch (err) {
      logger.error('Erro ao remover replay', err);
      showToast('Erro ao remover replay', 'error', 3000);
    } finally {
      setDeletingReplay(null);
    }
  };

  // Função de filtragem
  const getFilteredReplays = () => {
    let filtered = [...replays];

    // Filtro de busca por texto (nome, ID, recordingId)
    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(replay => {
        const filename = (replay.filename || '').toLowerCase();
        const id = (replay.id || '').toLowerCase();
        const recordingId = (replay.recordingId || '').toLowerCase();
        return filename.includes(searchLower) || 
               id.includes(searchLower) || 
               recordingId.includes(searchLower);
      });
    }

    // Filtro por resultado
    if (filterResult !== 'all') {
      filtered = filtered.filter(replay => {
        if (filterResult === 'success') {
          return replay.result === 'success';
        } else if (filterResult === 'failed') {
          return replay.result !== 'success' && replay.result !== undefined;
        }
        return true;
      });
    }

    // Filtro por data
    if (filterDateRange !== 'all') {
      const now = new Date();
      const cutoffDate = new Date();
      
      if (filterDateRange === 'today') {
        cutoffDate.setHours(0, 0, 0, 0);
      } else if (filterDateRange === 'week') {
        cutoffDate.setDate(now.getDate() - 7);
      } else if (filterDateRange === 'month') {
        cutoffDate.setDate(now.getDate() - 30);
      }

      filtered = filtered.filter(replay => {
        const replayDate = new Date(replay.modified || replay.startTime || 0);
        return replayDate >= cutoffDate;
      });
    }

    // Ordenação
    filtered.sort((a, b) => {
      let compareA, compareB;

      switch (sortBy) {
        case 'name':
          compareA = (a.filename || '').toLowerCase();
          compareB = (b.filename || '').toLowerCase();
          break;
        case 'size':
          compareA = a.size || 0;
          compareB = b.size || 0;
          break;
        case 'duration':
          compareA = a.duration || 0;
          compareB = b.duration || 0;
          break;
        case 'date':
        default:
          compareA = new Date(a.modified || a.startTime || 0).getTime();
          compareB = new Date(b.modified || b.startTime || 0).getTime();
          break;
      }

      if (sortBy === 'name') {
        return sortOrder === 'asc' 
          ? compareA.localeCompare(compareB)
          : compareB.localeCompare(compareA);
      } else {
        return sortOrder === 'asc' 
          ? compareA - compareB
          : compareB - compareA;
      }
    });

    return filtered;
  };

  const filteredReplays = getFilteredReplays();
  const hasActiveFilters = searchText.trim() || filterResult !== 'all' || filterDateRange !== 'all';

  const clearFilters = () => {
    setSearchText('');
    setFilterResult('all');
    setFilterDateRange('all');
    setSortBy('date');
    setSortOrder('desc');
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
              {filteredReplays.length !== replays.length && (
                <span className="ml-2 text-accent-primary">
                  ({filteredReplays.length} de {replays.length})
                </span>
              )}
            </p>
          </div>
          <Button
            onClick={loadReplays}
            variant="default"
            size="sm"
            disabled={loading}
          >
            🔄 Atualizar Lista
          </Button>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredReplays.map((replay) => (
              <div
                key={replay.filename}
                className="bg-bg-secondary rounded-lg border border-border-default p-4 hover:border-accent-primary transition-colors"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 
                    className="text-sm font-semibold text-text-primary truncate flex-1 cursor-pointer"
                    onClick={() => handleViewReplay(replay.filename)}
                    title={replay.filename}
                  >
                    {replay.filename}
                  </h3>
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
                  {/* Informações básicas */}
                  <div className="flex items-center justify-between text-xs text-text-tertiary mt-2">
                    <span>{formatFileSize(replay.size)}</span>
                    <span>{formatDate(replay.modified)}</span>
                  </div>

                  {/* Detalhes adicionais */}
                  <div className="mt-3 space-y-1 text-xs">
                    {replay.id && (
                      <div className="text-text-secondary">
                        <span className="text-text-tertiary">ID:</span>{' '}
                        <span className="font-mono">{replay.id}</span>
                      </div>
                    )}
                    {replay.recordingId && (
                      <div className="text-text-secondary">
                        <span className="text-text-tertiary">Gravação:</span>{' '}
                        <span className="font-mono">{replay.recordingId}</span>
                      </div>
                    )}
                    {replay.result && (
                      <div className="text-text-secondary">
                        <span className="text-text-tertiary">Resultado:</span>{' '}
                        <span className={`${
                          replay.result === 'success' 
                            ? 'text-status-success' 
                            : 'text-status-error'
                        }`}>
                          {replay.result === 'success' ? '✓ Sucesso' : '✗ Falhou'}
                        </span>
                      </div>
                    )}
                    {replay.mode && (
                      <div className="text-text-secondary">
                        <span className="text-text-tertiary">Modo:</span>{' '}
                        <span>{replay.mode}</span>
                      </div>
                    )}
                    {(replay.actionCount !== undefined || replay.screenCount !== undefined) && (
                      <div className="text-text-secondary">
                        <span className="text-text-tertiary">Ações:</span>{' '}
                        <span>{replay.actionCount || 0}</span>
                        {replay.screenCount !== undefined && (
                          <>
                            {' • '}
                            <span className="text-text-tertiary">Telas:</span>{' '}
                            <span>{replay.screenCount}</span>
                          </>
                        )}
                      </div>
                    )}
                    {replay.errorCount > 0 && (
                      <div className="text-status-error">
                        <span className="text-text-tertiary">Erros:</span>{' '}
                        <span>{replay.errorCount}</span>
                      </div>
                    )}
                    {replay.duration && (
                      <div className="text-text-secondary">
                        <span className="text-text-tertiary">Duração:</span>{' '}
                        <span>{formatDuration(replay.duration)}</span>
                      </div>
                    )}
                    {replay.startTime && (
                      <div className="text-text-secondary">
                        <span className="text-text-tertiary">Início:</span>{' '}
                        <span>{formatDate(replay.startTime)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
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

      <ToastContainer />
    </div>
  );
}

