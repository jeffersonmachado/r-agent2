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

  test('toda seleção declara changedFiles (inclusive zero) — contrato uniforme', () => {
    // Regressão do crash medido no CI (2026-10-21): o ramo de zero arquivos não devolvia
    // `changedFiles` e `run-impact-validation` quebrava em `selecao.changedFiles.length`,
    // deixando `reports/impact-validation-report.json` AUSENTE.
    const vazia = selectValidation(base({ changedFiles: [] }));
    expect(Array.isArray(vazia.changedFiles)).toBe(true);
    expect(vazia.changedFiles).toHaveLength(0);

    const comArquivos = selectValidation(base({ changedFiles: ['api/modules/queue-v2/routes.js'] }));
    expect(Array.isArray(comArquivos.changedFiles)).toBe(true);
    expect(comArquivos.changedFiles.length).toBeGreaterThan(0);
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

// ── P0-5 (medido 2026-10-16): DEPENDENTES NÃO SÃO COBERTURA ─────────────────────
//
// Defeito: a camada transitiva classificava o arquivo alterado quando `reverse[n]`
// tinha QUALQUER entrada. Um serviço de produção importado só por outro arquivo de
// produção (que nenhum teste alcança) era dado como coberto — e, se OUTRO alvo da
// mesma alteração produzisse testes, a seleção ficava não-vazia, o nível ficava L1 e
// o run saía `L1 GREEN` com esse arquivo exercitado por NADA. Ter dependentes não é
// ter testes: a classificação agora exige fecho reverso alcançando ≥1 teste.
describe('selectValidation — P0-5: dependentes NÃO são prova de cobertura', () => {
  // Fixture própria (não mexe no grafo dos outros testes): uma cadeia COM teste
  // alcançável e outra SEM — a segunda é o caso do falso verde.
  const FONTES = [
    { path: 'engine/utils.js', source: '' },
    { path: 'engine/executeStep.js', source: "require('./utils');" },
    { path: 'engine/__tests__/executeStep.test.js', source: "require('../executeStep');" },
    { path: 'api/services/orphanService.js', source: '' },
    { path: 'api/modules/orphan/routes.js', source: "require('../../services/orphanService');" },
  ];
  const g = buildImportGraph({ files: FONTES });
  const sel = (changedFiles) => selectValidation({ reverse: g.reverse, collectDependents, changedFiles });

  test('o dependente de produção existe no grafo (a premissa do defeito é real)', () => {
    expect(g.reverse['api/services/orphanService.js']).toEqual(['api/modules/orphan/routes.js']);
    // E nenhum teste alcança esse arquivo: o fecho reverso a partir dele é vazio.
    expect(collectDependents({ reverse: g.reverse, targets: ['api/services/orphanService.js'] }).tests).toEqual([]);
  });

  test('arquivo com dependentes mas SEM teste alcançável NÃO é dado como coberto', () => {
    const r = sel(['api/services/orphanService.js']);
    expect(r.escalate).toBe(true);
    expect(r.escalateReason).toBe('UNCLASSIFIED_CHANGED_FILES');
    expect(r.unclassified).toContain('api/services/orphanService.js');
    expect(r.tests).toEqual([]);
    expect(r.level).toBe(NIVEIS.L2);
  });

  test('o FALSO VERDE medido: um alvo COM teste não esconde o alvo SEM cobertura', () => {
    // Antes: `tests` não-vazio (por engine/utils.js) + orphanService "classificado"
    // ⇒ `escalate=false` e `L1 GREEN`, com orphanService coberto por nada.
    const r = sel(['api/services/orphanService.js', 'engine/utils.js']);
    expect(r.tests.length).toBeGreaterThan(0);
    expect(r.escalate).toBe(true);
    expect(r.escalateReason).toBe('UNCLASSIFIED_CHANGED_FILES');
    expect(r.unclassified).toContain('api/services/orphanService.js');
  });

  test('a cobertura pode ser DECLARADA na vizinhança (com reason) — e aí não escala', () => {
    const r = selectValidation(base({
      changedFiles: ['api/services/orphanService.js'],
      neighborhoodRules: [{ prefix: 'api/services', tests: ['tests/unit/orphanService.test.js'], reason: 'cobertura declarada para o serviço' }],
    }));
    expect(r.escalate).toBe(false);
    expect(r.level).toBe(NIVEIS.L1);
    expect(r.tests).toContain('tests/unit/orphanService.test.js');
    expect(r.layers.vizinhanca).toContain('tests/unit/orphanService.test.js');
  });
});
