/**
 * Sistema de logging para o backend (Node.js).
 *
 * Agora suporta:
 * - saída no console (como antes)
 * - gravação em arquivo (API) para não depender do terminal do VSCode
 *
 * Onde grava:
 * - por padrão: api/logs/api-YYYY-MM-DD.log
 * - e erros em: api/logs/error-YYYY-MM-DD.log
 *
 * Configuração:
 * - api/data/config.json:
 *   logging.level  (DEBUG|INFO|WARN|ERROR|NONE ou 0..4)
 *   logging.format ('text'|'json')
 *   logging.dir    (diretório base de logs)
 *   logging.toFile (true|false)
 * - Variáveis de ambiente (fallback):
 *   LOG_LEVEL, LOG_DIR, LOG_TO_FILE
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

function getLogLevel() {
  const configLevel = config.get('logging.level');
  if (configLevel !== undefined) {
    const level = typeof configLevel === 'string'
      ? LOG_LEVELS[String(configLevel).toUpperCase()]
      : parseInt(configLevel, 10);

    if (level !== undefined && !Number.isNaN(level) && level >= 0 && level <= 4) return level;
  }

  const envLevel = process.env.LOG_LEVEL;
  if (envLevel) {
    const level = parseInt(envLevel, 10);
    if (!Number.isNaN(level) && level >= 0 && level <= 4) return level;

    const asName = LOG_LEVELS[String(envLevel).toUpperCase()];
    if (asName !== undefined) return asName;
  }

  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;
}

function getLogDir() {
  const cfgDir = config.get('logging.dir');
  const envDir = process.env.LOG_DIR;
  // __dirname = api/utils
  return String(cfgDir || envDir || path.join(__dirname, '..', 'logs'));
}

function toFileEnabled() {
  const cfg = config.get('logging.toFile');
  if (typeof cfg === 'boolean') return cfg;
  const env = process.env.LOG_TO_FILE;
  if (!env) return true;
  return ['1', 'true', 'yes', 'on'].includes(String(env).toLowerCase());
}

function ensureDirSync(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // se falhar, seguimos com console apenas
  }
}

function yyyyMmDd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

function formatMessage(level, message, data = null) {
  const format = config.get('logging.format', 'text');
  const timestamp = new Date().toISOString();
  const levelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  const levelName = levelNames[level] || 'UNKNOWN';

  if (format === 'json') {
    const logEntry = { timestamp, level: levelName, message };
    if (data !== null && data !== undefined) {
      if (data instanceof Error) {
        logEntry.error = { message: data.message, stack: data.stack };
      } else if (typeof data === 'object') {
        logEntry.data = data;
      } else {
        logEntry.data = String(data);
      }
    }
    return JSON.stringify(logEntry);
  }

  let formatted = `[${timestamp}] [${levelName}] ${message}`;
  if (data !== null && data !== undefined) {
    if (data instanceof Error) {
      formatted += `\n${data.stack || data.message}`;
    } else if (typeof data === 'object') {
      formatted += `\n${safeStringify(data)}`;
    } else {
      formatted += ` ${String(data)}`;
    }
  }
  return formatted;
}

function appendToLogFiles(levelName, line) {
  if (!toFileEnabled()) return;

  const dir = getLogDir();
  ensureDirSync(dir);

  const date = yyyyMmDd();
  const apiFile = path.join(dir, `api-${date}.log`);
  const errFile = path.join(dir, `error-${date}.log`);

  try {
    fs.appendFileSync(apiFile, `${line}\n`, { encoding: 'utf8' });
    if (levelName === 'ERROR') fs.appendFileSync(errFile, `${line}\n`, { encoding: 'utf8' });
  } catch (e) {
    // se não conseguir gravar, não derruba a aplicação
  }
}

const logger = {
  setLevel(level) {
    if (level >= 0 && level <= 4) process.env.LOG_LEVEL = String(level);
  },

  getLevel() {
    return getLogLevel();
  },

  getLogDir() {
    return getLogDir();
  },

  isFileEnabled() {
    return toFileEnabled();
  },

  debug(message, data = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.DEBUG) {
      const line = formatMessage(LOG_LEVELS.DEBUG, message, data);
      // eslint-disable-next-line no-console
      console.log(line);
      appendToLogFiles('DEBUG', line);
    }
  },

  info(message, data = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.INFO) {
      const line = formatMessage(LOG_LEVELS.INFO, message, data);
      // eslint-disable-next-line no-console
      console.info(line);
      appendToLogFiles('INFO', line);
    }
  },

  warn(message, data = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.WARN) {
      const line = formatMessage(LOG_LEVELS.WARN, message, data);
      // eslint-disable-next-line no-console
      console.warn(line);
      appendToLogFiles('WARN', line);
    }
  },

  error(message, error = null) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.ERROR) {
      const errorData = error instanceof Error ? { message: error.message, stack: error.stack } : error;
      const line = formatMessage(LOG_LEVELS.ERROR, message, errorData);
      // eslint-disable-next-line no-console
      console.error(line);
      appendToLogFiles('ERROR', line);
    }
  },

  event(eventType, payload = {}) {
    const level = getLogLevel();
    if (level <= LOG_LEVELS.INFO) {
      const eventData = { type: 'event', eventType, ...payload, timestamp: new Date().toISOString() };
      const line = formatMessage(LOG_LEVELS.INFO, `[EVENT] ${eventType}`, eventData);
      // eslint-disable-next-line no-console
      console.info(line);
      appendToLogFiles('INFO', line);
    }
  },

  levels: LOG_LEVELS,
};

module.exports = logger;
