'use strict';

/**
 * Testes da seleção de validação por impacto (MISSÃO A / L1).
 *
 * O que este teste protege (o comportamento que faltava no RAP):
 *  - a seleção ENCONTRA testes por fecho transitivo, não só por nome;
 *  - jornadas ligam o arquivo a cenários do mesh (elo real 88/95);
 *  - a vizinhança cobre o que as camadas 1-2 não alcançam;
 *  - FAIL-CLOSED: arquivo de produção não classificado ESCALA o nível em vez de
 *    devolver "nenhum teste afetado" (o defeito do impact-map de 1,13%);
 *  - determinismo.
 */

const { selectValidation, NIVEIS } = require('../../../qa/coverage/impactSelection');
const { buildImportGraph, collectDependents } = require('../../../qa/coverage/impactGraph');

const ARQUIVOS = [
  { path: 'engine/utils.js', source: '' },
  { path: 'engine/executeStep.js', source: "require('./utils');" },
  { path: 'engine/__tests__/executeStep.test.js', source: "require('../executeStep');" },
  { path: 'api/services/queueDefinitionService.js', source: "require('../../engine/executeStep');" },
  { path: 'tests/unit/queueDefinition.test.js', source: "require('../../api/services/queueDefinitionService');" },
  { path: 'api/modules/queue/routes.js', source: '' },
];

const grafo = () => buildImportGraph({ files: ARQUIVOS });

const base = (extra = {}) => ({
  reverse: grafo().reverse,
  collectDependents,
  ...extra,
});

describe('selectValidation — camada transitiva', () => {
  test('seleciona o teste direto do arquivo alterado', () => {
    const r = selectValidation(base({ changedFiles: ['api/services/queueDefinitionService.js'] }));
    expect(r.tests).toContain('tests/unit/queueDefinition.test.js');
    expect(r.level).toBe(NIVEIS.L1);
    expect(r.escalate).toBe(false);
  });

  test('seleciona testes TRANSITIVAMENTE pelo grafo', () => {
    const r = selectValidation(base({ changedFiles: ['engine/utils.js'] }));
    expect(r.tests).toContain('engine/__tests__/executeStep.test.js');
    expect(r.tests).toContain('tests/unit/queueDefinition.test.js');
  });

  test('registra a camada que selecionou cada teste (rastreabilidade)', () => {
    const r = selectValidation(base({ changedFiles: ['engine/utils.js'] }));
    expect(r.layers.transitiva).toContain('tests/unit/queueDefinition.test.js');
  });

  test('alterar um arquivo de teste seleciona esse próprio teste', () => {
    const r = selectValidation(base({ changedFiles: ['tests/unit/queueDefinition.test.js'] }));
    // Forte de propósito: ninguém "importa" um arquivo de teste, então o fecho
    // reverso nunca o traria. A verificação fraca anterior (apenas "não ficou
    // não classificado") deixou passar o defeito de alterar um teste e não
    // executá-lo — medido em 2026-10-14.
    expect(r.tests).toContain('tests/unit/queueDefinition.test.js');
    expect(r.layers.transitiva).toContain('tests/unit/queueDefinition.test.js');
    expect(r.unclassified).toEqual([]);
    expect(r.escalate).toBe(false);
  });

  test('arquivo de teste alterado NÃO arrasta o fecho dos seus imports', () => {
    // Alterar um teste não deve executar a árvore inteira que ele importa:
    // o alvo é o próprio teste.
    const r = selectValidation(base({ changedFiles: ['engine/__tests__/executeStep.test.js'] }));
    expect(r.tests).toEqual(['engine/__tests__/executeStep.test.js']);
  });
});

describe('selectValidation — camada jornada (elo real 88/95)', () => {
  test('liga arquivo a jornada e a cenários do mesh', () => {
    const r = selectValidation(
      base({
        changedFiles: ['api/modules/queue/routes.js'],
        journeysByFile: { 'api/modules/queue/routes.js': ['physical_queue'] },
        scenariosByJourney: { physical_queue: ['mesh-queue-01', 'mesh-queue-02'] },
      })
    );
    expect(r.journeys).toEqual(['physical_queue']);
    expect(r.meshScenarios).toEqual(['mesh-queue-01', 'mesh-queue-02']);
    expect(r.layers.jornada).toEqual(['physical_queue']);
  });

  test('sem jornada o arquivo cai no fail-closed (não é silenciado)', () => {
    const r = selectValidation(
      base({
        changedFiles: ['api/modules/queue/routes.js'],
        journeysByFile: {},
        scenariosByJourney: {},
      })
    );
    // não tem teste que o importe E não tem jornada -> escalou
    expect(r.escalate).toBe(true);
    expect(r.escalateReason).toBe('UNCLASSIFIED_CHANGED_FILES');
    expect(r.unclassified).toContain('api/modules/queue/routes.js');
  });
});

