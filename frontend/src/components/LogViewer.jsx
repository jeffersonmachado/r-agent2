import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTheme } from '../styles/themeContext';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

/**
 * Componente para visualizar e gerenciar logs do sistema.
 * 
 * Features:
 * - Visualiza histórico de logs
 * - Filtra por nível
 * - Limpa logs
 * - Ajusta nível de log
 * - Auto-scroll
 */
export function LogViewer({ onClose }) {
  const { theme } = useTheme();
  const [logs, setLogs] = useState([]);
  const [filterLevel, setFilterLevel] = useState(-1); // -1 = todos
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef(null);
  const [currentLevel, setCurrentLevel] = useState(logger.getLevel());

  // Atualiza logs periodicamente
  useEffect(() => {
    const updateLogs = () => {
      const allLogs = logger.getHistory();
      setLogs((prev) => {
        const sameLength = prev.length === allLogs.length;
        const sameLast = allLogs.length === 0 || prev[prev.length - 1] === allLogs[allLogs.length - 1];
        return sameLength && sameLast ? prev : allLogs;
      });
      setCurrentLevel((prev) => {
        const next = logger.getLevel();
        return prev === next ? prev : next;
      });
    };

    updateLogs();
    const interval = setInterval(updateLogs, 500);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = useMemo(() => (
    filterLevel === -1
      ? logs
      : logs.filter(log => log.level === filterLevel)
  ), [logs, filterLevel]);

  const getLevelName = (level) => {
    const names = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    return names[level] || 'UNKNOWN';
  };

  const getLevelColor = (level) => {
      const colors = {
      0: theme.colors.text.tertiary, // DEBUG
      1: theme.colors.accent.primary,  // INFO
      2: theme.colors.status.warning, // WARN
      3: theme.colors.status.error,  // ERROR
      };
    return colors[level] || theme.colors.text.secondary;
  };

  const handleSetLevel = (level) => {
    logger.setLevel(level);
    setCurrentLevel(level);
  };

  const handleClear = () => {
    logger.clearHistory();
    setLogs([]);
  };

  const handleExportJson = () => {
    logger.downloadAsJson();
  };

  const handleExportText = () => {
    logger.downloadAsText();
  };

  const handleCopyAll = async () => {
    try {
      const text = logger.exportAsText();
      await navigator.clipboard.writeText(text);
      logger.info('Logs copiados para a área de transferência', { count: logs.length });
      
      // Feedback visual temporário
      const button = document.querySelector('[data-copy-all]');
      if (button) {
        const originalText = button.textContent;
        button.textContent = '✓ Copiado!';
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }
    } catch (err) {
      logger.error('Erro ao copiar logs', err);
    }
  };

  const handleCopyLog = async (log) => {
    try {
      const timestamp = new Date(log.timestamp).toLocaleString('pt-BR');
      const levelName = getLevelName(log.level);
      let text = `[${timestamp}] [${levelName}] ${log.message}`;
      
      if (log.data) {
        try {
          text += `\n${JSON.stringify(log.data, null, 2)}`;
        } catch (e) {
          text += `\n[Erro ao serializar dados]`;
        }
      }
      
      await navigator.clipboard.writeText(text);
      logger.debug('Log individual copiado');
    } catch (err) {
      logger.error('Erro ao copiar log', err);
    }
  };

  return (
    <div className="log-viewer-overlay" onClick={onClose}>
      <div className="log-viewer-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="log-viewer-header">
          <div className="log-viewer-title">
            Logs do Sistema
          </div>
          <div className="log-viewer-header-actions">
            <Button variant="ghost" size="sm" onClick={handleCopyAll} title="Copiar todos os logs" data-copy-all>
              📋 Copiar
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExportJson} title="Baixar logs como JSON">
              📥 JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExportText} title="Baixar logs como texto">
              📄 TXT
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClear}>
              Limpar
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className="log-viewer-controls">
          {/* Nível atual */}
          <div className="log-viewer-control-row">
            <div className="log-viewer-control-label">
              Nível atual:
            </div>
            {[0, 1, 2, 3].map((level) => (
              <Button
                key={level}
                variant={currentLevel === level ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => handleSetLevel(level)}
              >
                {getLevelName(level)}
              </Button>
            ))}
          </div>

          {/* Filtrar */}
          <div className="log-viewer-control-row">
            <div className="log-viewer-control-label">
              Filtrar:
            </div>
            <Button
              variant={filterLevel === -1 ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilterLevel(-1)}
            >
              Todos
            </Button>
            {[0, 1, 2, 3].map((level) => (
              <Button
                key={level}
                variant={filterLevel === level ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setFilterLevel(level)}
              >
                {getLevelName(level)}
              </Button>
            ))}

            <label className="log-viewer-control-checkbox">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
          </div>
        </div>

        {/* Logs */}
        <div ref={logContainerRef} className="log-viewer-content">
          {filteredLogs.length === 0 ? (
            <div className="log-viewer-empty">
              Nenhum log disponível
            </div>
          ) : (
            filteredLogs.map((log, index) => (
              <div
                key={index}
                className="log-viewer-entry"
                style={{
                  backgroundColor: log.level >= 2 ? `${getLevelColor(log.level)}20` : 'transparent',
                  position: 'relative',
                  paddingRight: '60px',
                }}
              >
                <button
                  onClick={() => handleCopyLog(log)}
                  className="log-viewer-entry-copy"
                  title="Copiar este log"
                >
                  📋
                </button>
                <div className="log-viewer-entry-header">
                  <span className="log-viewer-entry-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span 
                    className="log-viewer-entry-level"
                    style={{ color: getLevelColor(log.level) }}
                  >
                    [{getLevelName(log.level)}]
                  </span>
                </div>
                <div className="log-viewer-entry-message">{log.message}</div>
                {log.data && (
                  <pre className="log-viewer-entry-data">
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="log-viewer-footer">
          <span>Total: {filteredLogs.length} logs</span>
          <span>Nível: {getLevelName(currentLevel)}</span>
        </div>
      </div>
    </div>
  );
}

