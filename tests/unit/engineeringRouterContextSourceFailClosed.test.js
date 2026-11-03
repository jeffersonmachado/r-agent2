'use strict';

/**
 * L-1 (2026-10-20) — FONTE DE CONTEXTO NÃO MATERIALIZÁVEL = FALHA, NÃO DEGRADAÇÃO.
 *
 * Defeito corrigido: `contextBuilderService.createSourceReader` lia o CHECKOUT PRINCIPAL quando o
 * `source_commit` declarado pela task era irresolvível (apenas `logger.warn`). O workspace onde o
 * patch é aplicado, por outro lado, já falhava fechado (`patchApplyService.resolveTaskBaseCommit`
 * → `MISSION_SOURCE_COMMIT_UNRESOLVABLE`). Consequência: o CODER podia ser despachado com o
 * contexto de OUTRA base — o mesmo defeito de origem (INC-2B), um nível acima.
 *
 * Estes testes provam o comportamento no nível do ROUTER (não só do construtor): a tentativa é
 * fechada com código estável, a task vai para RED e NENHUM provider é chamado.
 *
 * Nenhum mock de módulo: `runOneAttempt` recebe a fachada de escrita por `run.writes` (o mesmo
 * caminho usado pela execução real com lease), então o teste observa o que o produto REALMENTE
 * escreve.
 */

const { runOneAttempt } = require('../../api/services/engineeringRouter/engineeringRouterService');

function makeRun() {
  const calls = {
    createAttempt: [],
    updateAttempt: [],
    recordTelemetry: [],
    transitionTask: [],
    saveLastError: [],
  };
  const writes = {
    transitionTask: async (taskId, toStatus) => {
      calls.transitionTask.push({ taskId, toStatus });
      return { id: taskId, status: toStatus };
    },
    getTask: async () => ({ id: 't1', status: 'CODING' }),
    createAttempt: async (taskId, payload) => {
      calls.createAttempt.push({ taskId, payload });
      return { id: 'att-1', attempt_number: 1 };
    },
    updateAttempt: async (attemptId, payload) => {
      calls.updateAttempt.push({ attemptId, payload });
    },
    recordTelemetry: async (payload) => {
      calls.recordTelemetry.push(payload);
    },
    saveLastError: async (taskId, payload) => {
      calls.saveLastError.push({ taskId, payload });
    },
  };
  const run = {
    writes,
    progress: async () => ({ ok: true }),
    assertHeld: async () => {},
    deadlineMeta: () => ({}),
    beginOperation: () => ({ signal: null }),
    endOperation: () => {},
  };
  return { run, calls };
}

const routingDecision = {
  coder: {
    selected: { providerId: 'provider-a', modelId: 'model-a', costClass: 'low' },
    reasonCodes: [],
    qualifiedCandidates: [],
  },
  policyVersion: 'test',
  independentReviewRequired: false,
};

function missionTask(overrides = {}) {
  return {
    id: '3b0f4c1e-2f6a-4f0f-9b9e-2b1a7c9d4e10',
    title: 'task de missão',
    objective: 'expor a seção de replan',
    task_type: 'CODE_GENERATION',
    risk: 'low',
    allowed_paths: ['package.json'],
    forbidden_paths: [],
    acceptance_criteria: [],
    mission_id: '7c2a1d90-4c33-4c47-8f6e-6a3f1f0e5b21',
    source_commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    max_iterations: 1,
    ...overrides,
  };
}

describe('engineeringRouter — fonte de contexto não materializável (L-1)', () => {
  test('source_commit irresolvível: attempt FAILED com código estável e NENHUM CODER despachado', async () => {
    const { run, calls } = makeRun();
    const result = await runOneAttempt({
      task: missionTask(),
      routingDecision,
      failureBundle: null,
      previousAttempt: null,
      credentialScope: 'SYSTEM_ENGINEERING',
      eventAudienceTenantId: null,
      run,
    });

    expect(result.outcome).toBe('FATAL');
    expect(result.reasonCode).toBe('CONTEXT_SOURCE_UNRESOLVABLE');

    // O attempt foi fechado com o motivo REAL (não um erro genérico de provider).
    const failed = calls.updateAttempt.find((u) => u.payload && u.payload.status === 'FAILED');
    expect(failed).toBeDefined();
    expect(failed.payload.error.code).toBe('CONTEXT_SOURCE_UNRESOLVABLE');
    expect(failed.payload.error.reason).toBe('MISSION_SOURCE_COMMIT_UNRESOLVABLE');
    expect(failed.payload.error.message).toMatch(/não existe neste repositório/);

    // Nada foi despachado: sem telemetria de DISPATCHED (o registro acontece antes de gerar patch).
    expect(calls.recordTelemetry).toHaveLength(0);
    // E nenhum resumo de contexto foi gravado (não houve contexto válido).
    expect(calls.updateAttempt.some((u) => u.payload && u.payload.context_summary)).toBe(false);
  });

  test('task de missão sem source_commit: FALHA com MISSION_SOURCE_NOT_INHERITED', async () => {
    const { run, calls } = makeRun();
    const result = await runOneAttempt({
      task: missionTask({ source_commit: null }),
      routingDecision,
      failureBundle: null,
      previousAttempt: null,
      credentialScope: 'SYSTEM_ENGINEERING',
      eventAudienceTenantId: null,
      run,
    });

    expect(result.outcome).toBe('FATAL');
    expect(result.reasonCode).toBe('CONTEXT_SOURCE_UNRESOLVABLE');
    const failed = calls.updateAttempt.find((u) => u.payload && u.payload.status === 'FAILED');
    expect(failed.payload.error.reason).toBe('MISSION_SOURCE_NOT_INHERITED');
    expect(calls.recordTelemetry).toHaveLength(0);
  });

  test('a regra nova NÃO bloqueia base válida: task de missão com commit resolvível lê da fonte', () => {
    const { execFileSync } = require('child_process');
    const { buildContext } = require('../../api/services/engineeringRouter/contextBuilderService');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const context = buildContext(missionTask({ source_commit: head }));

    expect(context.sourceOrigin).toEqual({ kind: 'MISSION_SOURCE', commit: head });
    expect(context.includedFiles).toContain('package.json');
  });
});
