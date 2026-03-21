import React from 'react';
import { Button } from '../../styles/Button';
import { Input, Textarea } from '../../styles/Input';
import { getCategoryLabel, validateUrl } from './generateSystemFileUtils';

/**
 * @param {Record<string, unknown>} props
 * @returns {JSX.Element}
 */
export function GenerateSystemKnowledgeFaqSection({
  bootstrap,
  useRag,
  setUseRag,
  ragSources,
  setRagSources,
  handleFileSelect,
  uploadedFiles,
  setSelectedFileDetails,
  removeUploadedFile,
  useWebScraping,
  setUseWebScraping,
  scrapingTargets,
  updateScrapingTarget,
  removeScrapingTarget,
  addScrapingTarget,
  includeQuestions,
  handleSuggestQuestionsFromDescription,
  name,
  description,
  setQuestionsList,
  setFaqGroups,
  setFaqCoverage,
  setFaqExclusions,
  setShowFaqExclusions,
  setInitialFlow,
  questionsList,
  faqExclusions,
  showFaqExclusions,
  setShowFaqExclusionsLocal,
  setError,
  questionsText,
  setQuestionsText,
  handleAddQuestionsFromText,
  faqCoverage,
  faqCoverageMeta,
  faqGroups,
  handleRemoveQuestion,
}) {
  return (
    <>
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 2 — Fonte de Conhecimento da IA</h2>

        <div className="mb-6">
          <label className="flex items-center gap-2 cursor-pointer mb-3 text-text-primary">
            <input
              type="checkbox"
              checked={useRag}
              onChange={(e) => setUseRag(e.target.checked)}
              disabled={bootstrap}
              className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
            />
            <span>RAG (interno)</span>
          </label>
          {useRag && !bootstrap && (
            <div className="ml-6 flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={ragSources.flows}
                  onChange={(e) => setRagSources({ ...ragSources, flows: e.target.checked })}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Fluxos</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={ragSources.qa}
                  onChange={(e) => setRagSources({ ...ragSources, qa: e.target.checked })}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>QA</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={ragSources.docs}
                  onChange={(e) => setRagSources({ ...ragSources, docs: e.target.checked })}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Documentação</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={ragSources.uploads || false}
                  onChange={(e) => setRagSources({ ...ragSources, uploads: e.target.checked })}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span>Arquivos Enviados</span>
              </label>
            </div>
          )}
        </div>

        <div className="mb-6 border-t border-border-default pt-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">📎 Upload de Arquivos para RAG</h3>
          <p className="text-sm text-text-secondary mb-4">
            Envie arquivos como promoções, avisos, tabelas de preço, imagens, PDFs, documentos, etc. para serem indexados no RAG e utilizados na geração.
            Todos os arquivos terão seu conteúdo extraído automaticamente: imagens usarão OCR, PDFs terão texto extraído, documentos de texto serão lidos completamente.
            A categoria será inferida automaticamente usando IA baseada no nome, tipo e conteúdo do arquivo. Todo o conteúdo extraído será indexado no RAG.
          </p>

          <div className="mb-4">
            <label htmlFor="file-upload-input" className="block mb-2 text-sm font-medium text-text-primary">
              Selecione arquivos:
            </label>
            <input
              id="file-upload-input"
              type="file"
              multiple
              onChange={handleFileSelect}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-accent-primary file:text-white hover:file:bg-accent-hover cursor-pointer"
              accept=".txt,.md,.pdf,.json,.csv,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,image/*"
            />
            <p className="text-xs text-text-tertiary mt-2">
              Formatos suportados: TXT, MD, PDF, JSON, CSV, DOC, DOCX, JPG, PNG, GIF, WEBP, BMP, SVG
            </p>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-text-primary mb-2">Arquivos enviados:</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {uploadedFiles.map((fileObj) => {
                  const isImage = fileObj.file?.type?.startsWith('image/') || fileObj.preview;
                  return (
                    <div
                      key={fileObj.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        fileObj.status === 'success'
                          ? 'bg-status-success/10 border-status-success/30'
                          : fileObj.status === 'error'
                            ? 'bg-status-error/10 border-status-error/30'
                            : fileObj.status === 'processing'
                              ? 'bg-status-warning/10 border-status-warning/30'
                              : 'bg-bg-secondary border-border-default'
                      } ${fileObj.status === 'success' ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
                      onClick={() => fileObj.status === 'success' && setSelectedFileDetails(fileObj)}
                      title={fileObj.status === 'success' ? 'Clique para ver detalhes e extrações' : ''}
                    >
                      {isImage && fileObj.preview && (
                        <div className="flex-shrink-0">
                          <img
                            src={fileObj.preview}
                            alt={fileObj.name}
                            className="w-16 h-16 object-cover rounded border border-border-default"
                          />
                        </div>
                      )}
                      {isImage && !fileObj.preview && (
                        <div className="flex-shrink-0 w-16 h-16 bg-bg-secondary border border-border-default rounded flex items-center justify-center text-2xl">
                          🖼️
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-text-primary truncate">
                            {fileObj.name}
                            {fileObj.status === 'success' && (
                              <span className="ml-2 text-xs text-text-tertiary">(clique para detalhes)</span>
                            )}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            fileObj.status === 'pending'
                              ? 'bg-status-warning/20 text-status-warning border border-status-warning/30'
                              : 'bg-accent-light text-accent-primary'
                          }`}>
                            {fileObj.status === 'pending' ? 'Pendente' : getCategoryLabel(fileObj.category)}
                          </span>
                          {fileObj.status === 'processing' && (
                            <span className="text-xs text-status-warning animate-pulse">⏳ Processando...</span>
                          )}
                          {fileObj.status === 'success' && (
                            <>
                              {fileObj.isDuplicate ? (
                                <span className="text-xs text-status-warning">⚠ Duplicado (usando existente)</span>
                              ) : (
                                <span className="text-xs text-status-success">✓ Indexado</span>
                              )}
                            </>
                          )}
                          {fileObj.status === 'error' && (
                            <span className="text-xs text-status-error">✗ Erro</span>
                          )}
                        </div>
                        {fileObj.error && <p className="text-xs text-status-error mt-1">{fileObj.error}</p>}
                        <p className="text-xs text-text-tertiary mt-1">
                          {(fileObj.size / 1024).toFixed(2)} KB
                          {fileObj.status === 'success' && (
                            <>
                              {isImage && ' • OCR aplicado'}
                              {fileObj.file?.type === 'application/pdf' && ' • Texto extraído'}
                              {fileObj.file?.type?.startsWith('text/') && ' • Conteúdo indexado'}
                              {fileObj.progress !== undefined && ` • ${fileObj.progress}%`}
                            </>
                          )}
                          {fileObj.status === 'processing' &&
                            typeof fileObj.progress === 'number' &&
                            Number.isFinite(fileObj.progress) && (
                              <> • {Math.max(0, Math.min(100, Math.round(fileObj.progress)))}%</>
                            )}
                        </p>
                        {fileObj.status === 'processing' &&
                          typeof fileObj.progress === 'number' &&
                          Number.isFinite(fileObj.progress) && (
                            <div className="mt-2 h-2 w-full bg-bg-secondary border border-border-default rounded overflow-hidden">
                              <div
                                className="h-full bg-status-warning"
                                style={{
                                  width: `${Math.max(0, Math.min(100, Math.round(fileObj.progress)))}%`,
                                  transition: 'width 180ms ease-out',
                                }}
                              />
                            </div>
                          )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeUploadedFile(fileObj.id);
                        }}
                        className="ml-2 text-status-error hover:opacity-80 text-sm flex-shrink-0"
                        title="Remover"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              {uploadedFiles.some((f) => f.status === 'success') && (
                <div className="mt-3 p-2 bg-status-success/10 border border-status-success/30 rounded-lg text-status-success text-sm">
                  💡 Arquivos indexados estarão disponíveis quando você selecionar "Arquivos Enviados" nas fontes RAG acima.
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-3 text-text-primary">
            <input
              type="checkbox"
              checked={useWebScraping}
              onChange={(e) => setUseWebScraping(e.target.checked)}
              className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
            />
            <span>Raspagem (externo)</span>
          </label>
          {useWebScraping && (
            <div className="ml-6">
              {scrapingTargets.map((url, index) => (
                <div key={index} className="flex gap-2 mb-2 items-center">
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => updateScrapingTarget(index, e.target.value)}
                    placeholder="https://exemplo.com"
                    className="flex-1"
                  />
                  {validateUrl(url) && <span className="text-status-success">✓</span>}
                  {!validateUrl(url) && url.trim() !== '' && <span className="text-status-error">✗</span>}
                  {scrapingTargets.length > 1 && (
                    <Button onClick={() => removeScrapingTarget(index)} className="px-4 py-2">
                      Remover
                    </Button>
                  )}
                </div>
              ))}
              <Button onClick={addScrapingTarget} className="mt-2">
                + Adicionar URL
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <h2 className="text-xl font-semibold text-text-primary mb-4">BLOCO 3 — Perguntas (FAQ / Aprendizado Adaptivo)</h2>

        {(includeQuestions || bootstrap) && (
          <div className="mt-4">
            <p className="text-sm text-text-secondary mb-3">
              Adicione perguntas que o bot deve ser capaz de responder. Elas serão incorporadas na geração do fluxo.
            </p>

            <div className="flex flex-wrap gap-2 mb-3">
              <Button onClick={handleSuggestQuestionsFromDescription} disabled={!name.trim() && !description.trim()}>
                Sugerir
              </Button>
              <Button
                onClick={() => {
                  setQuestionsList([]);
                  setFaqGroups(null);
                  setFaqCoverage(null);
                  setFaqExclusions(null);
                  setShowFaqExclusions(false);
                  setInitialFlow(null);
                }}
                disabled={questionsList.length === 0}
              >
                Limpar lista
              </Button>
            </div>

            {(() => {
              const hasExclusions = Array.isArray(faqExclusions) && faqExclusions.length > 0;
              const count = hasExclusions ? faqExclusions.length : 0;
              return (
                <div className="mb-3 border border-border-default rounded-lg bg-bg-secondary p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-text-primary">
                      Exclusões dinâmicas (anti-ruído)
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => (hasExclusions ? setShowFaqExclusionsLocal((value) => !value) : null)}
                        className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1 hover:bg-bg-hover"
                        title={hasExclusions
                          ? 'Termos inferidos para excluir ruído técnico das perguntas'
                          : 'Os termos serão inferidos após gerar o FAQ'}
                        disabled={!hasExclusions}
                      >
                        {count} termo(s) {showFaqExclusions && hasExclusions ? '▲' : '▼'}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-accent-primary hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!hasExclusions}
                        onClick={async () => {
                          if (!hasExclusions) return;
                          try {
                            const txt = faqExclusions.join('\n');
                            if (navigator?.clipboard?.writeText) {
                              await navigator.clipboard.writeText(txt);
                            } else {
                              setError('Clipboard indisponível');
                            }
                          } catch {
                            setError('Falha ao copiar exclusões');
                          }
                        }}
                      >
                        Copiar
                      </button>
                    </div>
                  </div>

                  {!hasExclusions && (
                    <div className="mt-2 text-xs text-text-tertiary">
                      Ainda não há termos inferidos. Eles aparecem automaticamente quando você gerar o FAQ (via “Sugerir”).
                    </div>
                  )}

                  {showFaqExclusions && hasExclusions && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {faqExclusions.slice(0, 30).map((t) => (
                        <span key={t} className="text-xs border border-border-default rounded-full px-2 py-0.5 text-text-secondary">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <Textarea
              value={questionsText}
              onChange={(e) => setQuestionsText(e.target.value)}
              placeholder="Digite uma pergunta por linha. Ex.:&#10;Como resetar minha senha?&#10;Quais são as formas de pagamento?"
              rows={4}
              className="w-full"
            />

            <div className="flex items-center gap-3 mt-2">
              <Button onClick={handleAddQuestionsFromText} disabled={!questionsText.trim()}>
                Adicionar perguntas
              </Button>
              <span className="text-xs text-text-tertiary">
                {questionsList.length} pergunta(s) na lista
              </span>
            </div>

            {questionsList.length > 0 && (
              <div className="mt-4 border border-border-default rounded-lg bg-bg-secondary p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-sm font-semibold text-text-primary">Perguntas incluídas</div>
                  {typeof faqCoverage === 'number' && (
                    <span className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1">
                      Cobertura do conhecimento: {Math.round(Math.max(0, Math.min(1, faqCoverage)) * 100)}%
                      {Number.isFinite(Number(faqCoverageMeta?.chunkTextsEffective)) ? (
                        <span className="text-text-tertiary">
                          {' '}
                          ({Number(faqCoverageMeta.chunkTextsEffective)} chunks {faqCoverageMeta?.chunkCoverageMode === 'relevant' ? 'relevantes' : 'totais'})
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>

                <div className="space-y-3 max-h-56 overflow-y-auto">
                  {Array.isArray(faqGroups) && faqGroups.length > 0 ? (
                    faqGroups.map((group, gIdx) => (
                      <div key={`${gIdx}-${group?.category || 'categoria'}`} className="border border-border-default/60 rounded-lg p-2">
                        <div className="text-xs font-semibold text-text-secondary">
                          {group?.category || 'Outros'}
                        </div>
                        <div className="space-y-2 mt-2">
                          {(Array.isArray(group?.questions) ? group.questions : []).map((q) => {
                            const idx = questionsList.indexOf(q);
                            return (
                              <div key={q} className="flex items-start justify-between gap-3">
                                <div className="text-sm text-text-primary whitespace-pre-wrap">{q}</div>
                                <button
                                  type="button"
                                  onClick={() => (idx >= 0 ? handleRemoveQuestion(idx) : null)}
                                  className="text-status-error hover:opacity-80 text-sm flex-shrink-0"
                                  title="Remover"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    questionsList.map((q, idx) => (
                      <div key={`${idx}-${q}`} className="flex items-start justify-between gap-3">
                        <div className="text-sm text-text-primary whitespace-pre-wrap">{q}</div>
                        <button
                          type="button"
                          onClick={() => handleRemoveQuestion(idx)}
                          className="text-status-error hover:opacity-80 text-sm flex-shrink-0"
                          title="Remover"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}