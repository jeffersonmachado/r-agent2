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

/**
 * FKs que referenciam `engineering_missions` e NÃO estão declaradas em MISSION_CHILD_DELETIONS.
 *
 * PURA de propósito: recebe as linhas do `information_schema` e a declaração, e devolve a lista de
 * chaves `tabela.coluna` descobertas — assim o comportamento é testável sem banco, e a mesma
 * função é usada no runtime contra o banco ALVO (não contra o banco que o ambiente de teste
 * escolher: medido em 2026-10-08, sob Jest o `TEST_DATABASE_URL` aponta para outro banco e uma
 * verificação rodada ali mediria o alvo errado e passaria vazia).
 */
function findMissingFkCoverage(tableRows, declarations = MISSION_CHILD_DELETIONS) {
  const declared = new Set(declarations.map((item) => `${item.table}.${item.column}`));
  return (Array.isArray(tableRows) ? tableRows : [])
    .map((row) => `${row.table_name}.${row.column_name}`)
    .filter((key) => !declared.has(key));
}

/**
 * FILHOS ESCOPADOS À MISSÃO, NA ORDEM DE REMOÇÃO (filho antes do pai). Nada de CASCADE.
 *
 * DEFEITO REAL medido em 2026-10-08: a lista estava escrita À MÃO dentro do `main()` e ficou
 * DESATUALIZADA — `engineering_mission_reviews` (FK RESTRICT) e `engineering_bug_findings` não
 * constavam, então o `--apply` abortava com violação de FK e a higiene canônica não removia NADA
 * (`[prune] falhou: update or delete on table "engineering_missions" violates foreign key
 * constraint "engineering_mission_reviews_mission_fk"`). Com a poda inoperante, o resíduo
 * acumulado (1079 missões, 1069 fixtures de teste, 8 em estado RESUMÍVEL) continuava sendo
 * processado por `resumeInterruptedMissions` a cada varredura — auto-envenenamento que estoura
 * passos obrigatórios do selo (`MISSION_CRASH_RECOVERY`) e o E2E do laço de bug.
 *
 * A COBERTURA é verificada contra o BANCO por
 * `tests/unit/governance/pruneTestMissionFkCoverage.test.js`: qualquer tabela que referencie
 * `engineering_missions` sem entrada aqui reprova o teste — foi assim que a lista à mão passou
 * despercebida quando `engineering_mission_reviews` nasceu.
 */
const MISSION_CHILD_DELETIONS = [
  // eventos do finding ANTES do finding (é o único filho de engineering_bug_findings)
  { table: 'engineering_bug_finding_events', model: 'EngineeringBugFindingEvent', column: 'finding_id', label: 'bugFindingEvents' },
  { table: 'engineering_bug_findings', model: 'EngineeringBugFinding', column: 'mission_id', label: 'bugFindings' },
  { table: 'engineering_mission_reviews', model: 'EngineeringMissionReview', column: 'mission_id', label: 'missionReviews' },
  { table: 'engineering_mission_approvals', model: 'EngineeringMissionApproval', column: 'mission_id', label: 'approvals' },
  { table: 'engineering_mission_versions', model: 'EngineeringMissionVersion', column: 'mission_id', label: 'versions' },
];

async function main() {
  await db.connect();

  const { Op, QueryTypes } = require('sequelize');
  const Mission = getModels.EngineeringMission();

  // ANTES de qualquer remoção: o banco ALVO ainda referencia a missão por alguma tabela que a
  // declaração não cobre? Se sim, aborta (fail-closed) — sem isto, a poda morria no meio com
  // violação de FK e o resíduo ficava (foi o defeito de 2026-10-08).
  const missionFks = await Mission.sequelize.query(
    `SELECT tc.table_name AS table_name, kcu.column_name AS column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'engineering_missions'`,
    { type: QueryTypes.SELECT },
  );
  const uncovered = findMissingFkCoverage(missionFks);
  if (missionFks.length === 0) {
    console.error('[prune] ABORTADO: o banco alvo não expõe NENHUMA referência a engineering_missions — consulta vazia não prova cobertura (banco/credencial errados?).');
    process.exit(1);
  }
  if (uncovered.length > 0) {
    console.error(`[prune] ABORTADO: ${missionFks.length} referência(s) a engineering_missions e ${uncovered.length} fora da declaração: ${uncovered.join(', ')}`);
    console.error('[prune] adicione a tabela em MISSION_CHILD_DELETIONS (filho antes do pai) — a poda não pode remover com FK pendente.');
    process.exit(1);
  }
  console.log(`[prune] cobertura de FKs conferida no banco alvo: ${missionFks.length} referência(s), todas declaradas`);
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

  // Ordem das FKs: filhos antes dos pais. Nada de CASCADE.
  const removed = {};
  removed.telemetry = await Telemetry.destroy({ where: { task_id: { [Op.in]: taskIds } } });
  const attemptRows = await Attempt.findAll({ where: { task_id: { [Op.in]: taskIds } }, attributes: ['id'], raw: true });
  const attemptIds = attemptRows.map((row) => row.id);
  removed.testRuns = await TestRun.destroy({ where: { attempt_id: { [Op.in]: attemptIds } } });
  removed.reviews = await Review.destroy({ where: { attempt_id: { [Op.in]: attemptIds } } });
  removed.attempts = await Attempt.destroy({ where: { task_id: { [Op.in]: taskIds } } });
  removed.tasks = await Task.destroy({ where: { id: { [Op.in]: taskIds } } });

  // Filhos ESCOPADOS À MISSÃO — percorridos a partir da DECLARAÇÃO (ver MISSION_CHILD_DELETIONS),
  // e não de uma lista paralela aqui, para que a cobertura verificada pelo teste seja exatamente
  // a que roda.
  const findingRows = await getModels.EngineeringBugFinding()
    .findAll({ where: { mission_id: { [Op.in]: ids } }, attributes: ['id'], raw: true });
  const scopedIds = { mission_id: ids, finding_id: findingRows.map((row) => row.id) };
  for (const item of MISSION_CHILD_DELETIONS) {
    const values = scopedIds[item.column] || [];
    removed[item.label] = values.length === 0
      ? 0
      : await getModels[item.model]().destroy({ where: { [item.column]: { [Op.in]: values } } });
  }

  removed.missions = await Mission.destroy({ where: { id: { [Op.in]: ids } } });

  console.log('[prune] removidos:', JSON.stringify(removed));

  const remaining = await Mission.count();
  console.log(`[prune] missões restantes=${remaining} (esperado: ${userMissions.length})`);
  if (remaining !== userMissions.length) {
    console.error('[prune] ATENÇÃO: a contagem final diverge do esperado — investigue antes de seguir.');
    process.exit(1);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[prune] falhou:', error.message);
      process.exit(1);
    });
}

module.exports = {
  MISSION_CHILD_DELETIONS,
  TEST_MARKER_PATTERNS,
  RESUMABLE_STATES,
  isTestFixture,
  findMissingFkCoverage,
};
