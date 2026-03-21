import React, { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../styles/Button';
import { updateSynonymsFromDocuments, cleanInvalidQueries, triggerLearning, deleteSynonym, updateSynonym } from '../../api/ragDocuments';
import logger from '../../utils/logger';

export function RagLearningModal({
  isOpen,
  loadingLearning,
  learningData,
  tenantId,
  documents,
  onClose,
  onRefresh,
  formatDateTime,
  formatDateOnly,
  showToast,
}) {
  const [editingSynonym, setEditingSynonym] = useState(null);

  const handleClose = () => {
    onClose();
    setEditingSynonym(null);
  };

  const handleUpdateSynonyms = async () => {
    try {
      if (!tenantId) return;
      const indexedDocs = documents.filter(doc => doc.indexed && doc.status === 'active');
      await updateSynonymsFromDocuments(tenantId, indexedDocs);
      await onRefresh();
      showToast('Sinônimos atualizados!', 'success');
    } catch (error) {
      logger.error('Erro ao atualizar sinônimos:', error);
      showToast('Erro ao atualizar sinônimos', 'error');
    }
  };

  const handleCleanQueries = async () => {
    try {
      const confirmed = window.confirm('Tem certeza que deseja remover todas as perguntas inválidas e duplicadas do histórico?');
      if (!confirmed) return;
      if (!tenantId) return;
      const result = await cleanInvalidQueries(tenantId);
      await onRefresh();
      const duplicates = (result.removedDuplicatesSuccessful || 0) + (result.removedDuplicatesFailed || 0);
      const invalid = result.totalRemoved - duplicates;
      let message = `${result.totalRemoved || 0} perguntas removidas`;
      if (invalid > 0 && duplicates > 0) message += ` (${invalid} inválidas, ${duplicates} duplicadas)`;
      else if (invalid > 0) message += ` (${invalid} inválidas)`;
      else if (duplicates > 0) message += ` (${duplicates} duplicadas)`;
      showToast(message, 'success');
    } catch (error) {
      logger.error('Erro ao limpar perguntas inválidas:', error);
      showToast('Erro ao limpar perguntas inválidas', 'error');
    }
  };

  const handleDeleteSynonym = async (term) => {
    try {
      const confirmed = window.confirm(`Tem certeza que deseja remover o sinônimo "${term}"?`);
      if (!confirmed) return;
      if (!tenantId) return;
      await deleteSynonym(tenantId, term);
      await onRefresh();
      showToast('Sinônimo removido!', 'success');
    } catch (error) {
      logger.error('Erro ao remover sinônimo:', error);
      showToast('Erro ao remover sinônimo', 'error');
    }
  };

  const handleTriggerLearning = async () => {
    try {
      if (!tenantId) return;
      await triggerLearning(tenantId);
      await onRefresh();
      showToast('Aprendizado disparado! Configurações otimizadas.', 'success');
    } catch (error) {
      logger.error('Erro ao disparar aprendizado:', error);
      showToast('Erro ao disparar aprendizado', 'error');
    }
  };

  const handleSaveSynonym = async () => {
    try {
      if (!tenantId || !editingSynonym) return;
      await updateSynonym(tenantId, editingSynonym.term, editingSynonym.synonyms);
      await onRefresh();
      setEditingSynonym(null);
      showToast('Sinônimos atualizados!', 'success');
    } catch (error) {
      logger.error('Erro ao atualizar sinônimos:', error);
      showToast('Erro ao atualizar sinônimos', 'error');
    }
  };

  const handleDeleteEditingSynonym = async () => {
    if (!editingSynonym) return;
    try {
      const confirmed = window.confirm(`Tem certeza que deseja remover o sinônimo "${editingSynonym.term}"?`);
      if (!confirmed) return;
      if (!tenantId) return;
      await deleteSynonym(tenantId, editingSynonym.term);
      await onRefresh();
      setEditingSynonym(null);
      showToast('Sinônimo removido!', 'success');
    } catch (error) {
      logger.error('Erro ao remover sinônimo:', error);
      showToast('Erro ao remover sinônimo', 'error');
    }
  };

  const btnStyle = (bg) => ({
    backgroundColor: `var(${bg})`,
    color: 'white',
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
  });

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={handleClose}
        title="🧠 Aprendizado Adaptativo"
        size="xl"
      >
        <div className="space-y-6">
          {loadingLearning ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-accent-primary border-t-transparent mb-4"></div>
              <p className="text-text-secondary">Carregando dados de aprendizado...</p>
            </div>
          ) : learningData ? (
            <>
              {/* Estatísticas Gerais */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <span>📊</span><span>Estatísticas de Aprendizado</span>
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-text-primary">
                      {learningData.learningCycles?.total || learningData.metrics?.learningCycles || 0}
                    </div>
                    <div className="text-sm text-text-secondary">Ciclos de Aprendizado</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-status-success">
                      {learningData.metrics?.successfulQueries || learningData.successfulQueries || 0}
                    </div>
                    <div className="text-sm text-text-secondary">Queries Bem-sucedidas</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-status-error">
                      {learningData.metrics?.failedQueries || learningData.failedQueries || 0}
                    </div>
                    <div className="text-sm text-text-secondary">Queries Falhadas</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-text-primary">
                      {learningData.metrics?.successRate ? `${Math.round(learningData.metrics.successRate * 100)}%`
                        : learningData.successRate ? `${Math.round(learningData.successRate * 100)}%` : '0%'}
                    </div>
                    <div className="text-sm text-text-secondary">Taxa de Sucesso</div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-border-default grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.synonyms ? Object.keys(learningData.synonyms).length : learningData.metrics?.synonymsCount || 0}
                    </div>
                    <div className="text-xs text-text-secondary">Sinônimos Aprendidos</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.queryPatterns?.successful?.length || learningData.metrics?.successfulPatterns || 0}
                    </div>
                    <div className="text-xs text-text-secondary">Padrões Bem-sucedidos</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.queryPatterns?.failed?.length || learningData.metrics?.failedPatterns || 0}
                    </div>
                    <div className="text-xs text-text-secondary">Padrões Falhados</div>
                  </div>
                </div>
                {(learningData.learningCycles?.lastCycle || learningData.metrics?.lastCycle) && (
                  <div className="mt-4 pt-4 border-t border-border-default">
                    <div className="text-sm text-text-secondary">
                      Último ciclo: {formatDateTime(learningData.learningCycles?.lastCycle || learningData.metrics?.lastCycle)}
                    </div>
                  </div>
                )}
              </div>

              {/* Sinônimos Aprendidos */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>📚</span>
                    <span>Sinônimos Aprendidos ({learningData.synonyms ? Object.keys(learningData.synonyms).length : 0})</span>
                  </h3>
                  <Button onClick={handleUpdateSynonyms} style={btnStyle('--accent-primary')}>
                    🔄 Atualizar
                  </Button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {learningData.synonyms && Object.keys(learningData.synonyms).length > 0 ? (
                    Object.entries(learningData.synonyms).map(([term, synonyms]) => (
                      <div key={term} className="bg-bg-secondary rounded-lg p-3 flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-text-primary mb-1">{term}</div>
                          <div className="flex flex-wrap gap-2">
                            {Array.isArray(synonyms) ? synonyms.map((syn, idx) => (
                              <span key={idx} className="px-2 py-1 bg-bg-tertiary text-text-secondary rounded text-xs">{syn}</span>
                            )) : (
                              <span className="px-2 py-1 bg-bg-tertiary text-text-secondary rounded text-xs">{synonyms}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingSynonym({ term, synonyms: Array.isArray(synonyms) ? synonyms : [synonyms] })}
                            className="text-accent-primary hover:text-accent-hover"
                            title="Editar"
                          >✏️</button>
                          <button
                            onClick={() => handleDeleteSynonym(term)}
                            className="text-status-error hover:text-status-error/80"
                            title="Remover"
                          >🗑️</button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-text-secondary text-sm text-center py-4">
                      Nenhum sinônimo aprendido ainda. Execute uma análise de documentos para começar.
                    </p>
                  )}
                </div>
              </div>

              {/* Perguntas Bem-sucedidas */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>✅</span>
                    <span>Perguntas Bem-sucedidas ({learningData.queryPatterns?.successful?.length || 0})</span>
                  </h3>
                  {learningData.queryPatterns?.successful?.length > 0 && (
                    <Button onClick={handleCleanQueries} style={btnStyle('--status-warning')}>
                      🧹 Limpar Inválidas
                    </Button>
                  )}
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {learningData.queryPatterns?.successful?.length > 0 ? (
                    learningData.queryPatterns.successful.slice(-10).reverse().map((pattern, idx) => (
                      <div key={idx} className="bg-status-success/10 rounded-lg p-3 border border-status-success/30">
                        <div className="font-medium text-text-primary mb-1">{pattern.query}</div>
                        <div className="flex gap-4 text-xs text-text-secondary">
                          <span>Confiança: {Math.round((pattern.confidence || 0) * 100)}%</span>
                          <span>Chunks: {pattern.chunksFound || 0}</span>
                          {pattern.timestamp && <span>{formatDateOnly(pattern.timestamp)}</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-text-secondary text-sm text-center py-4">
                      Nenhuma pergunta bem-sucedida registrada ainda.
                    </p>
                  )}
                </div>
              </div>

              {/* Perguntas Falhadas */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>❌</span>
                    <span>Perguntas Falhadas ({learningData.queryPatterns?.failed?.length || 0})</span>
                  </h3>
                  {learningData.queryPatterns?.failed?.length > 0 && (
                    <Button onClick={handleCleanQueries} style={btnStyle('--status-warning')}>
                      🧹 Limpar Inválidas
                    </Button>
                  )}
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {learningData.queryPatterns?.failed?.length > 0 ? (
                    learningData.queryPatterns.failed.slice(-10).reverse().map((pattern, idx) => (
                      <div key={idx} className="bg-status-error/10 rounded-lg p-3 border border-status-error/30">
                        <div className="font-medium text-text-primary mb-1">{pattern.query}</div>
                        <div className="flex gap-4 text-xs text-text-secondary">
                          <span>Chunks: {pattern.chunksFound || 0}</span>
                          {pattern.timestamp && <span>{formatDateOnly(pattern.timestamp)}</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-text-secondary text-sm text-center py-4">
                      Nenhuma pergunta falhada registrada.
                    </p>
                  )}
                </div>
              </div>

              {/* Configurações Otimizadas */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>⚙️</span><span>Configurações Otimizadas</span>
                  </h3>
                  <Button onClick={handleTriggerLearning} style={btnStyle('--accent-primary')}>
                    🔄 Otimizar Agora
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-text-secondary mb-1">minScore</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.config?.minScore || learningData.metrics?.config?.minScore || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-text-secondary mb-1">topK</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.config?.topK || learningData.metrics?.config?.topK || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-text-secondary mb-1">chunkOverlap</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.config?.chunkOverlap || learningData.metrics?.config?.chunkOverlap || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Histórico de Ciclos */}
              {learningData.learningCycles?.cycles?.length > 0 && (
                <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                  <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <span>🔄</span>
                    <span>Histórico de Ciclos (últimos {Math.min(10, learningData.learningCycles.cycles.length)})</span>
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {learningData.learningCycles.cycles.slice(-10).reverse().map((cycle, idx) => (
                      <div key={idx} className="bg-bg-secondary rounded-lg p-3 border border-border-default">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-semibold text-text-primary">
                              Ciclo #{cycle.cycle} - {cycle.type === 'synonym_update' ? 'Atualização de Sinônimos' : 'Otimização de Config'}
                            </div>
                            <div className="text-xs text-text-secondary mt-1">
                              {formatDateTime(cycle.timestamp)}
                            </div>
                          </div>
                        </div>
                        {cycle.type === 'synonym_update' && (
                          <div className="text-sm text-text-secondary">
                            Sinônimos adicionados: {cycle.synonymsAdded || 0} | Total: {cycle.totalSynonyms || 0}
                          </div>
                        )}
                        {cycle.type === 'config_optimization' && cycle.newConfig && (
                          <div className="text-sm text-text-secondary space-y-1">
                            <div>minScore: {cycle.previousConfig?.minScore || 'N/A'} → {cycle.newConfig.minScore}</div>
                            <div>topK: {cycle.previousConfig?.topK || 'N/A'} → {cycle.newConfig.topK}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <span>📈</span><span>Status do Aprendizado</span>
                </h3>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded text-sm font-medium ${
                    (learningData.metrics?.status || learningData.status) === 'good'
                      ? 'bg-status-success/20 text-status-success'
                      : (learningData.metrics?.status || learningData.status) === 'needs_improvement'
                      ? 'bg-status-warning/20 text-status-warning'
                      : 'bg-status-error/20 text-status-error'
                  }`}>
                    {(learningData.metrics?.status || learningData.status) === 'good' ? '✅ Bom'
                      : (learningData.metrics?.status || learningData.status) === 'needs_improvement' ? '⚠️ Precisa Melhorar'
                      : '❌ Ruim'}
                  </span>
                  {(learningData.metrics?.avgConfidence || learningData.avgConfidence) > 0 && (
                    <span className="text-text-secondary text-sm">
                      Confiança média: {Math.round((learningData.metrics?.avgConfidence || learningData.avgConfidence) * 100)}%
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-text-secondary">Nenhum dado de aprendizado disponível ainda.</p>
              <p className="text-text-tertiary text-sm mt-2">
                Execute análises de documentos para começar o aprendizado.
              </p>
            </div>
          )}
        </div>
      </Dialog>

      {/* Modal de Edição de Sinônimo (nested) */}
      {editingSynonym && (
        <Dialog
          isOpen={!!editingSynonym}
          onClose={() => setEditingSynonym(null)}
          title="Editar Sinônimos"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Termo Principal</label>
              <input
                type="text"
                value={editingSynonym.term}
                readOnly
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Sinônimos (um por linha)</label>
              <textarea
                value={editingSynonym.synonyms.join('\n')}
                onChange={(e) => setEditingSynonym({
                  ...editingSynonym,
                  synonyms: e.target.value.split('\n').filter(s => s.trim())
                })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                rows={6}
                placeholder="Digite um sinônimo por linha"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                onClick={() => setEditingSynonym(null)}
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-default)', cursor: 'pointer' }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveSynonym}
                style={{ backgroundColor: 'var(--accent-primary)', color: 'white', padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
              >
                Salvar
              </Button>
              <Button
                onClick={handleDeleteEditingSynonym}
                style={{ backgroundColor: 'var(--status-error)', color: 'white', padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
              >
                🗑️ Remover
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