describe('selectValidation — camada vizinhança', () => {
  test('regra de prefixo cobre o arquivo e adiciona os testes declarados', () => {
    const r = selectValidation(
      base({
        changedFiles: ['api/modules/queue/routes.js'],
        neighborhoodRules: [
          { prefix: 'api/modules/queue', tests: ['tests/unit/queueModuleRoutes.test.js'], reason: 'módulo inteiro' },
        ],
      })
    );
    expect(r.tests).toContain('tests/unit/queueModuleRoutes.test.js');
    expect(r.layers.vizinhanca).toContain('tests/unit/queueModuleRoutes.test.js');
    expect(r.escalate).toBe(false);
  });

  test('regra NÃO engole arquivo já classificado pela camada transitiva', () => {
    const r = selectValidation(
      base({
        changedFiles: ['api/services/queueDefinitionService.js'],
        neighborhoodRules: [{ prefix: 'api/services', tests: ['tests/unit/TUDO.test.js'] }],
      })
    );
    expect(r.tests).not.toContain('tests/unit/TUDO.test.js');
  });

  test('prefixo casa apenas em limite de caminho (não em substring)', () => {
    const r = selectValidation(
      base({
        changedFiles: ['api/modules/queue-v2/routes.js'],
        neighborhoodRules: [{ prefix: 'api/modules/queue', tests: ['tests/unit/x.test.js'] }],
      })
    );
    // `queue-v2` NÃO é `queue`
    expect(r.tests).not.toContain('tests/unit/x.test.js');
    expect(r.escalate).toBe(true);
  });
});

describe('selectValidation — FAIL-CLOSED (o comportamento que faltava)', () => {
  test('nenhum arquivo alterado escala para L3 (nunca "nada a fazer")', () => {
    const r = selectValidation(base({ changedFiles: [] }));
    expect(r.escalate).toBe(true);
    expect(r.escalateReason).toBe('NO_CHANGED_FILES');
    expect(r.level).toBe(NIVEIS.L3);
  });

  test('arquivo sem teste e sem jornada ESCALA em vez de silenciar', () => {
    const r = selectValidation(base({ changedFiles: ['api/services/orfaoService.js'] }));
    expect(r.escalate).toBe(true);
    expect(r.escalateReason).toBe('UNCLASSIFIED_CHANGED_FILES');
    expect(r.unclassified).toEqual(['api/services/orfaoService.js']);
    expect(r.tests).toEqual([]);
  });

  test('seleção insuficiente (alvo testado mas abaixo do mínimo) escala', () => {
    // `queueDefinitionService.js` TEM teste (1), mas exigimos 5: falta de
    // cobertura é motivo distinto de "não classificado".
    const r = selectValidation(
      base({ changedFiles: ['api/services/queueDefinitionService.js'], minTestsForL1: 5 })
    );
    expect(r.escalate).toBe(true);
    expect(r.escalateReason).toBe('INSUFFICIENT_SELECTION');
    expect(r.unclassified).toEqual([]);
  });

  test('a decisão NUNCA é "nenhum teste" com escalate=false para arquivo de produção', () => {
    const casos = [
      ['api/services/orfaoService.js'],
      ['desconhecido/arquivo.js'],
      ['api/modules/queue/routes.js'],
    ];
    for (const changedFiles of casos) {
      const r = selectValidation(base({ changedFiles }));
      if (r.tests.length === 0) {
        expect(r.escalate).toBe(true);
      }
    }
  });
});

describe('selectValidation — determinismo e contrato', () => {
  test('mesma entrada produz decisão idêntica', () => {
    const entrada = base({ changedFiles: ['engine/utils.js', 'api/services/queueDefinitionService.js'] });
    const a = selectValidation(entrada);
    const b = selectValidation(entrada);
    expect({ ...a, generatedAt: undefined }).toEqual({ ...b, generatedAt: undefined });
  });

  test('ordem dos arquivos alterados não muda a seleção', () => {
    const a = selectValidation(base({ changedFiles: ['engine/utils.js', 'api/modules/queue/routes.js'] }));
    const b = selectValidation(base({ changedFiles: ['api/modules/queue/routes.js', 'engine/utils.js'] }));
    expect({ ...a, generatedAt: undefined }).toEqual({ ...b, generatedAt: undefined });
  });

  test('exige collectDependents injetado (falha explícita, nunca silenciosa)', () => {
    expect(() => selectValidation({ changedFiles: ['x.js'] })).toThrow(/collectDependents/);
  });

  test('usa o relógio injetado quando fornecido', () => {
    const r = selectValidation(base({ changedFiles: ['engine/utils.js'], nowMs: () => 1234567890 }));
    expect(r.generatedAt).toBe(1234567890);
  });

  test('deduplica arquivos alterados repetidos', () => {
    const r = selectValidation(base({ changedFiles: ['engine/utils.js', './engine/utils.js'] }));
    expect(r.changedFiles).toEqual(['engine/utils.js']);
  });
});
