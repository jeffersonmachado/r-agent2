import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';
import { RpaConfigDialog } from '../components/RpaConfigDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { Button } from '../styles/Button';
import { listRpaRecordings, executeRpaRecording, cancelRpaExecution, deleteRpaRecording, startManualRecording, stopManualRecording } from '../api/rpa';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

/**
 * Página para visualizar e reproduzir seeds RPA.
 * Interface para listar seeds de /tests/rpa/seeds/ e executá-los.
 */
export function RpaSeedsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [seeds, setSeeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedSeed, setSelectedSeed] = useState(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionId, setExecutionId] = useState(null);
  const [executionStatus, setExecutionStatus] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [seedToDelete, setSeedToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingId, setRecordingId] = useState(null);
  const [recordingStatus, setRecordingStatus] = useState(null);
  const [showRecordDialog, setShowRecordDialog] = useState(false);
  const [newSeedName, setNewSeedName] = useState('');
  const [newSeedUrl, setNewSeedUrl] = useState('');
  const logsEndRef = useRef(null);

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Carrega seeds disponíveis
  useEffect(() => {
    loadSeeds();
  }, []);

  // Scroll automático para o final dos logs
  useEffect(() => {
    if (logsEndRef.current && executionStatus?.logs?.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [executionStatus?.logs]);

  // WebSocket: status de gravação manual em tempo real (sem polling REST).
  const recordingIdRef = useRef(null);
  useEffect(() => {
    recordingIdRef.current = recordingId;
  }, [recordingId]);

  const executionIdRef = useRef(null);
  useEffect(() => {
    executionIdRef.current = executionId;
  }, [executionId]);

  const handleRpaWsEvent = useCallback((eventName, payload) => {
    if (eventName === 'rpa.recording.updated') {
      if (!payload?.recordingId || payload.recordingId !== recordingIdRef.current) return;
      if (payload.status === 'recording') {
        setRecordingStatus({ success: true, status: 'recording', seedName: payload.seedName });
        return;
      }
      // Gravação finalizada (completed/failed): encerra modo de gravação na UI.
      setRecording(false);
      setRecordingId(null);
      setRecordingStatus(null);
      if (payload.status === 'completed') loadSeeds();
      return;
    }

    if (eventName === 'rpa.execution.updated') {
      if (!payload?.id || payload.id !== executionIdRef.current) return;
      setExecutionStatus((prev) => ({ ...(prev || {}), ...payload }));

      if (['completed', 'failed', 'cancelled'].includes(payload.status)) {
        setExecuting(false);
        if (payload.status === 'completed') {
          showToast('Seed executado com sucesso!', 'success');
        } else if (payload.status === 'failed') {
          const errorMsg = payload.error || 'Erro desconhecido';
          showToast(`Seed falhou: ${errorMsg.substring(0, 100)}${errorMsg.length > 100 ? '...' : ''}`, 'error');
        } else {
          showToast('Execução do seed cancelada', 'info');
        }
      }
    }
  }, [showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  useWebSocketContext({
    onEvent: handleRpaWsEvent,
    subscribeEvents: ['rpa.execution.updated', 'rpa.recording.updated'],
  });

  // Rede de segurança: se nenhum evento chegar em 10 min, destrava a UI.
  useEffect(() => {
    if (!executionId || !executing) return undefined;
    const timeoutId = setTimeout(() => {
      setExecuting(false);
      showToast('Timeout: Execução RPA demorou muito tempo', 'warning');
    }, 10 * 60 * 1000);
    return () => clearTimeout(timeoutId);
  }, [executionId, executing, showToast]);

  const loadSeeds = async () => {
    setLoading(true);
    try {
      const data = await listRpaRecordings();
      // Filtra apenas seeds (que vêm de /tests/rpa/seeds/)
      // A API já retorna seeds e recordings, mas vamos mostrar todos como "seeds"
      const allRecordings = data.recordings || data || [];
      setSeeds(allRecordings);
    } catch (error) {
      logger.error('Erro ao carregar seeds', error);
      showToast('Erro ao carregar seeds: ' + (error.message || 'Erro desconhecido'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = (seed) => {
    setSelectedSeed(seed);
    setShowConfigDialog(true);
  };

  const handleConfirmExecute = async (config) => {
    setShowConfigDialog(false);
    setExecuting(true);
    setExecutionId(null);
    setExecutionStatus(null);

    try {
      const result = await executeRpaRecording(selectedSeed.id, config);
      if (result.executionId) {
        setExecutionId(result.executionId);
        showToast('Execução do seed iniciada!', 'success');
      } else if (result.success) {
        setExecuting(false);
        showToast('Seed executado com sucesso!', 'success');
      } else {
        setExecuting(false);
        showToast('Execução do seed falhou', 'error');
      }
    } catch (error) {
      logger.error('Erro ao executar seed', error);
      setExecuting(false);
      showToast('Erro ao executar seed: ' + (error.message || 'Erro desconhecido'), 'error');
    }
  };

  const handleCancel = async () => {
    if (!executionId) return;

    setCancelling(true);
    try {
      await cancelRpaExecution(executionId);
      setExecuting(false);
      setExecutionId(null);
      showToast('Execução cancelada', 'info');
    } catch (error) {
      logger.error('Erro ao cancelar execução', error);
      showToast('Erro ao cancelar execução', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const handleDelete = async (seed) => {
    setDeleting(true);
    try {
      await deleteRpaRecording(seed.id);
      showToast('Seed removido com sucesso', 'success');
      await loadSeeds();
    } catch (error) {
      logger.error('Erro ao remover seed', error);
      showToast('Erro ao remover seed: ' + (error.message || 'Erro desconhecido'), 'error');
    } finally {
      setDeleting(false);
      setSeedToDelete(null);
    }
  };

  const handleViewDetails = (seed) => {
    setSelectedSeed(seed);
    setShowDetailsModal(true);
  };

  const handleStartRecording = async () => {
    if (!newSeedName || newSeedName.trim() === '') {
      showToast('Nome do seed é obrigatório', 'error');
      return;
    }

    try {
      const result = await startManualRecording(newSeedName, newSeedUrl || undefined);
      if (result.success) {
        setRecording(true);
        setRecordingId(result.recordingId);
        setShowRecordDialog(false);
        setNewSeedName('');
        setNewSeedUrl('');
        showToast(`Gravação "${result.recordingId}" iniciada! Interaja com o navegador que abriu.`, 'success', 5000);
      } else {
        showToast(result.error || 'Erro ao iniciar gravação', 'error');
      }
    } catch (error) {
      logger.error('Erro ao iniciar gravação', error);
      showToast('Erro ao iniciar gravação: ' + (error.message || 'Erro desconhecido'), 'error');
    }
  };

  const handleStopRecording = async () => {
    if (!recordingId) return;

    try {
      const result = await stopManualRecording(recordingId);
      if (result.success) {
        setRecording(false);
        setRecordingId(null);
        setRecordingStatus(null);
        showToast(`Gravação salva com sucesso! Seed: ${result.seedId}`, 'success', 5000);
        await loadSeeds(); // Recarrega lista de seeds
      } else {
        showToast(result.error || 'Erro ao parar gravação', 'error');
      }
    } catch (error) {
      logger.error('Erro ao parar gravação', error);
      showToast('Erro ao parar gravação: ' + (error.message || 'Erro desconhecido'), 'error');
    }
  };

  const getActionIcon = (type) => {
    const icons = {
      navigate: '🌐',
      fill: '✏️',
      click: '🖱️',
      wait: '⏳',
      assert: '✅',
      select: '📋',
    };
    return icons[type] || '📝';
  };

  const getActionName = (type) => {
    const names = {
      navigate: 'Navegar',
      fill: 'Preencher',
      click: 'Clicar',
      wait: 'Aguardar',
      assert: 'Validar',
      select: 'Selecionar',
    };
    return names[type] || type;
  };

  if (authLoading) {
    return (
      <CrudPageBase>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <CrudPageBase>
      <div style={{ marginBottom: '30px' }}>
        <h1 className="text-3xl font-bold text-text-primary mb-2">🌱 Seeds RPA</h1>
        <p className="text-text-secondary">
          Visualize e reproduza seeds de <code className="bg-bg-secondary px-1 py-0.5 rounded text-xs">tests/rpa/seeds/</code>
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        {/* Lista de Seeds */}
        <div className="bg-bg-secondary rounded-lg p-4" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 className="text-xl font-semibold text-text-primary">Seeds Disponíveis</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                onClick={() => setShowRecordDialog(true)}
                disabled={recording}
                style={{ padding: '6px 12px', fontSize: '14px', backgroundColor: 'var(--accent-default)' }}
              >
                🎬 Novo Seed
              </Button>
              <Button
                onClick={loadSeeds}
                disabled={loading}
                style={{ padding: '6px 12px', fontSize: '14px' }}
              >
                🔄 Atualizar
              </Button>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <p className="text-text-secondary">Carregando seeds...</p>
            </div>
          ) : seeds.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <p className="text-text-secondary">Nenhum seed encontrado</p>
              <p className="text-text-secondary text-sm mt-2">
                Seeds devem estar em <code className="bg-bg-primary px-1 py-0.5 rounded text-xs">tests/rpa/seeds/</code>
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {seeds.map((seed) => (
                <div
                  key={seed.id}
                  className="bg-bg-primary rounded-lg p-3 border border-border-default hover:border-accent-default transition-colors"
                  style={{
                    cursor: 'pointer',
                    border: selectedSeed?.id === seed.id ? '2px solid var(--accent-default)' : '1px solid var(--border-default)',
                  }}
                  onClick={() => setSelectedSeed(seed)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 className="text-text-primary font-semibold">{seed.name || seed.id}</h3>
                        {seed.source && (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            seed.source === 'manual' 
                              ? 'bg-blue-500/20 text-blue-400' 
                              : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {seed.source === 'manual' ? '✋ Manual' : '🤖 Auto'}
                          </span>
                        )}
                      </div>
                      {seed.version && (
                        <p className="text-text-secondary text-sm">v{seed.version}</p>
                      )}
                      <p className="text-text-secondary text-xs mt-1">
                        📝 {seed.steps?.length || 0} ações
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetails(seed);
                        }}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >
                        👁️
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExecute(seed);
                        }}
                        disabled={executing}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >
                        ▶️
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel de Execução */}
        <div className="bg-bg-secondary rounded-lg p-4">
          {selectedSeed ? (
            <>
              <h2 className="text-xl font-semibold text-text-primary mb-4">
                {selectedSeed.name || selectedSeed.id}
              </h2>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', marginBottom: '10px' }}>
                  <span className="text-text-secondary">ID:</span>
                  <code className="bg-bg-primary px-2 py-1 rounded text-sm">{selectedSeed.id}</code>
                </div>
                {selectedSeed.version && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', marginBottom: '10px' }}>
                    <span className="text-text-secondary">Versão:</span>
                    <span className="text-text-primary">{selectedSeed.version}</span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', marginBottom: '10px' }}>
                  <span className="text-text-secondary">Ações:</span>
                  <span className="text-text-primary">{selectedSeed.steps?.length || 0}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <Button
                  onClick={() => handleExecute(selectedSeed)}
                  disabled={executing}
                  style={{ flex: 1 }}
                >
                  ▶️ Executar Seed
                </Button>
                <Button
                  onClick={() => handleViewDetails(selectedSeed)}
                  style={{ flex: 1 }}
                >
                  👁️ Ver Detalhes
                </Button>
              </div>

              {executing && executionStatus && (
                <div className="bg-bg-primary rounded-lg p-4" style={{ marginTop: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h3 className="text-lg font-semibold text-text-primary">Status da Execução</h3>
                    <Button
                      onClick={handleCancel}
                      disabled={cancelling}
                      style={{ padding: '6px 12px' }}
                    >
                      {cancelling ? 'Cancelando...' : '❌ Cancelar'}
                    </Button>
                  </div>

                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span className="text-text-secondary">Status:</span>
                      <span className={`font-semibold ${
                        executionStatus.status === 'completed' ? 'text-green-500' :
                        executionStatus.status === 'failed' ? 'text-red-500' :
                        executionStatus.status === 'cancelled' ? 'text-yellow-500' :
                        'text-blue-500'
                      }`}>
                        {executionStatus.status || 'running'}
                      </span>
                    </div>
                    {executionStatus.progress !== undefined && (
                      <div style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <span className="text-text-secondary">Progresso:</span>
                          <span className="text-text-primary">{executionStatus.progress}%</span>
                        </div>
                        <div className="bg-bg-secondary rounded-full" style={{ height: '8px', overflow: 'hidden' }}>
                          <div
                            className="bg-accent-default"
                            style={{
                              height: '100%',
                              width: `${executionStatus.progress}%`,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {executionStatus.logs && executionStatus.logs.length > 0 && (
                    <div style={{ marginTop: '15px' }}>
                      <h4 className="text-text-primary font-semibold mb-2">Logs:</h4>
                      <div
                        className="bg-bg-secondary rounded p-3"
                        style={{
                          maxHeight: '300px',
                          overflowY: 'auto',
                          fontFamily: 'monospace',
                          fontSize: '12px',
                        }}
                      >
                        {executionStatus.logs.map((log, idx) => (
                          <div key={idx} className="text-text-secondary" style={{ marginBottom: '5px' }}>
                            {log}
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </div>
                    </div>
                  )}

                  {executionStatus.error && (
                    <div className="bg-red-500/10 border border-red-500 rounded p-3 mt-3">
                      <p className="text-red-500 font-semibold">Erro:</p>
                      <p className="text-red-400 text-sm">{executionStatus.error}</p>
                    </div>
                  )}
                </div>
              )}

              {!executing && (
                <div className="bg-bg-primary rounded-lg p-4" style={{ marginTop: '20px' }}>
                  <h3 className="text-lg font-semibold text-text-primary mb-3">Ações do Seed</h3>
                  {selectedSeed.steps && selectedSeed.steps.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                      {selectedSeed.steps.map((step, idx) => (
                        <div
                          key={idx}
                          className="bg-bg-secondary rounded p-2 border border-border-default"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                            <span style={{ fontSize: '18px' }}>{getActionIcon(step.type)}</span>
                            <span className="text-text-primary font-semibold">
                              {getActionName(step.type)}
                            </span>
                          </div>
                          {step.url && (
                            <div className="text-text-secondary text-sm">
                              <strong>URL:</strong> {step.url}
                            </div>
                          )}
                          {step.selector && (
                            <div className="text-text-secondary text-sm">
                              <strong>Seletor:</strong> <code>{step.selector}</code>
                            </div>
                          )}
                          {step.value && (
                            <div className="text-text-secondary text-sm">
                              <strong>Valor:</strong> {step.value.length > 50 ? `${step.value.substring(0, 50)}...` : step.value}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-text-secondary">Nenhuma ação definida</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <p className="text-text-secondary">Selecione um seed na lista ao lado</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Detalhes */}
      {showDetailsModal && selectedSeed && (
        <Dialog
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
          title={`Detalhes do Seed: ${selectedSeed.name || selectedSeed.id}`}
        >
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ marginBottom: '20px' }}>
              <h3 className="text-lg font-semibold text-text-primary mb-3">Informações Gerais</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px' }}>
                <span className="text-text-secondary">ID:</span>
                <code className="bg-bg-secondary px-2 py-1 rounded">{selectedSeed.id}</code>
                {selectedSeed.internalId && (
                  <>
                    <span className="text-text-secondary">ID Interno:</span>
                    <code className="bg-bg-secondary px-2 py-1 rounded">{selectedSeed.internalId}</code>
                  </>
                )}
                {selectedSeed.version && (
                  <>
                    <span className="text-text-secondary">Versão:</span>
                    <span className="text-text-primary">{selectedSeed.version}</span>
                  </>
                )}
                <span className="text-text-secondary">Total de Ações:</span>
                <span className="text-text-primary">{selectedSeed.steps?.length || 0}</span>
              </div>
            </div>

            {selectedSeed.steps && selectedSeed.steps.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-3">Ações ({selectedSeed.steps.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {selectedSeed.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="bg-bg-secondary rounded p-3 border border-border-default"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '20px' }}>{getActionIcon(step.type)}</span>
                        <span className="text-text-primary font-semibold">
                          Ação {idx + 1}: {getActionName(step.type)}
                        </span>
                      </div>
                      <pre className="bg-bg-primary rounded p-2 text-xs overflow-x-auto" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {JSON.stringify(step, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedSeed.data && Object.keys(selectedSeed.data).length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <h3 className="text-lg font-semibold text-text-primary mb-3">Dados</h3>
                <pre className="bg-bg-secondary rounded p-3 text-xs overflow-x-auto" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {JSON.stringify(selectedSeed.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {/* Dialog de Configuração */}
      <RpaConfigDialog
        isOpen={showConfigDialog}
        onClose={() => setShowConfigDialog(false)}
        onConfirm={handleConfirmExecute}
        defaultConfig={{
          headless: false,
          slowMo: 100,
          timeout: 30000,
          screenshotOnFailure: true,
        }}
      />

      {/* Dialog de Confirmação de Exclusão */}
      <ConfirmDialog
        isOpen={!!seedToDelete}
        onClose={() => setSeedToDelete(null)}
        onConfirm={() => handleDelete(seedToDelete)}
        title="Confirmar Exclusão"
        message={`Tem certeza que deseja remover o seed "${seedToDelete?.name || seedToDelete?.id}"?`}
        confirmText="Remover"
        cancelText="Cancelar"
      />

      {/* Dialog de Gravação Manual */}
      <Dialog
        isOpen={showRecordDialog}
        onClose={() => {
          setShowRecordDialog(false);
          setNewSeedName('');
          setNewSeedUrl('');
        }}
        title="🎬 Criar Novo Seed Manualmente"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label className="text-text-primary font-semibold mb-2 block">
              Nome do Seed *
            </label>
            <input
              type="text"
              value={newSeedName}
              onChange={(e) => setNewSeedName(e.target.value)}
              placeholder="ex: meu-login"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded text-text-primary"
              style={{ fontFamily: 'monospace' }}
            />
            <p className="text-text-secondary text-xs mt-1">
              Nome único para identificar o seed
            </p>
          </div>
          <div>
            <label className="text-text-primary font-semibold mb-2 block">
              URL Inicial (opcional)
            </label>
            <input
              type="text"
              value={newSeedUrl}
              onChange={(e) => setNewSeedUrl(e.target.value)}
              placeholder="http://localhost:5173"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded text-text-primary"
            />
            <p className="text-text-secondary text-xs mt-1">
              URL onde a gravação começará. Deixe vazio para usar a padrão.
            </p>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
            <p className="text-blue-400 text-sm">
              <strong>Como funciona:</strong>
            </p>
            <ul className="text-blue-300 text-xs mt-2 list-disc list-inside space-y-1">
              <li>Um navegador será aberto automaticamente</li>
              <li>Interaja normalmente: clique, digite, navegue</li>
              <li>Quando terminar, clique em "Parar Gravação"</li>
              <li>O seed será salvo automaticamente em <code>/tests/rpa/seeds/</code></li>
            </ul>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <Button
              onClick={() => {
                setShowRecordDialog(false);
                setNewSeedName('');
                setNewSeedUrl('');
              }}
              style={{ padding: '8px 16px' }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleStartRecording}
              disabled={!newSeedName || newSeedName.trim() === ''}
              style={{ padding: '8px 16px', backgroundColor: 'var(--accent-default)' }}
            >
              🎬 Iniciar Gravação
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Indicador de Gravação em Andamento */}
      {recording && recordingStatus && (
        <div className="fixed bottom-4 right-4 bg-bg-secondary border-2 border-accent-default rounded-lg p-4 shadow-lg" style={{ zIndex: 1000, maxWidth: '400px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 className="text-text-primary font-semibold">🎬 Gravando Seed</h3>
            <Button
              onClick={handleStopRecording}
              style={{ padding: '4px 12px', fontSize: '12px', backgroundColor: 'var(--red-500)' }}
            >
              ⏹️ Parar
            </Button>
          </div>
          <p className="text-text-secondary text-sm">
            <strong>Seed:</strong> {recordingStatus.seedName}
          </p>
          <p className="text-text-secondary text-xs mt-1">
            Interaja com o navegador que abriu. Quando terminar, clique em "Parar".
          </p>
        </div>
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}

