'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fingerprintObject } = require('../../../qa/coverage/fingerprints');
const {
  buildInventory,
  diffInventories,
  findOrphanedItems,
} = require('../../../api/services/qa/inventory/inventoryEngine');

function writeFixture(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const MODEL_V1 = `'use strict';
const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');
let Foo = null;
function getFooModel() {
  if (!Foo) {
    Foo = getSequelize().define('Foo', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
    }, { tableName: 'foos' });
  }
  return Foo;
}
module.exports = getFooModel;
`;

const MODEL_V2 = MODEL_V1.replace(
  "tenant_id: { type: DataTypes.STRING, allowNull: false },",
  "tenant_id: { type: DataTypes.STRING, allowNull: false },\n      status: { type: DataTypes.STRING, allowNull: true },",
);

function createFixtureRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-engine-'));

  writeFixture(rootDir, 'api/app/routeRegistry.js', `'use strict';
function createRouteRegistry(routers) {
  return [{ router: routers.fitnessRouter }];
}
module.exports = { createRouteRegistry };
`);
  writeFixture(rootDir, 'api/app/registerRoutes.js', `'use strict';
const { createFitnessRoutes } = require('../modules/fitness/routes');
function registerRoutes() {
  const fitnessRouter = createFitnessRoutes();
  return [fitnessRouter];
}
module.exports = { registerRoutes };
`);
  writeFixture(rootDir, 'api/modules/fitness/routes.js', `'use strict';
const express = require('express');
function createFitnessRoutes() {
  const router = express.Router();
  router.get('/api/fitness/students', requireAuth, async (req, res) => {});
  return router;
}
module.exports = { createFitnessRoutes };
`);
  writeFixture(rootDir, 'frontend/src/main.jsx', `
const isRoute = (basePath) => currentPath === basePath;
const isX = isRoute('/fitness/students');
const isY = isRoute('/zzz-sem-vinculo');
`);
  writeFixture(rootDir, 'frontend/src/navigation/menu.js', `
export const navigationMenu = [];
`);
  writeFixture(rootDir, 'api/db/models/Foo.js', MODEL_V1);
  writeFixture(rootDir, 'config/journey-contracts.json', JSON.stringify({
    version: 1,
    journeys: { fitness_customer_checkin: { requiredCapabilities: ['checkin'] } },
  }));
  writeFixture(rootDir, 'qa-mesh/meshRegistry.json', JSON.stringify([
    { id: 'm1', domain: 'fitness' },
  ]));

  return rootDir;
}

