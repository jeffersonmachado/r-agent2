import React from 'react';

export function ConfigRateLimitTab({ editedConfig, renderField, updateValue }) {
  return (
<div className="space-y-6">
  <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
    <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
      <span>🚦</span>
      <span>Rate Limiting</span>
    </h3>

    <div className="mb-6 pb-6 border-b border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Redis</h4>
      {renderField('URL do Redis', 'rateLimit.redis.url', editedConfig.rateLimit?.redis?.url)}
      <div className="mt-4 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
        <p className="text-sm text-text-secondary">
          💡 URL de conexão do Redis para armazenar contadores de rate limiting. Exemplo: <code className="bg-bg-primary px-1 rounded">redis://localhost:6379</code>
        </p>
      </div>
    </div>

    <div className="mb-6 pb-6 border-b border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - DRY-RUN</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Pontos (execuções)', 'rateLimit.policies.dryRun.points', editedConfig.rateLimit?.policies?.dryRun?.points, 'number')}
        {renderField('Duração (segundos)', 'rateLimit.policies.dryRun.duration', editedConfig.rateLimit?.policies?.dryRun?.duration, 'number')}
      </div>
      <div className="mt-4 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
        <p className="text-sm text-text-secondary">
          ℹ️ DRY-RUN é mais permissivo (padrão: 50 execuções por minuto) - usado para testes
        </p>
      </div>
    </div>

    <div className="mb-6 pb-6 border-b border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Geração Real</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Pontos (execuções)', 'rateLimit.policies.generation.points', editedConfig.rateLimit?.policies?.generation?.points, 'number')}
        {renderField('Duração (segundos)', 'rateLimit.policies.generation.duration', editedConfig.rateLimit?.policies?.generation?.duration, 'number')}
      </div>
      <div className="mt-4 p-4 bg-status-warning/10 rounded-lg border border-status-warning/30">
        <p className="text-sm text-text-secondary">
          ⚠️ Geração real é restritiva (padrão: 5 execuções por minuto) - usado em produção
        </p>
      </div>
    </div>

    <div className="mb-6 pb-6 border-b border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Bootstrap</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Pontos (execuções)', 'rateLimit.policies.bootstrap.points', editedConfig.rateLimit?.policies?.bootstrap?.points, 'number')}
        {renderField('Duração (segundos)', 'rateLimit.policies.bootstrap.duration', editedConfig.rateLimit?.policies?.bootstrap?.duration, 'number')}
      </div>
      <div className="mt-4 p-4 bg-status-error/10 rounded-lg border border-status-error/30">
        <p className="text-sm text-text-secondary">
          🚨 Bootstrap é extremamente restritivo (padrão: 1 execução a cada 5 minutos) - usado para operações críticas
        </p>
      </div>
    </div>

    <div className="mb-6 pb-6 border-b border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Scraping</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Pontos (requisições)', 'rateLimit.policies.scraping.points', editedConfig.rateLimit?.policies?.scraping?.points, 'number')}
        {renderField('Duração (segundos)', 'rateLimit.policies.scraping.duration', editedConfig.rateLimit?.policies?.scraping?.duration, 'number')}
        {renderField('Requisições por Segundo (por domínio)', 'rateLimit.policies.scraping.requestsPerSecond', editedConfig.rateLimit?.policies?.scraping?.requestsPerSecond, 'number')}
        {renderField('Páginas por Execução', 'rateLimit.policies.scraping.pagesPerExecution', editedConfig.rateLimit?.policies?.scraping?.pagesPerExecution, 'number')}
      </div>
      <div className="mt-4 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
        <p className="text-sm text-text-secondary">
          ℹ️ Scraping tem limites por domínio (requests por segundo) e por execução (páginas máximas)
        </p>
      </div>
    </div>

    <div className="mb-6">
      <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Validação de Sistema</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Pontos (execuções)', 'rateLimit.policies.systemValidate.points', editedConfig.rateLimit?.policies?.systemValidate?.points, 'number')}
        {renderField('Duração (segundos)', 'rateLimit.policies.systemValidate.duration', editedConfig.rateLimit?.policies?.systemValidate?.duration, 'number')}
      </div>
    </div>

    <div className="mt-6 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
      <p className="text-sm text-text-primary mb-2">
        <strong>ℹ️ Sobre Rate Limiting:</strong>
      </p>
      <ul className="text-sm text-text-secondary space-y-1 ml-4 list-disc">
        <li>Todas as execuções passam por rate limiting antes de qualquer processamento</li>
        <li>Rate limiting bloqueia execuções que excedem os limites configurados</li>
        <li>Erros de rate limit retornam HTTP 429 com informação de quando tentar novamente</li>
        <li>Eventos são registrados em <code className="bg-bg-primary px-1 rounded">reports/rate-limit-events.json</code></li>
        <li>Redis é obrigatório em produção para rate limiting distribuído</li>
      </ul>
    </div>
  </div>
</div>
);
}
