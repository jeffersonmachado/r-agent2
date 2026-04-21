/**
 * Seed da Plataforma via RPA + API idempotente.
 *
 * Objetivos desta versão:
 * - não depender de gravações ausentes
 * - falhar cedo e de forma útil quando infra estiver indisponível
 * - separar smoke UI de seed funcional
 * - gerar relatório JSON + Markdown com evidências
 */

const path = require('path');
const { assertLegacyEntrypointAllowed } = require('../../core/rpa/legacyEntrypointGuard');
const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');
const config = require('../../core/rpa/rpaConfig');
const {
  SEED_DATA,
  SEED_RECORDINGS,
  ensureSeedRecordings,
  collectInfraStatus,
  buildSeedMatrix,
  authenticateRpa,
  ensureQueues,
  ensureDepartments,
  ensureAgents,
  ensureFlows,
  saveExecutionArtifacts,
} = require('./seedPlatformSupport');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function createExecutionId() {
  return `seed-rpa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildSmokeSummary(smokeResults = []) {
  const total = smokeResults.length;
  const skipped = smokeResults.filter((item) => item && item.skipped).length;
  const executed = total - skipped;
  const passed = smokeResults.filter((item) => item && !item.skipped && item.success).length;
  const failed = smokeResults.filter((item) => item && !item.skipped && !item.success).length;

  return {
    total,
    executed,
    skipped,
    passed,
    failed,
  };
}

async function runSmokeSeeds({ infra, report }) {
  const smokeResults = [];

  if (!infra.frontend.reachable) {
    for (const recordingRef of SEED_RECORDINGS) {
      const matrixEntry = report.matrix.find((item) => item.seed === recordingRef.filename);
      const blockers = matrixEntry?.blockers || [`frontend indisponível em ${infra.frontend.url}`];
      smokeResults.push({
        seed: recordingRef.filename,
        success: false,
        skipped: true,
        result: 'SKIPPED',
        executionType: recordingRef.executionType,
        blockers,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      });
      report.testsExecuted.push({
        name: `smoke:${recordingRef.filename}`,
        result: 'SKIPPED',
        details: blockers.join('; '),
      });
    }
    return smokeResults;
  }

  const runner = new RpaTestRunner({
    headless: process.env.HEADLESS !== 'false',
    slowMo: process.env.HEADLESS === 'false' ? 250 : 0,
    enableReplay: true,
    devtools: false,
  });

  try {
    await runner.init();

    for (const recordingRef of SEED_RECORDINGS) {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const matrixEntry = report.matrix.find((item) => item.seed === recordingRef.filename);
      const blockers = matrixEntry?.blockers || [];

      console.log(`▶️  Iniciando seed smoke: ${recordingRef.filename}`);

      if (blockers.length > 0) {
        smokeResults.push({
          seed: recordingRef.filename,
          success: false,
          skipped: true,
          result: 'SKIPPED',
          executionType: recordingRef.executionType,
          blockers,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
        });
        report.testsExecuted.push({
          name: `smoke:${recordingRef.filename}`,
          result: 'SKIPPED',
          details: blockers.join('; '),
        });
        console.log(`⏭️  Seed smoke pulado: ${recordingRef.filename} (${blockers.join('; ')})`);
        continue;
      }

      try {
        const recording = require(path.join(__dirname, 'seeds', recordingRef.filename));
        const result = await runner.playback(recording, {
          urls: {
            frontend: config.urls.frontend,
            api: config.urls.api,
          },
        });

        const success = !!result.success;
        smokeResults.push({
          seed: recordingRef.filename,
          success,
          skipped: false,
          result: success ? 'PASS' : 'FAIL',
          executionType: recordingRef.executionType,
          replayPath: result.replayPath || null,
          tracePath: result.tracePath || null,
          errors: result.errors || [],
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
        });

        report.testsExecuted.push({
          name: `smoke:${recordingRef.filename}`,
          result: success ? 'PASS' : 'FAIL',
          details: success
            ? (result.replayPath || 'execução concluída')
            : (result.errors || []).map((error) => error.error).join(' | '),
        });
        const statusIcon = success ? '✅' : '❌';
        console.log(`${statusIcon} Seed smoke finalizado: ${recordingRef.filename} (${success ? 'PASS' : 'FAIL'})`);
      } catch (error) {
        const errorMessage = error && error.message ? error.message : String(error);
        smokeResults.push({
          seed: recordingRef.filename,
          success: false,
          skipped: false,
          result: 'FAIL',
          executionType: recordingRef.executionType,
          replayPath: null,
          tracePath: null,
          errors: [{ step: 'runtime', action: 'seed-execution', error: errorMessage }],
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
        });
        report.testsExecuted.push({
          name: `smoke:${recordingRef.filename}`,
          result: 'FAIL',
          details: errorMessage,
        });
        console.log(`❌ Seed smoke falhou: ${recordingRef.filename} (${errorMessage})`);
      }
    }
  } finally {
    await runner.close().catch(() => null);
  }

  return smokeResults;
}

async function runFunctionalSeed({ infra, report }) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  if (!infra.api.reachable || !infra.db.reachable) {
    const reasons = [];
    if (!infra.api.reachable) reasons.push(`API indisponível em ${infra.api.url}`);
    if (!infra.db.reachable) reasons.push(`PostgreSQL indisponível em ${infra.db.host}:${infra.db.port}`);
    report.testsExecuted.push({
      name: 'functional-seed',
      result: 'SKIPPED',
      details: reasons.join('; '),
    });
    return {
      skipped: true,
      failed: false,
      reasons,
      flows: [],
      queues: [],
      departments: [],
      agents: [],
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  }

  try {
    const auth = await authenticateRpa({
      apiBaseUrl: infra.api.url,
      tenantId: process.env.TEST_TENANT_ID || 'system',
    });
    const context = {
      apiBaseUrl: infra.api.url,
      token: auth.token,
    };

    const queues = await ensureQueues(SEED_DATA, context);
    const departments = await ensureDepartments(SEED_DATA, context);
    const agents = await ensureAgents(SEED_DATA, context);
    const flows = await ensureFlows(SEED_DATA, context, auth.agent?.tenantId || 'system');

    report.testsExecuted.push({
      name: 'functional-seed:queues',
      result: 'PASS',
      details: `${queues.filter((item) => item.status === 'created').length} created / ${queues.filter((item) => item.status === 'existing').length} existing`,
    });
    report.testsExecuted.push({
      name: 'functional-seed:departments',
      result: 'PASS',
      details: `${departments.filter((item) => item.status === 'created').length} created / ${departments.filter((item) => item.status === 'existing').length} existing`,
    });
    report.testsExecuted.push({
      name: 'functional-seed:agents',
      result: 'PASS',
      details: `${agents.filter((item) => item.status === 'created').length} created / ${agents.filter((item) => item.status === 'existing').length} existing`,
    });
    report.testsExecuted.push({
      name: 'functional-seed:flows',
      result: 'PASS',
      details: `${flows.filter((item) => item.status === 'created').length} created / ${flows.filter((item) => item.status === 'existing').length} existing`,
    });

    return {
      skipped: false,
      failed: false,
      tenantId: auth.agent?.tenantId || 'system',
      authAgent: auth.agent,
      queues,
      departments,
      agents,
      flows,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    report.testsExecuted.push({
      name: 'functional-seed',
      result: 'FAIL',
      details: message,
    });

    return {
      skipped: false,
      failed: true,
      error: message,
      reasons: [message],
      flows: [],
      queues: [],
      departments: [],
      agents: [],
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  }
}

async function seedPlatform() {
  ensureSeedRecordings();
  const infra = await collectInfraStatus();
  const smokeOnly = hasFlag('--smoke-only');
  const executionId = createExecutionId();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const report = {
    executionId,
    startedAt,
    generatedAt: new Date().toISOString(),
    mode: smokeOnly ? 'smoke-only' : 'full',
    infra,
    matrix: buildSeedMatrix(infra),
    problemsFound: [
      'O agregador principal referenciava cinco seeds ausentes em tests/rpa/seeds.',
      'A criação funcional dependia implicitamente de infra real sem um pré-check útil de API/DB.',
      'O auto-login do runner podia interferir em seeds com navegação externa ou pública.',
      'O launch do Playwright não tinha fallback robusto quando o browser empacotado não estava instalado.',
    ],
    fixesApplied: [
      'Seeds ausentes passaram a ser materializados automaticamente e também foram versionados no repositório.',
      'O seed principal foi reestruturado para usar smoke UI via Playwright e criação funcional idempotente via API autenticada.',
      'O fluxo agora detecta ausência de frontend, API e PostgreSQL antes de entrar em tentativas inúteis.',
      'O auto-login do runner agora respeita seeds públicos e URLs externas.',
      'O ActionExecutor agora tenta browser Playwright e faz fallback para Chromium/Chrome do sistema com erro útil.',
    ],
    testsExecuted: [],
    evidence: [],
    remainingLimitations: [],
    smokeResults: [],
    functionalResults: null,
    summary: null,
    artifacts: null,
  };

  console.log('🌱 Seed/RPA da Plataforma\n');
  console.log(`Frontend: ${infra.frontend.url} -> ${infra.frontend.reachable ? 'OK' : 'INDISPONIVEL'}`);
  console.log(`API: ${infra.api.url} -> ${infra.api.reachable ? 'OK' : 'INDISPONIVEL'}`);
  console.log(`PostgreSQL: ${infra.db.host}:${infra.db.port} -> ${infra.db.reachable ? 'OK' : 'INDISPONIVEL'}`);
  console.log(`Browser fallback do sistema: ${infra.browser.systemPath || 'nao encontrado'}\n`);

  report.smokeResults = await runSmokeSeeds({ infra, report });
  report.smokeSummary = buildSmokeSummary(report.smokeResults);
  const smokeFailures = report.smokeResults.filter((item) => !item.skipped && !item.success);
  for (const failure of smokeFailures) {
    const errorText = (failure.errors || []).map((item) => item.error).join(' | ') || 'falha sem detalhe adicional';
    report.remainingLimitations.push(`Smoke ${failure.seed} falhou: ${errorText}`);
  }

  if (smokeOnly) {
    report.functionalResults = {
      skipped: true,
      reasons: ['Execução solicitada em modo --smoke-only'],
    };
    report.remainingLimitations.push('Seed funcional não executado porque o modo --smoke-only foi solicitado.');
  } else {
    report.functionalResults = await runFunctionalSeed({ infra, report });
    if (report.functionalResults.skipped || report.functionalResults.failed) {
      report.remainingLimitations.push(...report.functionalResults.reasons);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedMs;

  const artifactPaths = saveExecutionArtifacts(report);
  report.artifacts = {
    jsonPath: artifactPaths.jsonPath,
    mdPath: artifactPaths.mdPath,
    latestMdPath: artifactPaths.latestMdPath,
  };

  report.summary = {
    executionId,
    mode: report.mode,
    smoke: report.smokeSummary,
    functional: {
      skipped: !!report.functionalResults?.skipped,
      failed: !!report.functionalResults?.failed,
      reasons: report.functionalResults?.reasons || [],
    },
    infra: {
      frontendReachable: !!infra.frontend.reachable,
      apiReachable: !!infra.api.reachable,
      dbReachable: !!infra.db.reachable,
      browserSystemPath: infra.browser.systemPath || null,
    },
  };

  for (const smoke of report.smokeResults) {
    if (smoke.replayPath) {
      report.evidence.push(`Replay gerado para ${smoke.seed}: ${smoke.replayPath}`);
    }
  }
  report.evidence.push(`Relatório JSON salvo em ${artifactPaths.jsonPath}`);
  report.evidence.push(`Relatório Markdown salvo em ${artifactPaths.mdPath}`);
  report.evidence.push(`Relatório Markdown latest salvo em ${artifactPaths.latestMdPath}`);

  saveExecutionArtifacts(report, artifactPaths);

  console.log('Resumo final');
  console.log(`- Execução: ${executionId}`);
  console.log(`- Relatório JSON: ${artifactPaths.jsonPath}`);
  console.log(`- Relatório Markdown: ${artifactPaths.mdPath}`);
  console.log(`- Smoke total: ${report.smokeSummary.total}`);
  console.log(`- Smoke executados: ${report.smokeSummary.executed}`);
  console.log(`- Smoke pulados: ${report.smokeSummary.skipped}`);
  console.log(`- Smoke pass: ${report.smokeSummary.passed}`);
  console.log(`- Smoke fail: ${report.smokeSummary.failed}`);
  if (report.functionalResults?.skipped) {
    console.log(`- Seed funcional: PULADO (${report.functionalResults.reasons.join('; ')})`);
  } else if (report.functionalResults?.failed) {
    console.log(`- Seed funcional: FALHOU (${report.functionalResults.error})`);
  } else {
    console.log(`- Filas: ${report.functionalResults.queues.length}`);
    console.log(`- Departamentos: ${report.functionalResults.departments.length}`);
    console.log(`- Agentes: ${report.functionalResults.agents.length}`);
    console.log(`- Fluxos: ${report.functionalResults.flows.length}`);
  }

  return report;
}

if (require.main === module) {
  assertLegacyEntrypointAllowed('tests/rpa/seedPlatformRPA.js');
  seedPlatform()
    .then((report) => {
      const hasSmokeFailure = report.smokeResults.some((item) => !item.skipped && !item.success);
      const hasFunctionalFailure = !!report.functionalResults?.failed;
      const exitCode = hasSmokeFailure || hasFunctionalFailure ? 1 : 0;
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error('❌ Erro fatal no seed/RPA:', error);
      process.exit(1);
    });
}

module.exports = {
  seedPlatform,
  SEED_DATA,
};
