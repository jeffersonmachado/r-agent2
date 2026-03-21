import React from 'react';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../styles/Button';

export function RagDocumentDetailsModal({
  isOpen,
  document: selectedDocument,
  loading,
  deletingById,
  onClose,
  onDelete,
  onReindex,
  formatDateTime,
  getDetailsText,
  getExtractedText,
  downloadTextAsFile,
  downloadFromUrlBestEffort,
  buildApiUrl,
  getAuthHeaders,
}) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Detalhes do Documento"
      size="lg"
    >
      {selectedDocument && (
        <div className="space-y-4">
          {/* Título */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
            <p className="text-text-primary font-semibold">{selectedDocument.title || 'Sem título'}</p>
          </div>

          {/* ID */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">ID</label>
            <p className="text-text-primary font-mono text-sm break-all">{selectedDocument.id}</p>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
            <span className={`inline-block px-3 py-1 rounded text-sm ${
              selectedDocument.status === 'active' ? 'bg-status-success/20 text-status-success' :
              selectedDocument.status === 'archived' ? 'bg-status-warning/20 text-status-warning' :
              'bg-status-error/20 text-status-error'
            }`}>
              {selectedDocument.status || 'unknown'}
            </span>
          </div>

          {/* Indexação */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Status de Indexação</label>
            <div className="flex items-center gap-3">
              <span className={`inline-block px-3 py-1 rounded text-sm ${
                selectedDocument.indexed ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'
              }`}>
                {selectedDocument.indexed ? '✓ Indexado' : '✗ Não indexado'}
              </span>
              {selectedDocument.chunksCount > 0 && (
                <span className="text-text-secondary text-sm">
                  {selectedDocument.chunksCount} chunk{selectedDocument.chunksCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {selectedDocument.indexedAt && (
              <p className="text-text-tertiary text-xs mt-1">
                Indexado em: {formatDateTime(selectedDocument.indexedAt)}
              </p>
            )}
          </div>

          {/* Fonte */}
          {selectedDocument.metadata?.source && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Fonte</label>
              <span className={`inline-block px-3 py-1 rounded text-sm ${
                selectedDocument.metadata.source === 'knowledge_base' ? 'bg-status-info/20 text-status-info' :
                selectedDocument.metadata.source === 'product_docs' ? 'bg-status-warning/20 text-status-warning' :
                selectedDocument.metadata.source === 'tickets' ? 'bg-accent-light text-accent-primary' :
                'bg-bg-secondary text-text-secondary'
              }`}>
                {selectedDocument.metadata.source}
              </span>
            </div>
          )}

          {/* Metadados */}
          {selectedDocument.metadata && Object.keys(selectedDocument.metadata).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Metadados</label>
              <div className="bg-bg-secondary rounded-lg p-4 space-y-2">
                {selectedDocument.metadata.category && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary text-sm">Categoria:</span>
                    <span className="text-text-primary text-sm">{selectedDocument.metadata.category}</span>
                  </div>
                )}
                {selectedDocument.metadata.productId && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary text-sm">ID do Produto:</span>
                    <span className="text-text-primary text-sm font-mono">{selectedDocument.metadata.productId}</span>
                  </div>
                )}
                {selectedDocument.metadata.tags && selectedDocument.metadata.tags.length > 0 && (
                  <div>
                    <span className="text-text-secondary text-sm block mb-1">Tags:</span>
                    <div className="flex flex-wrap gap-2">
                      {selectedDocument.metadata.tags.map((tag, index) => (
                        <span key={index} className="px-2 py-1 bg-bg-tertiary text-text-secondary rounded text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {Object.entries(selectedDocument.metadata)
                  .filter(([key]) => !['source', 'category', 'productId', 'tags'].includes(key))
                  .map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-text-secondary text-sm">{key}:</span>
                      <span className="text-text-primary text-sm break-all text-right max-w-[60%]">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Documento original (URL) */}
          {(selectedDocument.metadata?.url ||
            selectedDocument.metadata?.filePath ||
            selectedDocument.metadata?.file ||
            selectedDocument.metadata?.sourceUrl) && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Documento Original</label>
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const raw =
                    selectedDocument.metadata?.url ||
                    selectedDocument.metadata?.sourceUrl ||
                    selectedDocument.metadata?.filePath ||
                    selectedDocument.metadata?.file ||
                    '';
                  const href = raw && raw.startsWith('/') ? buildApiUrl(raw) : raw;
                  if (href) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-primary hover:text-accent-hover underline flex items-center gap-2 break-all"
                      >
                        <span>🔗</span>
                        <span>{href}</span>
                        <span className="text-xs text-text-tertiary">(abrir em nova aba)</span>
                      </a>
                    );
                  }
                  return null;
                })()}
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                  onClick={async () => {
                    const originalUrl =
                      selectedDocument.metadata?.url ||
                      selectedDocument.metadata?.sourceUrl ||
                      selectedDocument.metadata?.filePath ||
                      selectedDocument.metadata?.file;
                    const filenameHint =
                      selectedDocument.metadata?.fileName ||
                      selectedDocument.metadata?.filename ||
                      selectedDocument.title ||
                      selectedDocument.id;
                    await downloadFromUrlBestEffort(originalUrl, filenameHint);
                  }}
                  title="Tentar baixar o documento original"
                >
                  ⬇️ Download
                </button>
              </div>
            </div>
          )}

          {/* Binário original (armazenado no BD) */}
          {(selectedDocument?.metadata?.fileName || selectedDocument?.metadata?.filename || selectedDocument?.metadata?.originalBinary?.stored) && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Arquivo Original (binário)</label>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                  onClick={async () => {
                    const filenameHint =
                      selectedDocument.metadata?.originalBinary?.filename ||
                      selectedDocument.metadata?.fileName ||
                      selectedDocument.metadata?.filename ||
                      selectedDocument.title ||
                      selectedDocument.id;
                    await downloadFromUrlBestEffort(
                      `/rag/documents/${encodeURIComponent(selectedDocument.id)}/download`,
                      filenameHint,
                      { headers: getAuthHeaders() }
                    );
                  }}
                  title="Baixar o arquivo original salvo no banco"
                >
                  ⬇️ Baixar arquivo (DB)
                </button>
                {selectedDocument.metadata?.originalBinary?.mimeType && (
                  <span className="text-xs text-text-tertiary">
                    {selectedDocument.metadata.originalBinary.mimeType}
                  </span>
                )}
                {!selectedDocument?.metadata?.originalBinary?.stored && (
                  <span className="text-xs text-text-tertiary">
                    (Obs.: este documento não tem a flag `originalBinary.stored`; se o download acima retornar 404, o binário não está salvo no BD.)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Texto extraído */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Texto extraído</label>
            <div className="bg-bg-secondary rounded-lg p-4 max-h-96 overflow-y-auto">
              <p className="text-text-primary text-sm whitespace-pre-wrap break-words">
                {getDetailsText(selectedDocument) || 'Sem texto extraído'}
              </p>
            </div>
            {getDetailsText(selectedDocument) && (
              <p className="text-text-tertiary text-xs mt-1">
                {getDetailsText(selectedDocument).length} caractere{getDetailsText(selectedDocument).length !== 1 ? 's' : ''}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                onClick={() => {
                  const filename =
                    selectedDocument.metadata?.fileName ||
                    selectedDocument.metadata?.filename ||
                    selectedDocument.title ||
                    selectedDocument.id ||
                    'texto-extraido';
                  downloadTextAsFile(filename, getDetailsText(selectedDocument));
                }}
                title="Baixar o texto extraído como .txt"
              >
                ⬇️ Baixar texto (.txt)
              </button>
              {selectedDocument.metadata?.fileName && (
                <span className="text-xs text-text-tertiary">
                  (Obs.: este download é do texto extraído; quando disponível, o binário original pode ser baixado acima)
                </span>
              )}
            </div>

            {(() => {
              const extracted = getExtractedText(selectedDocument);
              const indexable = (selectedDocument?.content && typeof selectedDocument.content === 'string')
                ? selectedDocument.content
                : '';
              const showIndexable = extracted && indexable && extracted.trim() !== indexable.trim();
              if (!showIndexable) return null;
              return (
                <details className="mt-3 cursor-pointer">
                  <summary className="text-xs text-text-tertiary select-none">
                    Ver conteúdo indexável (o que vai para o vector store)
                  </summary>
                  <div className="bg-bg-secondary rounded-lg p-3 mt-2 max-h-64 overflow-y-auto">
                    <p className="text-text-secondary text-xs whitespace-pre-wrap break-words">
                      {indexable}
                    </p>
                  </div>
                </details>
              );
            })()}
          </div>

          {/* Datas */}
          <div className="grid grid-cols-2 gap-4">
            {selectedDocument.createdAt && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Criado em</label>
                <p className="text-text-primary text-sm">
                  {formatDateTime(selectedDocument.createdAt)}
                </p>
              </div>
            )}
            {selectedDocument.updatedAt && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Atualizado em</label>
                <p className="text-text-primary text-sm">
                  {formatDateTime(selectedDocument.updatedAt)}
                </p>
              </div>
            )}
          </div>

          {/* Tenant ID */}
          {selectedDocument.tenantId && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Tenant ID</label>
              <p className="text-text-primary font-mono text-sm break-all">{selectedDocument.tenantId}</p>
            </div>
          )}

          {/* Botões de Ação */}
          <div className="flex gap-2 justify-end pt-4 border-t border-border-default">
            <Button
              onClick={() => onReindex(selectedDocument)}
              disabled={loading}
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {selectedDocument?.indexed ? '🔄 Reindexar' : '🔍 Indexar'}
            </Button>
            <Button
              onClick={() => onDelete(selectedDocument)}
              disabled={loading || (selectedDocument?.id && !!deletingById[String(selectedDocument.id)])}
              style={{
                backgroundColor: 'var(--status-error)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: (loading || (selectedDocument?.id && !!deletingById[String(selectedDocument.id)])) ? 'not-allowed' : 'pointer',
                opacity: (loading || (selectedDocument?.id && !!deletingById[String(selectedDocument.id)])) ? 0.6 : 1,
              }}
            >
              🗑️ Excluir
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
