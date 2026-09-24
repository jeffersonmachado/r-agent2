'use strict';

/**
 * Degradação e falha do enriquecimento — provas de que o Mission Compiler NÃO inventa, NÃO engole
 * erro e NÃO deixa estado divergente.
 *
 *   ADV-10 resposta malformada do provedor de IA
 *   ADV-11 alucinação de fato pelo modelo (fatos vêm do coletor, não do modelo)
 *   ADV-14 banco indisponível ⇒ persistence_required (sem fallback em memória)
 *   ADV-15 falha parcial ao gravar a versão ⇒ missão não avança e continua retomável
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO.
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');

const ENRICHER_PROVIDER = 'qwen'; // único provider com modelos ENRICHER na allowlist
const TEST_TENANT_KEY = 'jest-mission-enrichment-degradation';
const RAW_MISSION = 'Corrija o defeito de soma em mathUtils.';

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // Porta ÚNICA de infraestrutura (§11/§12): em RELEASE_AUTHORITATIVE=1 isto LANÇA INFRA_ERROR
  // (nunca PASS silencioso); em dev registra NOT_EXECUTED com motivo.
  return require('../helpers/infraGate').skipOrFail({ suite: 'mission-enrichment-degradation', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

async function newMission() {
  const { mission } = await compiler.compileMission(RAW_MISSION, {
    createdBy: 'jest-degradation',
    tenantId: TEST_TENANT_KEY,
  });
  createdMissionIds.push(mission.id);
  return mission;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
    return;
  }
  const getModels = require('../../api/db/models');
  await getModels.getTenant().findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest — Mission degradation', status: 'active', plan: 'enterprise' },
  });
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  await saveAICredentials(TEST_TENANT_KEY, ENRICHER_PROVIDER, `jest-fixture-fake-key-${Date.now()}`);
}, 30000);

afterAll(async () => {
  if (!dbAvailable) return;
  clearAiProviderConfig(ENRICHER_PROVIDER);
  const getModels = require('../../api/db/models');
  try {
    if (createdMissionIds.length > 0) {
      await getModels.EngineeringMissionApproval().destroy({ where: { mission_id: createdMissionIds } });
      await getModels.EngineeringMissionVersion().destroy({ where: { mission_id: createdMissionIds } });
      await getModels.EngineeringMission().destroy({ where: { id: createdMissionIds } });
    }
    const tenant = await getModels.getTenant().findOne({ where: { tenant_key: TEST_TENANT_KEY } });
    if (tenant) {
      await getModels.getTenantAICredential().destroy({ where: { tenant_id: tenant.id, provider: ENRICHER_PROVIDER } });
      await getModels.getTenant().destroy({ where: { tenant_key: TEST_TENANT_KEY } });
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('Engineering Mission — degradação do enriquecimento', () => {
  jest.setTimeout(60000);

  test('ADV-10: resposta malformada do modelo não vira enriquecimento inventado', async () => {
    if (skipIfNoDatabase()) return;
    registerAiProvider(ENRICHER_PROVIDER, {
      async generate() { return { text: 'isso não é JSON — apenas texto solto', usage: null }; },
    });
    const mission = await newMission();

    expect(mission.enrichment.degraded).toEqual(expect.arrayContaining([expect.stringContaining('MALFORMED_MODEL_RESPONSE')]));
    expect(mission.enrichment.modelSelection.selected).toBeTruthy(); // houve candidato real
    // O enriquecimento continua, mas APENAS com fatos + regras determinísticas.
    expect(mission.status).toBe('AWAITING_APPROVAL');
    expect(mission.currentSpec.derivedRequirements.length).toBeGreaterThan(0);
    expect(mission.currentSpec.objective).toBe(RAW_MISSION); // sem objetivo inventado pelo modelo
  }, 60000);

  test('ADV-10: falha total do provedor registra degradação e não derruba a missão', async () => {
    if (skipIfNoDatabase()) return;
    registerAiProvider(ENRICHER_PROVIDER, {
      async generate() {
        const err = new Error('provider fora do ar (simulado)');
        err.code = 'ECONNREFUSED';
        throw err;
      },
    });
    const mission = await newMission();
    expect(mission.enrichment.degraded).toEqual(expect.arrayContaining([expect.stringContaining('MODEL_INVOCATION_FAILED')]));
    expect(mission.status).toBe('AWAITING_APPROVAL');
  }, 60000);

  test('ADV-11: alucinação do modelo não cria fato — subsistema proposto é INFERRED e revisável', async () => {
    if (skipIfNoDatabase()) return;
    registerAiProvider(ENRICHER_PROVIDER, {
      async generate() {
        return {
          text: JSON.stringify({
            missionType: 'BUG_FIX',
            objective: 'Corrigir soma',
            subsystems: ['servico-que-nao-existe-xyz'],
            risk: 'LOW',
            confidence: 0.99,
            ambiguities: [],
          }),
          usage: null,
        };
      },
    });
    const mission = await newMission();

    // O modelo NÃO consegue declarar fatos: nenhum requisito derivado de banco/tenancy aparece.
    const ruleIds = mission.currentSpec.derivedRequirements.map((r) => r.ruleId);
    expect(ruleIds).not.toContain('DATABASE_MIGRATION');
    expect(ruleIds).not.toContain('TENANT_ISOLATION');

    // O subsistema proposto entra como INFERRED/MODEL_ENRICHMENT (revisável), nunca como
    // inspeção de repositório — a distinção fica visível na provenance.
    const provenance = mission.enrichment.provenance.filter((p) => p.field === 'subsystems' && p.enrichedValue === 'servico-que-nao-existe-xyz');
    expect(provenance).toHaveLength(1);
    expect(provenance[0].source).toBe('MODEL_ENRICHMENT');
    expect(provenance[0].enrichmentType).toBe('INFERRED');
    expect(provenance[0].reason).toMatch(/revisável/i);

    // Confiança do modelo (0.99) NÃO substitui a confiança calculada por evidência.
    expect(mission.enrichment_confidence).toBeLessThan(0.99);
  }, 60000);

  test('ADV-14: banco indisponível ⇒ persistence_required explícito (sem fallback em memória)', async () => {
    if (skipIfNoDatabase()) return;
    const getModels = require('../../api/db/models');
    const MissionModel = getModels.EngineeringMission();
    const spy = jest.spyOn(MissionModel, 'create').mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    try {
      await expect(missionStore.createMission({ originalMission: 'missão com banco fora', createdBy: 'jest' }))
        .rejects.toMatchObject({ code: 'persistence_required' });
    } finally {
      spy.mockRestore();
    }
  }, 40000);

  test('ADV-15: falha parcial ao gravar a versão não deixa mission divergente e mantém retomada', async () => {
    if (skipIfNoDatabase()) return;
    registerAiProvider(ENRICHER_PROVIDER, { async generate() { return { text: 'x', usage: null }; } });
    const { mission } = await missionStore.createMission({ originalMission: RAW_MISSION, createdBy: 'jest-degradation' });
    createdMissionIds.push(mission.id);

    const getModels = require('../../api/db/models');
    const VersionModel = getModels.EngineeringMissionVersion();
    const spy = jest.spyOn(VersionModel, 'create').mockRejectedValueOnce(new Error('disk full (simulado)'));
    let thrown = null;
    try {
      await compiler.enrichMission(mission.id, { actor: 'jest-degradation', tenantId: TEST_TENANT_KEY });
    } catch (err) {
      thrown = err;
    } finally {
      spy.mockRestore();
    }

    expect(thrown).toBeTruthy();
    expect(thrown.code).toBe('persistence_required');

    // A missão NÃO avançou de versão nem inventou aprovação — e continua retomável.
    const after = await missionStore.getMission(mission.id);
    expect(after.current_version).toBe(0);
    expect(await missionStore.listVersions(mission.id)).toHaveLength(0);
    expect(await missionStore.listApprovals(mission.id)).toHaveLength(0);

    const resumable = await missionStore.findResumableMissions({ limit: 200 });
    expect(resumable.some((m) => m.id === mission.id)).toBe(true);

    // E a retomada REAL completa o enriquecimento (idempotente, sem duplicar versão).
    const resumed = await compiler.enrichMission(mission.id, { actor: 'jest-degradation', tenantId: TEST_TENANT_KEY });
    expect(resumed.current_version).toBe(1);
    expect(await missionStore.listVersions(mission.id)).toHaveLength(1);
  }, 60000);
});
