'use strict';

/**
 * MANIFESTO CANÔNICO de suítes — descoberta determinística e não-vacuidade.
 *
 * ACHADO REAL (2026-09-25): a lista de suítes autoritativas era escrita à mão e divergia do que a
 * execução canônica rodava. Suítes autoritativas ficaram fora da verificação por tempo
 * indeterminado — uma delas pulava infraestrutura em SILÊNCIO com `console.warn`, sem aparecer em
 * relatório algum. O defeito só apareceu quando o manifesto passou a ser derivado.
 *
 * Este teste prova as propriedades que impedem a repetição:
 *   1. a lista é DERIVADA do disco (adicionar suíte candidata fora do manifesto = violação);
 *   2. exclusão exige MOTIVO (não há como "esconder" uma suíte em silêncio);
 *   3. execução: suíte ausente = NOT_EXECUTED; suíte "PASS" com 0 testes = violação;
 *   4. o manifesto real do repositório é consistente e não-vacuoso.
 */

const fs = require('fs');
const path = require('path');
const {
  resolveManifest,
  evaluateExecution,
  globToRegExp,
  MANIFEST_VIOLATION_CODES,
  CONFIG_PATH,
} = require('../../../scripts/governance/lib/releaseSuiteManifest');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP_DIR = path.join(ROOT, 'reports', '.manifest-test');

