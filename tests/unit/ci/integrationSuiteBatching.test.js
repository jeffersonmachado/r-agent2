'use strict';

/**
 * Guarda do executor de `tests/integration` + `tests/tenant` do CI (`scripts/ci/run-integration-suites.js`).
 *
 * Medido em 2026-10-28 (run 40737265748): rodar essas suítes com o paralelismo default deixou 5
 * suítes / 26 testes vermelhos, todas da família que `config/canonical-release-suites.json` declara
 * EXCLUSIVA (worker global do laço de bugs + banco de missões compartilhados). O executor existe
 * para respeitar esse manifesto; estes testes garantem que ele não regrida para "tudo num lote só"
 * nem perca a disciplina de ambiente.
 */

const {
  planBatches, sanitizedEnv, DEFAULT_POOL_MAX,
} = require('../../../scripts/ci/run-integration-suites');

const MANIFEST = require('../../../config/canonical-release-suites.json');

describe('executor de integração do CI — lotes respeitam os grupos exclusivos', () => {
  const exclusiveGroups = MANIFEST.execution.exclusiveGroups;

  test('o manifesto declara execução serial e grupos exclusivos (a premissa do executor)', () => {
    expect(MANIFEST.execution.concurrency).toBe('serial');
    expect(exclusiveGroups.length).toBeGreaterThan(0);
  });

  test('nenhum lote contém duas suítes do MESMO grupo exclusivo', () => {
    const doManifesto = exclusiveGroups.flatMap((grupo) => grupo.suites);
    // Lista sintética: só as suítes que importam para a regra, para o teste não depender do disco.
    const suites = [...new Set(doManifesto)].sort();
    const { batches } = planBatches(suites, { exclusiveGroups });

    for (const grupo of exclusiveGroups) {
      for (const batch of batches) {
        const noLote = batch.suites.filter((suite) => grupo.suites.includes(suite));
        expect(noLote.length).toBeLessThanOrEqual(1);
      }
    }
  });

  test('suítes fora dos grupos podem dividir lote (o executor não serializa o repositório inteiro)', () => {
    const suites = [
      'tests/integration/alpha.test.js',
      'tests/integration/beta.test.js',
      'tests/integration/gamma.test.js',
    ];
    const { batches } = planBatches(suites, { exclusiveGroups });
    expect(batches.length).toBe(1);
    expect(batches[0].suites).toEqual(suites);
  });

  test('cada suíte do grupo exclusivo cai em lote próprio quando só elas existem', () => {
    const grupo = exclusiveGroups[0];
    const { batches } = planBatches([...grupo.suites].sort(), { exclusiveGroups });
    expect(batches.length).toBe(grupo.suites.length);
    for (const batch of batches) expect(batch.suites.length).toBe(1);
  });
});

describe('executor de integração do CI — disciplina de ambiente do runner autoritativo', () => {
  test('NÃO herda ENGINEERING_RUNNER_URL/TOKEN (o .env aponta para o runner de dev)', () => {
    const env = sanitizedEnv({
      PATH: '/usr/bin',
      ENGINEERING_RUNNER_URL: 'http://127.0.0.1:8090',
      ENGINEERING_RUNNER_TOKEN: 'token-de-dev',
    });
    expect(env.ENGINEERING_RUNNER_URL).toBeUndefined();
    expect(env.ENGINEERING_RUNNER_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  test('CLAMPA DB_POOL_MAX (um lote roda --runInBand; o pool do .env é de dev)', () => {
    expect(sanitizedEnv({ DB_POOL_MAX: '40' }).DB_POOL_MAX).toBe(String(DEFAULT_POOL_MAX));
    expect(sanitizedEnv({ DB_POOL_MAX: '4' }).DB_POOL_MAX).toBe('4');
    expect(sanitizedEnv({}).DB_POOL_MAX).toBe(String(DEFAULT_POOL_MAX));
  });
});
