'use strict';

/**
 * tests/integration/missionSourceStaleReplanFullRouterE2E.test.js
 *
 * STALE_CANDIDATE_FULL_ROUTER_E2E — a task SUBSTITUTA é executada pelo ROUTER de verdade.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * DIFERENÇA EM RELAÇÃO A `missionSourceStaleReplanE2E`: aquele E2E prova a camada de FONTE com a
 * integração conduzida pelo teste (candidate montado à mão). Aqui o que está em prova é o elo
 * seguinte, que ficava sem prova: depois de `STALE_CANDIDATE` → replan automático, a task
 * SUBSTITUTA é criada ancorada no commit CORRENTE da fonte e executada pelo Router REAL
 * (provider → patch → sandbox → testes → review → regressão → governança → promoção → integração),
 * convergindo para GREEN e fazendo a missão avançar de M2 para M3.
 *
 * CADEIA PROVADA (nesta ordem, tudo pelo caminho canônico):
 *   1. missão compilada, EDITADA/APROVADA (spec com allowedPaths + testCommands) e com fonte própria;
 *   2. task A integra um patch na fonte            → a fonte vira M2;
 *   3. task B (ancorada em M1, agora STALE) roda pelo ROUTER até a promoção e a integração é
 *      RECUSADA com `STALE_CANDIDATE` — a classificação é SOURCE_STALE, nunca bug de aplicação;
 *   4. replan automático canônico (`maybeReplanAfterSourceFailure`) → task SUBSTITUTA ancorada em M2;
 *   5. a substituta roda pelo ROUTER e chega a GREEN, integrando na fonte → a missão vira M3;
 *   6. M3 carrega os DOIS patches e a `main` nunca foi tocada.
 *
 * O QUE É REAL: Postgres, repositório git (worktrees, `commit-tree`, branches, `update-ref`),
 * Router completo, Engineering Runner + sandbox, test runner, reviewer, regressão, gate de
 * governança, promoção (commit+branch), integração por CAS na fonte da missão.
 * O QUE É DUBLÊ: SOMENTE a chamada de rede ao LLM (providers determinísticos sob ids reais do
 * registry, mesmo harness de `engineeringBugLoopNaturalPathE2E`).
 *
 * NOTA DE HARNESS (medida em 2026-10-07): a fixture de comando de teste é NEUTRA de propósito —
 * ela precisa PASSAR na base antiga M1 (senão a task B nunca chega a PROMOTING para ser recusada
 * por STALE) e também em M2. `mathUtils.test.js` é RED por design e por isso não serve.
 *
 * Infra ausente ⇒ pulo EXPLÍCITO via `skipOrFail` (RELEASE_AUTHORITATIVE=1 lança).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * ESCOPO DE CREDENCIAL DO ROUTER = O TENANT DESTA SUÍTE.
 *
 * O Router resolve credencial por `ENGINEERING_ROUTER_TENANT_ID` (default `system`) e, no runner
 * efêmero, `system` não tem credencial nenhuma: a task de correção ia a
 * `NO_QUALIFIED_CANDIDATE` e a suíte reprovava por DEPENDÊNCIA DE ESTADO AMBIENTAL. O mesmo
 * defeito já foi medido e corrigido em `engineeringBugLoopNaturalPathE2E` (runs 39673283430 e
 * 39676752021); aqui vale o MESMO padrão — escopo apontado para o tenant que a suíte cria e limpa,
 * sem tocar no tenant `system` do operador.
 *
 * ORDEM IMPORTA: a variável é lida no carregamento do módulo, então a atribuição vem ANTES dos
 * `require` que trazem `engineeringRouterService`/`engineeringModelAvailabilityService`.
 */
