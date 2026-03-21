import React from 'react';

export function ConfigRagTab({ editedConfig, renderField, updateValue }) {
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
        Por padrão, o serviço roda na porta <strong>9000</strong>. Certifique-se de que o serviço está rodando antes de usar.
      </p>
      <p className="text-sm text-text-secondary mt-2">
        Para iniciar o serviço manualmente: <code className="bg-bg-primary px-2 py-1 rounded text-xs">cd rag-service && uvicorn main:app --reload --host 0.0.0.0 --port 9000</code>
      </p>
    </div>
  </div>
</div>
);
}
