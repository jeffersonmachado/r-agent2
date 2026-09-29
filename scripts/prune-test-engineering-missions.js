#!/usr/bin/env node
'use strict';

/**
 * prune-test-engineering-missions.js — HIGIENE do banco de desenvolvimento.
 *
 * PROBLEMA MEDIDO (2026-09-28): as suítes de missão de engenharia criam missões de fixture no
 * banco e as removem em `afterAll`. Quando uma execução é ABORTADA (timeout, SIGKILL, CI
 * interrompido) o `afterAll` não roda e a fixture fica. O acúmulo tornou-se mensurável:
 * `resumeInterruptedMissions` custa ~1,2 s por missão resumível (26 missões = 31,5 s por
 * varredura) e a própria suíte passou a estourar o timeout de 60 s — auto-envenenamento.
 *
 * CRITÉRIO DE SEGURANÇA (não negociável):
 *   - só remove missões cujo `created_by` é um MARCADOR DE TESTE/FERRAMENTA conhecido
 *     (`jest-*`, `verify-*`, `timeout-architecture-e2e`, `sanity`, `*measure*`);
 *   - missões criadas por USUÁRIO (o `created_by` é um identificador real, ex.: UUID) NUNCA são
 *     tocadas — nem listadas como candidatas;
 *   - DRY-RUN por padrão. A remoção exige `--apply` explícito;
 *   - a remoção ocorre na ordem das FKs (telemetria/attempt/testrun/review → task → approval →
 *     version → mission), nunca por cascade.
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/prune-test-engineering-missions.js            # relatório
 *   node --env-file-if-exists=.env scripts/prune-test-engineering-missions.js --apply     # remove
 *
 * (Não usa `dotenv`: o pacote não está instalado neste repositório — ver AI_MEMORY.)
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'api', 'db'));
const getModels = require(path.join(ROOT, 'api', 'db', 'models'));

const APPLY = process.argv.includes('--apply');
const INCLUDE_STALE_RESUMABLE = process.argv.includes('--include-stale-resumable');

const RESUMABLE_STATES = ['CREATED', 'ENRICHING', 'APPROVED', 'EXECUTING'];

/** Marcadores de origem de TESTE/FERRAMENTA — qualquer outro valor é tratado como usuário real. */
const TEST_MARKER_PATTERNS = [
  /^jest-/i,
  /^verify-/i,
  /^timeout-architecture-e2e$/i,
  /^sanity$/i,
  /measure/i,
];

function isTestFixture(createdBy) {
  const value = String(createdBy || '');
  if (value.length === 0) return false;
  return TEST_MARKER_PATTERNS.some((pattern) => pattern.test(value));
}

async function main() {
  await db.connect();

  const { Op } = require('sequelize');
  const Mission = getModels.EngineeringMission();
  const all = await Mission.findAll({ attributes: ['id', 'status', 'created_by', 'title'], raw: true });

  const fixtures = all.filter((mission) => isTestFixture(mission.created_by));
  const userMissions = all.filter((mission) => !isTestFixture(mission.created_by));
  const resumableFixtures = fixtures.filter((mission) => RESUMABLE_STATES.includes(mission.status));

  console.log(`[prune] total=${all.length} fixtures_de_teste=${fixtures.length} (resumíveis=${resumableFixtures.length}) usuário=${userMissions.length}`);
  console.log('[prune] missões de USUÁRIO preservadas integralmente:');
  for (const mission of userMissions) {
    console.log(`[prune]   ${mission.id} | ${mission.status} | ${mission.created_by} | ${String(mission.title).slice(0, 60)}`);
  }

  if (fixtures.length === 0) {
    console.log('[prune] nada a remover');
    return;
  }

  if (!APPLY) {
    console.log('[prune] DRY-RUN: nenhuma linha foi removida. Use --apply para remover as fixtures.');
    if (!INCLUDE_STALE_RESUMABLE && resumableFixtures.length > 0) {
      console.log(`[prune] observação: ${resumableFixtures.length} fixture(s) de teste estão em estado resumível e continuam sendo processadas pelas varreduras.`);
    }
    return;
  }

  const ids = fixtures.map((mission) => mission.id);
  const taskIds = (await Mission.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['linked_task_id'], raw: true }))
    .map((row) => row.linked_task_id)
    .filter(Boolean);

  const Telemetry = getModels.getEngineeringTelemetryEvent();
  const TestRun = getModels.getEngineeringTestRun();
  const Review = getModels.getEngineeringReview();
  const Attempt = getModels.getEngineeringAttempt();
  const Task = getModels.getEngineeringTask();
  const Approval = getModels.EngineeringMissionApproval();
  const Version = getModels.EngineeringMissionVersion();

  // Ordem das FKs: filhos antes dos pais. Nada de CASCADE.
  const removed = {};
  removed.telemetry = await Telemetry.destroy({ where: { task_id: { [Op.in]: taskIds } } });
  const attemptRows = await Attempt.findAll({ where: { task_id: { [Op.in]: taskIds } }, attributes: ['id'], raw: true });
  const attemptIds = attemptRows.map((row) => row.id);
  removed.testRuns = await TestRun.destroy({ where: { attempt_id: { [Op.in]: attemptIds } } });
  removed.reviews = await Review.destroy({ where: { attempt_id: { [Op.in]: attemptIds } } });
  removed.attempts = await Attempt.destroy({ where: { task_id: { [Op.in]: taskIds } } });
  removed.tasks = await Task.destroy({ where: { id: { [Op.in]: taskIds } } });
  removed.approvals = await Approval.destroy({ where: { mission_id: { [Op.in]: ids } } });
  removed.versions = await Version.destroy({ where: { mission_id: { [Op.in]: ids } } });
  removed.missions = await Mission.destroy({ where: { id: { [Op.in]: ids } } });

  console.log('[prune] removidos:', JSON.stringify(removed));

  const remaining = await Mission.count();
  console.log(`[prune] missões restantes=${remaining} (esperado: ${userMissions.length})`);
  if (remaining !== userMissions.length) {
    console.error('[prune] ATENÇÃO: a contagem final diverge do esperado — investigue antes de seguir.');
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[prune] falhou:', error.message);
    process.exit(1);
  });