const TEST_TENANT_KEY = 'jest-e2e-stale-full-router';
process.env.ENGINEERING_ROUTER_TENANT_ID = TEST_TENANT_KEY;

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');
const coordinator = require('../../api/services/engineeringMission/bugLoopCoordinatorService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const router = require('../../api/services/engineeringRouter/engineeringRouterService');
const sourceSpec = require('../../engine/engineeringMission/missionSource');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = 'tests/fixtures/engineering-router-sandbox';
const FIXTURE_FILE = `${FIXTURE_DIR}/mathUtils.js`;
const SMOKE_FILE = `${FIXTURE_DIR}/staleReplanSmoke.test.js`;
// Comando da allowlist do Router (`npx jest`), determinístico e que passa em M1 e M2.
const SMOKE_COMMAND = `npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=${SMOKE_FILE} --no-coverage`;
// Arquivo criado pelo patch do CODER (a substituta) — adição pura, aplica em qualquer base.
const PATCH_B_FILE = `${FIXTURE_DIR}/staleReplanPatchB.js`;
const PATCH_B_CONTENT = "'use strict';\n\nmodule.exports = { origin: 'patch-b-stale-replan' };\n";

const SUITE_NAME = 'mission-source-stale-replan-full-router-e2e';

/** Conteúdo de `mathUtils.js` DEPOIS do patch da task A (o que faz a fonte virar M2). */
const PATCH_A_CONTENT = `'use strict';

function multiply(a, b) {
  return a * b;
}

function add(a, b) {
  return a + b;
}

module.exports = { multiply, add };
`;

const PRECONDITIONS_OK = {
  candidateGreen: true,
  hasTestRun: true,
  reviewVerdict: 'APPROVE',
  regressionStatus: 'PASS',
  ownershipValid: true,
  candidateIntegrityOk: true,
};

let dbAvailable = false;
let dbReason = 'desconhecido';
const created = { tasks: [], missions: [] };

function git(args, { cwd = ROOT } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitSafe(args, opts) {
  try {
    return { ok: true, out: git(args, opts) };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.message) };
  }
}

function readAtCommit(commit, relPath) {
  return git(['show', `${commit}:${relPath}`]);
}

function existsAtCommit(commit, relPath) {
  return gitSafe(['cat-file', '-e', `${commit}:${relPath}`]).ok;
}

/**
 * Candidate como o Router cria: worktree descartável sobre `baseCommit` e `commit-tree -p <base>`.
 * (Usado AQUI só para o passo 2 — o avanço da fonte por uma task já concluída. O candidate da
 * SUBSTITUTA é produzido pelo próprio Router.)
 */
function createCandidate({ baseCommit, files, message }) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-full-cand-'));
  git(['worktree', 'add', '--detach', ws, baseCommit]);
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(ws, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    git(['add', '-A'], { cwd: ws });
    const tree = git(['write-tree'], { cwd: ws });
    return git(['commit-tree', tree, '-p', baseCommit, '-m', message]);
  } finally {
    gitSafe(['worktree', 'remove', '--force', ws]);
    if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true });
  }
}

/**
 * Diff REAL de criação de arquivo, gerado pelo git (não escrito à mão): o formato precisa trazer
 * `new file mode` + `index`, senão `git apply` trata `/dev/null` como caminho relativo e recusa —
 * armadilha medida em 2026-10-06.
 */
