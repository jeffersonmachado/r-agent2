'use strict';

/**
 * Guarda de fonte única do catálogo de tools do copiloto (A2) — teste de
 * NÃO-VACUIDADE.
 *
 * Um invariante que nunca pode falhar não é um invariante. Este teste prova,
 * com um diretório-fixture real, que o scanner DETECTA uma definição paralela
 * (id canônico ou capability literal) e que o diretório REAL do copiloto está
 * limpo (o catálogo é a única definição).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CATALOG_FILE,
  findParallelToolDeclarations,
} = require('../../scripts/governance/ask-ai-tool-source-guard');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_DIR = path.join(REPO_ROOT, 'api', 'services', 'askAi');

function writeFixtureFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

describe('guarda do catálogo de tools — detecção de registry paralelo', () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-tool-guard-'));
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test('detecta um id canônico declarado fora do catálogo', () => {
    writeFixtureFile(fixtureDir, 'clean.js', "'use strict';\nmodule.exports = { ok: true };\n");
    writeFixtureFile(
      fixtureDir,
      'parallelRegistry.js',
      "'use strict';\nconst TOOLS = [{ id: 'askai.shadow.tool', capability: 'x' }];\nmodule.exports = { TOOLS };\n",
    );

    expect(findParallelToolDeclarations(fixtureDir)).toEqual(['parallelRegistry.js']);
  });

  test('detecta uma capability literal declarada fora do catálogo', () => {
    writeFixtureFile(
      fixtureDir,
      'localTable.js',
      "'use strict';\nmodule.exports = [{ label: 'x', capability: 'crm.read' }];\n",
    );

    expect(findParallelToolDeclarations(fixtureDir)).toEqual(['localTable.js']);
  });

  test('o próprio catálogo é excluído da varredura', () => {
    writeFixtureFile(
      fixtureDir,
      CATALOG_FILE,
      "'use strict';\nmodule.exports = [{ id: 'askai.canonical.tool', capability: 'crm.read' }];\n",
    );

    expect(findParallelToolDeclarations(fixtureDir)).toEqual([]);
  });

  test('não confunde referências (`toolId:`, `capability: tool.capability`) com declaração', () => {
    writeFixtureFile(
      fixtureDir,
      'projection.js',
      [
        "'use strict';",
        'function build(tool) {',
        "  return { id: tool.id, canonicalId: tool.id, capability: tool.capability, toolId: 'askai.x' };",
        '}',
        'module.exports = { build };',
        '',
      ].join('\n'),
    );

    expect(findParallelToolDeclarations(fixtureDir)).toEqual([]);
  });

  test('o diretório REAL do copiloto tem o catálogo como única definição', () => {
    expect(findParallelToolDeclarations(REAL_DIR)).toEqual([]);
  });
});
