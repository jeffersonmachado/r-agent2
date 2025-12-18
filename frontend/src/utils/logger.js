/**
 * Sistema de logging com níveis e opção de debug.
 * 
 * Níveis:
 * - debug: Informações detalhadas para debugging
 * - info: Informações gerais
 * - warn: Avisos
 * - error: Erros
 * 
 * Uso:
 *   import logger from './utils/logger';
 *   logger.debug('Mensagem de debug');
 *   logger.info('Mensagem de info');
 *   logger.warn('Mensagem de aviso');
 *   logger.error('Mensagem de erro', error);
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

// Nível atual (pode ser alterado via localStorage ou variável de ambiente)
function getLogLevel() {
  // Verifica localStorage primeiro
  const stored = localStorage.getItem('app_log_level');
  if (stored) {
    const level = parseInt(stored, 10);
    if (!isNaN(level) && level >= 0 && level <= 4) {
      return level;
    }
  }
  
  // Verifica variável de ambiente
  const envLevel = import.meta.env.VITE_LOG_LEVEL;
  if (envLevel) {
    const level = parseInt(envLevel, 10);
    if (!isNaN(level) && level >= 0 && level <= 4) {
      return level;
    }
  }
  
  // Padrão: INFO em produção, DEBUG em desenvolvimento
  return import.meta.env.DEV ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
}

// Armazena logs em memória para visualização (últimos 1000)
const logHistory = [];
const MAX_LOG_HISTORY = 1000;

function addToHistory(level, message, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data: data ? JSON.parse(JSON.stringify(data)) : null,
  };
  
  logHistory.push(entry);
  
  // Mantém apenas os últimos MAX_LOG_HISTORY logs
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
}

function formatMessage(level, message, data) {
  const timestamp = new Date().toISOString();
  const levelName = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === level) || 'UNKNOWN';
  
  let formatted = `[${timestamp}] [${levelName}] ${message}`;
  
  if (data) {
    try {
      formatted += ` ${JSON.stringify(data, null, 2)}`;
    } catch (e) {
      formatted += ` [Erro ao serializar dados: ${e.message}]`;
    }
  }
  
  return formatted;
}

const logger = {
  /**
   * Define o nível de log
   * @param {number} level - Nível de log (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=NONE)
   */
  setLevel(level) {
    if (level >= 0 && level <= 4) {
      localStorage.setItem('app_log_level', String(level));
      logger.info('Nível de log alterado para', { level });
    }
  },
  
  /**
   * Obtém o nível de log atual
   * @returns {number}
   */
  getLevel() {
    return getLogLevel();
  },
  
  /**
   * Obtém o histórico de logs
   * @returns {Array}
   */
  getHistory() {
    return [...logHistory];
  },
  
  /**
   * Limpa o histórico de logs
   */
  clearHistory() {
    logHistory.length = 0;
  },
  
  /**
   * Exporta os logs como JSON
   * @returns {string} JSON string dos logs
   */
  exportAsJson() {
    return JSON.stringify(logHistory, null, 2);
  },
  
  /**
   * Exporta os logs como texto formatado
   * @returns {string} Texto formatado dos logs
   */
  exportAsText() {
    const lines = logHistory.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleString('pt-BR');
      const levelName = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === log.level) || 'UNKNOWN';
      let line = `[${timestamp}] [${levelName}] ${log.message}`;
      
      if (log.data) {
        try {
          line += `\n${JSON.stringify(log.data, null, 2)}`;
        } catch (e) {
          line += `\n[Erro ao serializar dados: ${e.message}]`;
        }
      }
      
      return line;
    });
    
    return lines.join('\n\n');
  },
  
  /**
   * Faz download dos logs como arquivo JSON
   */
  downloadAsJson() {
    const content = this.exportAsJson();
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    link.download = `logs-${timestamp}.json`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    logger.info('Logs exportados como JSON', { count: logHistory.length });
  },
  
  /**
   * Faz download dos logs como arquivo de texto
   */
  downloadAsText() {
    const content = this.exportAsText();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    link.download = `logs-${timestamp}.txt`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    logger.info('Logs exportados como texto', { count: logHistory.length });
  },
  
  /**
   * Log de debug (nível 0)
   */
  debug(message, data) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.DEBUG) {
      const formatted = formatMessage(LOG_LEVELS.DEBUG, message, data);
      // eslint-disable-next-line no-console
      console.debug(formatted);
      addToHistory(LOG_LEVELS.DEBUG, message, data);
    }
  },
  
  /**
   * Log de informação (nível 1)
   */
  info(message, data) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.INFO) {
      const formatted = formatMessage(LOG_LEVELS.INFO, message, data);
      // eslint-disable-next-line no-console
      console.info(formatted);
      addToHistory(LOG_LEVELS.INFO, message, data);
    }
  },
  
  /**
   * Log de aviso (nível 2)
   */
  warn(message, data) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.WARN) {
      const formatted = formatMessage(LOG_LEVELS.WARN, message, data);
      // eslint-disable-next-line no-console
      console.warn(formatted);
      addToHistory(LOG_LEVELS.WARN, message, data);
    }
  },
  
  /**
   * Log de erro (nível 3)
   */
  error(message, error) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.ERROR) {
      const errorData = error instanceof Error 
        ? { 
            message: error.message, 
            stack: error.stack,
            ...(error.status && { status: error.status }),
            ...(error.body && { body: error.body }),
          }
        : error;
      
      const formatted = formatMessage(LOG_LEVELS.ERROR, message, errorData);
      // eslint-disable-next-line no-console
      console.error(formatted);
      addToHistory(LOG_LEVELS.ERROR, message, errorData);
    }
  },
  
  /**
   * Níveis de log disponíveis
   */
  LEVELS: LOG_LEVELS,
};