function generateNewFilePatch(relPath, content) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-full-patchgen-'));
  try {
    git(['init', '-q', '-b', 'main'], { cwd: scratch });
    git(['config', 'user.email', 'patchgen@results.local'], { cwd: scratch });
    git(['config', 'user.name', 'PatchGen'], { cwd: scratch });
    const abs = path.join(scratch, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    git(['add', '-A'], { cwd: scratch });
    return git(['diff', '--cached'], { cwd: scratch });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function deleteBranchIfExists(branch) {
  if (!branch) return;
  gitSafe(['branch', '-D', branch]);
}

async function setupTenantAndProviders() {
  const models = require('../../api/db/models');
  await models.getTenant().findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Stale Full Router', status: 'active', plan: 'enterprise' },
  });
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  // O Router escolhe o provider por capability/policy — o teste NÃO presume qual. Dublês para TODOS
  // os candidatos; sem isso o provider escolhido cai na API real ("Provider não registrado no
  // engine de IA"), barreira medida em 2026-10-07.
  const CANDIDATE_PROVIDERS = ['anthropic', 'mistral', 'kimi', 'deepseek', 'openai', 'qwen', 'groq'];
  const patchB = generateNewFilePatch(PATCH_B_FILE, PATCH_B_CONTENT);
  function makeFakeProvider(label) {
    return {
      async generate(prompt, context) {
        if (context && context.purpose === 'engineering_coder') {
          return {
            text: JSON.stringify({ summary: 'cria o artefato do patch B sobre a fonte corrente', diff: patchB }),
            usage: { prompt_tokens: 80, completion_tokens: 40 },
          };
        }
        if (context && context.purpose === 'engineering_reviewer') {
          return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 40, completion_tokens: 10 } };
        }
        // Qualquer outro propósito recebe resposta neutra: o objetivo é determinismo, não simular
        // o produto.
        return { text: JSON.stringify({}), usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    };
  }
  provisionCredentialScope();
  for (const provider of CANDIDATE_PROVIDERS) {
    registerAiProvider(provider, makeFakeProvider(provider));
    await saveAICredentials(TEST_TENANT_KEY, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
  }

}



/**
 * Guarda de ORDEM DO ESCOPO (a variável é lida no carregamento dos módulos do Router).
 *
 * Chamada no setup: se alguém mover a atribuição de `ENGINEERING_ROUTER_TENANT_ID` para depois dos
 * `require` — ou sobrescrevê-la no meio do arquivo — o Router volta a resolver credencial no tenant
 * `system`, e a suíte passa a depender de estado do operador (foi exatamente o defeito medido nos
 * runs 39673283430/39676752021). Aqui isso falha ALTO, no setup, em vez de virar `BLOCKED` no meio
 * do ciclo.
 */
function provisionCredentialScope() {
  const escopo = process.env.ENGINEERING_ROUTER_TENANT_ID;
  if (escopo !== TEST_TENANT_KEY) {
    throw new Error(
      `escopo de credencial do Router deveria ser ${TEST_TENANT_KEY} (tenant da suíte) e é ${escopo} — `
      + 'a env é lida no carregamento do módulo, então a atribuição tem de vir ANTES dos requires',
    );
  }
  return escopo;
}

/**
 * Não há nada a restaurar: o escopo é o tenant que esta suíte cria e destrói, e nenhuma credencial é
 * escrita em tenant de terceiro (o padrão canônico substituiu a fixture que usava `system`).
 * A função permanece como registro executável dessa garantia — se o escopo divergir no teardown,
 * algo escreveu no lugar errado e a suíte falha.
 */
function restoreCredentialScope() {
  const escopo = process.env.ENGINEERING_ROUTER_TENANT_ID;
  if (escopo !== TEST_TENANT_KEY) {
    throw new Error(`escopo de credencial divergiu no teardown: ${escopo} (esperado ${TEST_TENANT_KEY})`);
  }
  return { restored: false, reason: 'escopo é o tenant da suíte; nenhuma credencial de terceiro foi tocada' };
}

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
  restoreCredentialScope();
  clearAiProviderConfig();
  if (dbAvailable) {
    const models = require('../../api/db/models');
    try {
      for (const taskId of created.tasks) {
        deleteBranchIfExists(`engineering-router/candidates/${taskId}`);
        const attempts = await engineeringTaskService.listAttempts(taskId).catch(() => []);
        for (const attempt of attempts) {
          await models.getEngineeringTestRun().destroy({ where: { attempt_id: attempt.id } }).catch(() => {});
          await models.getEngineeringReview().destroy({ where: { attempt_id: attempt.id } }).catch(() => {});
          await models.getEngineeringRegressionRun().destroy({ where: { attempt_id: attempt.id } }).catch(() => {});
        }
        await models.getEngineeringRegressionRun().destroy({ where: { task_id: taskId } }).catch(() => {});
        await models.getEngineeringAttempt().destroy({ where: { task_id: taskId } }).catch(() => {});
        await models.getEngineeringTelemetryEvent().destroy({ where: { task_id: taskId } }).catch(() => {});
        await models.getEngineeringOperation().destroy({ where: { task_id: taskId } }).catch(() => {});
        await models.getEngineeringTask().destroy({ where: { id: taskId } }).catch(() => {});
      }
      for (const missionId of created.missions) {
        const mission = await missionStore.getMission(missionId).catch(() => null);
        deleteBranchIfExists(mission && mission.mission_integration_branch);
        await models.getEngineeringMissionIntegration().destroy({ where: { mission_id: missionId } }).catch(() => {});
        await models.EngineeringMissionApproval().destroy({ where: { mission_id: missionId } }).catch(() => {});
        await models.EngineeringMissionVersion().destroy({ where: { mission_id: missionId } }).catch(() => {});
        await models.EngineeringMission().destroy({ where: { id: missionId } }).catch(() => {});
      }
      await models.getTenant().destroy({ where: { tenant_key: TEST_TENANT_KEY } }).catch(() => {});
    } catch (_) { /* best-effort */ }
  }
  await sequelizeModule.close().catch(() => {});
}, 60000);

