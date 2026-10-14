'use strict';

/**
 * Fronteira ÚNICA de leitura de arquivo da `engine/`.
 *
 * Quatro pontos da engine precisam ler JSON/prompt do disco (whitelist de ações,
 * catálogo de capacidades, prompts do flow generator, planos de execução). Ler
 * `fs` direto dentro do módulo de domínio torna a função impossível de testar sem
 * tocar o disco real e amarra o determinismo do replay ao conteúdo do filesystem.
 *
 * Por isso a leitura entra por INJEÇÃO:
 *
 *   const { setFileReaderProvider, resetFileReaderProvider } = require('./fileSystem');
 *   setFileReaderProvider(() => ({
 *     readFileSync: () => '{"allowed":["noop"]}',
 *   }));
 *   ...
 *   resetFileReaderProvider();
 *
 * O default (produção) é `fs` real — mesmo comportamento anterior. NÃO há escrita
 * aqui: a engine lê configuração, nunca muta o ambiente.
 *
 * Este arquivo é a fronteira de ambiente explicitamente autorizada em
 * `ioAllowedFiles` (`scripts/governance/validate-layer-conventions.js`): contém a
 * porta, não regra de negócio.
 */

const fs = require('fs');

let provider = null;

function setFileReaderProvider(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('setFileReaderProvider espera uma função (factory) ou null');
  }
  provider = fn;
}

function resetFileReaderProvider() {
  provider = null;
}

function hasInjectedFileReader() {
  return provider !== null;
}

function getFileReader() {
  return provider ? provider() : fs;
}

/** Conteúdo de texto do arquivo (síncrono, como os call sites originais). */
function readFileSync(absPath, encoding) {
  return getFileReader().readFileSync(absPath, encoding || 'utf8');
}

/** JSON parseado do arquivo. Propaga o erro de parse (não engole). */
function readJsonSync(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

function existsSync(absPath) {
  return getFileReader().existsSync(absPath);
}

module.exports = {
  setFileReaderProvider,
  resetFileReaderProvider,
  hasInjectedFileReader,
  getFileReader,
  readFileSync,
  readJsonSync,
  existsSync,
};
