'use strict';

/**
 * MERGE ACUMULATIVO DA MISSÃO SOB ESCRITA CONCORRENTE (perda de atualização).
 *
 * DEFEITO REAL MEDIDO (2026-10-20), comprovado pelo E2E do Bug Loop rodando em
 * paralelo com outra suíte do Router:
 *
 *   - `bugLoopCoordinatorService` gravava `resume.bugLoop.lineage` com
 *     `decision=REPLACE_TASK_RESUME_PHASE` e um `replacementTaskId` NOVO (log
 *     real: `replacementTaskId: 635d254e-…`);
 *   - a missão persistida ficava com a lineage ANTERIOR
 *     (`replacementTaskId === originalTaskId`), e o E2E falhava em
 *     `expect(lineage.replacementTaskId).not.toBe(originalTaskId)`.
 *
 * Causa: `mergeMissionJson` era read-modify-write puro (`getMission` → monta →
 * `update` incondicional). Duas escritas concorrentes partiam do mesmo snapshot e
 * a ÚLTIMA vencia com o snapshot ANTIGO, apagando a chave que a outra escreveu.
 *
 * O que este teste prova, sem mock nenhum (Postgres real, modelo real):
 *   1. duas escritas concorrentes em CHAVES DIFERENTES de `resume_metadata`
 *      sobrevivem as duas — nenhuma é apagada pela outra;
 *   2. duas escritas concorrentes na MESMA chave produzem um resultado válido
 *      (um dos dois valores), nunca um estado corrompido/parcial;
 *   3. o merge nunca perde `enrichment`/`preview` ao gravar `resume`.
 *
 * ANTES da correção o caso (1) falhava de forma intermitente — é exatamente a
 * corrida que corrompeu o E2E. O teste força a concorrência com muitas rodadas
 * (não confia em sorte de agendamento).
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (via infraGate), nunca PASS silencioso.
 */

const sequelizeModule = require('../../api/db/sequelize');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'mission-merge-concurrency',
    available: dbAvailable,
    reason: dbReason,
    requirement: 'postgres',
  });
}

function getModel() {
  return require('../../api/db/models').EngineeringMission();
}

async function novaMissao(sufixo) {
  const { mission } = await missionStore.createMission({
    originalMission: `Missão de teste de concorrência (${sufixo}) — não executar.`,
    missionType: 'INVESTIGATION',
    risk: 'LOW',
    createdBy: 'jest-merge-concurrency',
    idempotencyKey: `jest-merge-concurrency:${sufixo}:${Date.now()}:${Math.random()}`,
  });
  createdMissionIds.push(mission.id);
  return mission.id;
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
  if (!dbAvailable) return;
  try {
    if (createdMissionIds.length > 0) {
      await getModel().destroy({ where: { id: createdMissionIds } });
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 20000);

describe('mergeMissionJson — escrita concorrente não perde atualização', () => {
  jest.setTimeout(60000);

  test('escritas concorrentes em CHAVES DIFERENTES de resume_metadata sobrevivem as duas', async () => {
    if (skipIfNoDatabase()) return;

    const RODADAS = 15;
    for (let rodada = 0; rodada < RODADAS; rodada += 1) {
      const missionId = await novaMissao(`chaves-diferentes-${rodada}`);

      // As duas escritas reais que disputaram a corrida no incidente:
      //   A) coordenador do Bug Loop gravando a lineage da retomada;
      //   B) orquestrador/worker gravando o contador de replan de fonte.
      const lineage = {
        decision: 'REPLACE_TASK_RESUME_PHASE',
        replacementTaskId: `replacement-${rodada}`,
        originalTaskId: `original-${rodada}`,
      };
      const sourceReplan = { taskId: `task-${rodada}`, attempts: rodada + 1 };

      await Promise.all([
        missionStore.mergeMissionJson(missionId, { resume: { bugLoop: { lineage } } }),
        missionStore.mergeMissionJson(missionId, { resume: { sourceReplan } }),
      ]);

      const final = await missionStore.getMission(missionId);
      // NENHUMA das duas escritas pode desaparecer: se uma sumir, houve lost update.
      expect(final.resume_metadata.bugLoop).toEqual({ lineage });
      expect(final.resume_metadata.sourceReplan).toEqual(sourceReplan);
    }
  });

  test('escritas concorrentes na MESMA chave produzem um dos valores, nunca estado parcial', async () => {
    if (skipIfNoDatabase()) return;

    for (let rodada = 0; rodada < 10; rodada += 1) {
      const missionId = await novaMissao(`mesma-chave-${rodada}`);
      const A = { decision: 'REPLACE_TASK_RESUME_PHASE', replacementTaskId: `A-${rodada}` };
      const B = { decision: 'RETRY_ORIGINAL_TASK', replacementTaskId: `B-${rodada}` };

      await Promise.all([
        missionStore.mergeMissionJson(missionId, { resume: { bugLoop: { lineage: A } } }),
        missionStore.mergeMissionJson(missionId, { resume: { bugLoop: { lineage: B } } }),
      ]);

      const final = await missionStore.getMission(missionId);
      expect([A, B]).toContainEqual(final.resume_metadata.bugLoop.lineage);
    }
  });

  test('gravar resume NÃO apaga enrichment/preview/policyResolution já persistidos', async () => {
    if (skipIfNoDatabase()) return;

    const missionId = await novaMissao('preservacao');

    await missionStore.mergeMissionJson(missionId, {
      enrichment: { stage: 'enriched' },
      preview: { summary: 'prévia' },
      policyResolution: { source: 'teste' },
    });
    await missionStore.mergeMissionJson(missionId, {
      resume: { bugLoop: { lineage: { decision: 'REPLACE_TASK_RESUME_PHASE' } } },
    });

    const final = await missionStore.getMission(missionId);
    expect(final.enrichment).toEqual({ stage: 'enriched' });
    expect(final.preview).toEqual({ summary: 'prévia' });
    expect(final.resume_metadata.policyResolution).toEqual({ source: 'teste' });
    expect(final.resume_metadata.bugLoop.lineage.decision).toBe('REPLACE_TASK_RESUME_PHASE');
  });

  test('merge em missão inexistente devolve null (não inventa registro)', async () => {
    if (skipIfNoDatabase()) return;
    const resultado = await missionStore.mergeMissionJson(
      '00000000-0000-4000-8000-000000000000',
      { resume: { bugLoop: { lineage: { decision: 'X' } } } }
    );
    expect(resultado).toBeNull();
  });

  test('chave não suportada continua sendo erro explícito (não é engolida pelo CAS)', async () => {
    if (skipIfNoDatabase()) return;
    const missionId = await novaMissao('chave-invalida');
    await expect(
      missionStore.mergeMissionJson(missionId, { campoInexistente: true })
    ).rejects.toMatchObject({ code: 'MISSION_MERGE_UNKNOWN_KEY' });
  });
});
