'use strict';

/**
 * Aceite da missão de correção de dependência — dois requisitos que este teste fixa:
 *
 * 1. O aceite precisa CABER no deadline de um comando de teste do Runner (política
 *    `INTEGRATION_TEST` = **120 s**). Medido em 2026-10-09: `npm run test:unit` leva ~9 min, então
 *    exigi-la tornava o aceite insatisfazível no workspace isolado — missões com patch VÁLIDO
 *    morriam em TESTING, a árvore limpa também reprovava, e o histórico era 1 GREEN em 75
 *    aprovações. O que passa a valer: prova MECÂNICA do alvo aplicado + um comando funcional
 *    rápido (`npm run test:flow`: 30 suítes / 264 testes / 40 s no workspace isolado).
 *
 * 2. A suíte completa e os gates de SELO continuam obrigatórios no pipeline de release
 *    (`validate:governance-enforcement`, `npm run test:unit` do humano/CI) — este teste garante
 *    que a missão NÃO os substitui nem os declara cumpridos.
 */

const { buildPatchMissionSpec, dependencyResolutionCommand } = require('../../../engine/securityIntel/patchPlanner');

const plano = (extra = {}) => ({
  advisoryId: 'GHSA-hrr3-gc8f-f4qj',
  packageName: 'fast-uri',
  currentVersion: '3.1.0',
  targetVersion: '3.1.8',
  kind: 'TRANSITIVE_OVERRIDE',
  updateRisk: 'PATCH',
  autonomy: 'LEVEL_B_ISOLATED',
  severity: 'HIGH',
  preconditions: ['executar a suíte do serviço consumidor'],
  service: 'api',
  ...extra,
});

describe('aceite da correção de dependência — cabe no deadline e prova o alvo', () => {
  it('NÃO usa a suíte completa como aceite (9 min > deadline de 120 s por comando)', () => {
    const { options } = buildPatchMissionSpec({ plan: plano() });
    expect(options.testCommands).not.toContain('npm run test:unit');
    // Toda suíte de unidade do repositório é proibida como comando de aceite.
    for (const cmd of options.testCommands) {
      expect(cmd).not.toMatch(/jest\s+tests\/unit\s*$|test:unit$/);
    }
  });

  it('inclui a prova MECÂNICA de versão (o alvo aplicado), antes do comando funcional', () => {
    const { options } = buildPatchMissionSpec({ plan: plano() });
    expect(options.testCommands[0]).toContain('fast-uri');
    expect(options.testCommands[0]).toContain('3.1.8');
    expect(options.testCommands[0]).toContain('require("fast-uri/package.json")');
    // O comando falha quando a versão instalada é MENOR que o alvo.
    expect(options.testCommands[0]).toContain('process.exit(1)');
    expect(options.testCommands[0]).toContain('ALVO NAO APLICADO');
  });

  it('PyPI usa importlib do venv do serviço', () => {
    const cmd = dependencyResolutionCommand(plano({ service: 'rag-service', packageName: 'transformers', targetVersion: '5.10.0' }));
    expect(cmd).toContain('./venv/bin/python');
    expect(cmd).toContain('importlib.metadata');
    expect(cmd).toContain("'transformers'");
    expect(cmd).toContain("Version('5.10.0')");
  });

  it('sem alvo não inventa prova (devolve null, nada de comando vazio)', () => {
    expect(dependencyResolutionCommand(plano({ targetVersion: null }))).toBeNull();
    expect(dependencyResolutionCommand(plano({ packageName: '' }))).toBeNull();
    const { options } = buildPatchMissionSpec({ plan: plano({ targetVersion: null }) });
    expect(options.testCommands).not.toContain(null);
    expect(options.testCommands.length).toBeGreaterThan(0);
  });

  it('o comando funcional é o núcleo determinístico, não a suíte do serviço', () => {
    const api = buildPatchMissionSpec({ plan: plano() }).options.testCommands;
    expect(api).toContain('npm run test:flow');
  });

  it('o texto da missão declara o aceite EXATO que vai rodar', () => {
    const { mission, options } = buildPatchMissionSpec({ plan: plano() });
    expect(mission).toContain('Aceite executado por comando');
    for (const cmd of options.testCommands) {
      expect(mission).toContain(cmd);
    }
  });

  it('o critério declara que os gates de selo são do pipeline, não da missão', () => {
    const { options } = buildPatchMissionSpec({ plan: plano() });
    const criterios = options.acceptanceCriteria.join(' | ');
    expect(criterios).toContain('versão >= 3.1.8');
    expect(criterios).toMatch(/pipeline de release/);
    expect(criterios).not.toContain('suíte do serviço consumidor verde');
  });
});
