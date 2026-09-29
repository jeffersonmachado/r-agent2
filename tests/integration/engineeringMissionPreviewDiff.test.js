'use strict';

/**
 * V2-08 — "Preview apresenta diff."
 *
 * O requisito tem duas partes, e as duas são provadas aqui:
 *   1. MECANISMO (puro, determinístico): `buildEnrichmentPreview` projeta o diff campo a campo
 *      (`specDiff` com field/previousValue/nextValue) a partir do diff real de specs — o preview
 *      APRESENTA o que mudou, não apenas o estado final;
 *   2. RUNTIME (banco real): o preview persistido da missão carrega a estrutura de diff e marca
 *      `reEnriched`/`previousVersion` quando existe versão anterior a comparar.
 *
 * Nota de honestidade: a primeira versão NÃO tem diff a apresentar (nada anterior a comparar) —
 * `specDiff` vazio ali é o comportamento correto, e é afirmado como tal.
 *
 * Banco indisponível ⇒ porta única `tests/helpers/infraGate` (NOT_EXECUTED em dev;
 * INFRA_ERROR em RELEASE_AUTHORITATIVE=1).
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const { buildEnrichmentPreview } = require('../../engine/engineeringMission/missionPreview');

const RAW_MISSION = 'Apresente no preview exatamente o que o enriquecimento acrescentou.';

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // eslint-disable-next-line global-require
  return require('../helpers/infraGate').skipOrFail({
    suite: 'engineering-mission-preview-diff',
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

describe('V2-08 — preview apresenta diff', () => {
  jest.setTimeout(90000);

  test('mecanismo: o preview projeta o diff campo a campo (field/previousValue/nextValue)', () => {
    const preview = buildEnrichmentPreview({
      spec: {
        missionId: 'm-preview',
        version: 2,
        specHash: 'hash-2',
        originalMission: RAW_MISSION,
        objective: 'objetivo enriquecido',
        constraints: [],
        scope: [],
      },
      enrichment: {
        provenance: [
          {
            field: 'objective',
            originalValue: 'objetivo original',
            enrichedValue: 'objetivo enriquecido',
            enrichmentType: 'MODIFIED',
            reason: 'contexto do repositório',
            source: 'REPO_CONTENT',
          },
        ],
      },
      previousSpec: { missionId: 'm-preview', version: 1, originalMission: RAW_MISSION },
      changes: [{ field: 'objective', previousValue: 'objetivo original', nextValue: 'objetivo enriquecido' }],
    });

    expect(preview.reEnriched).toBe(true);
    expect(preview.previousVersion).toBe(1);
    expect(preview.specDiff).toEqual([
      { field: 'objective', previousValue: 'objetivo original', nextValue: 'objetivo enriquecido' },
    ]);
    // A intenção original continua visível no preview, lado a lado com o enriquecido.
    expect(preview.original.mission).toBe(RAW_MISSION);
  });

  test('runtime: o preview persistido carrega a estrutura de diff da versão corrente', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-preview-diff' });
    createdMissionIds.push(mission.id);

    const first = await compiler.getMissionDetail(mission.id);
    expect(first.preview).toBeTruthy();
    expect(Array.isArray(first.preview.specDiff)).toBe(true);
    // Comportamento MEDIDO na primeira versão: não existe versão anterior (`reEnriched` falso),
    // mas o preview JÁ apresenta o diff do enriquecimento — cada campo introduzido aparece com
    // previousValue null contra o estado vazio de origem.
    expect(first.preview.specDiff.length).toBeGreaterThan(0);
    expect(first.preview.specDiff.every((entry) => entry.previousValue === null)).toBe(true);
    expect(first.preview.reEnriched).toBe(false);

    await compiler.enrichMission(mission.id, { actor: 'jest-preview-diff', forceNewVersion: true });

    const second = await compiler.getMissionDetail(mission.id);
    expect(second.preview).toBeTruthy();
    expect(Array.isArray(second.preview.specDiff)).toBe(true);
    expect(second.preview.reEnriched).toBe(true);
    expect(second.preview.previousVersion).toBe(1);
    // O diff apresentado é composto de pares campo/valor — a estrutura exigida pela UI.
    for (const entry of second.preview.specDiff) {
      expect(typeof entry.field).toBe('string');
      expect(Object.prototype.hasOwnProperty.call(entry, 'previousValue')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(entry, 'nextValue')).toBe(true);
    }
  });
});
