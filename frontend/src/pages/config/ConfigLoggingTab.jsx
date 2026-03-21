import React from 'react';

export function ConfigLoggingTab({ editedConfig, renderField }) {
  return (
<div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
    <span>📝</span>
    <span>Logging</span>
  </h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {renderField(
      'Nível de Log', 
      'logging.level', 
      editedConfig.logging?.level,
      'text',
      [
        { value: 'DEBUG', label: 'DEBUG - Todas as mensagens (0)' },
        { value: 'INFO', label: 'INFO - Informações, avisos e erros (1)' },
        { value: 'WARN', label: 'WARN - Apenas avisos e erros (2)' },
        { value: 'ERROR', label: 'ERROR - Apenas erros (3)' },
        { value: 'NONE', label: 'NONE - Nenhum log (4)' }
      ]
    )}
    {renderField(
      'Formato de Saída', 
      'logging.format', 
      editedConfig.logging?.format,
      'text',
      [
        { value: 'json', label: 'JSON - Formato estruturado (recomendado)' },
        { value: 'text', label: 'TEXT - Formato texto legível' }
      ]
    )}
  </div>
  <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
    <p className="text-sm text-text-secondary mb-2">
      <strong>💡 Níveis de Log:</strong>
    </p>
    <ul className="text-sm text-text-secondary space-y-1 ml-4 list-disc">
      <li><strong>DEBUG:</strong> Todas as mensagens, incluindo informações detalhadas para debugging</li>
      <li><strong>INFO:</strong> Informações gerais, avisos e erros (padrão em produção)</li>
      <li><strong>WARN:</strong> Apenas avisos e erros</li>
      <li><strong>ERROR:</strong> Apenas erros</li>
      <li><strong>NONE:</strong> Nenhum log será exibido</li>
    </ul>
  </div>
  <div className="mt-4 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
    <p className="text-sm text-text-primary">
      <strong>ℹ️ Nota:</strong> Após alterar as configurações de logging, reinicie o servidor da API para aplicar as mudanças.
    </p>
  </div>
</div>
);
}