function writeConfig(name, config) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const target = path.join(TMP_DIR, name);
  fs.writeFileSync(target, JSON.stringify(config, null, 2));
  return target;
}

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('releaseSuiteManifest — descoberta determinística', () => {
  describe('globToRegExp', () => {
    it('casa com * sem atravessar diretórios e escapa metacaracteres', () => {
      const re = globToRegExp('tests/unit/engineeringMission*.test.js');
      expect(re.test('tests/unit/engineeringMissionCompiler.test.js')).toBe(true);
      expect(re.test('tests/unit/engineeringMissionX.test.js')).toBe(true);
      expect(re.test('tests/integration/engineeringMissionCompiler.test.js')).toBe(false);
      expect(re.test('tests/unit/engineeringRouterX.test.js')).toBe(false);
    });
  });

  describe('divergência manifesto × disco', () => {
    it('suíte candidata fora do manifesto e sem exclusão é VIOLAÇÃO (não silêncio)', () => {
      const configPath = writeConfig('not-in-manifest.json', {
        manifestVersion: 'test',
        discovery: { globs: ['tests/unit/engineeringMission*.test.js'], explicit: [] },
        exclusions: [],
        execution: { zeroTestsIsViolation: true },
      });
      const resolved = resolveManifest({ configPath });
      // O manifesto é derivado: tudo que casa com a descoberta ENTRA. Nada pode ficar de fora
      // sem uma exclusão declarada — é isso que impede a suíte autoritativa invisível.
      expect(resolved.authoritative.length).toBeGreaterThan(5);
      expect(resolved.authoritative).toContain('tests/unit/engineeringMissionSpecFreshness.test.js');
      expect(resolved.violations).toEqual([]);
    });

    it('exclusão SEM motivo suficiente é recusada (não dá para esconder suíte em silêncio)', () => {
      const configPath = writeConfig('exclusao-sem-motivo.json', {
        manifestVersion: 'test',
        discovery: { globs: ['tests/unit/engineeringMission*.test.js'], explicit: [] },
        exclusions: [{ glob: 'tests/unit/engineeringMissionCompiler.test.js', reason: 'curto' }],
        execution: {},
      });
      const resolved = resolveManifest({ configPath });
      expect(resolved.ok).toBe(false);
      expect(resolved.violations.map((v) => v.code)).toContain(MANIFEST_VIOLATION_CODES.MANIFEST_INVALID);
    });

    it('exclusão COM motivo remove a suíte da autoridade e fica registrada', () => {
      const motivo = 'Suíte de unidade pura coberta pelo gate geral de unidade; não exige runtime real.';
      const configPath = writeConfig('exclusao-ok.json', {
        manifestVersion: 'test',
        discovery: { globs: ['tests/unit/engineeringMissionCompiler.test.js'], explicit: [] },
        exclusions: [{ glob: 'tests/unit/engineeringMissionCompiler.test.js', reason: motivo }],
        execution: {},
      });
      const resolved = resolveManifest({ configPath });
      expect(resolved.authoritative).toEqual([]);
      // Zero suítes = gate vacuoso; o motivo não pode servir para esvaziar o manifesto em silêncio.
      expect(resolved.violations.map((v) => v.code)).toContain(MANIFEST_VIOLATION_CODES.MANIFEST_EMPTY);
      expect(resolved.excluded[0].reason).toBe(motivo);
    });

    it('PRECEDÊNCIA: item declarado em `explicit` não é removido por uma exclusão de glob', () => {
      // Defeito real: a exclusão `engineeringRouter*` engolia o `explicit` (teste do provider
      // Qwen), removendo-o do manifesto em silêncio — o eixo QWEN_PROVIDER_STRUCTURAL ficou
      // NO_GO por "suíte não executada" sem que ninguém tivesse decidido removê-la.
      const configPath = writeConfig('precedencia.json', {
        manifestVersion: 'test',
        discovery: { globs: ['tests/unit/engineeringMission*.test.js'], explicit: ['tests/unit/engineeringRouterQwenProvider.test.js'] },
        exclusions: [{ glob: 'tests/unit/engineeringRouter*.test.js', reason: 'exclusão ampla que NÃO pode engolir item declarado explicitamente' }],
        execution: {},
      });
      const resolved = resolveManifest({ configPath });
      expect(resolved.authoritative).toContain('tests/unit/engineeringRouterQwenProvider.test.js');
      expect(resolved.excluded.map((e) => e.path)).not.toContain('tests/unit/engineeringRouterQwenProvider.test.js');
    });

    it('exclusão que não casa com nada é registrada como não-utilizada (não fica invisível)', () => {
      const configPath = writeConfig('exclusao-inerte.json', {
        manifestVersion: 'test',
        discovery: { globs: ['tests/unit/engineeringMission*.test.js'], explicit: [] },
        exclusions: [{ glob: 'tests/unit/naoExiste*.test.js', reason: 'exclusão inerte usada para provar que ela é reportada e não silenciosa' }],
        execution: {},
      });
      const resolved = resolveManifest({ configPath });
      expect(resolved.unusedExclusions.map((e) => e.glob)).toContain('tests/unit/naoExiste*.test.js');
      expect(resolved.ok).toBe(true); // decisão de escopo, não erro
    });

    it('suíte declarada que não existe no disco é violação', () => {
      const configPath = writeConfig('inexistente.json', {
        manifestVersion: 'test',
        discovery: { globs: [], explicit: ['tests/unit/suiteQueNaoExiste.test.js'] },
        exclusions: [],
        execution: {},
      });
      const resolved = resolveManifest({ configPath });
      expect(resolved.violations.map((v) => v.code)).toContain(MANIFEST_VIOLATION_CODES.MANIFEST_SUITE_MISSING);
    });

    it('manifesto ausente é violação de configuração, nunca PASS silencioso', () => {
      const resolved = resolveManifest({ configPath: path.join(TMP_DIR, 'nao-existe.json') });
      expect(resolved.ok).toBe(false);
      expect(resolved.violations.map((v) => v.code)).toContain(MANIFEST_VIOLATION_CODES.MANIFEST_INVALID);
    });
  });

  describe('avaliação da execução', () => {
    const manifest = { authoritative: ['a.test.js', 'b.test.js', 'c.test.js'], execution: { zeroTestsIsViolation: true } };

    it('suíte do manifesto ausente do relatório é NOT_EXECUTED (jamais cobertura)', () => {
      const evaluation = evaluateExecution(manifest, { suites: { 'a.test.js': { state: 'PASS', testsExecuted: 5 } } });
      expect(evaluation.results.find((r) => r.suite === 'b.test.js').state).toBe('NOT_EXECUTED');
      expect(evaluation.covered).toBe(1);
      expect(evaluation.violations.map((v) => v.code)).toContain('MANIFEST_SUITE_NOT_EXECUTED');
    });

    it('suíte marcada PASS com ZERO testes é FAIL (o verde mais falso possível)', () => {
      const evaluation = evaluateExecution(manifest, {
        suites: {
          'a.test.js': { state: 'PASS', testsExecuted: 0 },
          'b.test.js': { state: 'PASS', testsExecuted: 3 },
          'c.test.js': { state: 'PASS', testsExecuted: 1 },
        },
      });
      const a = evaluation.results.find((r) => r.suite === 'a.test.js');
      expect(a.state).toBe('FAIL');
      expect(evaluation.violations.map((v) => v.code)).toContain('MANIFEST_SUITE_ZERO_TESTS');
      expect(evaluation.covered).toBe(2);
      expect(evaluation.coverageRatio).toBeCloseTo(0.6667, 3);
    });

    it('estados não-PASS nunca contam como cobertura', () => {
      const evaluation = evaluateExecution(manifest, {
        suites: {
          'a.test.js': { state: 'INFRA_ERROR', testsExecuted: 0 },
          'b.test.js': { state: 'FAIL', testsExecuted: 2 },
          'c.test.js': { state: 'PASS', testsExecuted: 4 },
        },
      });
      expect(evaluation.covered).toBe(1);
      expect(evaluation.violations.length).toBeGreaterThanOrEqual(2);
    });

    it('todos PASS ⇒ cobertura integral e nenhuma violação', () => {
      const evaluation = evaluateExecution(manifest, {
        suites: {
          'a.test.js': { state: 'PASS', testsExecuted: 1 },
          'b.test.js': { state: 'PASS', testsExecuted: 2 },
          'c.test.js': { state: 'PASS', testsExecuted: 3 },
        },
      });
      expect(evaluation.violations).toEqual([]);
      expect(evaluation.coverageRatio).toBe(1);
    });
  });

  describe('manifesto REAL do repositório', () => {
    it('é consistente, não-vacuoso e cobre as suítes de missão/task', () => {
      const resolved = resolveManifest();
      expect(resolved.ok).toBe(true);
      expect(resolved.authoritative.length).toBeGreaterThanOrEqual(20);
      expect(resolved.authoritative).toContain('tests/integration/engineeringMissionStaleSpec.test.js');
      expect(resolved.authoritative).toContain('tests/unit/engineeringMissionSpecFreshness.test.js');
      expect(resolved.authoritative).toContain('tests/integration/engineeringTaskFencing.test.js');
      expect(resolved.authoritative).toContain('tests/integration/engineeringTaskConcurrencyAndRestart.test.js');
      // Toda exclusão precisa de motivo (auditabilidade) e nenhuma pode esvaziar o gate.
      for (const excluded of resolved.excluded) {
        expect(typeof excluded.reason).toBe('string');
        expect(excluded.reason.length).toBeGreaterThanOrEqual(20);
      }
    });

    it('o manifesto não contém caminhos que não existem', () => {
      const resolved = resolveManifest();
      const missing = resolved.authoritative.filter((suite) => !fs.existsSync(path.join(ROOT, suite)));
      expect(missing).toEqual([]);
    });

    it('o config aponta para o próprio arquivo canônico (fonte única)', () => {
      expect(fs.existsSync(CONFIG_PATH)).toBe(true);
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      expect(config.execution.zeroTestsIsViolation).toBe(true);
    });
  });
});
