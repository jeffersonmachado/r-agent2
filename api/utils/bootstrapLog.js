'use strict';

/**
 * bootstrapLog — log de BOOTSTRAP sem dependências.
 *
 * Por que existe: `api/utils/logger` depende de `api/utils/config` (lê o nível de
 * log da configuração). Módulos que a PRÓPRIA cadeia de configuração usa — ou
 * seja, `api/utils/config` — não podem depender do logger sem criar um ciclo de
 * `require`, e a saída alternativa era `console.*` direto, que a política de
 * camadas proíbe dentro de `api/` (use `api/utils/logger`).
 *
 * Este módulo fecha essa lacuna com ZERO dependências: escreve em stdout/stderr
 * pelo mesmo canal do console, sem formatar e sem consultar configuração (o que
 * seria impossível antes de a configuração existir). Ele não substitui o logger
 * em código de aplicação — quem pode usar `api/utils/logger`, usa.
 *
 * Níveis expostos: info, warn, error, debug.
 */

function write(stream, args) {
  const line = args
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.stack || value.message;
      try {
        return JSON.stringify(value);
      } catch (_) {
        return String(value);
      }
    })
    .join(' ');
  stream.write(`${line}\n`);
}

const bootstrapLog = {
  info(...args) {
    write(process.stdout, args);
  },
  warn(...args) {
    write(process.stderr, args);
  },
  error(...args) {
    write(process.stderr, args);
  },
  debug(...args) {
    if (process.env.LOG_LEVEL === 'DEBUG' || process.env.LOG_LEVEL === 'debug') {
      write(process.stdout, args);
    }
  },
};

module.exports = bootstrapLog;
