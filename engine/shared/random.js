'use strict';

/**
 * Fronteira ÚNICA de aleatoriedade da `engine/`.
 *
 * A `engine/` é o núcleo determinístico da plataforma: replay, simulação e
 * fingerprint de fluxo exigem que duas execuções do MESMO fluxo produzam o MESMO
 * resultado. Um `Math.random()` lido direto dentro de um nó quebra essa garantia
 * de forma invisível — o defeito só aparece quando se comparam dois replays e o
 * hash divergiu sem causa aparente.
 *
 * Por isso o aleatório entra por INJEÇÃO:
 *
 *   const { setRandomProvider, resetRandomProvider } = require('./random');
 *   setRandomProvider(() => 0.42);   // replay determinístico
 *   ...
 *   resetRandomProvider();           // volta ao comportamento normal
 *
 * O default (produção) continua sendo `Math.random()`. Este arquivo é a fronteira
 * de ambiente explicitamente autorizada em `ioAllowedFiles`
 * (`scripts/governance/validate-layer-conventions.js`) — como `clock.js`, ele não
 * contém regra de negócio, apenas a porta.
 */

let provider = null;

function setRandomProvider(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('setRandomProvider espera uma função ou null');
  }
  provider = fn;
}

function resetRandomProvider() {
  provider = null;
}

function hasInjectedRandom() {
  return provider !== null;
}

/** Float em [0, 1) — mesma semântica de `Math.random()`. */
function random() {
  return provider ? provider() : Math.random();
}

/** Inteiro em [min, max] (inclusive). */
function randomInt(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** `true` com probabilidade `p` (0..1). */
function chance(p) {
  return random() < p;
}

/** Sufixo hexadecimal imprevisível (sem os 2 primeiros dígitos de `Math.random()`). */
function randomHexSuffix() {
  return random().toString(16).slice(2);
}

module.exports = {
  setRandomProvider,
  resetRandomProvider,
  hasInjectedRandom,
  random,
  randomInt,
  chance,
  randomHexSuffix,
};
