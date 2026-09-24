'use strict';

/**
 * E2E REAL do ciclo de missão de engenharia (§41):
 *
 *   MISSÃO EM LINGUAGEM NATURAL
 *   → ENRICH (fatos reais do repositório + regras de política)
 *   → PREVIEW (o usuário vê exatamente o que foi acrescentado)
 *   → APROVAÇÃO HUMANA (edit + approve)
 *   → ENGINEER ROUTER (CODER → TESTE → REVIEWER → REGRESSION → GOVERNANCE)
 *   → GREEN
 *
 * O que é dublê: SOMENTE a chamada de rede ao LLM (`registerAiProvider` real sob ids reais do
 * registry, com credencial real em `tenant_ai_credentials` de um tenant dedicado). Todo o resto —
 * enriquecimento, versionamento, aprovação, task contract, roteamento por capability, git
 * worktree, test runner, review, persistência — roda sem dublê.
 *
 * Também prova que a EXECUÇÃO corresponde à MissionSpec APROVADA (aderência, TEST 48) e que a
 * intenção original sobreviveu intacta até o fim.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (nunca verde silencioso).
 */

const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const reportService = require('../../api/services/engineeringMission/missionReportService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');

const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'mistral';
const TEST_TENANT_KEY = 'jest-e2e-engineering-mission';

const FIXTURE_FILE = 'tests/fixtures/engineering-router-sandbox/mathUtils.js';
const FIXTURE_TEST_COMMAND = 'npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js --no-coverage';

const FIX_DIFF = `diff --git a/${FIXTURE_FILE} b/${FIXTURE_FILE}
--- a/${FIXTURE_FILE}
+++ b/${FIXTURE_FILE}
@@ -1,7 +1,11 @@
 'use strict';

 function multiply(a, b) {
   return a * b;
 }

-module.exports = { multiply };
+function add(a, b) {
+  return a + b;
+}
+
+module.exports = { multiply, add };
`;

const RAW_MISSION = 'Corrija definitivamente o defeito de soma em mathUtils e deixe tudo verde.';

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];
const createdTaskIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[engineering-mission-e2e] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

async function setupCredential(tenantKey, provider) {
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  await saveAICredentials(tenantKey, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
}

async function teardownCredential(tenantKey, provider) {
  try {
    const getModels = require('../../api/db/models');
    const TenantModel = getModels.getTenant();
    const CredentialModel = getModels.getTenantAICredential();
    const tenant = await TenantModel.findOne({ where: { tenant_key: tenantKey } });
    if (tenant) await CredentialModel.destroy({ where: { tenant_id: tenant.id, provider } });
  } catch (_) { /* best-effort */ }
}

function deleteCandidateBranchIfExists(taskId) {
  try {
    const { execFileSync } = require('child_process');
    execFileSync('git', ['branch', '-D', `engineering-router/candidates/${taskId}`], {
      cwd: require('path').resolve(__dirname, '..', '..'),
      stdio: 'ignore',
    });
  } catch (_) { /* branch pode não ter sido criada */ }
}

function makeFakeProvider(label) {
  return {
    async generate(prompt, context) {
      expect(context.tenantId).toBe(TEST_TENANT_KEY);
      if (context.purpose === 'engineering_coder') {
        return { text: JSON.stringify({ summary: 'adiciona add() em mathUtils', diff: FIX_DIFF }), usage: { prompt_tokens: 10, completion_tokens: 5 } };
      }
      if (context.purpose === 'engineering_reviewer') {
        return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 8, completion_tokens: 2 } };
      }
      throw new Error(`[${label}] purpose inesperado: ${context.purpose}`);
    },
  };
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
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Engineering Mission', status: 'active', plan: 'enterprise' },
  });
  await setupCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  await setupCredential(TEST_TENANT_KEY, REVIEWER_PROVIDER);
  registerAiProvider(CODER_PROVIDER, makeFakeProvider(CODER_PROVIDER));
  registerAiProvider(REVIEWER_PROVIDER, makeFakeProvider(REVIEWER_PROVIDER));
}, 30000);

