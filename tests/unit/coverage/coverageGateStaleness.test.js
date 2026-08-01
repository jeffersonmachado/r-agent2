'use strict';

/**
 * Regressão — evidência técnica STALE não conta como cobertura válida.
 *
 * Falha observada (2026-08-01): o coverage gate consumiu
 * reports/db-integrity-report.json com 6 dias de idade e
 * reports/api-surface-report.json com 2 dias sem qualquer degradação —
 * apenas o relatório de tenant-isolation tinha política de frescor
 * (TENANT_REPORT_MAX_AGE_MS). Evidência velha contava como VALIDATED,
 * violando o modelo de estados (STALE) e a regra "evidência stale não
 * conta como cobertura válida".
 *
 * Comportamento correto esperado:
 * 1. Relatório de wave mais velho que o limiar (padrão 7 dias,
 *    override por options.maxAgeMs) tem estados VALIDATED degradados
 *    para STALE — deixam de contar como cobertura válida.
 * 2. Relatório fresco não sofre degradação.
 * 3. Relatório sem generatedAt é tratado como stale.
 * 4. Estados não-VALIDATED (VISITED, FAILED) são preservados.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadDbIntegrityTechnicalExecutions,
  loadApiSurfaceTechnicalExecutions,
  loadPageSurfaceTechnicalExecutions,
} = require('../../../scripts/governance/validate-coverage-gate');

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function writeReport(payload) {
  const reportPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'wave-stale-')),
    'report.json',
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return reportPath;
}

function isoDaysAgo(days) {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

const API_INVENTORY = [
  { id: 'api:GET:/api/widgets', kind: 'api' },
  { id: 'api:POST:/api/widgets', kind: 'api' },
];

const MODEL_INVENTORY = [
  { id: 'model:Widget', kind: 'model', model: 'Widget' },
  { id: 'field:Widget.status', kind: 'field', model: 'Widget' },
];

const PAGE_INVENTORY = [{ id: 'page:/agenda', kind: 'page' }];

describe('coverage-gate — frescor das evidências de wave (STALE)', () => {
  test('api-surface com 8 dias: VALIDATED degrada para STALE', () => {
    const reportPath = writeReport({
      generatedAt: isoDaysAgo(8),
      perItem: [
        { id: 'api:GET:/api/widgets', state: 'VALIDATED' },
        { id: 'api:POST:/api/widgets', state: 'VISITED' },
      ],
    });
    const { executions, stale } = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
    });
    expect(stale).toBe(true);
    expect(executions).toEqual([
      { itemId: 'api:GET:/api/widgets', state: 'STALE' },
      { itemId: 'api:POST:/api/widgets', state: 'VISITED' },
    ]);
  });

  test('api-surface fresco (1h): estados preservados, stale=false', () => {
    const reportPath = writeReport({
      generatedAt: isoDaysAgo(1 / 24),
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });
    const { executions, stale } = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
    });
    expect(stale).toBe(false);
    expect(executions).toEqual([{ itemId: 'api:GET:/api/widgets', state: 'VALIDATED' }]);
  });

  test('api-surface sem generatedAt: tratado como stale', () => {
    const reportPath = writeReport({
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });
    const { stale, executions } = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
    });
    expect(stale).toBe(true);
    expect(executions).toEqual([{ itemId: 'api:GET:/api/widgets', state: 'STALE' }]);
  });

  test('api-surface com maxAgeMs customizado: limiar respeitado', () => {
    const reportPath = writeReport({
      generatedAt: isoDaysAgo(2),
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });
    const fresh = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
      maxAgeMs: 3 * 24 * 60 * 60 * 1000,
    });
    expect(fresh.stale).toBe(false);
    const stale = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
      maxAgeMs: 1 * 24 * 60 * 60 * 1000,
    });
    expect(stale.stale).toBe(true);
    expect(stale.executions[0].state).toBe('STALE');
  });

  test('db-integrity velho: models e fields degradam para STALE', () => {
    const reportPath = writeReport({
      generatedAt: isoDaysAgo(10),
      dbAvailable: true,
      perModel: [{ id: 'model:Widget', state: 'VALIDATED' }],
      perRelation: [],
    });
    const { executions, stale } = loadDbIntegrityTechnicalExecutions(MODEL_INVENTORY, {
      reportPath,
      nowMs: NOW,
    });
    expect(stale).toBe(true);
    expect(executions).toEqual([
      { itemId: 'model:Widget', state: 'STALE' },
      { itemId: 'field:Widget.status', state: 'STALE' },
    ]);
  });

  test('page-surface velho: páginas degradam para STALE', () => {
    const reportPath = writeReport({
      generatedAt: isoDaysAgo(30),
      perItem: [{ id: 'page:/agenda', state: 'VALIDATED' }],
    });
    const { executions, stale } = loadPageSurfaceTechnicalExecutions(PAGE_INVENTORY, {
      reportPath,
      nowMs: NOW,
    });
    expect(stale).toBe(true);
    expect(executions).toEqual([{ itemId: 'page:/agenda', state: 'STALE' }]);
  });
});
