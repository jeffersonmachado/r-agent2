import React from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FlowTestChat } from '../../components/FlowTestChat';
import { Button } from '../../styles/Button';

export function FlowEditorOverlays({
  currentFlow,
  showDeleteConfirm,
  setShowDeleteConfirm,
  handleDeleteConfirm,
  showTestChat,
  setShowTestChat,
  setTestFlowDefinition,
  setTestChatSize,
  testChatSize,
  testFlowDefinition,
  testKey,
  showGeneratedFlowModal,
  setShowGeneratedFlowModal,
  generatedFlowModalData,
  setGeneratedFlowModalData,
  showToast,
  ToastContainer,
  fileInputRef,
  handleFileChange,
  logger,
}) {
  return (
    <>
      {currentFlow && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteConfirm}
          title="Remover fluxo"
          message={`Tem certeza que deseja remover o fluxo "${currentFlow.name || currentFlow.id}"?\n\nEsta ação não pode ser desfeita.`}
          confirmText="Remover"
          cancelText="Cancelar"
          variant="danger"
          icon="🗑️"
        />
      )}

      <Dialog
        isOpen={showTestChat}
        onClose={() => {
          if (typeof window !== 'undefined') {
            try {
              window.dispatchEvent(
                new CustomEvent('flow-runner-cleanup', {
                  detail: {
                    clearAll: true,
                  },
                }),
              );
            } catch (err) {
              logger.debug('FlowEditorPage - erro ao emitir evento de limpeza', err);
            }
          }

          setShowTestChat(false);
          setTestFlowDefinition(null);
          setTestChatSize(null);
        }}
        title="Chat de Teste"
        size="xl"
        draggable={true}
        resizable={true}
        dynamicSize={testChatSize}
      >
        {testFlowDefinition && (
          <div className="h-[600px] min-h-[400px]">
            <FlowTestChat
              key={testKey}
              flow={testFlowDefinition}
              onSizeChange={setTestChatSize}
            />
          </div>
        )}
      </Dialog>

      <Dialog
        isOpen={showGeneratedFlowModal}
        onClose={() => {
          setShowGeneratedFlowModal(false);
          setGeneratedFlowModalData(null);
        }}
        title="Fluxo gerado (preview)"
        size="xl"
        draggable={true}
        resizable={true}
      >
        <div className="space-y-4">
          <div className="text-sm text-text-secondary">
            Este é o fluxo que acabou de ser gerado e aplicado no editor.
          </div>

          <div className="p-3 rounded-md border border-border-default bg-bg-tertiary space-y-1 text-sm">
            <div><strong>Modo:</strong> {generatedFlowModalData?.mode === 'saved' ? 'salvo e carregado' : 'rascunho (não salvo)'} </div>
            <div><strong>Nome:</strong> {generatedFlowModalData?.flow?.name || '—'}</div>
            <div><strong>ID:</strong> {generatedFlowModalData?.flow?.id || '—'}</div>
            <div><strong>Nós:</strong> {generatedFlowModalData?.flow?.nodes?.length || 0}</div>
          </div>

          {generatedFlowModalData?.validationWarnings && generatedFlowModalData.validationWarnings.valid === false && (
            <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
              <strong>Avisos de validação:</strong> {(generatedFlowModalData.validationWarnings.errors || []).length} item(ns).
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  const txt = JSON.stringify(generatedFlowModalData?.flow || {}, null, 2);
                  if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(txt);
                    showToast('JSON copiado para o clipboard', 'success', 2000);
                  } else {
                    showToast('Clipboard indisponível', 'warning', 2500);
                  }
                } catch {
                  showToast('Falha ao copiar JSON', 'error', 2500);
                }
              }}
              disabled={!generatedFlowModalData?.flow}
            >
              Copiar JSON
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setShowGeneratedFlowModal(false);
                setGeneratedFlowModalData(null);
              }}
            >
              Fechar
            </Button>
          </div>

          <pre className="text-xs font-mono whitespace-pre-wrap max-h-[55vh] overflow-y-auto p-3 rounded bg-bg-primary border border-border-default">
            {JSON.stringify(generatedFlowModalData?.flow || {}, null, 2)}
          </pre>
        </div>
      </Dialog>

      <ToastContainer />

      <input
        type="file"
        accept="application/json,.json,.bpmn,.xml,application/xml,text/xml"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
}
