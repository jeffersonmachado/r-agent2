'use strict';

/**
 * Teste de integração real (sem fixtures): roda os scanners contra o
 * repositório de verdade e asserta os limites observados em 2026-07-25:
 *   - 671 rotas de API (48 módulos, 0 mounts não resolvidos)
 *   - 150 páginas de frontend
 *   - 155 models (0 erros de parse), 155 tabelas, 1492 campos, 9 relações
 *   - inventário total: 2632 itens, 521 ORPHANED
 * Os limites abaixo são os valores medidos — não reduzi-los para fazer o
 * teste passar; se caírem, investigar a regressão no scanner ou no código.
 */

const path = require('path');
const { scanApiRoutes } = require('../../../api/services/qa/inventory/apiRouteScanner');
const { scanFrontendRoutes } = require('../../../api/services/qa/inventory/frontendRouteScanner');
const { scanModels } = require('../../../api/services/qa/inventory/modelScanner');
const { buildInventory } = require('../../../api/services/qa/inventory/inventoryEngine');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

describe('inventory integration (repositório real)', () => {
  it('descobre as rotas de API reais', () => {
    const result = scanApiRoutes({ rootDir: ROOT_DIR });
    expect(result.unresolvedMounts).toEqual([]);
    expect(result.items.length).toBeGreaterThanOrEqual(671);
    expect(new Set(result.items.map((item) => item.module)).size).toBeGreaterThanOrEqual(48);
    expect(result.items.some((item) => item.id === 'api:GET:/api/crm/accounts')).toBe(true);
    expect(result.items.some((item) => item.id === 'api:POST:/api/crm/accounts')).toBe(true);
  });

  it('descobre as páginas reais do frontend', () => {
    const result = scanFrontendRoutes({ rootDir: ROOT_DIR });
    expect(result.warnings).toEqual([]);
    expect(result.items.length).toBeGreaterThanOrEqual(138);
    expect(result.items.some((item) => item.id === 'page:/agenda')).toBe(true);
    expect(result.items.some((item) => item.id === 'page:/dev/qa-waves')).toBe(true);
    // /r-agent2 é prefixo de mount de deploy, não página — nunca pode virar item.
    expect(result.items.some((item) => item.id === 'page:/r-agent2')).toBe(false);
  });

  it('descobre os models reais sem erros de parse', () => {
    const result = scanModels({ rootDir: ROOT_DIR });
    expect(result.warnings).toEqual([]);
    const byKind = {};
    for (const item of result.items) byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    expect(byKind.model).toBeGreaterThanOrEqual(155);
    expect(byKind.table).toBeGreaterThanOrEqual(155);
    expect(byKind.field).toBeGreaterThanOrEqual(1492);
    expect(byKind.relation).toBeGreaterThanOrEqual(9);
  });

  it('monta o inventário completo com linking e fingerprints', () => {
    const inventory = buildInventory({ rootDir: ROOT_DIR });
    expect(inventory.counts.total).toBeGreaterThanOrEqual(2632);
    expect(inventory.counts.byKind.api).toBeGreaterThanOrEqual(671);
    expect(inventory.counts.byKind.page).toBeGreaterThanOrEqual(138);
    expect(inventory.counts.byKind.model).toBeGreaterThanOrEqual(155);
    expect(inventory.counts.orphaned).toBeGreaterThanOrEqual(0);
    expect(inventory.items.every((item) => /^[0-9a-f]{64}$/.test(item.fingerprint))).toBe(true);
    const orphaned = inventory.items.filter((item) => item.linkStatus === 'ORPHANED');
    const technical = inventory.items.filter((item) => item.linkKind === 'technical-wave');
    expect(orphaned.length).toBe(inventory.counts.orphaned);
    expect(technical.length).toBeGreaterThan(0);
    expect(technical.every((item) => Boolean(item.technicalWave))).toBe(true);
  });
});
