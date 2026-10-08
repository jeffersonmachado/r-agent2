'use strict';

/**
 * Higiene canônica do banco de DEV — critério de segurança e COBERTURA DE FKs.
 *
 * Dois defeitos reais aconteceram aqui, e os dois passariam por `node --check`:
 *
 *   1. a lista de filhos escopados à missão era escrita À MÃO dentro do `main()` e ficou
 *      desatualizada: `engineering_mission_reviews` (FK RESTRICT) e `engineering_bug_findings`
 *      não constavam, então `--apply` abortava com violação de FK — a poda canônica simplesmente
 *      não removia nada. O resíduo (1079 missões, 1069 fixtures, 8 RESUMÍVEIS) continuava sendo
 *      varrido por `resumeInterruptedMissions`, estourando passos obrigatórios do selo e o E2E do
 *      laço de bug. A cobertura agora é PERGUNTADA AO BANCO (não deduzida da leitura do código);
 *   2. um filtro de segurança que erre para "remover" apaga missão de usuário. O critério é
 *      `created_by` com MARCADOR DE TESTE conhecido — e é isto que o primeiro bloco fixa.
 */

const {
  MISSION_CHILD_DELETIONS,
  isTestFixture,
  findMissingFkCoverage,
} = require('../../../scripts/prune-test-engineering-missions');

describe('prune-test-engineering-missions — critério de segurança (sem banco)', () => {
  it('marcadores de TESTE/FERRAMENTA são reconhecidos', () => {
    for (const marker of ['jest-natural', 'verify-e2e', 'timeout-architecture-e2e', 'sanity', 'measure-sweep']) {
      expect(isTestFixture(marker)).toBe(true);
    }
  });

  it('origem de USUÁRIO nunca é classificada como fixture (fail-closed para o lado que PRESERVA)', () => {
    for (const user of ['cc1fbca6-d8cb-4ac8-a858-2d221244a8b3', 'admin', 'systemadmin']) {
      expect(isTestFixture(user)).toBe(false);
    }
  });

  it('origem AUSENTE (null/undefined/vazio) é tratada como usuário — nunca como descarte', () => {
    for (const missing of [null, undefined, '']) {
      expect(isTestFixture(missing)).toBe(false);
    }
  });

  it('o filho do finding é removido ANTES do finding (senão a FK de eventos barra a poda)', () => {
    const events = MISSION_CHILD_DELETIONS.findIndex((item) => item.table === 'engineering_bug_finding_events');
    const findings = MISSION_CHILD_DELETIONS.findIndex((item) => item.table === 'engineering_bug_findings');
    expect(events).toBeGreaterThanOrEqual(0);
    expect(findings).toBeGreaterThanOrEqual(0);
    expect(events).toBeLessThan(findings);
  });
});

describe('prune-test-engineering-missions — cobertura de FKs (função usada no runtime)', () => {
  it('a declaração cobre as referências REAIS a engineering_missions', () => {
    const reais = [
      { table_name: 'engineering_bug_findings', column_name: 'mission_id' },
      { table_name: 'engineering_mission_approvals', column_name: 'mission_id' },
      { table_name: 'engineering_mission_reviews', column_name: 'mission_id' },
      { table_name: 'engineering_mission_versions', column_name: 'mission_id' },
    ];
    expect(findMissingFkCoverage(reais)).toEqual([]);
  });

  it('tabela NOVA que referencie a missão aparece como descoberta (é o defeito de 2026-10-08)', () => {
    const comTabelaNova = [
      ...MISSION_CHILD_DELETIONS
        .filter((item) => item.column === 'mission_id')
        .map((item) => ({ table_name: item.table, column_name: item.column })),
      { table_name: 'engineering_mission_notes', column_name: 'mission_id' },
    ];
    expect(findMissingFkCoverage(comTabelaNova)).toEqual(['engineering_mission_notes.mission_id']);
  });

  it('entrada vazia ou malformada não vira falso verde (o runtime aborta por conta própria)', () => {
    expect(findMissingFkCoverage([])).toEqual([]);
    expect(findMissingFkCoverage(null)).toEqual([]);
  });

  it('as quatro tabelas conhecidas continuam declaradas (guarda contra remoção acidental)', () => {
    const declaradas = MISSION_CHILD_DELETIONS.map((item) => item.table);
    for (const tabela of [
      'engineering_bug_findings',
      'engineering_mission_approvals',
      'engineering_mission_reviews',
      'engineering_mission_versions',
    ]) {
      expect(declaradas).toContain(tabela);
    }
  });
});
