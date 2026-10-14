'use strict';

/**
 * Testes do grafo de impacto por imports (MISSÃO A / L1).
 *
 * O que este teste protege:
 *  - extração de specs cobre require/import/export-from/dynamic-import;
 *  - a resolução relativa é determinística e cobre extensões e index;
 *  - o fecho transitivo reverso ENCONTRA os testes que dependem de um alvo
 *    (que é o objetivo de negócio: selecionar o que reexecutar);
 *  - alvo sem teste alcançável é reportado como tal (entrada do fail-closed);
 *  - ciclos não travam nem explodem;
 *  - determinismo: dois grafos iguais produzem seleções idênticas.
 */

const {
  isTestFile,
  normalizar,
  extractImportSpecs,
  buildImportGraph,
  collectDependents,
} = require('../../../qa/coverage/impactGraph');

describe('impactGraph — reconhecimento de teste', () => {
  test('identifica arquivos de teste por convenção', () => {
    expect(isTestFile('tests/unit/foo.test.js')).toBe(true);
    expect(isTestFile('frontend/src/__tests__/bar.test.jsx')).toBe(true);
    expect(isTestFile('engine/__tests__/baz.test.js')).toBe(true);
    expect(isTestFile('api/modules/queue/service.js')).toBe(false);
    expect(isTestFile('')).toBe(false);
    expect(isTestFile(null)).toBe(false);
  });
});

describe('impactGraph — extração de imports', () => {
  test('cobre require, import default, named, export-from e import dinâmico', () => {
    const fonte = [
      "const a = require('./a');",
      "import b from './b';",
      "import { c } from './c';",
      "import * as d from './d';",
      "export { e } from './e';",
      "const f = await import('./f');",
      "const pacote = require('express');",
    ].join('\n');

    const specs = extractImportSpecs(fonte);
    expect(specs).toEqual(['./a', './b', './c', './d', './e', './f', 'express']);
  });

  test('não duplica specs repetidos e preserva a ordem de aparição', () => {
    const specs = extractImportSpecs("require('./x');\nrequire('./x');\nrequire('./y');");
    expect(specs).toEqual(['./x', './y']);
  });

  test('fonte vazia ou sem imports devolve lista vazia', () => {
    expect(extractImportSpecs('')).toEqual([]);
    expect(extractImportSpecs('const x = 1;')).toEqual([]);
  });

  test('não confunde string solta com import', () => {
    // `from` dentro de texto não deve capturar o valor errado
    expect(extractImportSpecs("const msg = 'carregado from './fake'';")).toEqual([]);
  });
});

describe('impactGraph — construção do grafo', () => {
  const arquivos = [
    { path: 'engine/utils.js', source: "module.exports = { x: 1 };" },
    { path: 'engine/executeStep.js', source: "const u = require('./utils');\nmodule.exports = u;" },
    { path: 'engine/__tests__/executeStep.test.js', source: "const s = require('../executeStep');" },
    { path: 'api/services/queueService.js', source: "const e = require('../../engine/executeStep');" },
    { path: 'tests/unit/queue.test.js', source: "const q = require('../../api/services/queueService');" },
  ];

  test('resolve imports relativos para caminhos canônicos', () => {
    const g = buildImportGraph({ files: arquivos });
    expect(g.edges['engine/executeStep.js']).toEqual(['engine/utils.js']);
    expect(g.edges['engine/__tests__/executeStep.test.js']).toEqual(['engine/executeStep.js']);
    expect(g.edges['api/services/queueService.js']).toEqual(['engine/executeStep.js']);
    expect(g.edges['tests/unit/queue.test.js']).toEqual(['api/services/queueService.js']);
  });

  test('ignora pacotes npm e assets inexistentes', () => {
    const g = buildImportGraph({
      files: [
        { path: 'a.js', source: "require('express');\nrequire('./nao-existe');\nrequire('./b');" },
        { path: 'b.js', source: '' },
      ],
    });
    expect(g.edges['a.js']).toEqual(['b.js']);
  });

  test('o grafo reverso aponta quem importa cada nó', () => {
    const g = buildImportGraph({ files: arquivos });
    expect(g.reverse['engine/utils.js']).toEqual(['engine/executeStep.js']);
    expect(g.reverse['engine/executeStep.js']).toEqual([
      'api/services/queueService.js',
      'engine/__tests__/executeStep.test.js',
    ]);
  });

  test('a lista de nós é estável e ordenada', () => {
    const g = buildImportGraph({ files: [...arquivos].reverse() });
    expect(g.nodes).toEqual([...g.nodes].sort());
  });
});

