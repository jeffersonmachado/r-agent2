'use strict';

/**
 * Fronteira ÚNICA de temporização da `engine/`.
 *
 * Timers são efeito de ambiente (`setTimeout`/`setInterval`): deixam execução
 * pendente depois do fim do fluxo, criam flakiness em teste e impedem replay
 * determinístico de nós com retry/backoff. A `engine/` declara a espera como
 * dependência injetável:
 *
 *   const { setSchedulerProvider, resetSchedulerProvider } = require('./scheduler');
 *   setSchedulerProvider({ setTimeout: (fn) => { fn(); return 0; } });  // sem espera real
 *   ...
 *   resetSchedulerProvider();
 *
 * Regras de uso: o valor de retorno (handle) deve ser propagado para outro
 * `scheduler.clearTimeout(...)` injetado quando o fluxo cancela a espera.
 *
 * O default (produção) é o timer global. Este arquivo é a fronteira de ambiente
 * explicitamente autorizada em `ioAllowedFiles`
 * (`scripts/governance/validate-layer-conventions.js`): contém a porta, não regra
 * de negócio.
 */

let provider = null;

function setSchedulerProvider(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('setSchedulerProvider espera uma função (factory) ou null');
  }
  provider = fn;
}

function resetSchedulerProvider() {
  provider = null;
}

function hasInjectedScheduler() {
  return provider !== null;
}

/**
 * Default = timer REAL do runtime. Usa `globalThis` de propósito: as funções
 * exportadas abaixo se chamam `setTimeout`/`setInterval`, então referenciá-las
 * diretamente aqui seria **auto-referência** (o wrapper chamaria a si mesmo =
 * recursão infinita). `globalThis` desambigua.
 */
const DEFAULT_SCHEDULER = Object.freeze({
  setTimeout: (...args) => globalThis.setTimeout(...args),
  clearTimeout: (...args) => globalThis.clearTimeout(...args),
  setInterval: (...args) => globalThis.setInterval(...args),
  clearInterval: (...args) => globalThis.clearInterval(...args),
});

function getScheduler() {
  return provider ? provider() : DEFAULT_SCHEDULER;
}

function setTimeout(fn, ms, ...args) {
  return getScheduler().setTimeout(fn, ms, ...args);
}

function clearTimeout(handle) {
  return getScheduler().clearTimeout(handle);
}

function setInterval(fn, ms, ...args) {
  return getScheduler().setInterval(fn, ms, ...args);
}

function clearInterval(handle) {
  return getScheduler().clearInterval(handle);
}

module.exports = {
  setSchedulerProvider,
  resetSchedulerProvider,
  hasInjectedScheduler,
  getScheduler,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
