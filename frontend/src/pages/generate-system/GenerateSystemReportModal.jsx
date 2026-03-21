import React from 'react';
import { Button } from '../../styles/Button';
import { Dialog } from '../../components/Dialog';

/**
 * @param {Record<string, unknown>} props
 * @returns {JSX.Element}
 */
export function GenerateSystemReportModal({
  showReportModal,
  setShowReportModal,
  reportData,
  setReportData,
  setReportError,
  loadingReport,
  reportError,
  totalSteps,
  replayStepByStep,
  setReplayStepByStep,
  currentReplayStep,
  setCurrentReplayStep,
  currentStep,
  getReplaySteps,
  goToFirst,
  goToPrevious,
  goToNext,
  goToLast,
  handleReplayClick,
}) {
  return (
    <>
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
    </>
  );
}