describe('inventoryEngine', () => {
  let rootDir;

  beforeEach(() => {
    rootDir = createFixtureRoot();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('gera inventário completo com fingerprints determinísticos', () => {
    const first = buildInventory({ rootDir, now: new Date('2026-07-25T00:00:00Z') });
    const second = buildInventory({ rootDir, now: new Date('2026-07-25T00:00:00Z') });

    expect(first.version).toBe(1);
    expect(first.generatedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(first.counts.total).toBe(first.items.length);
    expect(first.items.every((item) => /^[0-9a-f]{64}$/.test(item.fingerprint))).toBe(true);

    const fp = (inv) => inv.items.map((item) => `${item.id}:${item.fingerprint}`);
    expect(fp(first)).toEqual(fp(second));
  });

  it('fingerprint é sensível a mudança estrutural (diff detecta changed/added)', () => {
    const before = buildInventory({ rootDir, now: new Date('2026-07-25T00:00:00Z') });
    writeFixture(rootDir, 'api/db/models/Foo.js', MODEL_V2);
    const after = buildInventory({ rootDir, now: new Date('2026-07-25T00:00:00Z') });

    const diff = diffInventories(before, after);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toContain('field:Foo.status');
    expect(diff.changed.map((entry) => entry.id)).toContain('model:Foo');
    const changed = diff.changed.find((entry) => entry.id === 'model:Foo');
    expect(changed.beforeFingerprint).not.toBe(changed.afterFingerprint);
  });

  it('diff detecta added e removed por id', () => {
    const prev = { items: [{ id: 'a', fingerprint: '1' }, { id: 'b', fingerprint: '2' }] };
    const next = { items: [{ id: 'b', fingerprint: '2' }, { id: 'c', fingerprint: '3' }] };
    const diff = diffInventories(prev, next);
    expect(diff.added).toEqual(['c']);
    expect(diff.removed).toEqual(['a']);
    expect(diff.changed).toEqual([]);
  });

  it('vincula itens a jornadas por tokens de módulo/path/domínio', () => {
    const inventory = buildInventory({ rootDir });
    const api = inventory.items.find((item) => item.id === 'api:GET:/api/fitness/students');
    expect(api.linkStatus).toBe('LINKED');
    expect(api.linkKind).toBe('journey');
    expect(api.linkedJourneys).toContain('fitness_customer_checkin');
    expect(api.linkedDomains).toContain('fitness');
  });

  it('marca como ORPHANED item PRODUCTION sem vínculo com jornada', () => {
    const inventory = buildInventory({ rootDir });
    const orphan = inventory.items.find((item) => item.id === 'page:/zzz-sem-vinculo');
    expect(orphan.linkStatus).toBe('ORPHANED');
    expect(inventory.counts.orphaned).toBeGreaterThanOrEqual(1);
  });

  it('item DEVELOPMENT sem jornada recebe technicalWave e não é órfão', () => {
    const items = findOrphanedItems([
      {
        id: 'api:GET:/api/qa-waves/x', kind: 'api', method: 'GET', path: '/api/qa-waves/x',
        module: 'qa-waves', classification: 'DEVELOPMENT',
      },
    ], { journeyContracts: { journeys: {} }, meshRegistry: [] });
    expect(items[0].linkStatus).toBe('LINKED');
    expect(items[0].linkKind).toBe('technical-wave');
    expect(items[0].technicalWave).toBe('resilience');
  });

  it('item de dados sem jornada recebe technicalWave database-integrity', () => {
    const items = findOrphanedItems([
      {
        id: 'table:zzz', kind: 'table', table: 'zzz', model: 'Zzz', classification: 'PRODUCTION',
      },
    ], { journeyContracts: { journeys: {} }, meshRegistry: [] });
    expect(items[0].linkStatus).toBe('LINKED');
    expect(items[0].technicalWave).toBe('database-integrity');
  });

  it('fingerprintObject é estável independente da ordem das chaves', () => {
    expect(fingerprintObject({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(fingerprintObject({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprintObject({ a: 1 })).not.toBe(fingerprintObject({ a: 2 }));
  });

  it('item PRODUCTION de módulo declarado no technical-wave-map recebe a wave declarada', () => {
    const map = {
      version: 1,
      waves: { security: { modules: ['auth'] }, platform: { modules: ['tenant'] } },
    };
    const items = findOrphanedItems([
      {
        id: 'api:GET:/api/auth/me', kind: 'api', method: 'GET', path: '/api/auth/me',
        module: 'auth', classification: 'PRODUCTION',
      },
      {
        id: 'api:GET:/tenants', kind: 'api', method: 'GET', path: '/tenants',
        module: 'tenant', classification: 'PRODUCTION',
      },
    ], { journeyContracts: { journeys: {} }, meshRegistry: [], technicalWaveMap: map });
    expect(items[0].linkStatus).toBe('LINKED');
    expect(items[0].linkKind).toBe('technical-wave');
    expect(items[0].technicalWave).toBe('security');
    expect(items[1].linkStatus).toBe('LINKED');
    expect(items[1].technicalWave).toBe('platform');
  });

  it('item PRODUCTION de módulo NÃO declarado continua ORPHANED (declaração é explícita)', () => {
    const map = { version: 1, waves: { security: { modules: ['auth'] } } };
    const items = findOrphanedItems([
      {
        id: 'api:GET:/api/marketing/forms', kind: 'api', method: 'GET', path: '/api/marketing/forms',
        module: 'domain-business', classification: 'PRODUCTION',
      },
    ], { journeyContracts: { journeys: {} }, meshRegistry: [], technicalWaveMap: map });
    expect(items[0].linkStatus).toBe('ORPHANED');
  });

  it('superfície DEVELOPMENT/SUPPORT nunca é journey-linked por coincidência de token', () => {
    // /api/debug/* (SUPPORT) tem token 'support', que casa com a jornada
    // support_ticket_flow — mas superfície de engenharia/suporte pertence a
    // wave técnica, não a jornada de negócio (política de segregação).
    const items = findOrphanedItems([
      {
        id: 'api:POST:/api/debug/entities/extract', kind: 'api', method: 'POST',
        path: '/api/debug/entities/extract', module: 'support-debug', classification: 'SUPPORT',
      },
    ], { journeyContracts: { journeys: { support_ticket_flow: {} } }, meshRegistry: [] });
    expect(items[0].linkStatus).toBe('LINKED');
    expect(items[0].linkKind).toBe('technical-wave');
    expect(items[0].technicalWave).toBe('support-diagnostics');
    expect(items[0].linkedJourneys).toEqual([]);
  });

  it('módulo declarado no technical-wave-map não é journey-linked por coincidência de token', () => {
    const map = { version: 1, waves: { platform: { modules: ['domain-admin'] } } };
    const items = findOrphanedItems([
      {
        id: 'api:GET:/system/channel-health', kind: 'api', method: 'GET',
        path: '/system/channel-health', module: 'domain-admin', classification: 'PRODUCTION',
      },
    ], {
      journeyContracts: { journeys: { channel_accounts: {} } },
      meshRegistry: [],
      technicalWaveMap: map,
    });
    expect(items[0].linkStatus).toBe('LINKED');
    expect(items[0].linkKind).toBe('technical-wave');
    expect(items[0].technicalWave).toBe('platform');
    expect(items[0].linkedJourneys).toEqual([]);
  });

  it('itens de dados continuam elegíveis a journey-linking (grafo de rastreabilidade)', () => {
    const items = findOrphanedItems([
      {
        id: 'model:Ticket', kind: 'model', model: 'Ticket', table: 'tickets', classification: 'PRODUCTION',
      },
    ], { journeyContracts: { journeys: { support_ticket_flow: {} } }, meshRegistry: [] });
    expect(items[0].linkStatus).toBe('LINKED');
    expect(items[0].linkKind).toBe('journey');
    expect(items[0].linkedJourneys).toContain('support_ticket_flow');
  });

  it('mapa real versionado liga módulos de plataforma às waves declaradas', () => {
    const map = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../../config/technical-wave-map.json'), 'utf8'),
    );
    const declared = Object.values(map.waves).flatMap((wave) => wave.modules);
    // Módulos declarados existem de fato no inventário real (sem declaração fantasma).
    const inventory = buildInventory({ rootDir: path.join(__dirname, '../../..') });
    const realModules = new Set(inventory.items.map((item) => item.module));
    for (const moduleName of declared) {
      expect(realModules.has(moduleName)).toBe(true);
    }
    // E todo item desses módulos ficou LINKED à wave declarada (não ORPHANED).
    const orphans = inventory.items.filter(
      (item) => item.linkStatus === 'ORPHANED' && declared.includes(item.module),
    );
    expect(orphans).toEqual([]);
  });
});