describe('impactGraph — fecho transitivo reverso (objetivo de negócio)', () => {
  const arquivos = [
    { path: 'engine/utils.js', source: '' },
    { path: 'engine/executeStep.js', source: "require('./utils');" },
    { path: 'engine/__tests__/utils.test.js', source: "require('../utils');" },
    { path: 'engine/__tests__/executeStep.test.js', source: "require('../executeStep');" },
    { path: 'api/services/queueService.js', source: "require('../../engine/executeStep');" },
    { path: 'tests/unit/queue.test.js', source: "require('../../api/services/queueService');" },
    { path: 'tests/unit/isolado.test.js', source: '' },
  ];

  test('alcança os testes que dependem DIRETAMENTE do alvo', () => {
    const g = buildImportGraph({ files: arquivos });
    const r = collectDependents({ reverse: g.reverse, targets: ['engine/utils.js'] });
    expect(r.tests).toContain('engine/__tests__/utils.test.js');
  });

  test('alcança testes TRANSITIVAMENTE (o caso que o mapa direto perdia)', () => {
    const g = buildImportGraph({ files: arquivos });
    const r = collectDependents({ reverse: g.reverse, targets: ['engine/utils.js'] });
    // executeStep.test importa executeStep, que importa utils
    expect(r.tests).toContain('engine/__tests__/executeStep.test.js');
    // queue.test importa queueService -> executeStep -> utils
    expect(r.tests).toContain('tests/unit/queue.test.js');
  });

  test('não inclui testes que não dependem do alvo', () => {
    const g = buildImportGraph({ files: arquivos });
    const r = collectDependents({ reverse: g.reverse, targets: ['engine/utils.js'] });
    expect(r.tests).not.toContain('tests/unit/isolado.test.js');
  });

  test('alvo sem nenhum teste alcançável devolve lista vazia (entrada do fail-closed)', () => {
    const g = buildImportGraph({ files: arquivos });
    const r = collectDependents({ reverse: g.reverse, targets: ['engine/__tests__/utils.test.js'] });
    expect(r.tests).toEqual([]);
  });

  test('o próprio alvo de teste não se auto-seleciona como dependente', () => {
    const g = buildImportGraph({ files: arquivos });
    const r = collectDependents({ reverse: g.reverse, targets: ['engine/__tests__/utils.test.js'] });
    expect(r.dependents).not.toContain('engine/__tests__/utils.test.js');
  });

  test('ciclos não travam o fecho', () => {
    const g = buildImportGraph({
      files: [
        { path: 'a.js', source: "require('./b');" },
        { path: 'b.js', source: "require('./a');" },
        { path: 'tests/ciclo.test.js', source: "require('../a');" },
      ],
    });
    const r = collectDependents({ reverse: g.reverse, targets: ['a.js'] });
    expect(r.tests).toEqual(['tests/ciclo.test.js']);
    // `dependents` é o impacto TOTAL (inclui testes); `tests` é o subconjunto
    // executável. O alvo (`a.js`) nunca aparece entre os dependentes.
    expect(r.dependents).toEqual(['b.js', 'tests/ciclo.test.js']);
    expect(r.dependents).not.toContain('a.js');
  });

  test('determinismo: mesma entrada produz exatamente a mesma saída', () => {
    const g1 = buildImportGraph({ files: arquivos });
    const g2 = buildImportGraph({ files: [...arquivos].reverse() });
    const r1 = collectDependents({ reverse: g1.reverse, targets: ['engine/utils.js'] });
    const r2 = collectDependents({ reverse: g2.reverse, targets: ['engine/utils.js'] });
    expect(r1).toEqual(r2);
  });

  test('múltiplos alvos são unidos sem duplicar testes', () => {
    const g = buildImportGraph({ files: arquivos });
    const r = collectDependents({
      reverse: g.reverse,
      targets: ['engine/utils.js', 'engine/executeStep.js'],
    });
    expect(r.tests).toEqual([...new Set(r.tests)].sort());
    expect(r.tests).toContain('tests/unit/queue.test.js');
  });
});

describe('impactGraph — normalização de caminho', () => {
  test('remove prefixo ./, normaliza separadores e resolve ..', () => {
    expect(normalizar('./api/x.js')).toBe('api/x.js');
    expect(normalizar('api\\x.js')).toBe('api/x.js');
    expect(normalizar('api/modules/../services/x.js')).toBe('api/services/x.js');
  });
});
