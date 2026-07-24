import React from 'react';
import { useTheme } from '../../styles/themeContext';
import { getStatusColor, getStatusIcon } from '../../utils/devDashboardUtils';

/**
 * Tab de Status
 */
export function StatusTab({ systemStatus }) {
  const { theme } = useTheme();

  if (!systemStatus) {
    return (
      <div className="text-center py-8 text-text-tertiary">
        Carregando status dos serviços...
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4 text-text-primary">Status dos Serviços</h2>
      
      {/* Status Geral */}
      <div className={`mb-6 p-6 rounded-lg border-2 ${getStatusColor(systemStatus.overall.status, theme)}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl font-bold">
                {getStatusIcon(systemStatus.overall.status)}
              </span>
              <h3 className="text-xl font-bold">
                Status Geral: {systemStatus.overall.status.toUpperCase()}
              </h3>
            </div>
            <p className="text-sm">
              {systemStatus.overall.healthy} de {systemStatus.overall.total} serviços saudáveis (
              {systemStatus.overall.percentage}%)
            </p>
          </div>
        </div>
      </div>

      {/* Lista de Serviços */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(systemStatus.services).map(([key, service]) => (
          <div
            key={key}
            className={`p-4 rounded-lg border-2 ${getStatusColor(service.status, theme)}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl font-bold">
                    {getStatusIcon(service.status)}
                  </span>
                  <h3 className="text-lg font-bold text-text-primary">{service.name}</h3>
                </div>
                <p className="text-sm mb-2 text-text-secondary">{service.description}</p>
                <div className="inline-block px-2 py-1 rounded-full text-xs font-medium border" style={{ 
                  backgroundColor: theme.colors.bg.secondary,
                  borderColor: theme.colors.border.default,
                  color: theme.colors.text.primary
                }}>
                  {service.status.toUpperCase()}
                </div>
              </div>
            </div>

            {/* Detalhes */}
            {service.details && (
              <div className="mt-3 text-sm space-y-1">
                {Object.entries(service.details).map(([key, value]) => (
                  <div key={key}>
                    <span className="font-medium text-text-primary">{key}:</span>{' '}
                    <span className="text-text-secondary">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Aviso operacional Redis */}
            {key === 'redis' && service.details?.configured === false && service.details?.mode === 'memory' && (
              <div className="mt-2 p-2 rounded text-sm" style={{
                backgroundColor: theme.colors.status.warning + '18',
                border: `1px solid ${theme.colors.status.warning}50`,
                color: theme.colors.status.warning,
              }}>
                {service.details.fallbackEnabled === false ? (
                  <>
                    <strong>Atenção:</strong> Redis não configurado e fallback desabilitado.
                    <div className="mt-1 flex gap-2 flex-wrap">
                      <a href="/config?tab=rateLimit" className="underline font-medium">🚦 Configurar Redis</a>
                      <a href="/config?tab=fallbacks" className="underline font-medium">⚙️ Habilitar fallback</a>
                      <a href="/dev/system-status" className="underline font-medium">📊 Ver detalhes</a>
                    </div>
                  </>
                ) : (
                  <>
                    <strong>Modo degradado:</strong> Redis não configurado; usando memória.{' '}
                    <a href="/config?tab=rateLimit" className="underline font-medium">Configurar →</a>
                  </>
                )}
              </div>
            )}

            {/* Erro */}
            {service.error && (
              <div className="mt-2 p-2 rounded text-sm" style={{ 
                backgroundColor: theme.colors.status.error + '20',
                border: `1px solid ${theme.colors.status.error}40`,
                color: theme.colors.status.error
              }}>
                <strong>Erro:</strong> {service.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

