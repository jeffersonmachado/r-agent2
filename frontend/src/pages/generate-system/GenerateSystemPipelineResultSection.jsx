import React from 'react';
import { Button } from '../../styles/Button';
import { PipelineStage, PIPELINE_STAGE_ORDER } from '../../hooks/usePipelineMachine';
import { getBasePath } from '../../utils';

/**
 * @param {Record<string, unknown>} props
 * @returns {JSX.Element}
 */
export function GenerateSystemPipelineResultSection({
  // BLOCO 5 – Validações Automáticas
  validationStatus,
  // BLOCO 5 – Pipeline Visível
  isTenantMode,
  executionMode,
  useWebScraping,
  needsDescriptionSuggestion,
  includeQuestions,
  bootstrap,
  useRag,
  pipelineMachine,
  pipelineDetails,
  pipelineStatus,
  ensureInitialFlowLoaded,
  initialGraphLoading,
  initialFlow,
  getStepMessage,
  executing,
  // Botão Executar
  handleExecute,
  isValid,
  rateLimitSecondsRemaining,
  clearRateLimit,
  getValidationError,
  // BLOCO 6 – Resultado Final
  result,
  finalStatus,
  navigate,
  handleViewReport,
  setGeneratedFlowForModal,
  setGeneratedFlowEditorUrl,
  setShowGeneratedFlowModal,
  error,
}) {
  return (
    <>
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

    </>
  );
}
