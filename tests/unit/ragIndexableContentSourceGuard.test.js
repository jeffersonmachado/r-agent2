'use strict';

/**
 * Não-vacuidade da guarda de FONTE ÚNICA do placeholder de "sem texto extraído".
 *
 * Se o scanner não fosse capaz de REPROVAR, ele seria decorativo: em 2026-10-08
 * o literal estava duplicado (ingestão gravava, indexador aceitava) e nada
 * apontava isso. Aqui: fixture hostil reprova, árvore real do repositório passa.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findDuplicatedPlaceholderLiterals,
} = require('../../scripts/governance/rag-indexable-content-guard');

const ROOT = path.resolve(__dirname, '..', '..');

function buildFixtureRepo({ withDuplication }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-indexable-guard-'));
  const authorizedDir = path.join(dir, 'api', 'services', 'rag');
  fs.mkdirSync(authorizedDir, { recursive: true });
  // O módulo autorizado SEMPRE contém o literal — e não pode ser acusado.
  fs.writeFileSync(
    path.join(authorizedDir, 'indexableContent.js'),
    "const NO_TEXT_PLACEHOLDER = 'Sem texto extraído. Indexando metadados do arquivo.';\nmodule.exports = { NO_TEXT_PLACEHOLDER };\n",
  );

  if (withDuplication) {
    const moduleDir = path.join(dir, 'api', 'modules', 'rag-documents');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'parallelPlaceholder.js'),
      "const finalText = extractedText || 'Sem texto extraído. Indexando metadados do arquivo.';\n",
    );
  }

  return dir;
}

describe('rag-indexable-content-guard', () => {
  test('fixture com literal paralelo REPROVA', () => {
    const dir = buildFixtureRepo({ withDuplication: true });
    try {
      const offenders = findDuplicatedPlaceholderLiterals(dir);
      expect(offenders).toEqual(['api/modules/rag-documents/parallelPlaceholder.js']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fixture só com o módulo autorizado PASSA', () => {
    const dir = buildFixtureRepo({ withDuplication: false });
    try {
      expect(findDuplicatedPlaceholderLiterals(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a árvore REAL do repositório está limpa (fonte única)', () => {
    expect(findDuplicatedPlaceholderLiterals(ROOT)).toEqual([]);
  });
});
