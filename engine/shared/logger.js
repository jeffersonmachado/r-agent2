'use strict';

/**
 * Fronteira ÚNICA de log da `engine/`.
 *
 * A `engine/` não deve escrever direto em `console`: quem observa a plataforma é a
 * camada de aplicação (`api/utils/logger`), com nível, correlação e destino
 * próprios. Um `console.log` dentro de um nó também polui a saída de replay e
 * quebra testes que afirmam sobre stdout.
 *
 * Por isso o log entra por INJEÇÃO, preservando a assinatura `(msg, data)`:
 *
 *   const { setLoggerProvider, resetLoggerProvider } = require('./logger');
 *   setLoggerProvider(() => loggerDoChamador);
 *   ...
 *   resetLoggerProvider();   // volta ao `console`
 *
 * O default (produção) é `console`, exatamente o comportamento anterior. Este
 * arquivo é a fronteira de ambiente explicitamente autorizada em
 * `ioAllowedFiles` (`scripts/governance/validate-layer-conventions.js`): contém a
 * porta, não regra de negócio.
 */

let provider = null;

function setLoggerProvider(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('setLoggerProvider espera uma função ou null');
  }
  provider = fn;
}

function resetLoggerProvider() {
  provider = null;
}

function hasInjectedLogger() {
  return provider !== null;
}

/** Logger atual (injetado ou `console`). */
function getLogger() {
  return provider ? provider() : console;
}

function info(msg, data) {
  getLogger().log(msg, data);
}

function warn(msg, data) {
  getLogger().warn(msg, data);
}

function error(msg, data) {
  getLogger().error(msg, data);
}

function debug(msg, data) {
  getLogger().debug(msg, data);
}

module.exports = {
  setLoggerProvider,
  resetLoggerProvider,
  hasInjectedLogger,
  getLogger,
  info,
  warn,
  error,
  debug,
};
