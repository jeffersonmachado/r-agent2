'use strict';

/**
 * Logger estruturado mínimo do container (JSON por linha no stdout).
 *
 * O container NÃO usa api/utils/logger: aquela cadeia lê api/data/config.json
 * e foi feita para o processo da API. Aqui o log é uma dependência zero, com
 * níveis e sem segredos (o token nunca é logado — auth.js não recebe logger).
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function createLogger({ level = 'info', service = 'mcp-research' } = {}) {
  const threshold = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;

  function write(severity, message, meta) {
    if ((LEVELS[severity] ?? 0) < threshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level: severity,
      service,
      msg: String(message),
      ...(meta && typeof meta === 'object' ? { meta } : {}),
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }

  return Object.freeze({
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  });
}

module.exports = { createLogger };
