import React from 'react';

export function ConfigFrontendTab({ editedConfig, renderField }) {
  return (
<div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
    <span>🖥️</span>
    <span>Frontend</span>
  </h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {renderField('Porta', 'frontend.port', editedConfig.frontend?.port, 'number')}
    {renderField('URL Base da API', 'frontend.apiBaseUrl', editedConfig.frontend?.apiBaseUrl)}
  </div>
</div>
);
}
