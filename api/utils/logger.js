/**
 * Logger utilitário do R-Agent2
 * - Mantém logs no console (para dev) e opcionalmente grava em arquivo (para produção/dev quando necessário)
 * - Não depende de libs externas (pino/winston), só fs + path
 *
 * Variáveis de ambiente úteis:
 *   LOG_TO_FILE=1           -> força gravação em arquivo
 *   LOG_DIR=./logs/api      -> diretório dos logs
 *   LOG_FILE=api.log        -> nome do arquivo
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// ---------- Config ----------
function truthy(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}

const DEFAULT_LOG_DIR = 'logs/api';
const DEFAULT_LOG_FILE = 'api.log';

function getLogDir() {
  return (
    process.env.LOG_DIR ||
    config.get('logging.dir', DEFAULT_LOG_DIR) ||
    DEFAULT_LOG_DIR
  );
}

function getLogFile() {
  return (
    process.env.LOG_FILE ||
    config.get('logging.file', DEFAULT_LOG_FILE) ||
    DEFAULT_LOG_FILE
  );
}

function isLogToFileEnabled() {
  // prioridade: env -> config -> default (true em dev para facilitar)
  if (process.env.LOG_TO_FILE !== undefined) return truthy(process.env.LOG_TO_FILE);
  const fromConfig = config.get('logging.toFile', undefined);
  if (fromConfig !== undefined) return !!fromConfig;
  // Garantia: se nada foi configurado, grava em arquivo por padrão.
  // Muitos ambientes (systemd/docker) podem não persistir stdout, então o arquivo é o ponto de verdade.
  return true;
}

// ---------- File stream ----------
let fileStream = null;
let fileStreamPath = null;

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // Se falhar (permissão, path inválido), apenas não grava em arquivo
    return false;
  }
  return true;
}

function openFileStreamIfNeeded() {
  if (!isLogToFileEnabled()) return null;
  if (fileStream) return fileStream;

  const dir = getLogDir();
  if (!ensureDir(dir)) return null;

  fileStreamPath = path.join(dir, getLogFile());

  try {
    fileStream = fs.createWriteStream(fileStreamPath, { flags: 'a' });
    fileStream.on('error', () => {
      // não derruba a app por falha de log
      fileStream = null;
      fileStreamPath = null;
    });
    return fileStream;
  } catch (e) {
    fileStream = null;
    fileStreamPath = null;
    return null;
  }
}

function writeToFile(line) {
  const s = openFileStreamIfNeeded();
  if (!s) return;
  try {
    s.write(line + '\n');
  } catch (e) {
    // ignora
  }
}

function closeFileStream() {
  if (!fileStream) return;
  try {
    fileStream.end();
  } catch (e) {
    // ignora
  } finally {
    fileStream = null;
    fileStreamPath = null;
  }
}

// Fecha stream em saídas comuns
process.on('exit', closeFileStream);
process.on('SIGINT', () => {
  closeFileStream();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeFileStream();
  process.exit(0);
});

// ---------- Formatting ----------
function nowIso() {
  return new Date().toISOString();
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

function formatLine(level, component, message, meta) {
  const prefix = `[${nowIso()}] [${level}]${component ? ` [${component}]` : ''}`;
  let line = `${prefix} ${message}`;
  if (meta !== undefined) {
    // meta em linha separada para leitura fácil (e para não estourar terminal)
    line += `\n${safeStringify(meta)}`;
  }
  return line;
}


// ---------- Argument normalization ----------
// Suporta chamadas no estilo:
//   logger.info("mensagem")
//   logger.warn("mensagem", {meta})
// além do estilo padrão:
//   logger.info("COMPONENTE", "mensagem", {meta})
function normalizeArgs(component, message, meta) {
  // logger.info("mensagem")
  if (message === undefined && meta === undefined) {
    return { component: null, message: component, meta: undefined };
  }

  // logger.info("mensagem", {meta})  -> (component = "mensagem", message = {meta})
  if (meta === undefined && message !== undefined && typeof message === 'object' && message !== null) {
    return { component: null, message: component, meta: message };
  }

  return { component, message, meta };
}

// ---------- Public API ----------
function log(level, component, message, meta) {
  const n = normalizeArgs(component, message, meta);
  const line = formatLine(level, n.component, n.message, n.meta);

  // Console
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);

  // File
  writeToFile(line);
}

module.exports = {
  debug: (component, message, meta) => log('DEBUG', component, message, meta),
  info: (component, message, meta) => log('INFO', component, message, meta),
  warn: (component, message, meta) => log('WARN', component, message, meta),
  error: (component, message, meta) => log('ERROR', component, message, meta),

  // Ajuda para troubleshooting
  _getLogFilePath: () => (fileStreamPath ? fileStreamPath : path.join(getLogDir(), getLogFile())),
  _isLogToFileEnabled: isLogToFileEnabled,
};

// Linha de boot do logger (ajuda a descobrir caminho real do arquivo)
try {
  setImmediate(() => {
    try {
      log('INFO', 'LOGGER', 'Logger carregado', {
        logToFile: isLogToFileEnabled(),
        logFile: path.join(getLogDir(), getLogFile()),
        cwd: process.cwd(),
        nodeEnv: process.env.NODE_ENV,
      });
    } catch (_) {}
  });
} catch (_) {}
