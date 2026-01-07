import React from 'react';
import { useTheme } from '../../styles/themeContext';

/**
 * Cabeçalho do DevDashboard
 */
export function DevDashboardHeader({ onShowLogs, onRefresh, loading, autoRefresh, setAutoRefresh, refreshInterval, setRefreshInterval, lastUpdate }) {
  const { theme } = useTheme();

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: theme.colors.text.primary }}>
            🛠️ Dashboard de Desenvolvimento
          </h1>
          <p style={{ color: theme.colors.text.secondary }}>
            Ferramentas e informações úteis para desenvolvedores
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onShowLogs}
            className="px-4 py-2 rounded-lg transition-colors"
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
            className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            <span className="text-sm" style={{ color: theme.colors.text.secondary }}>Auto-atualizar</span>
          </label>
          {autoRefresh && (
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="px-3 py-2 rounded-lg text-sm"
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
        <div className="mb-4 text-sm" style={{ color: theme.colors.text.tertiary }}>
          Última atualização: {lastUpdate.toLocaleTimeString('pt-BR')}
        </div>
      )}
    </>
  );
}

