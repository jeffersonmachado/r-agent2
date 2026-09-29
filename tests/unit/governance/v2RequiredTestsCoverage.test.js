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
