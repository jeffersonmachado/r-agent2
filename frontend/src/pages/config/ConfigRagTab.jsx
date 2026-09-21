import React, { useState } from 'react';
import { reloadRagConfig } from '../../api/config';
import { Button } from '../../styles/Button';

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
];

// Modelos atualizados (set/2026) — mesmos IDs reais já usados em engine/aiProviderRegistry.js
// (autoridade canônica da plataforma). Achado real: esta lista estava presa em modelos
// descontinuados há muito tempo (gpt-4o-mini/gpt-4-turbo, deepseek-chat/reasoner,
// claude-3-5-sonnet-20241022) — mesma classe de bug corrigida no Engineering Router após um
// pilot real revelar que os IDs mapeados não existiam mais nas APIs dos providers.
function getModelOptions(provider) {
  if (provider === 'openai') {
    return [
      { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (padrão)' },
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { value: 'o4-mini', label: 'o4-mini' },
    ];
  }
  if (provider === 'deepseek') {
    return [
      { value: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ];
  }
  if (provider === 'anthropic') {
    return [
      { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { value: 'claude-opus-5', label: 'Claude Opus 5' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ];
  }
  return [];
}

export function ConfigRagTab({ editedConfig, renderField, updateValue }) {
  const llmProvider = editedConfig?.rag?.service?.llm?.provider || '';
  const modelOptions = getModelOptions(llmProvider);
  const [reloadingRag, setReloadingRag] = useState(false);
  const [reloadResult, setReloadResult] = useState(null);

  const handleReloadRag = async () => {
    setReloadingRag(true);
    setReloadResult(null);
    try {
      const result = await reloadRagConfig();
      setReloadResult(result);
    } catch (err) {
      setReloadResult({ success: false, error: err.message });
    } finally {
      setReloadingRag(false);
    }
  };

  return (
<div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
    <span>🔍</span>
    <span>RAG Service</span>
  </h3>
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {renderField('URL do Serviço', 'rag.serviceUrl', editedConfig.rag?.serviceUrl)}
      {renderField('Timeout (ms)', 'rag.timeout', editedConfig.rag?.timeout, 'number')}
    </div>

    {/* LLM Configuration */}
    <div className="mt-6 pt-6 border-t border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
        <span>🧠</span>
        <span>Modelo LLM (geração de resposta)</span>
      </h4>
      <p className="text-sm text-text-secondary mb-4">
        Configuração do modelo de linguagem usado pelo RAG Service para gerar respostas baseadas nos documentos recuperados.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block mb-2 text-sm font-medium text-text-primary">
            Provider
          </label>
          <select
            value={editedConfig?.rag?.service?.llm?.provider || ''}
            onChange={(e) => {
              const newProvider = e.target.value || null;
              updateValue('rag.service.llm.provider', newProvider);
              // Reseta o modelo quando o provider muda
              updateValue('rag.service.llm.model', null);
            }}
            className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          >
            <option value="">Padrão (openai)</option>
            {LLM_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block mb-2 text-sm font-medium text-text-primary">
            Modelo
          </label>
          <select
            value={editedConfig?.rag?.service?.llm?.model || ''}
            onChange={(e) => updateValue('rag.service.llm.model', e.target.value || null)}
            className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          >
            <option value="">Padrão do provider</option>
            {modelOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          {renderField(
            'Temperatura (0-2)',
            'rag.service.llm.temperature',
            editedConfig?.rag?.service?.llm?.temperature,
            'number'
          )}
        </div>

        <div>
          {renderField(
            'Max Tokens',
            'rag.service.llm.maxTokens',
            editedConfig?.rag?.service?.llm?.maxTokens,
            'number'
          )}
        </div>
      </div>
    </div>

    <div className="mt-6 pt-6 border-t border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Configuração por Tenant</h4>
      {editedConfig.rag?.tenants && Object.keys(editedConfig.rag.tenants).length > 0 ? (
        <div className="space-y-4">
          {Object.entries(editedConfig.rag.tenants).map(([tenantId, tenantConfig]) => (
            <div key={tenantId} className="p-4 bg-bg-primary rounded-lg border border-border-default">
              <h5 className="text-md font-semibold text-text-primary mb-3">{tenantId}</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {renderField(
                  'URL do Serviço',
                  `rag.tenants.${tenantId}.serviceUrl`,
                  tenantConfig?.serviceUrl
                )}
                {renderField(
                  'Timeout (ms)',
                  `rag.tenants.${tenantId}.timeout`,
                  tenantConfig?.timeout,
                  'number'
                )}
              </div>
              {tenantConfig?.domains && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <h6 className="text-sm font-medium text-text-secondary mb-2">Domínios</h6>
                  <div className="space-y-2">
                    {Object.entries(tenantConfig.domains).map(([domainName, domainConfig]) => (
                      <div key={domainName} className="p-3 bg-bg-secondary rounded border border-border-default">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-text-primary">{domainName}</span>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={domainConfig?.enabled || false}
                              onChange={(e) => updateValue(`rag.tenants.${tenantId}.domains.${domainName}.enabled`, e.target.checked)}
                              className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary cursor-pointer"
                            />
                            <span className="text-xs text-text-secondary">Habilitado</span>
                          </label>
                        </div>
                        {domainConfig?.defaultCategory && (
                          <p className="text-xs text-text-secondary mt-1">
                            Categoria padrão: {domainConfig.defaultCategory}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-text-secondary text-sm">Nenhum tenant configurado</p>
      )}
    </div>

    <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
      <p className="text-sm text-text-secondary">
        💡 O RAG Service é um serviço Python (FastAPI) que fornece funcionalidades de Retrieval-Augmented Generation.
        Por padrão, o serviço roda na porta <strong>8001</strong>. Certifique-se de que o serviço está rodando antes de usar.
      </p>
      <p className="text-sm text-text-secondary mt-2">
        Para iniciar o serviço manualmente: <code className="bg-bg-primary px-2 py-1 rounded text-xs">cd rag-service && uvicorn main:app --reload --host 0.0.0.0 --port 8001</code>
      </p>

      <div className="mt-4 pt-4 border-t border-accent-primary/20 flex items-center gap-3">
        <Button
          onClick={handleReloadRag}
          disabled={reloadingRag}
          variant="secondary"
          className="flex items-center gap-2"
        >
          {reloadingRag ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent-primary"></div>
              <span>Recarregando...</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>Recarregar Config RAG</span>
            </>
          )}
        </Button>
        {reloadResult && (
          <span className={`text-sm ${reloadResult.success ? 'text-status-success' : 'text-status-error'}`}>
            {reloadResult.success ? '✓ Config recarregada' : `✗ ${reloadResult.error || 'Erro'}`}
          </span>
        )}
      </div>
    </div>
  </div>
</div>
);
}
