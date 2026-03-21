import React from 'react';

export function ConfigFeaturesTab({ editedConfig, updateValue }) {
  return (
<div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
    <span>✨</span>
    <span>Features</span>
  </h3>
  <div className="space-y-4">
    <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={editedConfig.features?.aiTasksEnabled || false}
        onChange={(e) => updateValue('features.aiTasksEnabled', e.target.checked)}
        className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary cursor-pointer"
      />
      <div className="flex-1">
        <span className="text-text-primary font-medium">Tarefas de IA Habilitadas</span>
        <p className="text-text-secondary text-sm mt-1">(aiTasksEnabled)</p>
      </div>
    </label>
    <div className="p-4 bg-accent-light rounded-lg border border-accent-primary/20">
      <p className="text-sm text-text-secondary">
        💡 Controla se as tarefas de IA estão habilitadas. Quando desabilitado, todas as tarefas de IA retornam fallback.
      </p>
    </div>
    <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={editedConfig.features?.useRealAiApi || false}
        onChange={(e) => updateValue('features.useRealAiApi', e.target.checked)}
        className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary cursor-pointer"
      />
      <div className="flex-1">
        <span className="text-text-primary font-medium">Usar API Real de IA</span>
        <p className="text-text-secondary text-sm mt-1">(useRealAiApi)</p>
      </div>
    </label>
    <div className="p-4 bg-accent-light rounded-lg border border-accent-primary/20">
      <p className="text-sm text-text-secondary">
        💡 Quando habilitado, faz chamadas HTTP reais à API de IA (/api/ai/generate) ao invés de usar a implementação mock local baseada em palavras-chave. As requisições aparecerão na aba Network do DevTools.
      </p>
    </div>
  </div>
</div>
);
}
