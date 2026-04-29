import React from 'react';
import './ExecutionProgress.css';

/**
 * Componente para exibir progresso de uma execução em tempo real
 * com spinner, barra de progresso e informações de status.
 */
export function ExecutionProgress({
  status = 'idle', // idle | processing | success | failed
  progress = 0, // 0-100
  currentStep = null,
  summary = null,
  durationMs = 0,
  onCancel = null,
}) {
  const isRunning = status === 'processing';
  const isSuccess = status === 'success';
  const isFailed = status === 'failed';

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'processing':
        return 'Processando...';
      case 'success':
        return 'Concluído ✓';
      case 'failed':
        return 'Falhou ✗';
      default:
        return 'Aguardando...';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'processing':
        return '#2196F3'; // azul
      case 'success':
        return '#4CAF50'; // verde
      case 'failed':
        return '#f44336'; // vermelho
      default:
        return '#999';
    }
  };

  return (
    <div className="execution-progress-container">
      {/* Header com status */}
      <div className="execution-progress-header">
        <div className="execution-progress-status">
          {isRunning && <div className="execution-progress-spinner" />}
          <span
            className="execution-progress-status-label"
            style={{ color: getStatusColor() }}
          >
            {getStatusLabel()}
          </span>
        </div>

        {onCancel && isRunning && (
          <button
            className="execution-progress-cancel-btn"
            onClick={onCancel}
            title="Cancelar execução"
          >
            ✕
          </button>
        )}
      </div>

      {/* Barra de progresso */}
      <div className="execution-progress-bar-container">
        <div className="execution-progress-bar-track">
          <div
            className="execution-progress-bar-fill"
            style={{
              width: `${progress}%`,
              backgroundColor: getStatusColor(),
            }}
          />
        </div>
        <span className="execution-progress-percentage">{progress}%</span>
      </div>

      {/* Informações de resumo */}
      {summary && (
        <div className="execution-progress-summary">
          <div className="execution-progress-summary-row">
            <span className="execution-progress-summary-label">Total:</span>
            <span className="execution-progress-summary-value">
              {summary.total} cenários
            </span>
          </div>

          <div className="execution-progress-summary-row">
            <span className="execution-progress-summary-label">Executados:</span>
            <span className="execution-progress-summary-value">
              {summary.executed}/{summary.total}
            </span>
          </div>

          {summary.passed > 0 && (
            <div className="execution-progress-summary-row">
              <span className="execution-progress-summary-label">✓ Passou:</span>
              <span className="execution-progress-summary-value success">
                {summary.passed}
              </span>
            </div>
          )}

          {summary.failed > 0 && (
            <div className="execution-progress-summary-row">
              <span className="execution-progress-summary-label">✗ Falhou:</span>
              <span className="execution-progress-summary-value failed">
                {summary.failed}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Step atual */}
      {currentStep && (
        <div className="execution-progress-current-step">
          <div className="execution-progress-current-step-title">
            Executando: {currentStep.scenarioName || 'Cenário'}
          </div>
          <div
            className={`execution-progress-current-step-status ${currentStep.status}`}
          >
            {currentStep.status}
          </div>
        </div>
      )}

      {/* Duração */}
      {durationMs > 0 && (
        <div className="execution-progress-duration">
          Duração: {formatDuration(durationMs)}
        </div>
      )}

      {/* Go/No-Go final */}
      {summary?.goNoGo && (
        <div
          className={`execution-progress-gonogo ${summary.goNoGo.toLowerCase()}`}
        >
          {summary.goNoGo === 'GO' ? '✓ GO' : '✗ NO GO'}
        </div>
      )}
    </div>
  );
}

ExecutionProgress.displayName = 'ExecutionProgress';
