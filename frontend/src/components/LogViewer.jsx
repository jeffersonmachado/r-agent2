import React, { useState, useEffect, useRef } from 'react';
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
      setLogs(allLogs);
      setCurrentLevel(logger.getLevel());
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

  const filteredLogs = filterLevel === -1 
    ? logs 
    : logs.filter(log => log.level === filterLevel);

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
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: theme.colors.bg.elevated,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: '8px',
          width: '90%',
          maxWidth: '900px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${theme.colors.border.default}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '18px', fontWeight: 600, color: theme.colors.text.primary }}>
            Logs do Sistema
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
        <div
          style={{
            padding: '12px 20px',
            borderBottom: `1px solid ${theme.colors.border.default}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Nível atual */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '12px', color: theme.colors.text.secondary }}>
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
          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '12px', color: theme.colors.text.secondary }}>
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

            <label
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: theme.colors.text.secondary,
                cursor: 'pointer',
              }}
            >
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
        <div
          ref={logContainerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: '11px',
            lineHeight: 1.5,
            backgroundColor: theme.colors.bg.primary,
          }}
        >
          {filteredLogs.length === 0 ? (
            <div style={{ color: theme.colors.text.tertiary, textAlign: 'center', padding: '20px' }}>
              Nenhum log disponível
            </div>
          ) : (
            filteredLogs.map((log, index) => (
              <div
                key={index}
                style={{
                  marginBottom: '4px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: log.level >= 2 ? `${getLevelColor(log.level)}20` : 'transparent',
                  position: 'relative',
                  paddingRight: '60px',
                }}
              >
                <button
                  onClick={() => handleCopyLog(log)}
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    padding: '2px 6px',
                    fontSize: '10px',
                    backgroundColor: theme.colors.bg.tertiary,
                    border: `1px solid ${theme.colors.border.default}`,
                    borderRadius: '4px',
                    color: theme.colors.text.secondary,
                    cursor: 'pointer',
                    opacity: 0.7,
                    transition: 'opacity 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.backgroundColor = theme.colors.bg.hover;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.7';
                    e.currentTarget.style.backgroundColor = theme.colors.bg.tertiary;
                  }}
                  title="Copiar este log"
                >
                  📋
                </button>
                <span style={{ color: theme.colors.text.tertiary }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                {' '}
                <span style={{ color: getLevelColor(log.level), fontWeight: 600 }}>
                  [{getLevelName(log.level)}]
                </span>
                {' '}
                <span style={{ color: theme.colors.text.primary }}>{log.message}</span>
                {log.data && (
                  <pre
                    style={{
                      marginTop: '4px',
                      marginLeft: '20px',
                      color: theme.colors.text.secondary,
                      fontSize: '10px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 20px',
            borderTop: `1px solid ${theme.colors.border.default}`,
            fontSize: '11px',
            color: theme.colors.text.tertiary,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Total: {filteredLogs.length} logs</span>
          <span>Nível: {getLevelName(currentLevel)}</span>
        </div>
      </div>
    </div>
  );
}

