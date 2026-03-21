import React from 'react';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../styles/Button';

/**
 * RagReindexModal
 *
 * Modal de progresso de reindexação em lote.
 *
 * Props:
 *   isOpen        {boolean}
 *   progress      {{ status, message, total, indexed, failed, errors, consistencyCheck }}
 *   onClose       {() => void}  — deve chamar setShowReindexModal(false) + resetProgress
 */
export function RagReindexModal({ isOpen, progress, onClose }) {
  const canClose = progress.status !== 'processing';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => { if (canClose) onClose(); }}
      title="Reindexação em Lote"
      size="md"
      showCloseButton={canClose}
    >
      <div className="space-y-4">
        {/* Status e Mensagem */}
        <div className="text-center">
          {progress.status === 'processing' && (
            <div className="mb-4">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-accent-primary border-t-transparent"></div>
            </div>
          )}
          {progress.status === 'completed' && (
            <div className="mb-4">
              <div className="inline-block rounded-full h-12 w-12 bg-status-success flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}
          {progress.status === 'error' && (
            <div className="mb-4">
              <div className="inline-block rounded-full h-12 w-12 bg-status-error flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
          )}
          <p className="text-text-primary font-medium mb-2">
            {progress.status === 'processing' && 'Processando...'}
            {progress.status === 'completed' && 'Concluído!'}
            {progress.status === 'error' && 'Erro'}
          </p>
          <p className="text-text-secondary text-sm whitespace-pre-line">
            {progress.message}
          </p>
        </div>

        {/* Verificação de Consistência */}
        {progress.status === 'completed' && progress.consistencyCheck && (
          <div className={`mb-4 p-4 rounded-lg border-2 ${
            progress.consistencyCheck.isConsistent === true
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
              : progress.consistencyCheck.isConsistent === false
              ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
              : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
          }`}>
            <div className="flex items-start gap-2">
              <span className="text-xl">
                {progress.consistencyCheck.isConsistent === true ? '✅' :
                 progress.consistencyCheck.isConsistent === false ? '⚠️' : 'ℹ️'}
              </span>
              <div className="flex-1">
                <div className="font-semibold mb-1 text-text-primary">
                  {progress.consistencyCheck.isConsistent === true ? 'Consistência Verificada' :
                   progress.consistencyCheck.isConsistent === false ? 'Inconsistência Detectada' :
                   'Verificação de Consistência'}
                </div>
                <div className="text-sm text-text-secondary mb-2">
                  {progress.consistencyCheck.message}
                </div>
                {progress.consistencyCheck.isConsistent === false && (
                  <div className="text-xs text-text-tertiary mt-2 space-y-1">
                    <div>Banco de Dados: <span className="font-semibold">{progress.consistencyCheck.dbIndexed}</span> documentos indexados</div>
                    <div>Vector Store: <span className="font-semibold">{progress.consistencyCheck.vectorIndexed}</span> documentos indexados</div>
                    <div className="mt-1 font-semibold text-status-warning">Diferença: {progress.consistencyCheck.difference} documento(s)</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Estatísticas */}
        {progress.total > 0 && (
          <div className="bg-bg-secondary rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary">Total de documentos:</span>
              <span className="text-text-primary font-semibold">{progress.total}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-text-secondary">Indexados com sucesso:</span>
              <span className="text-status-success font-semibold">{progress.indexed}</span>
            </div>
            {progress.failed > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-text-secondary">Falharam:</span>
                <span className="text-status-error font-semibold">{progress.failed}</span>
              </div>
            )}
          </div>
        )}

        {/* Barra de Progresso (Indeterminada durante processamento) */}
        {progress.status === 'processing' && progress.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Processando</span>
              <span className="text-text-primary">
                {progress.total} documento{progress.total !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="w-full bg-bg-secondary rounded-full h-3 overflow-hidden">
              <div className="bg-accent-primary h-3 rounded-full animate-pulse" style={{ width: '100%' }} />
            </div>
            <p className="text-xs text-text-tertiary text-center">
              Aguarde enquanto os documentos são processados...
            </p>
          </div>
        )}

        {/* Barra de Progresso Final */}
        {progress.status === 'completed' && progress.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Progresso</span>
              <span className="text-text-primary">
                {progress.indexed + progress.failed} / {progress.total}
              </span>
            </div>
            <div className="w-full bg-bg-secondary rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-300 flex items-center justify-end pr-2 ${
                  progress.failed > 0 ? 'bg-status-warning' : 'bg-status-success'
                }`}
                style={{ width: '100%' }}
              >
                <span className="text-xs text-white font-medium">100%</span>
              </div>
            </div>
          </div>
        )}

        {/* Lista de Erros */}
        {progress.errors && progress.errors.length > 0 && (
          <div className="bg-status-error/10 border border-status-error/30 rounded-lg p-4 max-h-48 overflow-y-auto">
            <p className="text-status-error font-semibold mb-2">Erros encontrados:</p>
            <ul className="space-y-2 text-sm">
              {progress.errors.slice(0, 10).map((error, index) => (
                <li key={index} className="text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {error.title || error.documentId || `Documento ${index + 1}`}:
                  </span>{' '}
                  {error.error || error.message || 'Erro desconhecido'}
                </li>
              ))}
              {progress.errors.length > 10 && (
                <li className="text-text-tertiary italic">
                  ... e mais {progress.errors.length - 10} erro(s)
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Botão de Fechar */}
        {canClose && (
          <div className="flex justify-end pt-2">
            <Button
              onClick={onClose}
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Fechar
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
