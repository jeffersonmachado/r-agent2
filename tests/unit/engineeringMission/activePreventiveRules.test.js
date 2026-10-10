'use strict';

/**
 * ENGINEERING MEMORY — regras preventivas ATIVAS chegam ao planejamento da correção.
 *
 * DEFEITO MEDIDO (auditoria 2026-10-10): `activeRules()` existia no motor desde
 * 2026-10-08 mas não tinha CHAMADOR de produção. A regra preventiva era gravada
 * como ACTIVE e nunca lida antes de corrigir — a "prevenção" só aparecia no
 * fechamento, ou seja, a memória era aditiva e decorativa.
 *
 * Este teste protege a consulta: somente ACTIVE é devolvido (PROPOSED não é
 * obrigação), a categoria filtra a busca e o contrato recebe o texto da regra.
 */

jest.mock('../../../api/db/models/EngineeringBugFinding', () => jest.fn());
jest.mock('../../../api/db/models/EngineeringBugFindingEvent', () => jest.fn());

const getEngineeringBugFindingModel = require('../../../api/db/models/EngineeringBugFinding');
const bugFindingService = require('../../../api/services/engineeringMission/bugFindingService');

function ruleRecord(overrides = {}) {
  return {
    id: 'f-1',
    category: 'BUG',
    status: 'CLOSED',
    last_seen_at: new Date('2026-10-09T00:00:00.000Z'),
    triage: {
      knownProblem: {
        knownProblemId: 'kp-abc',
        state: 'ACTIVE',
        rootCause: 'gate de release afrouxado para passar',
        preventiveRule: 'não remover checagem de governança para destravar uma missão',
        regressionTest: { path: 'tests/unit/governance/x.test.js', execution: { status: 'PASS', exitCode: 0, sourceFingerprint: 'fp-1' } },
        fixedIn: 'commit-def456',
        activatedAt: '2026-10-09T12:00:00.000Z',
      },
    },
    get() { return this; },
    toJSON() { return this; },
    ...overrides,
  };
}

function primeModel(rows) {
  const findAll = jest.fn().mockResolvedValue(rows);
  getEngineeringBugFindingModel.mockReturnValue({ findAll, create: jest.fn() });
  return findAll;
}

describe('bugFindingService.getActivePreventiveRules', () => {
  test('devolve SOMENTE regras ACTIVE — PROPOSED não é obrigação', async () => {
    primeModel([
      ruleRecord(),
      ruleRecord({
        id: 'f-2',
        triage: { knownProblem: { knownProblemId: 'kp-proposed', state: 'PROPOSED', preventiveRule: 'ainda não provada' } },
      }),
      ruleRecord({ id: 'f-3', triage: {} }),
    ]);

    const rules = await bugFindingService.getActivePreventiveRules({ category: 'BUG' });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      knownProblemId: 'kp-abc',
      preventiveRule: 'não remover checagem de governança para destravar uma missão',
      rootCause: 'gate de release afrouxado para passar',
      fixedIn: 'commit-def456',
    });
    // A execução registrada acompanha a regra (é o que prova que o teste roda).
    expect(rules[0].regressionTest.execution).toMatchObject({ status: 'PASS', exitCode: 0 });
  });

  test('a categoria FILTRA a busca (só a mesma classe de falha é consultada)', async () => {
    const findAll = primeModel([ruleRecord()]);
    await bugFindingService.getActivePreventiveRules({ category: 'GOVERNANCE' });
    const args = findAll.mock.calls[0][0];
    expect(args.where).toMatchObject({ category: 'GOVERNANCE' });
    // Só findings já resolvidos podem carregar regra ativa.
    expect(args.where.status).toEqual(['REGRESSION_VALIDATED', 'CLOSED']);
  });

  test('limite é limitado (não varre a tabela inteira) e sem categoria não filtra categoria', async () => {
    const findAll = primeModel([]);
    await bugFindingService.getActivePreventiveRules({ limit: 99999 });
    expect(findAll.mock.calls[0][0].limit).toBe(200);
    expect(findAll.mock.calls[0][0].where.category).toBeUndefined();
  });

  test('sem banco a leitura falha — o chamador trata como lista vazia (não inventa regra)', async () => {
    getEngineeringBugFindingModel.mockReturnValue({
      findAll: jest.fn().mockRejectedValue(new Error('db down')),
      create: jest.fn(),
    });
    // A leitura FALHA (fail-closed: sem banco não se afirma memória)...
    await expect(bugFindingService.getActivePreventiveRules({})).rejects.toThrow();
    // ...e o planejamento captura a falha e segue sem regras (nunca com regra inventada).
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../api/services/engineeringMission/bugTriageService.js'),
      'utf8',
    );
    expect(source).toMatch(/getActivePreventiveRules\(\{ category, limit: 20 \}\)[\s\S]{0,40}\.catch\(\(\) => \[\]\)/);
  });
});

describe('bugTriageService — regras ativas entram no contrato da correção', () => {
  test('o triage consulta as regras ativas da categoria e as declara no assessment', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../../api/services/engineeringMission/bugTriageService.js'),
      'utf8',
    );
    // Não-vacuidade: a consulta existe E o resultado chega ao contrato (senão a memória
    // continuaria decorativa, que era exatamente o defeito).
    expect(source).toMatch(/getActivePreventiveRules\(/);
    expect(source).toMatch(/preventiveRules: activePreventiveRules/);
    expect(source).toMatch(/Regras preventivas ATIVAS desta categoria/);
  });
});
