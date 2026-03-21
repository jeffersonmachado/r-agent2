import React from 'react';

export function ConfigApiTab({ editedConfig, renderField }) {
  return (
<div className="space-y-6">
  <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
    <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
      <span>⚙️</span>
      <span>API</span>
    </h3>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {renderField('Porta', 'api.port', editedConfig.api?.port, 'number')}
    </div>
    <div className="mt-6 pt-6 border-t border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Limpeza de Tickets</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Intervalo (horas)', 'api.ticketCleanup.intervalHours', editedConfig.api?.ticketCleanup?.intervalHours, 'number')}
        {renderField('Idade Máxima (dias)', 'api.ticketCleanup.maxAgeDays', editedConfig.api?.ticketCleanup?.maxAgeDays, 'number')}
      </div>
    </div>
  </div>
</div>
);
}
