import React from 'react';

export function ConfigScriptsTab({ editedConfig, renderField, updateValue }) {
  return (
<div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
    <span>📜</span>
    <span>Scripts</span>
  </h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {renderField('URL da API', 'scripts.apiUrl', editedConfig.scripts?.apiUrl)}
    {renderField('Idade Máxima (dias)', 'scripts.maxAgeDays', editedConfig.scripts?.maxAgeDays, 'number')}
  </div>
  <div className="mt-6">
    <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={editedConfig.scripts?.dryRun || false}
        onChange={(e) => updateValue('scripts.dryRun', e.target.checked)}
        className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary cursor-pointer"
      />
      <span className="text-text-primary font-medium">Dry Run (modo simulação)</span>
    </label>
  </div>
</div>
);
}
