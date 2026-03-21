import React from 'react';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../styles/Button';
import { getDocument } from '../../api/ragDocuments';
import logger from '../../utils/logger';

/**
 * RagQueryModal
 *
 * Modal para fazer perguntas diretamente ao RAG e ver os documentos de origem.
 *
 * Props:
 *   isOpen            {boolean}
 *   queryText         {string}
 *   queryResult       {object|null}
 *   queryLoading      {boolean}
 *   onQueryTextChange {(text: string) => void}
 *   onQuery           {() => void}
 *   onClose           {() => void}
 *   onOpenDocument    {(document: object) => void}  — abre o modal de detalhes com o doc selecionado
 *   showToast         {(message, type) => void}
 */
export function RagQueryModal({ isOpen, queryText, queryResult, queryLoading, onQueryTextChange, onQuery, onClose, onOpenDocument, showToast }) {

  const handleViewDocument = async (documentId) => {
    try {
      const doc = await getDocument(documentId);
      if (doc) {
        onOpenDocument(doc);
      } else {
        showToast('Documento não encontrado', 'warning');
      }
    } catch (error) {
      logger.error('Erro ao buscar documento:', error);
      showToast('Erro ao buscar documento', 'error');
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        onClose();
        onQueryTextChange('');
      }}
      title="Fazer Pergunta ao RAG"
      size="lg"
    >
      <div className="space-y-4">
        {/* Campo de entrada */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Digite sua pergunta
          </label>
          <textarea
            value={queryText}
            onChange={(e) => onQueryTextChange(e.target.value)}
            placeholder="Ex: Como funciona o sistema de tickets?"
            className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-none"
            rows={4}
            disabled={queryLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onQuery();
              }
            }}
          />
          <p className="text-xs text-text-tertiary mt-1">
            Pressione Ctrl+Enter (ou Cmd+Enter no Mac) para enviar
          </p>
        </div>

        {/* Botão de enviar */}
        <div className="flex justify-end">
          <Button
            onClick={onQuery}
            disabled={queryLoading || !queryText.trim()}
            style={{
              backgroundColor: 'var(--accent-primary)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: queryLoading || !queryText.trim() ? 'not-allowed' : 'pointer',
              opacity: queryLoading || !queryText.trim() ? 0.6 : 1,
            }}
          >
            {queryLoading ? 'Processando...' : '🔍 Buscar'}
          </Button>
        </div>

        {/* Resultado */}
        {queryResult && (
          <div className="space-y-4 mt-6 pt-6 border-t border-border-default">
            {queryResult.success || queryResult.response ? (
              <>
                {/* Resposta */}
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Resposta
                  </label>
                  <div className={`rounded-lg p-4 ${
                    queryResult.success ? 'bg-bg-secondary' : 'bg-status-warning/10 border border-status-warning/30'
                  }`}>
                    <p className="text-text-primary whitespace-pre-wrap">
                      {queryResult.response || 'Sem resposta'}
                    </p>
                  </div>
                  {queryResult.confidence !== undefined && queryResult.confidence > 0 && (
                    <p className="text-xs text-text-tertiary mt-1">
                      Confiança: {Math.round(queryResult.confidence * 100)}%
                    </p>
                  )}
                  {!queryResult.success && (
                    <p className="text-xs text-status-warning mt-1">
                      ⚠️ Nenhum documento relevante encontrado para esta pergunta
                    </p>
                  )}
                </div>

                {/* Documentos relacionados */}
                {queryResult.sources && queryResult.sources.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Documentos Relacionados ({queryResult.sources.length})
                    </label>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {queryResult.sources.map((source, index) => (
                        <div
                          key={index}
                          className="bg-bg-secondary rounded-lg p-4 border border-border-default hover:border-accent-primary transition-colors cursor-pointer"
                          onClick={() => handleViewDocument(source.documentId)}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1">
                              <h4 className="text-text-primary font-semibold mb-1">
                                {source.title || `Documento ${index + 1}`}
                              </h4>
                              {source.score !== undefined && (
                                <span className="text-xs text-text-tertiary">
                                  Relevância: {Math.round(source.score * 100)}%
                                </span>
                              )}
                            </div>
                            <button
                              className="text-accent-primary hover:text-accent-hover text-sm"
                              onClick={(e) => { e.stopPropagation(); handleViewDocument(source.documentId); }}
                            >
                              📄 Ver detalhes
                            </button>
                          </div>
                          <p className="text-text-secondary text-sm line-clamp-3">
                            {source.excerpt || 'Sem trecho disponível'}
                          </p>
                          {source.documentId && (
                            <p className="text-text-tertiary text-xs mt-2 font-mono">
                              ID: {source.documentId.substring(0, 16)}...
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Metadados */}
                {queryResult.metadata && (
                  <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-tertiary">
                    <div className="flex justify-between">
                      <span>Chunks encontrados:</span>
                      <span className="text-text-primary">{queryResult.metadata.chunksFound || 0}</span>
                    </div>
                    {queryResult.metadata.chunksSearched && (
                      <div className="flex justify-between mt-1">
                        <span>Chunks pesquisados:</span>
                        <span className="text-text-primary">{queryResult.metadata.chunksSearched}</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="bg-status-error/10 border border-status-error/30 rounded-lg p-4">
                <p className="text-status-error font-semibold mb-1">Erro</p>
                <p className="text-text-secondary text-sm">
                  {queryResult.error || 'Erro desconhecido ao processar pergunta'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
