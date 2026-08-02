'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadDbIntegrityTechnicalExecutions } = require('../../../scripts/governance/validate-coverage-gate');

/**
 * Regressão: itens `relation:` do inventário ficavam fora das execuções
 * técnicas da Database Integrity Wave ("ficam fora por ora"), mantendo a
 * dimensão relation do coverage gate em 0% para sempre. A wave passou a
 * validar FKs de verdade (perRelation no relatório) e o gate passa a
 * mapear esses estados para os itens relation: de mesmo id.
 */
function writeReport(payload) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbi-report-')), 'report.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return file;
}

const INVENTORY_ITEMS = [
  { id: 'model:Widget', kind: 'model', model: 'Widget' },
  { id: 'field:Widget.tenant_key', kind: 'field', model: 'Widget' },
  { id: 'relation:Widget.tenant_key->tenants.id', kind: 'relation', model: 'Widget' },
  { id: 'relation:Widget.owner_id->users.id', kind: 'relation', model: 'Widget' },
];

describe('coverage-gate — loadDbIntegrityTechnicalExecutions com perRelation', () => {
  test('mapeia perRelation para itens relation: de mesmo id', () => {
    const reportPath = writeReport({
      generatedAt: new Date().toISOString(), // relatório fresco — data fixa vira bomba-relógio com a política STALE de 7 dias
      dbAvailable: true,
      perModel: [{ id: 'model:Widget', state: 'VALIDATED' }],
      perRelation: [
        { id: 'relation:Widget.tenant_key->tenants.id', state: 'VALIDATED' },
        { id: 'relation:Widget.owner_id->users.id', state: 'FAILED' },
      ],
    });

    const { executions, dbAvailable } = loadDbIntegrityTechnicalExecutions(INVENTORY_ITEMS, { reportPath });

    expect(dbAvailable).toBe(true);
    expect(executions).toEqual(
      expect.arrayContaining([
        { itemId: 'model:Widget', state: 'VALIDATED' },
        { itemId: 'field:Widget.tenant_key', state: 'VALIDATED' },
        { itemId: 'relation:Widget.tenant_key->tenants.id', state: 'VALIDATED' },
        { itemId: 'relation:Widget.owner_id->users.id', state: 'FAILED' },
      ]),
    );
    expect(executions).toHaveLength(4);
  });

  test('relatório sem perRelation (formato antigo) não emite execuções de relation', () => {
    const reportPath = writeReport({
      generatedAt: new Date().toISOString(), // relatório fresco — data fixa vira bomba-relógio com a política STALE de 7 dias
      dbAvailable: true,
      perModel: [{ id: 'model:Widget', state: 'VALIDATED' }],
    });

    const { executions } = loadDbIntegrityTechnicalExecutions(INVENTORY_ITEMS, { reportPath });

    expect(executions).toHaveLength(2);
    expect(executions.every((e) => !e.itemId.startsWith('relation:'))).toBe(true);
  });

  test('entrada perRelation sem item de inventário correspondente é ignorada', () => {
    const reportPath = writeReport({
      generatedAt: new Date().toISOString(), // relatório fresco — data fixa vira bomba-relógio com a política STALE de 7 dias
      dbAvailable: true,
      perModel: [],
      perRelation: [{ id: 'relation:Ghost.x->y.id', state: 'VALIDATED' }],
    });

    const { executions } = loadDbIntegrityTechnicalExecutions(INVENTORY_ITEMS, { reportPath });

    expect(executions).toEqual([]);
  });
});
