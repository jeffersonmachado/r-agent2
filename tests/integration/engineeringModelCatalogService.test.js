'use strict';

/**
 * ER-V1-FINAL-008 (Current Model Catalog) — reconciliação real (Postgres) do catálogo
 * governado. `reconcileDiscoveredModel` nunca é a fonte de elegibilidade do Router (isso
 * continua sendo só `engine/engineeringRouter/modelCapabilities.js`) — é a camada de
 * auditoria/governança sobre o que o discovery real encontra.
 */

const sequelizeModule = require('../../api/db/sequelize');
const modelCatalogService = require('../../api/services/engineeringRouter/modelCatalogService');

jest.setTimeout(30000);

let dbAvailable = false;
let dbReason = null;
const PROVIDER_ID = 'engineering-router-catalog-test';

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[model-catalog-service] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
});

afterEach(async () => {
  if (!dbAvailable) return;
  const getModels = require('../../api/db/models');
  const CatalogEntry = getModels.getEngineeringModelCatalogEntry();
  await CatalogEntry.destroy({ where: { provider_id: PROVIDER_ID } }).catch(() => {});
});

afterAll(async () => {
  await sequelizeModule.close().catch(() => {});
});

describe('ER-V1-FINAL-008 — modelCatalogService (Postgres real)', () => {
  test('provider real lista modelo novo, ausente da allowlist estática → entrada persistida como DISCOVERED', async () => {
    if (skipIfNoDatabase()) return;
    const entry = await modelCatalogService.reconcileDiscoveredModel({
      providerId: PROVIDER_ID,
      modelId: 'modelo-novo-nunca-visto',
      isMapped: false,
      listedByProviderNow: true,
      evidence: { source: 'test' },
    });
    expect(entry).not.toBeNull();
    expect(entry.status).toBe('DISCOVERED');

    const fetched = await modelCatalogService.getCatalogEntry(PROVIDER_ID, 'modelo-novo-nunca-visto');
    expect(fetched.status).toBe('DISCOVERED');
    expect(modelCatalogService.isEligibleForRisk(fetched.status, 'HIGH')).toBe(false);
    expect(modelCatalogService.isEligibleForRisk(fetched.status, 'CRITICAL')).toBe(false);
  });

  test('modelo mapeado e confirmado pelo discovery real → persistido como APPROVED, elegível', async () => {
    if (skipIfNoDatabase()) return;
    const entry = await modelCatalogService.reconcileDiscoveredModel({
      providerId: PROVIDER_ID,
      modelId: 'modelo-mapeado-presente',
      isMapped: true,
      listedByProviderNow: true,
    });
    expect(entry.status).toBe('APPROVED');
    expect(modelCatalogService.isEligibleForRisk(entry.status, 'CRITICAL')).toBe(true);
  });

  test('modelo antes mapeado e presente, cujo discovery real confirma que o provider deixou de listar → RETIRED, nunca elegível', async () => {
    if (skipIfNoDatabase()) return;
    await modelCatalogService.reconcileDiscoveredModel({
      providerId: PROVIDER_ID,
      modelId: 'modelo-removido-depois',
      isMapped: true,
      listedByProviderNow: true,
    });
    const retired = await modelCatalogService.reconcileDiscoveredModel({
      providerId: PROVIDER_ID,
      modelId: 'modelo-removido-depois',
      isMapped: true,
      listedByProviderNow: false,
    });
    expect(retired.status).toBe('RETIRED');
    expect(modelCatalogService.isEligibleForRisk(retired.status)).toBe(false);

    const fetched = await modelCatalogService.getCatalogEntry(PROVIDER_ID, 'modelo-removido-depois');
    expect(fetched.status).toBe('RETIRED');
  });

  test('reconciliação repetida com os mesmos fatos é idempotente — nunca duplica a entrada', async () => {
    if (skipIfNoDatabase()) return;
    await modelCatalogService.reconcileDiscoveredModel({
      providerId: PROVIDER_ID,
      modelId: 'modelo-idempotente',
      isMapped: false,
      listedByProviderNow: true,
    });
    await modelCatalogService.reconcileDiscoveredModel({
      providerId: PROVIDER_ID,
      modelId: 'modelo-idempotente',
      isMapped: false,
      listedByProviderNow: true,
    });
    const all = await modelCatalogService.listCatalogEntries({ status: 'DISCOVERED' });
    const matching = all.filter((e) => e.provider_id === PROVIDER_ID && e.model_id === 'modelo-idempotente');
    expect(matching.length).toBe(1);
  });
});