// Intercepta os métodos do console para também enviar para o sistema de log
if (typeof window !== 'undefined') {
  // Armazena os métodos originais do console
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  // Função auxiliar para extrair mensagem e dados de argumentos do console
  function parseConsoleArgs(args) {
    if (args.length === 0) return { message: '', data: null };
    
    // Tenta identificar se o primeiro argumento é uma string (mensagem)
    let message = '';
    let data = null;
    
    if (typeof args[0] === 'string') {
      message = args[0];
      if (args.length > 1) {
        // Se houver mais argumentos, tenta criar um objeto com eles
        try {
          data = args.length === 2 ? args[1] : Array.from(args.slice(1));
        } catch (e) {
          // Se falhar, converte tudo para string
          data = args.slice(1).map(arg => {
            try {
              return JSON.parse(JSON.stringify(arg));
            } catch {
              return String(arg);
            }
          });
        }
      }
    } else {
      // Se o primeiro argumento não é string, tenta converter tudo
      try {
        if (args.length === 1) {
          data = args[0];
          message = typeof args[0] === 'object' && args[0] !== null
            ? JSON.stringify(args[0])
            : String(args[0]);
        } else {
          data = Array.from(args);
          message = args.map(arg => {
            try {
              return typeof arg === 'object' && arg !== null
                ? JSON.stringify(arg)
                : String(arg);
            } catch {
              return String(arg);
            }
          }).join(' ');
        }
      } catch (e) {
        message = args.map(arg => String(arg)).join(' ');
        data = null;
      }
    }
    
    return { message, data };
  }

  // Intercepta console.log
  console.log = function(...args) {
    originalConsole.log(...args);
    const { message, data } = parseConsoleArgs(args);
    if (message) {
      addToHistory(LOG_LEVELS.INFO, message, data);
    }
  };

  // Intercepta console.info
  console.info = function(...args) {
    originalConsole.info(...args);
    const { message, data } = parseConsoleArgs(args);
    if (message) {
      addToHistory(LOG_LEVELS.INFO, message, data);
    }
  };

  // Intercepta console.warn
  console.warn = function(...args) {
    originalConsole.warn(...args);
    const { message, data } = parseConsoleArgs(args);
    if (message) {
      addToHistory(LOG_LEVELS.WARN, message, data);
    }
  };

  // Intercepta console.error
  console.error = function(...args) {
    originalConsole.error(...args);
    const { message, data } = parseConsoleArgs(args);
    if (message) {
      // Tenta extrair informações de erro se for um Error object
      let errorData = data;
      if (args[0] instanceof Error) {
        errorData = {
          message: args[0].message,
          stack: args[0].stack,
          ...(data && typeof data === 'object' ? data : { extra: data }),
        };
      }
      addToHistory(LOG_LEVELS.ERROR, message || 'Erro', errorData);
    }
  };

  // Intercepta console.debug
  console.debug = function(...args) {
    originalConsole.debug(...args);
    const { message, data } = parseConsoleArgs(args);
    if (message) {
      addToHistory(LOG_LEVELS.DEBUG, message, data);
    }
  };
}

export default logger;

