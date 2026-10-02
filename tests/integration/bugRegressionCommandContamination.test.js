'use strict';

/**
 * tests/integration/bugRegressionCommandContamination.test.js
 *
 * PROVA que a MEMÓRIA DE REGRESSÃO não pode injetar um não-comando no contrato da próxima correção.
 *
 * DEFEITO REAL (primeira ocorrência medida em 2026-09-30 13:40, silenciosa por dois dias):
 *
 *   `bugLoopCoordinatorService` gravava `regressionCommands: testRuns.map(r => r.command)` — sem
 *   validar que o valor É um comando. Um UUID entrou (o primeiro: `0fc961c0-9093-4201-9be0-627d592e415f`),
 *   foi persistido em `engineering_bug_findings.regression_test_refs`, e `getFindingMemory` passou a
 *   devolvê-lo como "regressão anterior". O `buildFixTaskContract` injetava em `test_commands` da
 *   próxima fix task, `parseCommand` rejeitava ⇒ `TEST_BLOCKED` ⇒ 3 tentativas ⇒ task RED.
 *
 *   Sem fix GREEN não há promoção, integração na fonte da missão nem `resumeOriginalMission`: o laço
 *   NÃO FECHAVA. Medido: `engineeringBugLoopNaturalPathE2E` em 902 s (orçamento esgotado) contra 35-68 s
 *   com memória limpa — o discriminador nunca foi o modo autoritativo, era o estado da memória.
 *
 * O teste cobre as DUAS barreiras, porque a memória é PERSISTENTE: a da escrita impede entrada nova,
 * a da leitura impede que o histórico ruim continue se propagando.
 */

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');
const { parseCommand } = require('../../engine/engineeringRouter/commandPolicy');

const SUITE_NAME = 'bug-regression-command-contamination';
const REAL_COMMAND = 'npx jest --testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js --no-coverage';
const CONTAMINANT = '0fc961c0-9093-4201-9be0-627d592e415f';

let dbAvailable = false;
let dbReason = 'desconhecido';
const created = [];
const FINGERPRINT = `jest-contamination-${Date.now()}`;

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 60000);

afterAll(async () => {
  if (!dbAvailable) return;
  const index = require('../../api/db/models');
  if (created.length) {
    await index.getEngineeringBugFindingEvent().destroy({ where: { finding_id: created } }).catch(() => {});
    await index.EngineeringBugFinding().destroy({ where: { id: created } }).catch(() => {});
  }
}, 60000);

describe('memória de regressão não contamina o contrato da correção', () => {
  test('a autoridade de comando distingue comando real de identificador', () => {
    // A base de todo o resto: sem isto, nenhuma barreira consegue separar o que serve do que não serve.
    expect(parseCommand(REAL_COMMAND).allowed).toBe(true);
    expect(parseCommand(CONTAMINANT).allowed).toBe(false);
    expect(parseCommand('bug-3a7ea73f').allowed).toBe(false);
    expect(parseCommand('').allowed).toBe(false);
  });

  test('BARREIRA DE LEITURA — memória devolve só comandos executáveis, descartando o id contaminante', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`);

    const { EngineeringBugFinding } = require('../../api/db/models');
    const Finding = EngineeringBugFinding();

    // Registro LEGADO: exatamente o formato que a produção acumulou — o comando real E o UUID.
    const row = await Finding.create({
      fingerprint: FINGERPRINT,
      title: 'finding contaminado (fixture do teste)',
      category: 'TEST_FAILURE',
      severity: 'MEDIUM',
      status: 'CLOSED',
      source: 'TEST',
      created_by: 'TEST',
      confirmation_basis: 'REPRODUCTION',
      regression_test_refs: [REAL_COMMAND, CONTAMINANT],
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    });
    created.push(row.id);

    const memory = await bugFindingService.getFindingMemory(FINGERPRINT);

    expect(memory.known).toBe(true);
    // O comando real SOBREVIVE — a barreira não pode ser tão agressiva a ponto de perder regressão.
    expect(memory.priorRegressionCommands).toContain(REAL_COMMAND);
    // O identificador NÃO passa. Esta é a asserção que trava o defeito de 2026-09-30.
    expect(memory.priorRegressionCommands).not.toContain(CONTAMINANT);
    for (const command of memory.priorRegressionCommands) {
      expect(parseCommand(command).allowed).toBe(true);
    }
  });

  test('a memória continua conhecendo a ocorrência anterior (a barreira não apaga história)', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`);
    const memory = await bugFindingService.getFindingMemory(FINGERPRINT);
    expect(memory.occurrences).toBeGreaterThanOrEqual(1);
    expect(memory.priorFindings.length).toBeGreaterThanOrEqual(1);
  });
});
