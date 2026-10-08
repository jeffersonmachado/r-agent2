'use strict';

/**
 * ERV1-CLOSE-004 / ER-V1-FINAL-006 — REGRESSION e GOVERNANCE precisam ser checagens reais,
 * capazes de reprovar, não transições de status decorativas.
 *
 * `checkRegression` (ER-V1-FINAL-006): achado real confirmado por inspeção direta do código
 * anterior — só chamava `listTestRuns(attemptId)`, relendo os `EngineeringTestRun` já
 * persistidos pela fase TESTING (evidence revalidation, nunca regression execution). Corrigido
 * para construir um `RegressionPlan` real proporcional ao risco e EXECUTAR os comandos de
 * verdade (via o sandbox real de ER-V1-FINAL-001) num workspace isolado, persistindo um
 * `EngineeringRegressionRun`. Testado aqui com workspace real (git worktree) e comandos reais.
 * `checkGovernance` executa de verdade o gate canônico existente
 * (scripts/governance/validate-engineering-router-v1.js) como subprocess real.
 */

const fs = require('fs');
const path = require('path');
const sequelizeModule = require('../../api/db/sequelize');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { createWorkspace, applyPatch, destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');
const { checkRegression, checkGovernance } = require('../../api/services/engineeringRouter/regressionGovernanceService');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { ROOT } = require('../../api/services/engineeringRouter/contextBuilderService');

jest.setTimeout(90000);

let dbAvailable = false;
let dbReason = null;
const createdTaskIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[regression-governance-service] PULADO: postgres_unreachable (${dbReason})`);
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

afterAll(async () => {
  if (!dbAvailable) return;
  const getModels = require('../../api/db/models');
  const Task = getModels.getEngineeringTask();
  const Attempt = getModels.getEngineeringAttempt();
  const TestRun = getModels.getEngineeringTestRun();
  try {
    for (const taskId of createdTaskIds) {
      const attempts = await Attempt.findAll({ where: { task_id: taskId } });
      for (const attempt of attempts) {
        await TestRun.destroy({ where: { attempt_id: attempt.id } });
      }
      await Attempt.destroy({ where: { task_id: taskId } });
      await Task.destroy({ where: { id: taskId } });
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
});

async function makeTaskAndAttempt({ testCommands, risk = 'LOW' }) {
  const task = await engineeringTaskService.createTask({
    title: 'regression-governance-fixture',
    objective: 'objetivo de teste',
    allowedPaths: ['tests/fixtures/engineering-router-sandbox/**'],
    testCommands,
    risk,
    maxIterations: 1,
  }, { createdBy: 'jest-regression-governance-test' });
  createdTaskIds.push(task.id);
  const attempt = await engineeringTaskService.createAttempt(task.id, { status: 'TESTED' });
  return { task, attempt };
}

describe('ER-V1-FINAL-006 — checkRegression executa de verdade (Postgres + workspace real, nunca só relê evidência antiga)', () => {
  const createdWorkspaces = [];

  afterEach(async () => {
    for (const ws of createdWorkspaces.splice(0)) {
      await destroyWorkspace(ws).catch(() => {});
    }
  });

  test('comandos do plano executam de verdade e passam → regressão aprova, com EngineeringRegressionRun persistido', async () => {
    if (skipIfNoDatabase()) return;
    const { task, attempt } = await makeTaskAndAttempt({
      testCommands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
    });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    const result = await checkRegression({
      taskId: task.id,
      attemptId: attempt.id,
      workspacePath: workspace,
      touchedPaths: ['tests/fixtures/engineering-router-sandbox/mathUtils.js'],
      risk: 'LOW',
      targetedCommands: task.test_commands,
    });

    expect(result.pass).toBe(true);
    expect(result.evidence.planTier).toBe('LOW');
    expect(result.evidence.commandCount).toBe(1);
    expect(result.evidence.failed).toHaveLength(0);

    const runs = await engineeringTaskService.listRegressionRuns(attempt.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].result).toBe('PASS');
    expect(runs[0].source_fingerprint).toEqual(expect.any(String));
  });

  test('comando do plano falha de verdade (exitCode != 0) → regressão reprova (nunca GREEN sem evidência real)', async () => {
    if (skipIfNoDatabase()) return;
    // jest sem nenhum arquivo correspondente ao padrão sai com exitCode != 0 de forma real e
    // determinística — prova execução de verdade (não existe nenhum EngineeringTestRun
    // anterior para este attempt; o resultado só pode vir de rodar o comando agora).
    const failingCommand = 'npx jest tests/unit/__nonexistent-file-forces-jest-nonzero-exit__.test.js';
    const { task, attempt } = await makeTaskAndAttempt({ testCommands: [failingCommand] });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    const result = await checkRegression({
      taskId: task.id,
      attemptId: attempt.id,
      workspacePath: workspace,
      touchedPaths: [],
      risk: 'LOW',
      targetedCommands: task.test_commands,
    });

    expect(result.pass).toBe(false);
    expect(result.evidence.failed.length).toBeGreaterThan(0);
    expect(result.evidence.failed[0].command).toBe(failingCommand);

    const runs = await engineeringTaskService.listRegressionRuns(attempt.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].result).toBe('FAIL');
  });

  test('RegressionPlan escala com o risco: MEDIUM inclui testes relacionados ao arquivo tocado, além do targeted', async () => {
    if (skipIfNoDatabase()) return;
    const { task, attempt } = await makeTaskAndAttempt({
      testCommands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      risk: 'MEDIUM',
    });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    const result = await checkRegression({
      taskId: task.id,
      attemptId: attempt.id,
      workspacePath: workspace,
      // Nome escolhido para bater com um teste real existente no repositório
      // (tests/unit/engineeringRouterPathBoundary.test.js) via a heurística de basename.
      touchedPaths: ['engine/engineeringRouter/pathBoundary.js'],
      risk: 'MEDIUM',
      targetedCommands: task.test_commands,
    });

    expect(result.evidence.planTier).toBe('MEDIUM');
    // targeted (1) + pelo menos um teste relacionado a "pathBoundary" encontrado no repositório.
    expect(result.evidence.commandCount).toBeGreaterThan(1);
  });

  test('source_fingerprint é da ÁRVORE DA TENTATIVA, nunca do ROOT do processo', async () => {
    if (skipIfNoDatabase()) return;
    const { task, attempt } = await makeTaskAndAttempt({
      testCommands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
    });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    // Altera SÓ a árvore da tentativa, num diretório que participa do fingerprint (`engine/` está
    // em SOURCE_ROOTS). Sem isso as duas árvores teriam o MESMO conteúdo — a tentativa nasce do
    // HEAD do ROOT — e o teste não conseguiria distinguir ROOT de workspace.
    const alvoRel = 'engine/engineeringRouter/hunkNormalizer.js';
    const alvoAbs = path.join(workspace, alvoRel);
    const original = fs.readFileSync(alvoAbs, 'utf8');
    try {
      fs.writeFileSync(alvoAbs, `${original}\n// marcador de teste: muda APENAS a arvore da tentativa\n`, 'utf8');

      const result = await checkRegression({
        taskId: task.id,
        attemptId: attempt.id,
        workspacePath: workspace,
        touchedPaths: [],
        risk: 'LOW',
        targetedCommands: task.test_commands,
      });

      expect(result.pass).toBe(true);
      expect(result.evidence.sourceFingerprintRoot).toEqual({
        kind: 'WORKSPACE_DA_TENTATIVA', path: workspace,
      });

      const runs = await engineeringTaskService.listRegressionRuns(attempt.id);
      expect(runs).toHaveLength(1);
      // O contrato do modelo diz "working tree no momento da execução".
      expect(runs[0].source_fingerprint).toBe(computeSourceFingerprint(workspace));
      // O DEFEITO medido: antes o campo carregava o fingerprint do ROOT do processo (outra árvore).
      expect(runs[0].source_fingerprint).not.toBe(computeSourceFingerprint(ROOT));
    } finally {
      fs.writeFileSync(alvoAbs, original, 'utf8');
    }
  });

  test('plano CRITICAL registra COMPOSIÇÃO e sinaliza quando degenera para só o contrato', async () => {
    if (skipIfNoDatabase()) return;
    const { task, attempt } = await makeTaskAndAttempt({
      testCommands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      risk: 'CRITICAL',
    });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    // Caminhos que não casam NENHUM teste do repositório ⇒ plano sem related/subsystem.
    // É o caso REAL medido (3 comandos num tier CRITICAL) — aqui ele é reproduzido sem custo: o
    // plano degenerado executa 1 comando. O caso AMPLO (related/subsystem preenchidos) é provado no
    // teste unitário puro do plano: executá-lo aqui dispararia dezenas de suítes reais.
    const degenerado = await checkRegression({
      taskId: task.id,
      attemptId: attempt.id,
      workspacePath: workspace,
      touchedPaths: ['docs/zzz-sem-teste/inexistente.md'],
      risk: 'CRITICAL',
      targetedCommands: task.test_commands,
    });

    expect(degenerado.pass).toBe(true);
    expect(degenerado.evidence.planBreakdown).toEqual({ targeted: 1, related: 0, subsystem: 0 });
    expect(degenerado.evidence.planDegraded).toBe(true);
    expect(degenerado.evidence.touchedPaths).toEqual(['docs/zzz-sem-teste/inexistente.md']);
    // A evidência passa a DISTINGUIR os dois planos (antes, 3 e 43 comandos eram indistinguíveis).
    expect(degenerado.evidence.commandCount).toBe(1);

    // O sinal não fica só no JSON: vira evento operacional consultável.
    const telemetria = await engineeringTaskService.listTelemetry(task.id);
    const degradado = telemetria.filter((e) => e.event_type === 'REGRESSION_PLAN_DEGRADED');
    expect(degradado).toHaveLength(1);
    expect(degradado[0].detail.planTier).toBe('CRITICAL');
    expect(degradado[0].detail.breakdown).toEqual({ targeted: 1, related: 0, subsystem: 0 });
  });
});