describe('Mission Source — STALE_CANDIDATE → REPLAN com a SUBSTITUTA executada pelo ROUTER', () => {
  jest.setTimeout(900000);

  let skipReason = null;
  let mission = null;
  let mainAtStart = null;

  beforeAll(async () => {
    if (!dbAvailable) {
      skipReason = `Postgres indisponível: ${dbReason}`;
      return;
    }

    // O harness MUTA branches do repositório real (fonte da missão + branch de candidate) e o gate
    // de governança do Router executa `<ROOT>/scripts/governance/validate-engineering-router-v1.js`
    // — que só existe no repositório real. Por isso o host repo NÃO é substituído por um repo
    // temporário (ver `contextBuilderService.ROOT`).
    mainAtStart = git(['rev-parse', 'main']);

    await setupTenantAndProviders();

    const compiled = await compiler.compileMission(
      `Criar o artefato do patch B em ${FIXTURE_DIR} sem tocar na linha principal.`,
      { createdBy: 'jest-stale-full-router', tenantId: TEST_TENANT_KEY, contextHints: { touchesDatabase: false, touchesMultiTenant: false } },
    );
    mission = compiled.mission;
    created.missions.push(mission.id);

    // Contrato da task (allowedPaths + testCommands) vem da SPEC aprovada — o replan cria a
    // substituta a partir dela, então o comando de teste precisa estar aqui, não na mão.
    await approvalService.editAndApprove(mission.id, {
      actor: 'jest-stale-full-router',
      reason: 'fixture de QA: escopo e comando de teste explícitos para o cenário de replan de fonte',
      patch: { allowedPaths: [`${FIXTURE_DIR}/`], scope: 'SMALL', testCommands: [SMOKE_COMMAND] },
      tenantId: TEST_TENANT_KEY,
    });

    await missionSourceService.ensureMissionSource(mission.id, { actor: 'jest' });
  }, 300000);

  test('a substituta do replan converge a GREEN pelo Router e avança a fonte para M3', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    // ── M1: fonte inicial da missão ──────────────────────────────────────────────────────────
    const start = await missionSourceService.getMissionSource(mission.id);
    const M1 = start.currentCommit;

    const taskA = await engineeringTaskService.createTask({
      title: 'task-a', objective: 'patch A', taskType: 'IMPLEMENT', risk: 'LOW', scope: 'LOW',
      missionId: mission.id, sourceCommit: M1, sourceRef: start.integrationBranch, sourceMissionFence: start.fence,
      allowedPaths: [`${FIXTURE_DIR}/`], testCommands: [SMOKE_COMMAND],
    }, { createdBy: 'jest', idempotencyKey: `e2e:${mission.id}:task-a` });
    created.tasks.push(taskA.id);

    const candidateA = createCandidate({
      baseCommit: M1,
      files: { [FIXTURE_FILE]: PATCH_A_CONTENT },
      message: 'patch A',
    });
    const integratedA = await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: taskA.id, candidateCommit: candidateA, preconditions: PRECONDITIONS_OK, actor: 'jest-a',
    });
    expect(integratedA.integrated).toBe(true);
    const M2 = integratedA.missionCommitAfter;
    expect(M2).not.toBe(M1);

    // ── Task B nasce ancorada em M1 → agora STALE, e roda pelo ROUTER ────────────────────────
    const taskB = await engineeringTaskService.createTask({
      title: 'task-b', objective: 'patch B sobre a base antiga', taskType: 'IMPLEMENT', risk: 'LOW', scope: 'LOW',
      missionId: mission.id, sourceCommit: M1, sourceRef: start.integrationBranch, sourceMissionFence: start.fence,
      allowedPaths: [`${FIXTURE_DIR}/`], testCommands: [SMOKE_COMMAND],
    }, { createdBy: 'jest', idempotencyKey: `e2e:${mission.id}:task-b` });
    created.tasks.push(taskB.id);

    const runB = await router.runTask(taskB.id, { eventAudienceTenantId: TEST_TENANT_KEY });
    // O Router executou tudo (provider, patch, sandbox, review, regressão, governança, promoção) e
    // foi RECUSADO na integração — nunca GREEN sobre trabalho que a missão não consegue usar.
    expect(runB.status).toBe('READY_FOR_PROMOTION');
    expect(runB.reasonCode).toBe('STALE_CANDIDATE');

    // A recusa não moveu a fonte nem aplicou o patch indevido.
    const afterStale = await missionSourceService.getMissionSource(mission.id);
    expect(afterStale.currentCommit).toBe(M2);
    expect(existsAtCommit(M2, PATCH_B_FILE)).toBe(false);

    // ── Classificação: stale de fonte NÃO é bug de aplicação ────────────────────────────────
    const classified = sourceSpec.classifySourceFailure({ reasonCode: 'STALE_CANDIDATE' });
    expect(classified.disposition).toBe('SOURCE_STALE');
    expect(classified.requiresReplan).toBe(true);
    expect(classified.createsApplicationBug).toBe(false);

    // ── REPLAN AUTOMÁTICO (a MESMA chamada que o orquestrador faz), com o resultado REAL ────
    const replan = await coordinator.maybeReplanAfterSourceFailure({
      missionId: mission.id,
      taskId: taskB.id,
      result: runB,
      actor: 'jest-replan',
      tenantId: TEST_TENANT_KEY,
    });
    expect(replan.replanned).toBe(true);
    expect(replan.replacementTaskId).toBeTruthy();

    // ── A PROVA DESTA SUÍTE: a SUBSTITUTA convergiu a GREEN pelo ROUTER ─────────────────────
    const replacement = await engineeringTaskService.getTask(replan.replacementTaskId);
    created.tasks.push(replacement.id);
    expect(replacement.source_commit).toBe(M2);

    const replacementAttempts = await engineeringTaskService.listAttempts(replacement.id);
    const attemptFailures = replacementAttempts
      .map((a) => `${a.attempt_number}:${a.status}${a.error ? `(${a.error.code})` : ''}`)
      .join(', ');
    expect(replacement.status).toBe('GREEN');
    expect(replacementAttempts.length).toBeGreaterThanOrEqual(1);
    expect(attemptFailures).toContain('DONE');

    // A integração aconteceu PELO ROUTER (não à mão): a fonte avançou para M3 carregando o patch B.
    const afterReplan = await missionSourceService.getMissionSource(mission.id);
    const M3 = afterReplan.currentCommit;
    expect(M3).not.toBe(M2);
    expect(existsAtCommit(M3, PATCH_B_FILE)).toBe(true);
    expect(readAtCommit(M3, PATCH_B_FILE)).toContain('patch-b-stale-replan');

    // ── A missão final carrega os DOIS patches e a `main` nunca foi tocada ───────────────────
    expect(readAtCommit(M3, FIXTURE_FILE)).toContain('add');
    expect(git(['rev-parse', 'main'])).toBe(mainAtStart);
    expect(existsAtCommit(mainAtStart, PATCH_B_FILE)).toBe(false);

    // Resultado do replan persistido e auditável na missão.
    const persisted = await missionStore.getMission(mission.id);
    const replanState = ((persisted.resume_metadata || {}).sourceReplan) || {};
    expect(replanState.attempts).toBeGreaterThanOrEqual(1);
    expect(replanState.lastTaskId).toBe(String(taskB.id));
  });
});
