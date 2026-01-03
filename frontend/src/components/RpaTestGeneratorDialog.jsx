import React, { useState } from 'react';
import { generateRpaTestFromFlow, saveRpaTest } from '../api/flows';
import { Button } from '../styles/Button';
import { Dialog } from './Dialog';
import logger from '../utils/logger';

/**
 * Diálogo para gerar teste RPA a partir de um fluxo usando IA.
 */
export function RpaTestGeneratorDialog({ flowId, flowName, flowVersion, onTestGenerated, onCancel }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [autoResolveDependencies, setAutoResolveDependencies] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleGenerate = async () => {
    if (!flowId) {
      setError('ID do fluxo é obrigatório');
      return;
    }

    try {
      setGenerating(true);
      setError(null);
      setPreview(null);

      logger.info('Iniciando geração de teste RPA', { flowId, flowName, flowVersion });

      const result = await generateRpaTestFromFlow(flowId, {
        version: flowVersion,
        autoResolveDependencies,
      });

      logger.info('Teste RPA gerado com sucesso', { 
        testId: result?.rpaTest?.id,
        stepCount: result?.rpaTest?.steps?.length || 0 
      });

      setPreview(result);
    } catch (err) {
      logger.error('Erro ao gerar teste RPA', err);
      setError(err.message || 'Erro ao gerar teste RPA. Tente novamente.');
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

      if (onTestGenerated) {
        onTestGenerated(preview.rpaTest, result);
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
    setAutoResolveDependencies(false);
    if (onCancel) {
      onCancel();
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={handleCancel}
      title="Gerar Teste RPA por IA"
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
                disabled={generating || !flowId}
              >
                {generating ? 'Gerando...' : 'Gerar Teste RPA'}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="text-sm text-text-secondary">
                Gera automaticamente um teste RPA executável a partir do fluxo <strong>{flowName || flowId}</strong>.
                O sistema analisará dependências, resolverá seeds necessários e gerará um teste completo.
              </div>

              <div className="p-4 bg-bg-tertiary rounded-md space-y-3">
                <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
                  Pipeline de Geração
                </div>
                <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary">
                  <li>Selecionar fluxo alvo (ID + versão)</li>
                  <li>Analisar dependências do fluxo</li>
                  <li>Resolver dependências faltantes</li>
                  <li>Gerar script de teste RPA por IA</li>
                  <li>Validar o script</li>
                  <li>Exibir preview completo</li>
                  <li>Exigir confirmação do usuário</li>
                  <li>Salvar o teste RPA</li>
                </ol>
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

              {error && (
                <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                  {error}
                </div>
              )}

              <div className="text-xs text-text-tertiary p-3 bg-bg-tertiary rounded-md">
                <strong>Importante:</strong> A IA não executa ações reais, apenas gera o script de teste.
                O teste será executado apenas após salvar e usar o motor RPA de replay.
              </div>
            </div>
          </>
        ) : (
          <RpaTestPreview
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
 * Componente de preview do teste RPA gerado.
 */
function RpaTestPreview({ preview, onSave, onCancel, saving, error }) {
  const { dependencies, resolution, rpaTest, readyToSave } = preview;

  return (
    <div className="space-y-6">
      <div className="text-sm text-text-secondary">
        Preview do teste RPA gerado. Revise os detalhes antes de salvar.
      </div>

      {/* Dependências */}
      <div className="space-y-3">
        <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
          Dependências Analisadas
        </div>
        <div className="p-4 bg-bg-tertiary rounded-md space-y-2 text-sm">
          <div>
            <strong>Fluxo:</strong> {preview.flowName} (v{preview.flowVersion})
          </div>
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
          Cancelar
        </Button>
        <Button 
          variant="primary" 
          onClick={onSave}
          disabled={saving || !readyToSave}
        >
          {saving ? 'Salvando...' : 'Confirmar e Salvar Teste RPA'}
        </Button>
      </div>
    </div>
  );
}

