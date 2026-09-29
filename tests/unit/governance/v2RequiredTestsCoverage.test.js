'use strict';

/**
 * Governança do gate dos TESTES OBRIGATÓRIOS V2 (V2-01..V2-42).
 *
 * Trava as duas coisas que tornam o gate confiável:
 *   1. O CONFIG é fiel ao prompt original: 42 IDs exatos (V2-01..V2-42), sem duplicata, com
 *      enunciado e sem nenhum campo de status escrito à mão (status é derivado, nunca declarado);
 *   2. O NÚCLEO PURO classifica pelo que foi OBSERVADO — gap, falha, não execução, prova ausente,
 *      evidência vencida, impedimento externo declarado e prova completa — sem afrouxar nenhum caso.
 */

const fs = require('fs');
const path = require('path');

const {
  classifyRequiredTest,
  deriveRequiredTests,
} = require('../../../governance/required-tests-derivation');

const ROOT = path.join(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'engineering-router-v2-required-tests.json');

const ALL_PASS = () => ({ state: 'PASS' });
const ALL_REPORTS_OK = () => ({ exists: true, value: 'GO', generatedAt: new Date().toISOString() });

describe('config dos 42 testes obrigatórios V2', () => {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const items = config.requiredTests || [];

  test('cobre exatamente os 42 IDs do prompt original (V2-01..V2-42)', () => {
    const expected = Array.from({ length: 42 }, (_, i) => `V2-${String(i + 1).padStart(2, '0')}`);
    expect(items.map((item) => item.id)).toEqual(expected);
  });

  test('todo requisito tem enunciado não vazio (nada de placeholder)', () => {
    for (const item of items) {
      expect(typeof item.requirement).toBe('string');
      expect(item.requirement.trim().length).toBeGreaterThan(3);
    }
  });

  test('nenhum item declara status/classificação à mão — o estado é derivado', () => {
    const forbidden = ['status', 'classification', 'proven', 'passed', 'state'];
    for (const item of items) {
      for (const key of forbidden) {
        expect(Object.prototype.hasOwnProperty.call(item, key)).toBe(false);
      }
    }
  });

  test('item sem prova declarada explica por que (gapReason), item com prova aponta uma prova', () => {
    for (const item of items) {
      const suites = item.suites || [];
      const reports = item.reports || [];
      if (suites.length === 0 && reports.length === 0) {
        expect(typeof item.gapReason === 'string' && item.gapReason.trim().length > 10).toBe(true);
      } else {
        expect(suites.length + reports.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('núcleo puro da derivação', () => {
  test('GAP: requisito sem prova alguma nunca é aprovado por omissão', () => {
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: [], reports: [], gapReason: 'sem teste dedicado' },
      { suiteState: ALL_PASS, reportState: ALL_REPORTS_OK },
    );
    expect(result.classification).toBe('GAP');
    expect(result.blocking).toBe(true);
  });

  test('FAILED: suíte com falha não vira prova', () => {
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: ['a.test.js'], reports: [] },
      { suiteState: () => ({ state: 'FAIL' }), reportState: ALL_REPORTS_OK },
    );
    expect(result.classification).toBe('FAILED');
    expect(result.blocking).toBe(true);
  });

  test('NOT_EXECUTED: suíte sem execução autoritativa não conta como prova', () => {
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: ['a.test.js'], reports: [] },
      { suiteState: () => null, reportState: ALL_REPORTS_OK },
    );
    expect(result.classification).toBe('NOT_EXECUTED');
    expect(result.blocking).toBe(true);
  });

  test('UNPROVEN: relatório de prova ausente não é aprovado por falta de dado', () => {
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: [], reports: ['reports/x.json'] },
      { suiteState: ALL_PASS, reportState: () => ({ exists: false, value: null, generatedAt: null }) },
    );
    expect(result.classification).toBe('UNPROVEN');
    expect(result.blocking).toBe(true);
  });

  test('UNPROVEN: relatório presente sem valor de aprovação não passa', () => {
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: [], reports: ['reports/x.json'] },
      { suiteState: ALL_PASS, reportState: () => ({ exists: true, value: 'NO_GO', generatedAt: new Date().toISOString() }) },
    );
    expect(result.classification).toBe('UNPROVEN');
  });

  test('STALE: evidência vencida não conta como prova (TTL)', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: [], reports: ['reports/x.json'] },
      { suiteState: ALL_PASS, reportState: () => ({ exists: true, value: 'GO', generatedAt: old }) },
    );
    expect(result.classification).toBe('STALE');
    expect(result.blocking).toBe(true);
  });

  test('BLOCKED_EXTERNAL: impedimento declarado não vira PASS nem vira defeito de código', () => {
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: ['a.test.js'], reports: [], externalBlocker: { reason: 'sem credencial no ambiente' } },
      { suiteState: ALL_PASS, reportState: ALL_REPORTS_OK },
    );
    expect(result.classification).toBe('BLOCKED_EXTERNAL');
    expect(result.blocking).toBe(false);
  });

  test('PROVEN: suíte PASS + relatório aprovado e fresco', () => {
    const result = classifyRequiredTest(
      { id: 'V2-99', requirement: 'x', suites: ['a.test.js'], reports: ['reports/x.json'] },
      { suiteState: ALL_PASS, reportState: ALL_REPORTS_OK },
    );
    expect(result.classification).toBe('PROVEN');
    expect(result.blocking).toBe(false);
  });

  // ── EVIDÊNCIA MEDIDA (defeito real corrigido em 2026-09-29) ─────────────────────────────────
  // O requisito V2-35 era classificado por `externalBlocker.reason` — um TEXTO escrito à mão, com
  // precedência sobre QUALQUER medição. O teste que deveria produzir a prova lia a credencial de
  // `process.env` (caminho que o produto não usa) e, como o Jest não carrega o `.env`, caía sempre
  // no ramo "sem credencial": a suíte dava PASS com qualquer desfecho e o gate não distinguia
  // "executou" de "não executou". Agora o desfecho vem de evidência MEDIDA pelo probe live.
  const MEASURED_ITEM = {
    id: 'V2-99',
    requirement: 'x',
    suites: ['a.test.js'],
    reports: [],
    evidence: { path: 'reports/x-evidence.json', statePath: 'state' },
  };
  const measured = (state, extra = {}) => () => ({
    exists: true,
    state,
    generatedAt: '2026-09-29T00:00:00.000Z',
    ...extra,
  });
  const NO_REPORTS = () => ({ exists: false });

  test('EVIDÊNCIA MEDIDA: state PASS vira PROVEN (medido, nunca declarado)', () => {
    const result = classifyRequiredTest(MEASURED_ITEM, {
      suiteState: ALL_PASS,
      reportState: NO_REPORTS,
      evidenceState: measured('PASS'),
    });
    expect(result.classification).toBe('PROVEN');
    expect(result.blocking).toBe(false);
    expect(result.detail).toMatch(/MEDIDO/);
  });

  test('EVIDÊNCIA MEDIDA: falha do PROVEDOR externo vira BLOCKED_EXTERNAL com o motivo REAL', () => {
    const result = classifyRequiredTest(MEASURED_ITEM, {
      suiteState: ALL_PASS,
      reportState: NO_REPORTS,
      evidenceState: measured('FAIL_AUTH', { httpStatus: 401, providerError: 'Incorrect API key provided' }),
    });
    expect(result.classification).toBe('BLOCKED_EXTERNAL');
    // Impedimento do provedor não é defeito de código: não bloqueia, mas JAMAIS vira PASS.
    expect(result.blocking).toBe(false);
    expect(result.detail).toContain('FAIL_AUTH');
    expect(result.detail).toContain('401');
    expect(result.detail).toContain('Incorrect API key provided');
  });

  test('EVIDÊNCIA MEDIDA: credencial não cadastrada é impedimento externo declarado PELA MEDIÇÃO', () => {
    const result = classifyRequiredTest(MEASURED_ITEM, {
      suiteState: ALL_PASS,
      reportState: NO_REPORTS,
      evidenceState: measured('NOT_EXECUTED_NO_CREDENTIAL'),
    });
    expect(result.classification).toBe('BLOCKED_EXTERNAL');
    expect(result.blocking).toBe(false);
  });

  test('EVIDÊNCIA MEDIDA: desfecho que NÃO é falha do provedor é defeito NOSSO (bloqueia)', () => {
    for (const state of ['FAIL_UNEXPECTED', 'FAIL_INVALID_RESPONSE', 'FAIL_NORMALIZATION']) {
      const result = classifyRequiredTest(MEASURED_ITEM, {
        suiteState: ALL_PASS,
        reportState: NO_REPORTS,
        evidenceState: measured(state),
      });
      expect(result.classification).toBe('UNPROVEN');
      expect(result.blocking).toBe(true);
    }
  });

  test('EVIDÊNCIA MEDIDA ausente ⇒ UNPROVEN: fail-closed, nunca assume sucesso', () => {
    const result = classifyRequiredTest(MEASURED_ITEM, {
      suiteState: ALL_PASS,
      reportState: NO_REPORTS,
      evidenceState: () => ({ exists: false }),
    });
    expect(result.classification).toBe('UNPROVEN');
    expect(result.blocking).toBe(true);
  });

  // Os dois testes abaixo são a proteção central: uma evidência ANTIGA não pode mascarar uma suíte
  // que quebrou nem uma suíte que não executou. Sem esta precedência, bastaria uma medição PASS de
  // um ciclo anterior para um gate ficar verde sobre execução inexistente.
  test('EVIDÊNCIA MEDIDA nunca mascara suíte FALHA (precedência de execução)', () => {
    const result = classifyRequiredTest(MEASURED_ITEM, {
      suiteState: () => ({ state: 'FAIL' }),
      reportState: NO_REPORTS,
      evidenceState: measured('PASS'),
    });
    expect(result.classification).toBe('FAILED');
    expect(result.blocking).toBe(true);
  });

  test('EVIDÊNCIA MEDIDA nunca mascara suíte NÃO EXECUTADA (precedência de execução)', () => {
    const result = classifyRequiredTest(MEASURED_ITEM, {
      suiteState: () => ({ state: 'NOT_EXECUTED' }),
      reportState: NO_REPORTS,
      evidenceState: measured('PASS'),
    });
    expect(result.classification).toBe('NOT_EXECUTED');
    expect(result.blocking).toBe(true);
  });

  test('agregado: um único item não provado mantém o gate em FAIL', () => {
    const derived = deriveRequiredTests({
      items: [
        { id: 'V2-01', requirement: 'ok', suites: ['a.test.js'], reports: [] },
        { id: 'V2-02', requirement: 'gap', suites: [], reports: [], gapReason: 'sem prova' },
      ],
      suiteState: ALL_PASS,
      reportState: ALL_REPORTS_OK,
    });
    expect(derived.status).toBe('FAIL');
    expect(derived.unresolvedIds).toEqual(['V2-02']);
  });
});
