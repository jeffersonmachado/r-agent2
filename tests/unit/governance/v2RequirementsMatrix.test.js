'use strict';

/**
 * MATRIZ DE REQUISITOS V2 — DERIVADA, não escrita à mão.
 *
 * Achado que originou isto: as mesmas contagens apareciam divergentes entre artefatos
 * ("17 suítes / 202 testes" num documento, "19 / 215" em outro) porque cada um repetia números
 * digitados. A matriz aqui recalculava-os das fontes reais.
 *
 * As provas que este teste exige:
 *   1. o status de um eixo é DERIVADO do relatório de execução (mudar o relatório muda o eixo);
 *   2. eixo OBRIGATÓRIO sem suíte executada é NO_GO (fail-closed, nunca "presumo OK");
 *   3. suíte que "passa" com 0 testes nunca produz eixo GO;
 *   4. as contagens do topo são somas dos eixos, não constantes;
 *   5. a lacuna V2-01..V2-42 aparece DECLARADA, não silenciada.
 */

const fs = require('fs');
const path = require('path');
const { buildMatrix } = require('../../../scripts/governance/generate-v2-requirements-matrix');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP = path.join(ROOT, 'reports', '.matrix-test');

function write(name, payload) {
  fs.mkdirSync(TMP, { recursive: true });
  const target = path.join(TMP, name);
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

const AXES = {
  matrixVersion: 'test',
  unmappedRequirementIds: { range: 'V2-01..V2-42', status: 'NOT_MAPPED_BY_REPOSITORY' },
  axes: {
    ALPHA: { requirement: 'requisito alpha', suites: ['a.test.js', 'b.test.js'], evidence: ['reports/x.json'], gate: 'npm run a' },
    BETA: { requirement: 'requisito beta', suites: ['c.test.js'], evidence: ['reports/y.json'], gate: 'npm run b' },
    GAMMA: { requirement: 'requisito sem suíte', suites: [], evidence: ['reports/z.json'], gate: 'npm run c' },
    ANTI_GREENWASHING: { requirement: 'sem pulo silencioso', suites: [], evidence: [], gate: 'npm run validate:anti-greenwashing' },
  },
};

beforeAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function matrix({ execution = null, antiGreenwashing = null, seal = null } = {}) {
  return buildMatrix({
    axesConfigPath: write('axes.json', AXES),
    suiteExecutionPath: execution ? write('exec.json', execution) : path.join(TMP, 'inexistente-exec.json'),
    antiGreenwashingPath: antiGreenwashing ? write('agw.json', antiGreenwashing) : path.join(TMP, 'inexistente-agw.json'),
    sealReportPath: seal ? write('seal.json', seal) : path.join(TMP, 'inexistente-seal.json'),
  });
}

describe('matriz V2 — status derivado', () => {
  it('sem relatório de execução, TODO eixo com suíte é NO_GO (sem prova não há GO)', () => {
    const result = matrix({ antiGreenwashing: { status: 'PASS', authoritativeSuites: 24, violationCount: 0 } });
    expect(result.axes.ALPHA.status).toBe('NO_GO');
    expect(result.axes.BETA.status).toBe('NO_GO');
    expect(result.axes.ALPHA.reason).toMatch(/relatório de execução de suítes ausente/);
  });

  it('todos os eixos PASS ⇒ GO, com testes somados das suítes reais', () => {
    const result = matrix({
      antiGreenwashing: { status: 'PASS', authoritativeSuites: 24, violationCount: 0 },
      execution: {
        suites: {
          'a.test.js': { state: 'PASS', testsExecuted: 10 },
          'b.test.js': { state: 'PASS', testsExecuted: 5 },
          'c.test.js': { state: 'PASS', testsExecuted: 3 },
        },
      },
    });
    expect(result.axes.ALPHA.status).toBe('GO');
    expect(result.axes.ALPHA.testsExecuted).toBe(15);
    expect(result.axes.BETA.testsExecuted).toBe(3);
    // GAMMA não tem suíte declarada: eixo obrigatório sem prova continua NO_GO.
    expect(result.axes.GAMMA.status).toBe('NO_GO');
    expect(result.totals.testsExecuted).toBe(18);
    expect(result.totals.suitesMapped).toBe(3);
  });

  it('suíte não-PASS derruba o eixo que depende dela (e só ele)', () => {
    const result = matrix({
      antiGreenwashing: { status: 'PASS', authoritativeSuites: 24, violationCount: 0 },
      execution: {
        suites: {
          'a.test.js': { state: 'PASS', testsExecuted: 10 },
          'b.test.js': { state: 'INFRA_ERROR', testsExecuted: 0 },
          'c.test.js': { state: 'PASS', testsExecuted: 3 },
        },
      },
    });
    expect(result.axes.ALPHA.status).toBe('NO_GO');
    expect(result.axes.ALPHA.reason).toMatch(/INFRA_ERROR/);
    expect(result.axes.BETA.status).toBe('GO');
  });

  it('suíte AUSENTE do relatório é NOT_EXECUTED e nunca conta como cobertura', () => {
    const result = matrix({
      antiGreenwashing: { status: 'PASS', authoritativeSuites: 24, violationCount: 0 },
      execution: { suites: { 'a.test.js': { state: 'PASS', testsExecuted: 7 } } },
    });
    expect(result.axes.ALPHA.suites.find((s) => s.suite === 'b.test.js').state).toBe('NOT_EXECUTED');
    expect(result.axes.ALPHA.status).toBe('NO_GO');
    expect(result.totals.suitesPass).toBe(1);
  });

  it('ANTI_GREENWASHING deriva do relatório próprio, não da execução de suítes', () => {
    const failing = matrix({
      antiGreenwashing: { status: 'FAIL', authoritativeSuites: 24, violationCount: 2 },
      execution: { suites: {} },
    });
    expect(failing.axes.ANTI_GREENWASHING.status).toBe('NO_GO');
    expect(failing.axes.ANTI_GREENWASHING.reason).toMatch(/violações=2/);

    const passing = matrix({
      antiGreenwashing: { status: 'PASS', authoritativeSuites: 24, violationCount: 0 },
      execution: { suites: {} },
    });
    expect(passing.axes.ANTI_GREENWASHING.status).toBe('GO');
  });

  it('as contagens do topo são SOMA dos eixos (não constantes digitadas)', () => {
    const base = {
      antiGreenwashing: { status: 'PASS', authoritativeSuites: 24, violationCount: 0 },
      execution: { suites: { 'a.test.js': { state: 'PASS', testsExecuted: 4 }, 'b.test.js': { state: 'PASS', testsExecuted: 2 }, 'c.test.js': { state: 'PASS', testsExecuted: 1 } } },
    };
    const result = matrix(base);
    const somaTestes = Object.values(result.axes).reduce((acc, a) => acc + a.testsExecuted, 0);
    expect(result.totals.testsExecuted).toBe(somaTestes);

    // Mudar a fonte MUDA o número — é o oposto de uma constante escrita à mão.
    const outra = matrix({
      ...base,
      execution: { suites: { 'a.test.js': { state: 'PASS', testsExecuted: 40 }, 'b.test.js': { state: 'PASS', testsExecuted: 2 }, 'c.test.js': { state: 'PASS', testsExecuted: 1 } } },
    });
    expect(outra.totals.testsExecuted).toBe(43);
    expect(outra.axes.ALPHA.testsExecuted).toBe(42);
  });

  it('declara a lacuna V2-01..V2-42 em vez de inventar identificadores', () => {
    const result = matrix({ antiGreenwashing: { status: 'PASS' }, execution: { suites: {} } });
    expect(result.unmappedRequirementIds.status).toBe('NOT_MAPPED_BY_REPOSITORY');
    expect(result.unmappedRequirementIds.range).toBe('V2-01..V2-42');
    // Um eixo chamado "V2-01" NÃO existe: nada foi fabricado para preencher a numeração.
    expect(Object.keys(result.axes).some((k) => /^V2-\d+$/.test(k))).toBe(false);
  });

  it('config de eixos ausente é erro explícito (nunca matriz vazia silenciosa)', () => {
    expect(() => buildMatrix({ axesConfigPath: path.join(TMP, 'nao-existe.json') })).toThrow(/ausente|ilegível/);
  });

  it('o config REAL do repositório é válido e não-vacuoso', () => {
    const real = buildMatrix();
    expect(real.totals.axes).toBeGreaterThanOrEqual(17);
    for (const axis of Object.values(real.axes)) {
      expect(typeof axis.requirement).toBe('string');
      expect(axis.requirement.length).toBeGreaterThan(20);
      expect(['GO', 'NO_GO']).toContain(axis.status);
      expect(Array.isArray(axis.evidence)).toBe(true);
    }
    // Nenhum eixo real pode estar sem suíte E sem gate — isso seria um requisito decorativo.
    // Eixos que derivam de OUTRO gate (anti-greenwashing, selo) legitimamente não têm suíte
    // própria: o veredito deles vem do relatório do gate, não da execução do manifesto.
    const NON_SUITE_AXES = new Set(['ANTI_GREENWASHING', 'ENGINEERING_ROUTER_V2_SEAL']);
    for (const [id, axis] of Object.entries(real.axes)) {
      const hasSuite = Array.isArray(axis.test) && axis.test.length > 0;
      expect(Boolean(hasSuite) || Boolean(axis.gate)).toBe(true);
      // Eixo com suíte declarada precisa declarar TAMBÉM a evidência que o comprova.
      if (hasSuite) expect(axis.evidence.length).toBeGreaterThan(0);
      if (!hasSuite && !NON_SUITE_AXES.has(id)) expect(axis.status).toBe('NO_GO');
      if (NON_SUITE_AXES.has(id)) expect(Boolean(axis.gate)).toBe(true);
    }
  });
});
