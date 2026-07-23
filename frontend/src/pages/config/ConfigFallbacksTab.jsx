import React from 'react';

export function ConfigFallbacksTab({ editedConfig, updateValue, setEditedConfig, viewMode, setJsonText }) {
  return (
<div className="space-y-6">
  <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
        <span>🛟</span>
        <span>Fallbacks (uso explícito)</span>
      </h3>
      <Button
        variant="secondary"
        onClick={() => {
          if (!editedConfig) return;
          const next = JSON.parse(JSON.stringify(editedConfig));
          next.fallbacks = {
            aiProviderSecondary: false,
            ragFallbackToDirect: false,
            rateLimitRedisToMemory: false,
            frontendAiMockOnError: false,
            frontendAiDisabledReturnFallback: false,
            frontendNavigationHardRedirect: false,
          };
          setEditedConfig(next);
          if (viewMode === 'json') setJsonText(JSON.stringify(next, null, 2));
        }}
        className="flex items-center gap-2"
      >
        <span>🧩</span>
        <span>Tornar explícito (todos false)</span>
      </Button>
    </div>

    <div className="p-4 bg-status-warning/10 rounded-lg border border-status-warning/30 mb-6">
      <p className="text-sm text-text-primary">
        <strong>⚠️ Importante:</strong> todos os toggles abaixo são <strong>false por padrão</strong>. Se um fallback estiver desabilitado, o sistema deve <strong>falhar de forma explícita</strong> (sem “jeitinho”) ou seguir o fluxo sem degradar silenciosamente.
      </p>
    </div>

    <div className="space-y-4">
      <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors">
        <button
          type="button"
          role="switch"
          aria-checked={editedConfig.fallbacks?.aiProviderSecondary === true}
          onClick={() => updateValue('fallbacks.aiProviderSecondary', !(editedConfig.fallbacks?.aiProviderSecondary === true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary ${
            editedConfig.fallbacks?.aiProviderSecondary === true
              ? 'bg-accent-primary border-accent-primary'
              : 'bg-bg-secondary border-border-default'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              editedConfig.fallbacks?.aiProviderSecondary === true ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1">
          <span className="text-text-primary font-medium">IA: usar provider secundário (primary → secondary)</span>
          <p className="text-text-secondary text-sm mt-1">`fallbacks.aiProviderSecondary`</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors">
        <button
          type="button"
          role="switch"
          aria-checked={editedConfig.fallbacks?.ragFallbackToDirect === true}
          onClick={() => updateValue('fallbacks.ragFallbackToDirect', !(editedConfig.fallbacks?.ragFallbackToDirect === true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary ${
            editedConfig.fallbacks?.ragFallbackToDirect === true
              ? 'bg-accent-primary border-accent-primary'
              : 'bg-bg-secondary border-border-default'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              editedConfig.fallbacks?.ragFallbackToDirect === true ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1">
          <span className="text-text-primary font-medium">RAG: fallback para IA direta quando RAG falha/baixa confiança</span>
          <p className="text-text-secondary text-sm mt-1">`fallbacks.ragFallbackToDirect`</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors">
        <button
          type="button"
          role="switch"
          aria-checked={editedConfig.fallbacks?.rateLimitRedisToMemory === true}
          onClick={() => updateValue('fallbacks.rateLimitRedisToMemory', !(editedConfig.fallbacks?.rateLimitRedisToMemory === true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary ${
            editedConfig.fallbacks?.rateLimitRedisToMemory === true
              ? 'bg-accent-primary border-accent-primary'
              : 'bg-bg-secondary border-border-default'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              editedConfig.fallbacks?.rateLimitRedisToMemory === true ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1">
          <span className="text-text-primary font-medium">Rate limit: permitir fallback Redis → memória</span>
          <p className="text-text-secondary text-sm mt-1">`fallbacks.rateLimitRedisToMemory`</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors">
        <button
          type="button"
          role="switch"
          aria-checked={editedConfig.fallbacks?.frontendAiMockOnError === true}
          onClick={() => updateValue('fallbacks.frontendAiMockOnError', !(editedConfig.fallbacks?.frontendAiMockOnError === true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary ${
            editedConfig.fallbacks?.frontendAiMockOnError === true
              ? 'bg-accent-primary border-accent-primary'
              : 'bg-bg-secondary border-border-default'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              editedConfig.fallbacks?.frontendAiMockOnError === true ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1">
          <span className="text-text-primary font-medium">Frontend: usar mock local se a API real de IA falhar</span>
          <p className="text-text-secondary text-sm mt-1">`fallbacks.frontendAiMockOnError`</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors">
        <button
          type="button"
          role="switch"
          aria-checked={editedConfig.fallbacks?.frontendAiDisabledReturnFallback === true}
          onClick={() => updateValue('fallbacks.frontendAiDisabledReturnFallback', !(editedConfig.fallbacks?.frontendAiDisabledReturnFallback === true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary ${
            editedConfig.fallbacks?.frontendAiDisabledReturnFallback === true
              ? 'bg-accent-primary border-accent-primary'
              : 'bg-bg-secondary border-border-default'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              editedConfig.fallbacks?.frontendAiDisabledReturnFallback === true ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1">
          <span className="text-text-primary font-medium">Frontend: quando IA estiver desabilitada, retornar “fallback” automático</span>
          <p className="text-text-secondary text-sm mt-1">`fallbacks.frontendAiDisabledReturnFallback`</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors">
        <button
          type="button"
          role="switch"
          aria-checked={editedConfig.fallbacks?.frontendNavigationHardRedirect === true}
          onClick={() => updateValue('fallbacks.frontendNavigationHardRedirect', !(editedConfig.fallbacks?.frontendNavigationHardRedirect === true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary ${
            editedConfig.fallbacks?.frontendNavigationHardRedirect === true
              ? 'bg-accent-primary border-accent-primary'
              : 'bg-bg-secondary border-border-default'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              editedConfig.fallbacks?.frontendNavigationHardRedirect === true ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1">
          <span className="text-text-primary font-medium">Frontend: permitir fallback de navegação via `window.location`</span>
          <p className="text-text-secondary text-sm mt-1">`fallbacks.frontendNavigationHardRedirect`</p>
        </div>
      </label>
    </div>
  </div>
</div>
);
}
