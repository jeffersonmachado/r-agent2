'use strict';

/**
 * V2-03 — "originalMission é imutável."
 *
 * Prova em DOIS níveis, com banco REAL:
 *   1. PERSISTÊNCIA: `updateMission`/`updateMissionGuarded` recusam qualquer patch que reescreva a
 *      intenção literal do usuário (ORIGINAL_MISSION_MUTATED) e o valor gravado permanece o mesmo,
 *      inclusive o hash;
 *   2. TRANSIÇÃO DE VERSÃO: editar a MissionSpec com patch que troca `originalMission` falha alto
 *      (a autoridade `assertOriginalMissionImmutable` é chamada antes de persistir);
 *   3. nenhuma versão da missão carrega `originalMission` diferente da intenção original.
 *
 * Banco indisponível ⇒ porta única `tests/helpers/infraGate`
 * (NOT_EXECUTED registrado em dev; INFRA_ERROR em RELEASE_AUTHORITATIVE=1 — nunca PASS silencioso).
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');

const RAW_MISSION = 'Imutabilidade: a intenção original do usuário nunca pode ser reescrita.';

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // eslint-disable-next-line global-require
  return require('../helpers/infraGate').skipOrFail({
    suite: 'engineering-mission-original-mission-immutability',
    available: dbAvailable,
    reason: dbReason,
    requirement: 'postgres',
  });
}

async function cleanupMission(missionId) {
  const models = require('../../api/db/models');
  await models.EngineeringMissionApproval().destroy({ where: { mission_id: missionId } });
  await models.EngineeringMissionVersion().destroy({ where: { mission_id: missionId } });
  await models.EngineeringMission().destroy({ where: { id: missionId } });
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 20000);

afterAll(async () => {
  if (dbAvailable) {
    for (const id of createdMissionIds) {
      await cleanupMission(id).catch(() => { /* best-effort */ });
    }
  }
  await sequelizeModule.close().catch(() => { /* best-effort */ });
}, 30000);

describe('V2-03 — originalMission é imutável', () => {
  jest.setTimeout(90000);

  test('UPDATE direto que tenta reescrever original_mission é recusado e o banco não muda', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-immutability' });
    createdMissionIds.push(mission.id);

    const before = await missionStore.getMission(mission.id);
    await expect(
      missionStore.updateMission(mission.id, { original_mission: 'INTENÇÃO REESCRITA POR UPDATE' }),
    ).rejects.toMatchObject({ code: 'ORIGINAL_MISSION_MUTATED' });

    const after = await missionStore.getMission(mission.id);
    expect(after.original_mission).toBe(before.original_mission);
    expect(after.original_mission_hash).toBe(before.original_mission_hash);
  });

  test('patch de edição de MissionSpec que troca originalMission falha alto', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-immutability' });
    createdMissionIds.push(mission.id);

    await expect(
      approvalService.editAndApprove(mission.id, {
        patch: { originalMission: 'INTENÇÃO TROCADA PELO PATCH' },
        actor: 'jest-immutability',
        approveEdited: false,
      }),
    ).rejects.toMatchObject({ code: 'ORIGINAL_MISSION_MUTATED' });

    const after = await missionStore.getMission(mission.id);
    expect(after.original_mission).toBe(RAW_MISSION);
  });

  test('nenhuma versão da missão carrega originalMission diferente da intenção original', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-immutability' });
    createdMissionIds.push(mission.id);

    await compiler.enrichMission(mission.id, { actor: 'jest-immutability', forceNewVersion: true });

    const versions = await missionStore.listVersions(mission.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    for (const version of versions) {
      expect(version.spec.originalMission).toBe(RAW_MISSION);
    }
  });
});
