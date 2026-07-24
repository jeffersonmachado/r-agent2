import React from 'react';
import { useTheme } from '../../styles/themeContext';

/**
 * Cabeçalho do DevDashboard
 */
export function DevDashboardHeader({ onShowLogs, onRefresh, loading, autoRefresh, setAutoRefresh, refreshInterval, setRefreshInterval, lastUpdate }) {
  const { theme } = useTheme();

  return (
    <>
      <div className="mb-4 md:mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2 text-text-primary">
            🛠️ Dashboard de Desenvolvimento
          </h1>
          <p className="text-sm md:text-base text-text-secondary">
            Ferramentas e informações úteis para desenvolvedores
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-4">
          <button
            onClick={onShowLogs}
            className="px-3 md:px-4 py-2 rounded-lg transition-colors text-sm md:text-base"
            style={{ 
              backgroundColor: theme.colors.accent.primary,
              color: '#ffffff'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.accent.hover}
            onMouseLeave={(e) => e.target.style.backgroundColor = theme.colors.accent.primary}
          >
            📋 Ver Logs
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-3 md:px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm md:text-base"
            style={{ 
              backgroundColor: loading ? theme.colors.text.tertiary : theme.colors.status.info,
              color: '#ffffff'
            }}
            onMouseEnter={(e) => !loading && (e.target.style.backgroundColor = theme.colors.status.info)}
            onMouseLeave={(e) => !loading && (e.target.style.backgroundColor = theme.colors.status.info)}
          >
            {loading ? '⏳ Atualizando...' : '🔄 Atualizar'}
          </button>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-xs md:text-sm text-text-secondary">Auto-atualizar</span>
          </label>
          {autoRefresh && (
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="px-2 md:px-3 py-2 rounded-lg text-xs md:text-sm"
              style={{ 
                backgroundColor: theme.colors.bg.secondary,
                border: `1px solid ${theme.colors.border.default}`,
                color: theme.colors.text.primary
              }}
            >
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1min</option>
            </select>
          )}
        </div>
      </div>

      {lastUpdate && (
        <div className="mb-4 text-sm text-text-tertiary">
          Última atualização: {lastUpdate.toLocaleTimeString('pt-BR')}
        </div>
      )}
    </>
  );
}

