import React from 'react';
import { Dialog } from '../../components/Dialog';

/**
 * RagAnalysisModal
 *
 * Modal de análise de documentos RAG — mostra progresso em tempo real e resultados detalhados.
 *
 * Props:
 *   isOpen            {boolean}
 *   analyzing         {boolean}
 *   analysisResults   {object|null}
 *   analysisProgress  {{ currentDocument, currentDocumentIndex, totalDocuments,
 *                        currentQuestion, currentQuestionIndex, totalQuestions,
 *                        questionsTested, successfulQuestions, failedQuestions, documentsAnalyzed }}
 *   onClose           {() => void}  — chamado quando o usuário fecha (não durante análise)
 */
export function RagAnalysisModal({ isOpen, analyzing, analysisResults, analysisProgress, onClose }) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => { if (!analyzing) onClose(); }}
      title="Análise de Documentos RAG"
      size="xl"
      showCloseButton={!analyzing}
    >
      <div className="space-y-4">
        {analyzing && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-accent-primary border-t-transparent mb-4"></div>
              <p className="text-text-primary font-medium text-lg">Analisando documentos e testando perguntas...</p>
              <p className="text-text-secondary text-sm mt-2">Isso pode levar alguns minutos</p>
            </div>

            {analysisProgress.totalDocuments > 0 && (
              <div className="bg-bg-secondary rounded-lg p-4 space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-text-primary font-medium">Progresso Geral</span>
                    <span className="text-text-secondary text-sm">
                      {analysisProgress.documentsAnalyzed} / {analysisProgress.totalDocuments} documentos
                    </span>
                  </div>
                  <div className="w-full bg-bg-tertiary rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-accent-primary h-3 rounded-full transition-all duration-300"
                      style={{ width: `${(analysisProgress.documentsAnalyzed / analysisProgress.totalDocuments) * 100}%` }}
                    />
                  </div>
                </div>

                {analysisProgress.currentDocument && (
                  <div className="border-t border-border-default pt-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-text-secondary text-sm">Documento atual:</span>
                      <span className="text-text-primary font-medium text-sm">
                        {analysisProgress.currentDocumentIndex} / {analysisProgress.totalDocuments}
                      </span>
                    </div>
                    <p className="text-text-primary font-semibold truncate" title={analysisProgress.currentDocument}>
                      {analysisProgress.currentDocument}
                    </p>
                  </div>
                )}

                {analysisProgress.currentQuestion && (
                  <div className="border-t border-border-default pt-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-text-secondary text-sm">Pergunta atual:</span>
                      <span className="text-text-primary font-medium text-sm">
                        {analysisProgress.currentQuestionIndex} / 3
                      </span>
                    </div>
                    <p className="text-text-primary text-sm italic truncate" title={analysisProgress.currentQuestion}>
                      "{analysisProgress.currentQuestion}"
                    </p>
                  </div>
                )}

                <div className="border-t border-border-default pt-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-text-primary">{analysisProgress.questionsTested}</div>
                      <div className="text-xs text-text-secondary">Perguntas Testadas</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-status-success">{analysisProgress.successfulQuestions}</div>
                      <div className="text-xs text-text-secondary">Com Resposta</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-status-error">{analysisProgress.failedQuestions}</div>
                      <div className="text-xs text-text-secondary">Sem Resposta</div>
                    </div>
                  </div>
                  {analysisProgress.questionsTested > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-default">
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary text-sm">Taxa de sucesso:</span>
                        <span className="text-text-primary font-semibold">
                          {Math.round((analysisProgress.successfulQuestions / analysisProgress.questionsTested) * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-bg-tertiary rounded-full h-2 mt-2 overflow-hidden">
                        <div
                          className="bg-status-success h-2 rounded-full transition-all duration-300"
                          style={{ width: `${(analysisProgress.successfulQuestions / analysisProgress.questionsTested) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!analyzing && analysisResults && (
          <>
            {/* Resumo */}
            <div className="bg-bg-secondary rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Resumo da Análise</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <div className="text-2xl font-bold text-text-primary">{analysisResults.totalDocuments}</div>
                  <div className="text-sm text-text-secondary">Total de Documentos</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-primary">
                    {analysisResults.totalIndexedDocuments !== undefined ? analysisResults.totalIndexedDocuments : analysisResults.documentsAnalyzed}
                  </div>
                  <div className="text-sm text-text-secondary">
                    {analysisResults.totalIndexedDocuments !== undefined ? 'Disponíveis para Análise' : 'Documentos Analisados'}
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-primary">{analysisResults.documentsAnalyzed}</div>
                  <div className="text-sm text-text-secondary">Documentos Analisados</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-primary">{analysisResults.totalQuestions}</div>
                  <div className="text-sm text-text-secondary">Perguntas Testadas</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-status-success">{analysisResults.successfulQuestions}</div>
                  <div className="text-sm text-text-secondary">Com Resposta</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-status-error">{analysisResults.failedQuestions}</div>
                  <div className="text-sm text-text-secondary">Sem Resposta</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border-default">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary">Taxa de sucesso:</span>
                  <span className="text-lg font-semibold text-text-primary">
                    {analysisResults.totalQuestions > 0
                      ? `${Math.round((analysisResults.successfulQuestions / analysisResults.totalQuestions) * 100)}%`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Resultados Detalhados */}
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-4">Resultados Detalhados</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {(analysisResults.results || []).map((result, index) => (
                  <div
                    key={index}
                    className={`rounded-lg p-4 border ${
                      result.success ? 'bg-status-success/10 border-status-success/30' : 'bg-status-error/10 border-status-error/30'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="text-text-primary font-semibold mb-1">
                          {result.documentTitle || result.documentId?.substring(0, 30)}
                        </h4>
                        <p className="text-text-secondary text-sm mb-2">
                          <strong>Pergunta:</strong> {result.question}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${
                        result.success ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'
                      }`}>
                        {result.success ? '✓ Sucesso' : '✗ Falhou'}
                      </span>
                    </div>
                    {result.success && (
                      <div className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-text-secondary">Documentos encontrados:</span>
                          <span className="text-text-primary font-semibold">{result.sourcesCount}</span>
                        </div>
                        {result.confidence > 0 && (
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Confiança:</span>
                            <span className="text-text-primary font-semibold">{Math.round(result.confidence * 100)}%</span>
                          </div>
                        )}
                      </div>
                    )}
                    {!result.success && result.error && (
                      <p className="mt-2 text-xs text-status-error"><strong>Erro:</strong> {result.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Estatísticas por Documento */}
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-4">Estatísticas por Documento</h3>
              <div className="space-y-2">
                {Array.from(new Map((analysisResults.results || []).map(r => [r.documentId, r.documentTitle])).entries()).map(([docId, docTitle]) => {
                  const docResults = (analysisResults.results || []).filter(r => r.documentId === docId);
                  const successCount = docResults.filter(r => r.success).length;
                  return (
                    <div key={docId} className="bg-bg-secondary rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <span className="text-text-primary font-medium" title={docTitle || docId}>{docTitle || docId?.substring(0, 30)}</span>
                        <span className="text-text-secondary text-sm">{successCount} / {docResults.length} perguntas com resposta</span>
                      </div>
                      <div className="mt-2 w-full bg-bg-tertiary rounded-full h-2">
                        <div className="bg-accent-primary h-2 rounded-full transition-all" style={{ width: `${(successCount / docResults.length) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Documentos Não Analisados */}
            {analysisResults.documentsWithoutQuestions && analysisResults.documentsWithoutQuestions.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4">
                  Documentos Não Analisados ({analysisResults.documentsWithoutQuestions.length})
                </h3>
                <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-4 mb-4">
                  <p className="text-sm text-text-secondary mb-3">
                    Os seguintes documentos foram selecionados para análise, mas não geraram perguntas válidas:
                  </p>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {analysisResults.documentsWithoutQuestions.map((doc, index) => (
                      <div key={doc.documentId || index} className="bg-bg-secondary rounded-lg p-3 border border-border-default">
                        <p className="text-text-primary font-medium text-sm mb-1">{doc.title || doc.documentId || `Documento ${index + 1}`}</p>
                        <p className="text-status-warning text-xs font-medium">{doc.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!analyzing && !analysisResults && (
          <div className="text-center py-8">
            <p className="text-text-secondary">Clique em "Analisar Documentos" para começar</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
