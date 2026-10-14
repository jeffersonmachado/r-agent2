'use strict';

/**
 * Fronteira ÚNICA de ambiente de processo da `engine/`.
 *
 * A engine resolvia caminhos com `process.cwd()` **no topo do módulo** e lia flags
 * com `process.env` direto. Isso produz dois defeitos reais:
 *
 *  1. `path.resolve(process.cwd(), 'prompts/…')` é avaliado no `require`, então o
 *     caminho fica congelado no primeiro carregamento — mudar de diretório de
 *     trabalho (teste, CLI, simulação) não tem efeito e o valor vaza de um teste
 *     para outro como estado global.
 *  2. Flag de ambiente lida no meio de uma execução impede replay determinístico
 *     (o mesmo fluxo se comporta diferente conforme o env do processo).
 *
 * Por isso o ambiente entra por INJEÇÃO:
 *
 *   const { setRuntimeEnvProvider, resetRuntimeEnvProvider } = require('./runtimeEnv');
 *   setRuntimeEnvProvider(() => ({ cwd: () => '/tmp/proj', getEnv: () => undefined }));
 *   ...
 *   resetRuntimeEnvProvider();
 *
 * O default (produção) é o processo real. Este arquivo é a fronteira de ambiente
 * explicitamente autorizada em `ioAllowedFiles`
 * (`scripts/governance/validate-layer-conventions.js`): contém a porta, não regra
 * de negócio.
 */

let provider = null;

const DEFAULT_ENV = Object.freeze({
  cwd: () => process.cwd(),
  getEnv: (name) => process.env[name],
});

function setRuntimeEnvProvider(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('setRuntimeEnvProvider espera uma função (factory) ou null');
  }
  provider = fn;
}

function resetRuntimeEnvProvider() {
  provider = null;
}

function hasInjectedRuntimeEnv() {
  return provider !== null;
}

function getRuntimeEnv() {
  return provider ? provider() : DEFAULT_ENV;
}

/** Diretório de trabalho efetivo (resolvido NA CHAMADA, nunca no `require`). */
function cwd() {
  return getRuntimeEnv().cwd();
}

/** Valor de variável de ambiente (string) ou `undefined`. */
function getEnv(name) {
  return getRuntimeEnv().getEnv(name);
}

/**
 * `true` a menos que a variável valha exatamente `'false'`.
 * Mesma semântica do `process.env.X !== 'false'` original.
 */
function isEnabledByDefault(name) {
  return getEnv(name) !== 'false';
}

/** Caminho absoluto a partir do diretório de trabalho efetivo. */
function resolveFromCwd(...parts) {
  return require('path').resolve(cwd(), ...parts);
}

module.exports = {
  setRuntimeEnvProvider,
  resetRuntimeEnvProvider,
  hasInjectedRuntimeEnv,
  getRuntimeEnv,
  cwd,
  getEnv,
  isEnabledByDefault,
  resolveFromCwd,
};
