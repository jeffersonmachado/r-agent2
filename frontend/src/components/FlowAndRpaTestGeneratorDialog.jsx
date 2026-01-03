import React, { useState } from 'react';
import { generateFlowFromDescription, createFlow, generateRpaTestFromFlow, saveRpaTest } from '../api/flows';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { Dialog } from './Dialog';
import logger from '../utils/logger';

/**
 * Diálogo para criar fluxo e gerar teste RPA por IA em uma única ação.
 */
export function FlowAndRpaTestGeneratorDialog({ onComplete, onCancel }) {
  const [description, setDescription] = useState('');
  const [flowName, setFlowName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [autoResolveDependencies, setAutoResolveDependencies] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
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
      setPreview(null);

      // Passo 1: Gerar fluxo
      setCurrentStep('Gerando fluxo por IA...');
      logger.info('Passo 1: Gerando fluxo', { description: description.substring(0, 100) });
      
      const generatedFlow = await generateFlowFromDescription(description, {
        flowName: flowName || undefined,
        flowId: flowId || undefined,
      });

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

      // Passo 3: Gerar teste RPA (o endpoint já faz análise de dependências internamente)
      setCurrentStep('Gerando teste RPA por IA...');
      logger.info('Passo 3: Gerando teste RPA', { flowId: savedFlow.id });
      
      const rpaTestResult = await generateRpaTestFromFlow(savedFlow.id, {
        version: savedFlow.version || 1,
        autoResolveDependencies,
      });

      if (!rpaTestResult || !rpaTestResult.rpaTest) {
        throw new Error('Falha ao gerar teste RPA: resultado não foi retornado corretamente');
      }

      logger.info('Teste RPA gerado com sucesso', { 
        testId: rpaTestResult?.rpaTest?.id,
        stepCount: rpaTestResult?.rpaTest?.steps?.length || 0 
      });

      setCurrentStep('Concluído!');
      
      // Monta preview completo
      setPreview({
        flow: savedFlow,
        rpaTest: rpaTestResult.rpaTest,
        dependencies: rpaTestResult.dependencies,
        resolution: rpaTestResult.resolution,
        readyToSave: !rpaTestResult.rpaTest.validationWarnings || rpaTestResult.rpaTest.validationWarnings.valid,
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
    setDescription('');
    setFlowName('');
    setFlowId('');
    setAutoResolveDependencies(false);
    setCurrentStep('');
    if (onCancel) {
      onCancel();
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={handleCancel}
      title="Criar Fluxo e Gerar Teste RPA por IA"
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
  const { flow, rpaTest, dependencies, resolution, readyToSave } = preview;

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
      {rpaTest?.validationWarnings && !rpaTest.validationWarnings.valid && (
        <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
          <strong>Aviso:</strong> O teste gerado tem alguns avisos de validação. Revise antes de salvar.
          <ul className="list-disc list-inside mt-2 space-y-1">
            {rpaTest.validationWarnings.errors?.map((err, index) => (
              <li key={index}>{err.message}</li>
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

