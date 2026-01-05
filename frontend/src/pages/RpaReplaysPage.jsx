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
  const [deletingReplay, setDeletingReplay] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

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

  const goToStep = (stepIndex) => {
    if (stepIndex >= 0 && stepIndex < totalSteps) {
      setCurrentReplayStep(stepIndex);
    }
  };

  const goToFirst = () => goToStep(0);
  const goToPrevious = () => goToStep(currentReplayStep - 1);
  const goToNext = () => goToStep(currentReplayStep + 1);
  const goToLast = () => goToStep(totalSteps - 1);

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

  return (
    <div className="h-screen bg-bg-primary flex flex-col overflow-hidden">
      {/* Header fixo */}
      <div className="flex-shrink-0 p-6 border-b border-border-default bg-bg-elevated">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">
              📋 Replays RPA
            </h1>
            <p className="text-text-secondary">
              Visualize todos os arquivos de replay de testes RPA executados
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {replays.map((replay) => (
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
        }}
        title={`📋 Replay: ${selectedReplay || ''}`}
        size="xl"
        draggable={true}
        resizable={true}
      >
        <div className="space-y-6 max-h-[80vh] overflow-y-auto">
          {loadingReplay && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-2"></div>
              <p className="text-text-secondary">Carregando replay...</p>
            </div>
          )}

          {replayData && !loadingReplay && (
            <>
              {/* Informações do replay */}
              <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-text-primary">📋 Informações do Replay</h3>
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
                        {formatDate(replayData.startTime)}
                      </p>
                    </div>
                  )}
                  {replayData.endTime && (
                    <div>
                      <span className="text-text-tertiary block">Fim:</span>
                      <p className="text-text-primary">
                        {formatDate(replayData.endTime)}
                      </p>
                    </div>
                  )}
                  {replayData.mode && (
                    <div>
                      <span className="text-text-tertiary block">Modo:</span>
                      <p className="text-text-primary">{replayData.mode}</p>
                    </div>
                  )}
                  {replayData.result && (
                    <div>
                      <span className="text-text-tertiary block">Resultado:</span>
                      <p className={`text-text-primary ${
                        replayData.result === 'success' ? 'text-status-success' : 'text-status-error'
                      }`}>
                        {replayData.result}
                      </p>
                    </div>
                  )}
                </div>
              </div>

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

                  {/* Conteúdo do passo atual */}
                  <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                    <div className="mb-2">
                      <span className="text-xs font-semibold text-text-tertiary">
                        {currentStep.type === 'action' ? '🔧 Ação' : '📸 Tela'}
                      </span>
                      {currentStep.data.timestamp && (
                        <span className="text-xs text-text-tertiary ml-2">
                          {formatDate(currentStep.data.timestamp)}
                        </span>
                      )}
                    </div>
                    
                    {currentStep.type === 'action' && (
                      <div className="space-y-2">
                        <div>
                          <span className="text-xs text-text-tertiary">Tipo: </span>
                          <span className="text-xs text-text-primary font-mono">
                            {currentStep.data.type}
                          </span>
                        </div>
                        {currentStep.data.selector && (
                          <div>
                            <span className="text-xs text-text-tertiary">Seletor: </span>
                            <span className="text-xs text-text-primary font-mono">
                              {currentStep.data.selector}
                            </span>
                          </div>
                        )}
                        {currentStep.data.value !== undefined && (
                          <div>
                            <span className="text-xs text-text-tertiary">Valor: </span>
                            <span className="text-xs text-text-primary">
                              {String(currentStep.data.value)}
                            </span>
                          </div>
                        )}
                        {currentStep.data.success !== undefined && (
                          <div>
                            <span className={`text-xs ${
                              currentStep.data.success !== false
                                ? 'text-status-success'
                                : 'text-status-error'
                            }`}>
                              {currentStep.data.success !== false ? '✓ Sucesso' : '✗ Falhou'}
                            </span>
                          </div>
                        )}
                        {currentStep.data.duration && (
                          <div>
                            <span className="text-xs text-text-tertiary">Duração: </span>
                            <span className="text-xs text-text-primary">
                              {currentStep.data.duration}ms
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {currentStep.type === 'screen' && currentStep.data.screenshot && (
                      <div className="mt-2">
                        <img
                          src={`data:image/png;base64,${currentStep.data.screenshot}`}
                          alt={`Screenshot do passo ${currentReplayStep + 1}`}
                          className="max-w-full h-auto rounded border border-border-default"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Modo Lista Completa */}
              {!replayStepByStep && (
                <>
                  {/* Ações do replay */}
                  {replayData.actions && replayData.actions.length > 0 && (
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
                                <div className="font-mono text-text-primary">{action.type}</div>
                                {action.selector && (
                                  <div className="text-text-secondary mt-1">
                                    Seletor: <span className="font-mono">{action.selector}</span>
                                  </div>
                                )}
                                {action.value !== undefined && (
                                  <div className="text-text-secondary mt-1">
                                    Valor: {String(action.value)}
                                  </div>
                                )}
                                {action.timestamp && (
                                  <div className="text-text-tertiary mt-1 text-xs">
                                    {formatDate(action.timestamp)}
                                  </div>
                                )}
                              </div>
                              <div className="ml-2">
                                {action.success !== false ? (
                                  <span className="text-status-success">✓</span>
                                ) : (
                                  <span className="text-status-error">✗</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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

