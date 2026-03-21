import React, { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../styles/Button';
import { AutoInitialGraphCanvas } from '../../components/AutoInitialGraphCanvas';
import { createFlow } from '../../api/flows';
import { getBasePath } from '../../utils';
import { getCategoryLabel } from './generateSystemFileUtils';

/**
 * @param {Record<string, unknown>} props
 * @returns {JSX.Element}
 */
export function GenerateSystemFileDetailsDialog({
  selectedFileDetails,
  setSelectedFileDetails,
  downloadRagOriginalFile,
}) {
  const fileTypeLabel =
    selectedFileDetails?.file?.type?.startsWith('image/') ? 'Imagem'
      : selectedFileDetails?.file?.type === 'application/pdf' ? 'PDF'
      : selectedFileDetails?.file?.type?.startsWith('text/') ? 'Texto'
      : 'Outro';

  return (
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
                  selectedFileDetails.status === 'success' ? 'text-status-success'
                    : selectedFileDetails.status === 'error' ? 'text-status-error'
                    : selectedFileDetails.status === 'processing' ? 'text-status-warning'
                    : 'text-text-secondary'
                }`}>
                  {selectedFileDetails.status === 'success' ? '✓ Indexado'
                    : selectedFileDetails.status === 'error' ? '✗ Erro'
                    : selectedFileDetails.status === 'processing' ? '⏳ Processando...'
                    : '⏸ Pendente'}
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
                      onClick={() => downloadRagOriginalFile(selectedFileDetails.documentId, selectedFileDetails.name, 'open')}
                      title="Abrir o arquivo original salvo no RAG em nova aba"
                    >
                      🔎 Abrir original (RAG)
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                      onClick={() => downloadRagOriginalFile(selectedFileDetails.documentId, selectedFileDetails.name, 'download')}
                      title="Baixar o arquivo original salvo no RAG"
                    >
                      ⬇️ Baixar original (RAG)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
            <h3 className="text-sm font-semibold text-text-primary mb-3">🏷️ Categoria</h3>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-3 py-1 rounded font-medium ${
                selectedFileDetails.status === 'pending'
                  ? 'bg-status-warning/20 text-status-warning border border-status-warning/30'
                  : 'bg-accent-light text-accent-primary'
              }`}>
                {selectedFileDetails.status === 'pending' ? 'Pendente' : getCategoryLabel(selectedFileDetails.category)}
              </span>
              {selectedFileDetails.status !== 'pending' && (
                <span className="text-xs text-text-tertiary">
                  (Inferida automaticamente usando IA)
                </span>
              )}
            </div>
            {selectedFileDetails.status !== 'pending' ? (
              <p className="text-xs text-text-tertiary mt-2">
                A categoria foi inferida analisando o nome do arquivo, tipo MIME e conteúdo extraído.
              </p>
            ) : (
              <p className="text-xs text-text-tertiary mt-2">
                A categoria será inferida automaticamente quando você clicar em "Executar".
              </p>
            )}
          </div>

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

          <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
            <h3 className="text-sm font-semibold text-text-primary mb-3">🔍 Metadados</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-text-tertiary">Tipo de Arquivo:</span>
                <span className="text-text-primary">{fileTypeLabel}</span>
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

          {selectedFileDetails.status === 'success' && (
            <div className="bg-status-success/10 rounded-lg p-4 border border-status-success/30">
              <h3 className="text-sm font-semibold text-status-success mb-2">✓ Indexado no RAG</h3>
              <p className="text-xs text-text-secondary">
                Este arquivo foi processado, teve seu conteúdo extraído e foi indexado no RAG.
                Ele estará disponível para consultas quando você selecionar "Arquivos Enviados" nas fontes RAG.
              </p>
            </div>
          )}

          {selectedFileDetails.error && (
            <div className="bg-status-error/10 rounded-lg p-4 border border-status-error/30">
              <h3 className="text-sm font-semibold text-status-error mb-2">✗ Erro</h3>
              <p className="text-xs text-status-error">{selectedFileDetails.error}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/**
 * @param {Record<string, unknown>} props
 * @returns {JSX.Element|null}
 */
export function GenerateSystemInitialFlowDialog({
  isTenantMode,
  initialFlow,
  showInitialFlowModal,
  setShowInitialFlowModal,
  initialFlowModalSize,
  setInitialFlowModalSize,
  isInitialFlowFullscreen,
  setIsInitialFlowFullscreen,
  isInitialFlowMinimized,
  setIsInitialFlowMinimized,
  showInitialFlowObjectiveEditor,
  setShowInitialFlowObjectiveEditor,
  initialFlowObjectiveDraft,
  setInitialFlowObjectiveDraft,
  extractTenantFromInitialFlowId,
  result,
  validatedTenantId,
  agent,
  downloadJsonFile,
  pipelineExecutionIdRef,
  setInitialFlow,
  setError,
}) {
  const [isPersistingInitialFlow, setIsPersistingInitialFlow] = useState(false);

  if (!isTenantMode || !initialFlow) return null;

  return (
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
              setShowInitialFlowObjectiveEditor((value) => !value);
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
              if (!isInitialFlowMinimized && isInitialFlowFullscreen) setIsInitialFlowFullscreen(false);
              setIsInitialFlowMinimized((value) => !value);
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
      size={isInitialFlowFullscreen ? 'full' : 'xl'}
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
        const isPersistedFlow = initialFlow?.__persisted === true;
        const looksLikePlaceholderId = rawFlowId && String(rawFlowId).includes('@0.1.0');
        const flowId = rawFlowId && !isDryRunId && !looksLikePlaceholderId && isPersistedFlow ? rawFlowId : null;
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
        const tenantParam =
          agent?.role === 'super_admin' && targetTenantId
            ? `&tenantId=${encodeURIComponent(targetTenantId)}`
            : '';
        const editorUrl = flowId ? `${basePath}/editor?flowId=${encodeURIComponent(flowId)}${tenantParam}` : '';

        const warnings = initialFlow?.validationWarnings || null;
        const warningCount = Array.isArray(warnings?.errors) ? warnings.errors.length : 0;
        const hasWarnings = warnings && warnings.valid === false && warningCount > 0;

        const badges = (
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

        const objectiveEditor = showInitialFlowObjectiveEditor ? (
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
                      const text = String(initialFlowObjectiveDraft || '').trim();
                      if (!text) return;
                      if (navigator?.clipboard?.writeText) {
                        await navigator.clipboard.writeText(text);
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
                <Button variant="ghost" size="xs" onClick={() => setShowInitialFlowObjectiveEditor(false)} title="Fechar">
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
        ) : null;

        const validationWarnings = hasWarnings ? (
          <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
            <strong>Avisos de validação:</strong> {warningCount} item(ns).
          </div>
        ) : null;

        const statusRow = flowId ? (
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
        ) : (
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
                  const { id: _ignoredId, ...payload } = (initialFlow || {});
                  const saved = await createFlow({ ...payload, name: safeName });
                  if (saved && typeof saved === 'object') {
                    setInitialFlow(saved);
                  } else {
                    throw new Error('Resposta inválida ao persistir fluxo');
                  }
                } catch (e) {
                  const message = e?.body?.message || e?.message || 'Falha ao persistir fluxo para abrir no editor.';
                  setError(message);
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

        return (
          <div className="space-y-3">
            {badges}
            {objectiveEditor}
            {validationWarnings}
            {statusRow}
            <div
              className="w-full overflow-hidden rounded-lg border border-border-default bg-bg-primary"
              style={{ height: contentHeight }}
            >
              {flowId ? (
                <iframe title="Editor de Fluxos" src={editorUrl} className="w-full h-full" style={{ border: 0 }} />
              ) : (
                <AutoInitialGraphCanvas flow={initialFlow} height="100%" />
              )}
            </div>
          </div>
        );
      })()}
    </Dialog>
  );
}

/**
 * @param {Record<string, unknown>} props
 * @returns {JSX.Element|null}
 */
export function GenerateSystemGeneratedFlowDialog({
  isTenantMode,
  generatedFlowForModal,
  showGeneratedFlowModal,
  setShowGeneratedFlowModal,
  generatedFlowModalSize,
  setGeneratedFlowModalSize,
  generatedFlowEditorUrl,
  setGeneratedFlowEditorUrl,
  isGeneratedFlowFullscreen,
  setIsGeneratedFlowFullscreen,
}) {
  if (!isTenantMode || !generatedFlowForModal) return null;

  return (
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
      size={isGeneratedFlowFullscreen ? 'full' : 'xl'}
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
        <iframe title="Editor de Fluxos" src={generatedFlowEditorUrl} className="w-full h-full" style={{ border: 0 }} />
      </div>
    </Dialog>
  );
}