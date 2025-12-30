/**
 * Sistema de logging para o backend (Node.js).
 * 
 * Níveis:
 * - debug: Informações detalhadas para debugging
 * - info: Informações gerais
 * - warn: Avisos
 * - error: Erros
 * 
 * Configuração:
 * - Lê configuração de api/data/config.json
 * - Suporta variável de ambiente LOG_LEVEL como fallback
 * 
 * Uso:
 *   const logger = require('./utils/logger');
 *   logger.debug('Mensagem de debug');
 *   logger.info('Mensagem de info');
 *   logger.warn('Mensagem de aviso');
 *   logger.error('Mensagem de erro', error);
 */

const config = require('./config');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

// Nível atual (lê da configuração primeiro, depois variável de ambiente)
function getLogLevel() {
  // 1. Tenta ler da configuração
  const configLevel = config.get('logging.level');
  if (configLevel !== undefined) {
    // Suporta tanto número quanto string
    const level = typeof configLevel === 'string' 
      ? LOG_LEVELS[configLevel.toUpperCase()] 
      : parseInt(configLevel, 10);
    
    if (level !== undefined && !isNaN(level) && level >= 0 && level <= 4) {
      return level;
    }
  }
  
  // 2. Fallback: variável de ambiente
  const envLevel = process.env.LOG_LEVEL;
  if (envLevel) {
    const level = parseInt(envLevel, 10);
    if (!isNaN(level) && level >= 0 && level <= 4) {
      return level;
    }
  }
  
  // 3. Padrão: INFO em produção, DEBUG em desenvolvimento
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;
}

/**
 * Formata mensagem de log com timestamp e nível
 */
function formatMessage(level, message, data = null) {
  const format = config.get('logging.format', 'text');
  const timestamp = new Date().toISOString();
  const levelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  const levelName = levelNames[level] || 'UNKNOWN';
  
  // Formato JSON
  if (format === 'json') {
    const logEntry = {
      timestamp,
      level: levelName,
      message,
    };
    
    if (data !== null && data !== undefined) {
      if (data instanceof Error) {
        logEntry.error = {
          message: data.message,
          stack: data.stack,
          ...data,
        };
      } else if (typeof data === 'object') {
        logEntry.data = data;
      } else {
        logEntry.data = String(data);
      }
    }
    
    return JSON.stringify(logEntry);
  }
  
  // Formato texto (padrão)
  let formatted = `[${timestamp}] [${levelName}] ${message}`;
  
  if (data !== null && data !== undefined) {
    try {
      if (data instanceof Error) {
        formatted += `\n${data.stack || data.message}`;
      } else if (typeof data === 'object') {
        formatted += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        formatted += ` ${String(data)}`;
      }
    } catch (e) {
      formatted += ` ${String(data)}`;
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
      process.env.LOG_LEVEL = String(level);
    }
  },
  
  /**
   * Obtém o nível atual de log
   * @returns {number}
   */
  getLevel() {
    return getLogLevel();
  },
  
  /**
   * Log de debug
   * @param {string} message - Mensagem
   * @param {any} [data] - Dados adicionais
   */
  debug(message, data = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.DEBUG) {
      // eslint-disable-next-line no-console
      console.log(formatMessage(LOG_LEVELS.DEBUG, message, data));
    }
  },
  
  /**
   * Log de informação
   * @param {string} message - Mensagem
   * @param {any} [data] - Dados adicionais
   */
  info(message, data = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.INFO) {
      // eslint-disable-next-line no-console
      console.info(formatMessage(LOG_LEVELS.INFO, message, data));
    }
  },
  
  /**
   * Log de aviso
   * @param {string} message - Mensagem
   * @param {any} [data] - Dados adicionais
   */
  warn(message, data = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.WARN) {
      // eslint-disable-next-line no-console
      console.warn(formatMessage(LOG_LEVELS.WARN, message, data));
    }
  },
  
  /**
   * Log de erro
   * @param {string} message - Mensagem
   * @param {Error|any} [error] - Erro ou dados adicionais
   */
  error(message, error = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.ERROR) {
      const errorData = error instanceof Error 
        ? { message: error.message, stack: error.stack, ...error }
        : error;
      
      // eslint-disable-next-line no-console
      console.error(formatMessage(LOG_LEVELS.ERROR, message, errorData));
    }
  },
  
  /**
   * Log de evento estruturado (para fallback, analytics, etc.)
   * 
   * @param {string} eventType - Tipo do evento (ex: 'fallback_triggered')
   * @param {Object} payload - Dados do evento
   */
  event(eventType, payload = {}) {
    const level = getLogLevel();
    // Eventos são sempre logados (equivalente a INFO)
    if (level <= LOG_LEVELS.INFO) {
      const eventData = {
        type: 'event',
        eventType,
        ...payload,
        timestamp: new Date().toISOString(),
      };
      
      // eslint-disable-next-line no-console
      console.info(formatMessage(LOG_LEVELS.INFO, `[EVENT] ${eventType}`, eventData));
    }
  },
  
  /**
   * Níveis de log disponíveis
   */
  levels: LOG_LEVELS,
};

module.exports = logger;

