'use strict';

/**
 * Guarda de FONTE ÚNICA do conteúdo indexável do RAG.
 *
 * O placeholder de "sem texto extraído" é a marca de um documento que NÃO tem
 * conteúdo para embeddar. Ele pode ser PRODUZIDO (scraping, upload) mas a regra
 * de "isto não é conteúdo" vive só em `api/services/rag/indexableContent.js`.
 *
 * POR QUE EXISTE: em 2026-10-08 o literal estava duplicado — a ingestão gravava
 * o placeholder como conteúdo e o indexador o aceitava como texto válido. Com
 * duas cópias, corrigir um caminho deixava o defeito entrar pelo outro. Este
 * scanner é a parte determinística e testável da invariante: qualquer outro
 * módulo de `api/` que declare o texto à mão reprova.
 *
 * Extraído do validador para poder ser exercitado com fixture real — uma
 * invariante precisa ser capaz de FALHAR.
 */

const fs = require('fs');
const path = require('path');

/** Único arquivo autorizado a DECLARAR a frase do placeholder. */
const AUTHORIZED_FILE = path.join('api', 'services', 'rag', 'indexableContent.js');

/**
 * Frase do placeholder de "sem texto extraído" (upload e site).
 *
 * A regra mira a FRASE COMPLETA ("sem texto extraído … indexando metadados"),
 * não o radical: mensagens/comentários que apenas citam "sem texto extraído"
 * para EXPLICAR a regra são legítimos e não podem reprovar o gate.
 */
const PLACEHOLDER_LITERAL = /sem texto extra[ií]do\.?\s*indexando metadados/i;

const SCAN_ROOT = 'api';
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'data']);

function listJsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listJsFiles(path.join(dir, entry.name), acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) acc.push(path.join(dir, entry.name));
  }
  return acc;
}

/**
 * Módulos que declararam o literal do placeholder fora do módulo autorizado.
 *
 * @param {string} rootDir raiz do repositório
 * @returns {string[]} caminhos relativos (ordenados) em conflito
 */
function findDuplicatedPlaceholderLiterals(rootDir) {
  const scanRoot = path.join(rootDir, SCAN_ROOT);
  if (!fs.existsSync(scanRoot)) return [];
  const authorized = path.join(rootDir, AUTHORIZED_FILE);

  const offenders = [];
  for (const file of listJsFiles(scanRoot)) {
    if (path.resolve(file) === path.resolve(authorized)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (PLACEHOLDER_LITERAL.test(source)) {
      offenders.push(path.relative(rootDir, file).split(path.sep).join('/'));
    }
  }
  return offenders.sort();
}

module.exports = {
  AUTHORIZED_FILE,
  PLACEHOLDER_LITERAL,
  findDuplicatedPlaceholderLiterals,
};