afterAll(async () => {
  if (!dbAvailable) return;
  clearAiProviderConfig();
  const getModels = require('../../api/db/models');
  try {
    for (const taskId of createdTaskIds) {
      deleteCandidateBranchIfExists(taskId);
      const attempts = await engineeringTaskService.listAttempts(taskId);
      for (const attempt of attempts) {
        await getModels.getEngineeringTestRun().destroy({ where: { attempt_id: attempt.id } });
        await getModels.getEngineeringReview().destroy({ where: { attempt_id: attempt.id } });
        await getModels.getEngineeringRegressionRun().destroy({ where: { attempt_id: attempt.id } }).catch(() => {});
      }
      await getModels.getEngineeringAttempt().destroy({ where: { task_id: taskId } });
      await getModels.getEngineeringTelemetryEvent().destroy({ where: { task_id: taskId } });
      await getModels.getEngineeringTask().destroy({ where: { id: taskId } });
    }
    if (createdMissionIds.length > 0) {
      await getModels.EngineeringMissionApproval().destroy({ where: { mission_id: createdMissionIds } });
      await getModels.EngineeringMissionVersion().destroy({ where: { mission_id: createdMissionIds } });
      await getModels.EngineeringMission().destroy({ where: { id: createdMissionIds } });
    }
  } catch (_) { /* best-effort */ }
  await teardownCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  await teardownCredential(TEST_TENANT_KEY, REVIEWER_PROVIDER);
  try {
    await getModels.getTenant().destroy({ where: { tenant_key: TEST_TENANT_KEY } });
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('Engineering Mission — E2E missão → enriquecimento → aprovação → execução → GREEN', () => {
  jest.setTimeout(180000);

  let missionId = null;
  let originalMissionText = null;

  test('1. missão em linguagem natural é enriquecida com fatos reais e fica AWAITING_APPROVAL', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, {
      createdBy: 'jest-e2e',
      contextHints: { touchesDatabase: true, touchesMultiTenant: true },
    });
    missionId = mission.id;
    originalMissionText = mission.original_mission;
    createdMissionIds.push(mission.id);

    expect(mission.original_mission).toBe(RAW_MISSION);
    expect(mission.status).toBe('AWAITING_APPROVAL');
    expect(mission.displayStatus).toBe('AWAITING_APPROVAL');
    expect(mission.current_version).toBe(1);
    expect(mission.risk).toBe('HIGH'); // consequência dos fatos (tenancy + schema), não decoração
    expect(mission.currentSpec.derivedRequirements.map((r) => r.id)).toContain('DR-TENANT_ISOLATION');
  });

  test('2. preview mostra o que foi acrescentado, com fonte e motivo (autoaprovação desabilitada por padrão)', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await compiler.getMissionDetail(missionId);
    expect(mission.preview.original.mission).toBe(RAW_MISSION);
    const policySection = mission.preview.sections.find((s) => s.category === 'POLICY_REQUIRED');
    expect(policySection.items.length).toBeGreaterThan(0);
    expect(policySection.items[0].source).toBeTruthy();
    expect(policySection.items[0].reason).toBeTruthy();
    expect(mission.preview.autoApproval.eligible).toBe(false);
    expect(mission.approval_state).toBe('PENDING');
  });

  test('3. execução antes da aprovação é bloqueada', async () => {
    if (skipIfNoDatabase()) return;
    await expect(orchestrator.startExecution(missionId, { tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'MISSION_APPROVAL_NOT_FOUND' });
    const mission = await missionStore.getMission(missionId);
    expect(mission.status).toBe('AWAITING_APPROVAL');
    expect(mission.linked_task_id).toBeNull();
  });

  test('4. aprovação humana (com edição do contrato de execução) libera exatamente a versão aprovada', async () => {
    if (skipIfNoDatabase()) return;
    const edited = await approvalService.editAndApprove(missionId, {
      patch: {
        allowedPaths: [FIXTURE_FILE],
        testCommands: [FIXTURE_TEST_COMMAND],
        maxIterations: 2,
        scope: 'SMALL',
      },
      actor: 'jest-e2e-approver',
      reason: 'escopo de execução explicitado para a fixture de QA',
    });
    expect(edited.mission.current_version).toBe(2);
    expect(edited.mission.status).toBe('APPROVED');
    expect(edited.materiality.level).toBe('MATERIAL');

    // A intenção original NUNCA muda, mesmo com edição humana.
    expect(edited.mission.original_mission).toBe(RAW_MISSION);
    const versions = await missionStore.listVersions(missionId);
    expect(versions.every((v) => v.original_mission === RAW_MISSION)).toBe(true);
  });

  test('5. execução cria uma EngineeringTask com contrato ADERENTE à MissionSpec aprovada', async () => {
    if (skipIfNoDatabase()) return;
    const started = await orchestrator.startExecution(missionId, { actor: 'jest-e2e', tenantId: TEST_TENANT_KEY });
    createdTaskIds.push(started.task.id);

    const spec = started.mission.currentSpec;
    expect(started.task.task_type).toBe('BUG_FIX');
    expect(started.task.risk).toBe(spec.risk);
    expect(started.task.allowed_paths).toEqual([FIXTURE_FILE]);
    expect(started.task.test_commands).toEqual([FIXTURE_TEST_COMMAND]);
    expect(started.task.max_iterations).toBe(2);
    expect(started.task.objective).toBe(spec.objective);
    // Critérios de aceite derivados do enriquecimento chegaram ao contrato de execução.
    expect(started.task.acceptance_criteria).toEqual(expect.arrayContaining([spec.acceptanceCriteria[0].text]));
    // Escopo explícito obrigatório: sem `explicitPolicyAuthorization` quando há allowedPaths.
    expect(started.task.explicit_policy_authorization).toBe(false);

    // Idempotência: chamar de novo NÃO cria uma segunda task.
    const again = await orchestrator.startExecution(missionId, { actor: 'jest-e2e', tenantId: TEST_TENANT_KEY });
    expect(again.task.id).toBe(started.task.id);
  });

  test('6. o loop real do Router chega a GREEN e a missão reflete GREEN', async () => {
    if (skipIfNoDatabase()) return;
    const run = await orchestrator.runMissionTask(missionId, {
      tenantId: TEST_TENANT_KEY,
      credentialScope: TEST_TENANT_KEY,
      runnerId: 'jest-e2e-mission-runner',
    });

    expect(run.result.status).toBe('GREEN');
    const mission = await missionStore.getMission(missionId);
    expect(mission.status).toBe('GREEN');
    expect(mission.completed_at).toBeTruthy();

    // Working tree principal intacto: o patch só existiu no worktree isolado.
    const fs = require('fs');
    const path = require('path');
    expect(fs.readFileSync(path.resolve(__dirname, '..', '..', FIXTURE_FILE), 'utf8')).not.toContain('function add');
  });

  test('7. relatório de auditoria responde às perguntas do auditor externo (§39)', async () => {
    if (skipIfNoDatabase()) return;
    const report = await reportService.buildMissionReport(missionId);

    expect(report.artifactType).toBe('engineering-mission-report');
    expect(report.originalMission.text).toBe(RAW_MISSION);
    expect(report.originalMission.preservedAcrossVersions).toBe(true);
    expect(report.versions.length).toBe(2);
    expect(report.approvals.length).toBe(2);
    expect(report.approvals.some((a) => a.mode === 'MANUAL' && a.state === 'APPROVED')).toBe(true);
    expect(report.enrichment.preview.sections).toBeDefined();
    expect(report.execution.taskStatus).toBe('GREEN');
    expect(report.execution.attempts.length).toBeGreaterThan(0);
    expect(report.execution.attempts[0].coderProvider).toBe(CODER_PROVIDER);
    expect(report.execution.reviews.some((r) => r.reviewerProvider === REVIEWER_PROVIDER && r.decision === 'APPROVE')).toBe(true);
    expect(report.execution.routingDecision).toBeTruthy();
    // A task executada é exatamente a da versão aprovada — nenhuma versão "mais nova" foi usada.
    expect(report.trace.specHash).toBe(report.versions[report.versions.length - 1].specHash);
  });

  test('8. TEST 48 — aderência missão original ↔ MissionSpec aprovada ↔ execução entregue', async () => {
    if (skipIfNoDatabase()) return;
    const report = await reportService.buildMissionReport(missionId);
    const approved = report.approvals.find((a) => a.state === 'APPROVED');
    const approvedVersion = report.versions.find((v) => v.version === approved.specVersion);
    const executedSpec = report.versions.find((v) => v.specHash === report.trace.specHash);

    // 1. o texto original do usuário está intacto e é o mesmo na versão aprovada e na executada;
    expect(report.originalMission.text).toBe(originalMissionText);
    expect(approvedVersion.spec.originalMission).toBe(originalMissionText);
    expect(executedSpec.spec.originalMission).toBe(originalMissionText);
    // 2. a versão executada é exatamente a aprovada (nem anterior, nem posterior);
    expect(executedSpec.version).toBe(approved.specVersion);
    expect(executedSpec.specHash).toBe(approved.specHash);
    // 3. todo critério de aceite da spec executada está no contrato da task que rodou.
    const task = await engineeringTaskService.getTask(report.execution.taskId);
    for (const criterion of executedSpec.spec.acceptanceCriteria) {
      expect(task.acceptance_criteria).toContain(criterion.text);
    }
  });
});