describe('ERV1-CLOSE-004 — checkGovernance (subprocess real do gate canônico)', () => {
  test('gate real (validate-engineering-router-v1.js) executa de verdade e aprova no estado atual do repo', async () => {
    const result = await checkGovernance();
    expect(result.evidence.gate).toBe('validate-engineering-router-v1');
    expect(result.evidence.exitCode).toBe(0);
    expect(result.pass).toBe(true);
  });

  // DEFEITO PRÉ-EXISTENTE CORRIGIDO (2026-10-08): este teste mockava `child_process.execFile`, mas
  // `checkGovernance` executa o gate por `runChildWithDeadline` (`api/utils/operationDeadline`), que
  // usa `child_process.spawn`. O mock nunca era aplicado ao caminho real e, como o módulo mockado
  // não tinha `spawn`, a execução morria com `TypeError: spawn is not a function` — o teste ficava
  // vermelho PERMANENTE e o enforcement crítico ("reprovação do gate reprova a task") ficava SEM
  // PROVA. Um enforcement que não pode ser provado é um enforcement que se remove sem ninguém notar.
  test('reprovação real do gate é propagada como pass:false com evidência (spawn mockado, sem quebrar o gate real do repo)', async () => {
    jest.resetModules();
    jest.doMock('child_process', () => {
      const actual = jest.requireActual('child_process');
      const { EventEmitter } = require('events');
      // Mesmo contrato consumido por `runChildWithDeadline`: stdout/stderr com 'data' + 'close' com code.
      const fakeSpawn = () => {
        const child = new EventEmitter();
        child.pid = 4242;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('[engineering-router-v1] status=FAIL checks=66 falhas=3\n - EXEMPLO: motivo simulado\n'));
          child.stderr.emit('data', Buffer.from('falha simulada do gate\n'));
          child.emit('close', 1, null);
        });
        return child;
      };
      return { ...actual, spawn: fakeSpawn };
    });

    const { checkGovernance: mockedCheckGovernance } = require('../../api/services/engineeringRouter/regressionGovernanceService');
    const result = await mockedCheckGovernance();

    expect(result.pass).toBe(false);
    expect(result.evidence.exitCode).toBe(1);
    expect(result.evidence.summary.join(' ')).toContain('status=FAIL');

    jest.dontMock('child_process');
    jest.resetModules();
  });
});
