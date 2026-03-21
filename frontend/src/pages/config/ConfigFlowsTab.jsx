import React from 'react';

export function ConfigFlowsTab({ editedConfig, renderField, flows, loadingFlows }) {
  return (
<div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
    <span>🔄</span>
    <span>Fluxos</span>
  </h3>
  {renderField(
    'ID do Fluxo Padrão', 
    'flows.defaultFlowId', 
    editedConfig.flows?.defaultFlowId,
    'text',
    loadingFlows 
      ? [{ value: '', label: 'Carregando...' }]
      : flows.length > 0
        ? [{ value: '', label: 'Nenhum (vazio)' }, ...flows.map(f => ({ value: f.id, label: `${f.name || f.id} (${f.id})` }))]
        : null
  )}
  {loadingFlows && (
    <p className="text-sm text-text-secondary mt-2">Carregando lista de fluxos...</p>
  )}
  {!loadingFlows && flows.length === 0 && (
    <p className="text-sm text-text-secondary mt-2">Nenhum fluxo encontrado. Você pode digitar o ID manualmente.</p>
  )}
</div>
);
}
