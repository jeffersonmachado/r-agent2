import React, { useState } from 'react';
import { generateFlowFromDescription, createFlow, generateRpaTestFromFlow, saveRpaTest } from '../api/flows';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { Dialog } from './Dialog';
import logger from '../utils/logger';

function summarizeValidationBySeverity(validationWarnings) {
  const errors = Array.isArray(validationWarnings?.errors) ? validationWarnings.errors : [];
  const counts = { error: 0, warning: 0, info: 0, other: 0, total: errors.length };
  for (const e of errors) {
    const sev = String(e?.severity || 'warning').toLowerCase();
    if (sev === 'error') counts.error += 1;
    else if (sev === 'warning') counts.warning += 1;
    else if (sev === 'info') counts.info += 1;
    else counts.other += 1;
  }
  return counts;
}

function hasBlockingValidationErrors(validationWarnings) {
  const errors = Array.isArray(validationWarnings?.errors) ? validationWarnings.errors : [];
  return errors.some((e) => String(e?.severity || 'warning').toLowerCase() === 'error');
}

/**
 * Diálogo para criar fluxo e gerar teste RPA por IA em uma única ação.
 */
export function FlowAndRpaTestGeneratorDialog({ onComplete, onCancel }) {
  const [description, setDescription] = useState('');
  const [flowName, setFlowName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [autoResolveDependencies, setAutoResolveDependencies] = useState(true);
  
  // Controles de fonte de conhecimento
  const [useRag, setUseRag] = useState(false);
  const [ragSources, setRagSources] = useState([]);
  const [useWebScraping, setUseWebScraping] = useState(false);
  const [scrapingTargets, setScrapingTargets] = useState(['']);
  
  // Controles de geração de teste RPA
  const [generateRpaTest, setGenerateRpaTest] = useState(false);
  const [rpaMode, setRpaMode] = useState('infer');
  
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [flowValidationWarnings, setFlowValidationWarnings] = useState(null);
  const [preview, setPreview] = useState(null);
  const [currentStep, setCurrentStep] = useState(''); // Para mostrar progresso
  const [saving, setSaving] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError('Por favor, descreva o fluxo que deseja criar.');
      return;
    }

    try {
      setGenerating(true);
      setError(null);
      setFlowValidationWarnings(null);
      setPreview(null);

      // Passo 1: Gerar fluxo
      setCurrentStep('Gerando fluxo por IA...');
      logger.info('Passo 1: Gerando fluxo', { 
        description: description.substring(0, 100),
        useRag,
        ragSources,
        useWebScraping,
        scrapingTargets: scrapingTargets.filter(url => url.trim()),
        generateRpaTest,
        rpaMode
      });
      
      const generationResult = await generateFlowFromDescription(description, {
        flowName: flowName || undefined,
        flowId: flowId || undefined,
        useRag,
        ragSources: useRag ? ragSources : [],
        useWebScraping,
        scrapingTargets: useWebScraping ? scrapingTargets.filter(url => url.trim()) : [],
        generateRpaTest,
        rpaMode,
      });

      const generatedFlow = generationResult?.flowDefinition || generationResult;
      if (!generatedFlow || typeof generatedFlow !== 'object') {
        throw new Error('Resposta inválida ao gerar fluxo (flowDefinition ausente).');
      }

      // ✅ Mostra warnings de validação do fluxo imediatamente (sem bloquear),
      // antes mesmo de persistir no backend, para feedback rápido.
      const generationWarnings = generationResult?.validationWarnings || null;
      const hasGenerationWarnings =
        !!generationWarnings &&
        generationWarnings.valid === false &&
        Array.isArray(generationWarnings.errors) &&
        generationWarnings.errors.length > 0;

      if (hasGenerationWarnings) {
        setFlowValidationWarnings(generationWarnings);
        logger.warn('Fluxo gerado com warnings de validação (pré-salvamento)', {
          flowId: generatedFlow?.id,
          errorCount: generationWarnings.errors.length,
          codes: generationWarnings.codes || generationWarnings.errors.map((e) => e?.code).filter(Boolean),
        });
      }

      logger.info('Fluxo gerado com sucesso', { 
        flowId: generatedFlow?.id,
        nodeCount: generatedFlow?.nodes?.length || 0 
      });

      // Passo 2: Salvar fluxo
      setCurrentStep('Salvando fluxo...');
      logger.info('Passo 2: Salvando fluxo', { flowId: generatedFlow?.id });
      
      const savedFlow = await createFlow(generatedFlow);
      
      if (!savedFlow || !savedFlow.id) {
        throw new Error('Falha ao salvar fluxo: fluxo não foi retornado corretamente');
      }
      
      logger.info('Fluxo salvo com sucesso', { flowId: savedFlow.id, flowName: savedFlow.name });

      // ✅ Se o backend retornou warnings no POST /flows, também exibimos,
      // mas evitamos duplicar caso já tenhamos warnings do /flows/generate.
      const savedWarnings = savedFlow?.validationWarnings || null;
      const hasSavedWarnings =
        !!savedWarnings &&
        savedWarnings.valid === false &&
        Array.isArray(savedWarnings.errors) &&
        savedWarnings.errors.length > 0;

      if (hasSavedWarnings && !hasGenerationWarnings) {
        setFlowValidationWarnings(savedWarnings);
      }

      // Passo 3: Gerar teste RPA (apenas se solicitado)
      let rpaTestResult = null;
      if (generateRpaTest) {
        setCurrentStep('Gerando teste RPA por IA...');
        logger.info('Passo 3: Gerando teste RPA', { flowId: savedFlow.id, rpaMode });
        
        rpaTestResult = await generateRpaTestFromFlow(savedFlow.id, {
          version: savedFlow.version || 1,
          autoResolveDependencies,
          rpaMode,
        });
      } else {
        logger.info('Passo 3: Pulando geração de teste RPA (não solicitado)');
      }

      if (generateRpaTest && (!rpaTestResult || !rpaTestResult.rpaTest)) {
        throw new Error('Falha ao gerar teste RPA: resultado não foi retornado corretamente');
      }

      if (rpaTestResult) {
        logger.info('Teste RPA gerado com sucesso', { 
          testId: rpaTestResult?.rpaTest?.id,
          stepCount: rpaTestResult?.rpaTest?.steps?.length || 0 
        });
      }

      setCurrentStep('Concluído!');
      
      // Monta preview completo
      const flowWarningsForPreview = (hasSavedWarnings ? savedWarnings : (hasGenerationWarnings ? generationWarnings : null));
      const rpaWarnings = rpaTestResult?.rpaTest?.validationWarnings || null;
      const blockingFlow = hasBlockingValidationErrors(flowWarningsForPreview);
      const blockingRpa = hasBlockingValidationErrors(rpaWarnings);
      const readyToSave = !generateRpaTest || (!blockingFlow && !blockingRpa);

      setPreview({
        flow: savedFlow,
        rpaTest: rpaTestResult?.rpaTest || null,
        dependencies: rpaTestResult?.dependencies || null,
        resolution: rpaTestResult?.resolution || null,
        flowValidationWarnings: flowWarningsForPreview,
        readyToSave,
      });

    } catch (err) {
      logger.error('Erro ao gerar fluxo e teste RPA', err);
      setError(err.message || 'Erro ao gerar fluxo e teste RPA. Tente novamente.');
      setCurrentStep('');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!preview || !preview.rpaTest) {
      setError('Nenhum teste RPA para salvar');
      return;
    }

    // Bloqueia apenas se houver erros (severity=error)
    const blockingFlow = hasBlockingValidationErrors(preview.flowValidationWarnings);
    const blockingRpa = hasBlockingValidationErrors(preview.rpaTest?.validationWarnings);
    if (blockingFlow || blockingRpa) {
      setError('Não é possível salvar: existem erros de validação (severity=error). Corrija antes de continuar.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      logger.info('Salvando teste RPA', { testId: preview.rpaTest.id });

      const result = await saveRpaTest(preview.rpaTest);

      logger.info('Teste RPA salvo com sucesso', { testId: preview.rpaTest.id });

      if (onComplete) {
        onComplete({
          flow: preview.flow,
          rpaTest: preview.rpaTest,
          saveResult: result,
        });
      }
    } catch (err) {
      logger.error('Erro ao salvar teste RPA', err);
      setError(err.message || 'Erro ao salvar teste RPA. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPreview(null);
    setError(null);
    setFlowValidationWarnings(null);
    setDescription('');
    setFlowName('');
    setFlowId('');
    setAutoResolveDependencies(false);
    setUseRag(false);
    setRagSources([]);
    setUseWebScraping(false);
    setScrapingTargets(['']);
    setGenerateRpaTest(false);
    setRpaMode('infer');
    setCurrentStep('');
    if (onCancel) {
      onCancel();
    }
  };

  const handleRagSourceToggle = (source) => {
    if (ragSources.includes(source)) {
      setRagSources(ragSources.filter(s => s !== source));
    } else {
      setRagSources([...ragSources, source]);
    }
  };

  const handleScrapingTargetChange = (index, value) => {
    const newTargets = [...scrapingTargets];
    newTargets[index] = value;
    setScrapingTargets(newTargets);
  };

  const addScrapingTarget = () => {
    setScrapingTargets([...scrapingTargets, '']);
  };

  const removeScrapingTarget = (index) => {
    setScrapingTargets(scrapingTargets.filter((_, i) => i !== index));
  };

  return (
    <Dialog
      isOpen={true}
      onClose={handleCancel}
      title="🚀 Flow & RPA Generator"
      size="xl"
    >
      <div className="space-y-6">
        {!preview ? (
          <>
            <div className="flex gap-2 justify-end pb-4 border-b border-border-default">
              <Button variant="ghost" onClick={handleCancel} disabled={generating}>
                Cancelar
              </Button>
              <Button 
                variant="primary" 
                onClick={handleGenerate}
                disabled={generating || !description.trim()}
              >
                {generating ? 'Gerando...' : 'Criar Fluxo e Gerar Teste RPA'}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="text-sm text-text-secondary">
                Crie um fluxo e gere automaticamente um teste RPA executável a partir de uma descrição em linguagem natural.
              </div>

              <div className="p-4 bg-bg-tertiary rounded-md space-y-3">
                <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
                  Pipeline Completo
                </div>
                <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary">
                  <li>Gerar fluxo a partir da descrição</li>
                  <li>Salvar fluxo no sistema</li>
                  <li>Analisar dependências do fluxo</li>
                  <li>Resolver dependências faltantes (opcional)</li>
                  <li>Gerar script de teste RPA por IA</li>
                  <li>Validar o script</li>
                  <li>Exibir preview completo</li>
                  <li>Confirmar e salvar teste RPA</li>
                </ol>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                  Descrição do Fluxo
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Exemplo: Quero um fluxo que comece com uma mensagem de boas-vindas, reconheça a intenção do usuário (suporte, vendas ou financeiro) e direcione para mensagens específicas. Se não entender, deve transferir para atendimento humano."
                  className="w-full p-3 border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
                  rows={6}
                  disabled={generating}
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                    Nome do fluxo (opcional)
                  </div>
                  <Input
                    type="text"
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                    placeholder="Deixe vazio para usar nome padrão"
                    className="w-full"
                    disabled={generating}
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                    ID do fluxo (opcional)
                  </div>
                  <Input
                    type="text"
                    value={flowId}
                    onChange={(e) => setFlowId(e.target.value)}
                    placeholder="Deixe vazio para gerar automaticamente"
                    className="w-full font-mono text-xs"
                    disabled={generating}
                  />
                </div>
              </div>

              {/* Fonte de Conhecimento da IA */}
              <div className="space-y-4 p-4 bg-bg-tertiary rounded-md border border-border-default">
                <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
                  Fonte de Conhecimento da IA
                </div>
                
                {/* RAG */}
                <div className="space-y-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useRag}
                      onChange={(e) => setUseRag(e.target.checked)}
                      disabled={generating}
                      className="rounded border-border-default"
                    />
                    <span className="text-sm text-text-secondary font-medium">
                      Usar conhecimento interno (RAG)
                    </span>
                  </label>
                  {useRag && (
                    <div className="ml-6 space-y-2">
                      <div className="text-xs text-text-tertiary">Selecione as fontes:</div>
                      {['flows', 'qa', 'docs'].map((source) => (
                        <label key={source} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ragSources.includes(source)}
                            onChange={() => handleRagSourceToggle(source)}
                            disabled={generating}
                            className="rounded border-border-default"
                          />
                          <span className="text-xs text-text-secondary capitalize">{source}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Web Scraping */}
                <div className="space-y-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useWebScraping}
                      onChange={(e) => setUseWebScraping(e.target.checked)}
                      disabled={generating}
                      className="rounded border-border-default"
                    />
                    <span className="text-sm text-text-secondary font-medium">
                      Usar fontes externas (Raspagem de sites)
                    </span>
                  </label>
                  {useWebScraping && (
                    <div className="ml-6 space-y-2">
                      <div className="text-xs text-text-tertiary">
                        URLs a serem raspadas (requer aprovação/auditoria):
                      </div>
                      {scrapingTargets.map((url, index) => (
                        <div key={index} className="flex gap-2">
                          <Input
                            type="url"
                            value={url}
                            onChange={(e) => handleScrapingTargetChange(index, e.target.value)}
                            placeholder="https://exemplo.com"
                            className="flex-1 font-mono text-xs"
                            disabled={generating}
                          />
                          {scrapingTargets.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeScrapingTarget(index)}
                              disabled={generating}
                              className="px-2 py-1 text-xs text-status-error hover:bg-status-error/10 rounded"
                            >
                              Remover
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addScrapingTarget}
                        disabled={generating}
                        className="text-xs text-accent-default hover:underline"
                      >
                        + Adicionar URL
                      </button>
                      <div className="text-xs text-status-warning bg-status-warning/10 p-2 rounded">
                        ⚠️ Raspagem de sites requer aprovação e será auditada.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Geração de Teste RPA */}
              <div className="space-y-4 p-4 bg-bg-tertiary rounded-md border border-border-default">
                <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
                  Geração de Teste RPA
                </div>
                
                <div className="space-y-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={generateRpaTest}
                      onChange={(e) => setGenerateRpaTest(e.target.checked)}
                      disabled={generating}
                      className="rounded border-border-default"
                    />
                    <span className="text-sm text-text-secondary font-medium">
                      Gerar teste RPA automaticamente
                    </span>
                  </label>
                  {generateRpaTest && (
                    <div className="ml-6 space-y-2">
                      <div className="text-xs text-text-tertiary">Modo de geração:</div>
                      <select
                        value={rpaMode}
                        onChange={(e) => setRpaMode(e.target.value)}
                        disabled={generating}
                        className="w-full p-2 border border-border-default rounded-md bg-bg-primary text-text-primary text-xs"
                      >
                        <option value="infer">Inferido pela IA</option>
                        <option value="record">Gravação assistida</option>
                        <option value="hybrid">Híbrido</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoResolveDependencies}
                    onChange={(e) => setAutoResolveDependencies(e.target.checked)}
                    disabled={generating}
                    className="rounded border-border-default"
                  />
                  <span className="text-sm text-text-secondary">
                    Resolver dependências automaticamente (executar seeds RPA)
                  </span>
                </label>
                <div className="text-xs text-text-tertiary ml-6">
                  Se marcado, o sistema executará seeds RPA para criar cadastros faltantes antes de gerar o teste.
                </div>
              </div>

              {currentStep && (
                <div className="p-3 rounded-md bg-status-info/10 border border-status-info/20 text-status-info text-sm">
                  {currentStep}
                </div>
              )}

              {/* Avisos de validação do fluxo (retornados por /flows/generate) */}
              {flowValidationWarnings && flowValidationWarnings.valid === false && (
                <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
                  <strong>Aviso:</strong> O fluxo gerado possui {flowValidationWarnings.errors?.length || 0} aviso(s) de validação (antes de salvar).
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    {(flowValidationWarnings.errors || []).map((err, index) => (
                      <li key={index}>{err.messageUi || err.message || 'Erro de validação'}</li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                  {error}
                </div>
              )}

              <div className="text-xs text-text-tertiary p-3 bg-bg-tertiary rounded-md">
                <strong>Importante:</strong> A IA não executa ações reais, apenas gera o fluxo e o script de teste.
                O teste será executado apenas após salvar e usar o motor RPA de replay.
              </div>
            </div>
          </>
        ) : (
          <FlowAndRpaTestPreview
            preview={preview}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saving}
            error={error}
          />
        )}
      </div>
    </Dialog>
  );
}

/**
 * Componente de preview do fluxo e teste RPA gerados.
 */
function FlowAndRpaTestPreview({ preview, onSave, onCancel, saving, error }) {
  const { flow, rpaTest, dependencies, resolution, readyToSave, flowValidationWarnings } = preview;
  const flowCounts = summarizeValidationBySeverity(flowValidationWarnings);
  const rpaCounts = summarizeValidationBySeverity(rpaTest?.validationWarnings);
  const flowHasWarnings = !!flowValidationWarnings && flowValidationWarnings.valid === false && Array.isArray(flowValidationWarnings.errors) && flowValidationWarnings.errors.length > 0;
  const rpaHasWarnings = !!rpaTest?.validationWarnings && rpaTest.validationWarnings.valid === false && Array.isArray(rpaTest.validationWarnings.errors) && rpaTest.validationWarnings.errors.length > 0;

  return (
    <div className="space-y-6">
      <div className="text-sm text-text-secondary">
        Preview do fluxo e teste RPA gerados. Revise os detalhes antes de salvar.
      </div>

      {/* Fluxo Gerado */}
      <div className="space-y-3">
        <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
          Fluxo Criado
        </div>
        <div className="p-4 bg-bg-tertiary rounded-md space-y-2 text-sm">
          <div>
            <strong>Nome:</strong> {flow?.name || flow?.id}
          </div>
          <div>
            <strong>ID:</strong> {flow?.id}
          </div>
          <div>
            <strong>Versão:</strong> {flow?.version || 1}
          </div>
          <div>
            <strong>Nós:</strong> {flow?.nodes?.length || 0}
          </div>
        </div>
      </div>

      {/* Avisos de Validação do Fluxo */}
      {flowHasWarnings && (
        <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
          <strong>Aviso (Fluxo):</strong> {flowCounts.total} item(ns) — erros: {flowCounts.error}, warnings: {flowCounts.warning}, info: {flowCounts.info}{flowCounts.other ? `, outros: ${flowCounts.other}` : ''}.
          <ul className="list-disc list-inside mt-2 space-y-1">
            {(flowValidationWarnings.errors || []).map((err, index) => (
              <li key={index}>{err.messageUi || err.message || 'Erro de validação'}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Dependências */}
      {dependencies && (
        <div className="space-y-3">
          <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
            Dependências Analisadas
          </div>
          <div className="p-4 bg-bg-tertiary rounded-md space-y-2 text-sm">
            <div>
              <strong>Filas faltantes:</strong> {dependencies?.cadastros?.queues?.missing?.length || 0}
            </div>
            <div>
              <strong>Departamentos faltantes:</strong> {dependencies?.cadastros?.departments?.missing?.length || 0}
            </div>
            <div>
              <strong>Seeds executados:</strong> {resolution?.executedSeeds?.length || 0}
            </div>
          </div>
        </div>
      )}

      {/* Seeds Executados */}
      {resolution && resolution.executedSeeds && resolution.executedSeeds.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
            Seeds Executados
          </div>
          <div className="p-4 bg-bg-tertiary rounded-md space-y-2 text-sm">
            {resolution.executedSeeds.map((seed, index) => (
              <div key={index}>
                <strong>{seed.seedName}:</strong> {seed.dependencyType} - {seed.target || 'N/A'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Passos RPA */}
      <div className="space-y-3">
        <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
          Passos RPA ({rpaTest?.steps?.length || 0} passos)
        </div>
        <div className="p-4 bg-bg-tertiary rounded-md space-y-2 text-sm max-h-64 overflow-y-auto">
          {rpaTest?.steps?.map((step, index) => (
            <div key={index} className="border-b border-border-default pb-2 last:border-0">
              <div className="font-medium">{index + 1}. {step.type}</div>
              <div className="text-text-tertiary text-xs">{step.description || 'Sem descrição'}</div>
              {step.selector && (
                <div className="text-text-tertiary text-xs font-mono">{step.selector}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Asserts */}
      <div className="space-y-3">
        <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
          Asserts Obrigatórios ({rpaTest?.asserts?.length || 0} asserts)
        </div>
        <div className="p-4 bg-bg-tertiary rounded-md space-y-2 text-sm max-h-48 overflow-y-auto">
          {rpaTest?.asserts?.map((assert, index) => (
            <div key={index} className="border-b border-border-default pb-2 last:border-0">
              <div className="font-medium">Assert {index + 1}: {assert.type}</div>
              <div className="text-text-tertiary text-xs">{assert.description || 'Sem descrição'}</div>
              {assert.expected && (
                <div className="text-text-tertiary text-xs">Esperado: {assert.expected}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Caminho Percorrido */}
      {rpaTest?.metadata?.pathTaken && rpaTest.metadata.pathTaken.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
            Caminho Percorrido no Fluxo
          </div>
          <div className="p-4 bg-bg-tertiary rounded-md space-y-2 text-sm">
            {rpaTest.metadata.pathTaken.map((step, index) => (
              <div key={index} className="flex items-center space-x-2">
                <span className="text-text-tertiary">{index + 1}.</span>
                <span className="font-medium">{step.nodeId}</span>
                <span className="text-text-tertiary">({step.nodeType})</span>
                <span className="text-text-tertiary text-xs">- {step.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Avisos de Validação */}
      {rpaHasWarnings && (
        <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
          <strong>Aviso (Teste RPA):</strong> {rpaCounts.total} item(ns) — erros: {rpaCounts.error}, warnings: {rpaCounts.warning}, info: {rpaCounts.info}{rpaCounts.other ? `, outros: ${rpaCounts.other}` : ''}.
          <ul className="list-disc list-inside mt-2 space-y-1">
            {rpaTest.validationWarnings.errors?.map((err, index) => (
              <li key={index}>{err.messageUi || err.message || 'Erro de validação'}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
          {error}
        </div>
      )}

      {!readyToSave && (
        <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
          <strong>Erro:</strong> O teste não está pronto para ser salvo. Corrija os problemas antes de continuar.
        </div>
      )}

      <div className="flex gap-2 justify-end pt-4">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Fechar
        </Button>
        <Button 
          variant="primary" 
          onClick={onSave}
          disabled={saving || !readyToSave}
        >
          {saving ? 'Salvando...' : 'Salvar Teste RPA'}
        </Button>
      </div>
    </div>
  );
}

