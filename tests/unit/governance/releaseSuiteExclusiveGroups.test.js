'use strict';

/**
 * tests/unit/governance/releaseSuiteExclusiveGroups.test.js
 *
 * PROVA que suítes que compartilham um runner GLOBAL nunca caem no mesmo lote — e que isso é uma
 * restrição DECLARADA no manifesto, não uma premissa escrita em comentário.
 *
 * DEFEITO REAL medido em 2026-10-02: `tests/helpers/purgeTestFindings.js` justificava sua segurança
 * com a frase "as suítes do laço NÃO podem rodar em paralelo entre si". O agrupamento por tamanho
 * fixo colocava TRÊS suítes de bug loop no mesmo lote. Como `runBugLoopSweep` é GLOBAL e a posse por
 * finding é um LEASE, um sweep vizinho deixa o lease preso e a suíte que ESPERA o worker automático
 * apenas pula: 115 ciclos sem retomada em lote, contra 35-68 s isolada.
 *
 * Uma premissa que sustenta uma garantia precisa ser EXECUTÁVEL. Aqui ela é.
 */

const fs = require('fs');
const path = require('path');

const { batchPaths, buildExclusiveIndex } = require('../../../scripts/governance/run-release-suites');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'canonical-release-suites.json');

describe('agrupamento de lotes com exclusividade declarada', () => {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const exclusiveGroups = (config.execution && config.execution.exclusiveGroups) || [];

  test('o manifesto declara o grupo do runner de laço de bugs com motivo auditável', () => {
    const group = exclusiveGroups.find((g) => g.id === 'BUG_LOOP_SHARED_RUNNER');
    expect(group).toBeTruthy();
    expect(group.suites).toEqual(expect.arrayContaining([
      'tests/integration/engineeringBugLoopNaturalPathE2E.test.js',
      'tests/integration/engineeringBugLoop.test.js',
      'tests/integration/engineeringBugAutonomousLoopE2E.test.js',
    ]));
    // Motivo substancial: restrição de concorrência sem justificativa é decisão invisível.
    expect(String(group.reason).length).toBeGreaterThan(120);
  });

  test('NENHUM lote contém duas suítes do mesmo grupo exclusivo', () => {
    const suites = (config.discovery.explicit || []).slice();
    const { batches } = batchPaths(suites.slice().sort(), { exclusiveGroups });
    const groupsOf = (suiteList) => {
      const set = new Set();
      for (const g of exclusiveGroups) {
        if (suiteList.some((s) => g.suites.includes(s))) set.add(g.id);
      }
      return set;
    };
    for (const batch of batches) {
      const seen = new Map();
      for (const s of batch.suites) {
        for (const g of groupsOf([s])) {
          if (seen.has(g)) {
            throw new Error(`lote ${batch.index} coloca ${seen.get(g)} e ${s} juntos no grupo ${g}`);
          }
          seen.set(g, s);
        }
      }
    }
    expect(batches.length).toBeGreaterThan(0);
  });

  test('a exclusividade NÃO serializa tudo: lotes continuam sendo preenchidos', () => {
    const semGrupo = Array.from({ length: 12 }, (_, i) => `tests/unit/exemplo${i}.test.js`);
    const { batches } = batchPaths(semGrupo, { exclusiveGroups });
    // Sem grupos envolvidos, o comportamento é o anterior: lotes cheios.
    expect(batches.length).toBe(2); // 12 / 6
    expect(batches[0].suites).toHaveLength(6);
  });

  test('um grupo de uma suíte só não restringe nada (não é grupo)', () => {
    const { groups } = buildExclusiveIndex([{ id: 'X', suites: ['a.test.js'], reason: 'motivo suficientemente longo aqui' }]);
    expect(groups).toHaveLength(0);
  });

  test('grupo sem motivo suficiente é recusado — restrição silenciosa não passa', () => {
    expect(() => buildExclusiveIndex([{ id: 'X', suites: ['a.test.js', 'b.test.js'], reason: 'curto' }]))
      .toThrow(/pelo menos 20 caracteres/);
  });

  test('suíte em DOIS grupos respeita ambos', () => {
    const groups = [
      { id: 'G1', suites: ['a.test.js', 'shared.test.js'], reason: 'motivo suficientemente longo um' },
      { id: 'G2', suites: ['shared.test.js', 'b.test.js'], reason: 'motivo suficientemente longo dois' },
    ];
    const { batches } = batchPaths(['a.test.js', 'b.test.js', 'shared.test.js', 'livre1.test.js', 'livre2.test.js', 'livre3.test.js'], { exclusiveGroups: groups });
    const batchOf = (s) => batches.find((b) => b.suites.includes(s));
    expect(batchOf('shared.test.js')).not.toBe(batchOf('a.test.js'));
    expect(batchOf('shared.test.js')).not.toBe(batchOf('b.test.js'));
    // E as livres continuam agrupadas.
    const livres = batches.filter((b) => b.suites.some((s) => /^livre/.test(s)));
    expect(livres.length).toBeGreaterThanOrEqual(1);
  });

  test('o agrupamento é determinístico (mesma entrada ⇒ mesmos lotes)', () => {
    const suites = ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js'];
    const one = batchPaths(suites, { exclusiveGroups });
    const two = batchPaths(suites, { exclusiveGroups });
    expect(JSON.stringify(one.batches)).toBe(JSON.stringify(two.batches));
  });
});
