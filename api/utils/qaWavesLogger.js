'use strict';

/**
 * Logger dedicado para QA Waves.
 *
 * Escreve no console (igual ao logger geral) E em logs/qa-waves.log.
 * Interface idêntica ao logger geral para ser um drop-in replacement.
 *
 * Arquivo de log: <project-root>/logs/qa-waves.log
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs/api');
const LOG_FILE = path.join(LOG_DIR, 'qa-waves.log');
const API_LOG_FILE = path.join(LOG_DIR, 'api.log');

// Garante que o diretório existe na inicialização
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (_) {
  // silently ignore — não deve impedir o boot da API
}

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

function getLogLevel() {
  const envLevel = process.env.LOG_LEVEL;
  if (envLevel) {
    const level = parseInt(envLevel, 10);
    if (!isNaN(level) && level >= 0 && level <= 4) return level;
  }
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;
}

function formatMessage(levelName, message, data) {
  const timestamp = new Date().toISOString();
  let formatted = `[${timestamp}] [${levelName}] [QA-WAVES] ${message}`;

  if (data !== null && data !== undefined) {
    try {
      if (data instanceof Error) {
        formatted += `\n${data.stack || data.message}`;
      } else if (typeof data === 'object') {
        formatted += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        formatted += ` ${String(data)}`;
      }
    } catch (_) {
      formatted += ` ${String(data)}`;
    }
  }

  return formatted;
}

function writeToFile(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (_) {
    // silently ignore
  }
  try {
    fs.appendFileSync(API_LOG_FILE, line + '\n', 'utf8');
  } catch (_) {
    // silently ignore
  }
}

function log(consoleMethod, levelName, levelValue, message, data = null) {
  if (getLogLevel() > levelValue) return;
  const formatted = formatMessage(levelName, message, data);
  // eslint-disable-next-line no-console
  console[consoleMethod](formatted);
  writeToFile(formatted);
}

const qaWavesLogger = {
  debug(message, data = null) {
    log('log', 'DEBUG', LOG_LEVELS.DEBUG, message, data);
  },
  info(message, data = null) {
    log('info', 'INFO', LOG_LEVELS.INFO, message, data);
  },
  warn(message, data = null) {
    log('warn', 'WARN', LOG_LEVELS.WARN, message, data);
  },
  error(message, error = null) {
    const data = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : error;
    log('error', 'ERROR', LOG_LEVELS.ERROR, message, data);
  },
  levels: LOG_LEVELS,
  logFile: LOG_FILE,
};

module.exports = qaWavesLogger;
