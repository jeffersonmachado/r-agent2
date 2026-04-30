'use strict';

const AutoCorrectionService = require('../../api/services/autocorrection/AutoCorrectionService');

function makeModels({
  runs = [],
  actions = [],
  links = [],
  insights = [],
  workspaceActions = [],
  evidenceRow = null,
} = {}) {
  const runStore = [...runs];
  const actionStore = [...actions];
  const linkStore = [...links];
  const insightStore = [...insights];
  const wsActionStore = [...workspaceActions];

  const AutoCorrectionRun = () => ({
    findOne: jest.fn(async ({ where } = {}) => {
      return runStore.find((r) =>
        (!where.tenant_id || r.tenant_id === where.tenant_id) &&
        (!where.source_type || r.source_type === where.source_type) &&
        (!where.source_id || r.source_id === where.source_id)
      ) || null;
    }),
    create: jest.fn(async (payload) => {
      const row = { id: `run-${Date.now()}`, ...payload };
      runStore.push(row);
      return row;
    }),
    findAll: jest.fn(async ({ where } = {}) => {
      const ids = where.id || [];
      return runStore.filter((r) => ids.includes(r.id));
    }),
  });

  const AutoCorrectionAction = () => ({
    create: jest.fn(async (payload) => {
      const row = { id: `action-${Date.now()}`, ...payload };
      actionStore.push(row);
      return row;
    }),
    findAll: jest.fn(async ({ where } = {}) => {
      const ids = where.run_id || [];
      return actionStore.filter((a) => ids.includes(a.run_id));
    }),
  });

  const WorkspaceEntityLink = () => ({
    findAll: jest.fn(async ({ where } = {}) => {
      return linkStore.filter((l) =>
        (!where.tenant_id || l.tenant_id === where.tenant_id) &&
        (!where.entity_id || l.entity_id === where.entity_id) &&
        (!where.source_type || l.source_type === where.source_type)
      );
    }),
    findOrCreate: jest.fn(async ({ where, defaults }) => {
      const existing = linkStore.find((l) =>
        l.source_type === where.source_type && l.source_id === where.source_id
      );
      if (existing) return [existing, false];
      const row = { ...defaults };
      linkStore.push(row);
      return [row, true];
    }),
  });

  const WorkspaceInsight = () => ({
    findOne: jest.fn(async () => null),
    create: jest.fn(async (payload) => {
      const row = { id: `insight-${Date.now()}`, ...payload };
      insightStore.push(row);
      return row;
    }),
  });

  const WorkspaceAction = () => ({
    findOne: jest.fn(async () => null),
    create: jest.fn(async (payload) => {
      const row = { id: `wsaction-${Date.now()}`, ...payload };
      wsActionStore.push(row);
      return row;
    }),
  });

  const Evidence = () => ({
    findOne: jest.fn(async () => evidenceRow),
  });

  return {
    AutoCorrectionRun,
    AutoCorrectionAction,
    WorkspaceEntityLink,
    WorkspaceInsight,
    WorkspaceAction,
    Evidence,
    _stores: { runStore, actionStore, linkStore, insightStore, wsActionStore },
  };
}

function makeService(overrides = {}) {
  const deps = { ...makeModels(overrides), logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } };
  return new AutoCorrectionService(deps);
}

describe('AutoCorrectionService', () => {
  describe('normalizeSourceType', () => {
    const svc = makeService();

    test.each([
      ['evidence', 'evidence'],
      ['qa_mesh_governance', 'qa_mesh_governance'],
      ['wave_abc', 'wave_failed'],
      ['smoke_test_xyz', 'smoke_test_failed'],
      ['api_error_recurrent', 'api_error_recurrent'],
      ['rpa_insight', 'rpa_insight'],
      ['rpa_whatsapp', 'rpa_insight'],
      ['qa_robot', 'rpa_insight'],
      ['unknown_type', 'unknown_type'],
    ])('normaliza "%s" → "%s"', (input, expected) => {
      expect(svc.normalizeSourceType(input)).toBe(expected);
    });

    test('usa payload.autocorrectionSource se value está vazio', () => {
      expect(svc.normalizeSourceType('', { payload: { autocorrectionSource: 'evidence' } })).toBe('evidence');
    });

    test('usa event.type como fallback final', () => {
      expect(svc.normalizeSourceType('', { type: 'smoke_run_test' })).toBe('smoke_test_failed');
    });
  });

  describe('isFailureEvent', () => {
    const svc = makeService();

    test.each([
      [{ summary: 'cenário falhou com erro crítico' }, true],
      [{ summary: 'evidence generated', payload: { status: 'failed' } }, true],
      [{ summary: 'execução concluída com sucesso' }, false],
      [{ summary: 'wave OK', payload: { status: 'passed' } }, false],
    ])('detecta falha corretamente', (event, expected) => {
      expect(svc.isFailureEvent(event)).toBe(expected);
    });
  });

  describe('createRunForFailure', () => {
    test('cria AutoCorrectionRun para source_type evidence', async () => {
      const models = makeModels();
      const svc = new AutoCorrectionService({
        ...models,
        failureDiagnosisService: {
          analyzeFailure: jest.fn(async () => ({
            affectedModule: 'workspace', rootCause: 'API failure', risk: 'high', confidence: 0.8, recommendedFix: 'Fix API', analyzedArtifacts: {},
          })),
        },
        patchProposalService: {
          proposePatch: jest.fn(async () => ({ patchSummary: 'Fix it', filesToChange: [], testsToRun: [] })),
        },
        correctionValidationService: {
          validateProposal: jest.fn(async () => ({ status: 'pending', summary: 'Pending review', steps: [] })),
        },
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const event = { type: 'evidence', summary: 'cenário falhou', payload: {} };
      const run = await svc.createRunForFailure({
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        event,
        sourceType: 'evidence',
        sourceId: 'ev-abc',
        timeline: [],
      });

      expect(run).toBeTruthy();
      expect(run.source_type).toBe('evidence');
      expect(run.tenant_id).toBe('tenant-1');
      expect(models._stores.actionStore).toHaveLength(1);
      expect(models._stores.actionStore[0].type).toBe('human_review');
    });

    test('cria run para source_type qa_mesh_governance', async () => {
      const models = makeModels();
      const svc = new AutoCorrectionService({
        ...models,
        failureDiagnosisService: {
          analyzeFailure: jest.fn(async () => ({
            affectedModule: 'workspace', rootCause: 'Critical checks failed', risk: 'critical', confidence: 0.95, recommendedFix: 'Review', analyzedArtifacts: {},
          })),
        },
        patchProposalService: {
          proposePatch: jest.fn(async () => ({ patchSummary: 'Governance review', filesToChange: [], testsToRun: [] })),
        },
        correctionValidationService: {
          validateProposal: jest.fn(async () => ({ status: 'pending', summary: 'Pending', steps: [] })),
        },
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const run = await svc.createRunForFailure({
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        event: { type: 'qa_mesh_governance', summary: 'wave falhou', payload: {} },
        sourceType: 'qa_mesh_governance',
        sourceId: 'scenario-1:wave',
        timeline: [],
      });

      expect(run).toBeTruthy();
      expect(run.source_type).toBe('qa_mesh_governance');
    });

    test('retorna run existente se já foi criado (idempotência)', async () => {
      const existingRun = { id: 'run-existing', tenant_id: 'tenant-1', source_type: 'evidence', source_id: 'ev-1', status: 'pending_review' };
      const models = makeModels({ runs: [existingRun] });
      const svc = new AutoCorrectionService({ ...models, logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } });

      const run = await svc.createRunForFailure({
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        event: { type: 'evidence', summary: 'falha', payload: {} },
        sourceType: 'evidence',
        sourceId: 'ev-1',
        timeline: [],
      });

      expect(run.id).toBe('run-existing');
      // findOne foi chamado mas create não
      expect(models._stores.runStore).toHaveLength(1);
    });

    test('retorna null para source_type desconhecido/não aceito', async () => {
      const models = makeModels();
      const svc = new AutoCorrectionService({ ...models, logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } });

      const run = await svc.createRunForFailure({
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        event: { type: 'chat_message', summary: 'mensagem normal', payload: {} },
        sourceType: 'chat_message',
        sourceId: 'msg-1',
        timeline: [],
      });

      expect(run).toBeNull();
    });
  });

  describe('listRunsForEntity', () => {
    test('retorna items com actions agrupadas', async () => {
      const run1 = { id: 'run-1', tenant_id: 'tenant-1', source_type: 'evidence', source_id: 'ev-1', status: 'pending_review' };
      const link1 = { tenant_id: 'tenant-1', entity_id: 'entity-1', source_type: 'autocorrection_run', source_id: 'run-1' };
      const action1 = { id: 'act-1', run_id: 'run-1', type: 'human_review', status: 'pending' };

      const models = makeModels({ runs: [run1], links: [link1], actions: [action1] });
      const svc = new AutoCorrectionService({ ...models, logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } });

      const result = await svc.listRunsForEntity({ tenantId: 'tenant-1', entityId: 'entity-1' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('run-1');
      expect(result.items[0].actions).toHaveLength(1);
      expect(result.items[0].actions[0].type).toBe('human_review');
    });

    test('retorna vazio quando não há links', async () => {
      const models = makeModels();
      const svc = new AutoCorrectionService({ ...models, logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } });

      const result = await svc.listRunsForEntity({ tenantId: 'tenant-1', entityId: 'entity-1' });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('ensureForEntityFailures', () => {
    test('cria runs para eventos de evidence com falha', async () => {
      const models = makeModels();
      const diagnoseMock = jest.fn(async () => ({
        affectedModule: 'workspace', rootCause: 'Test failure', risk: 'high', confidence: 0.85, recommendedFix: 'Fix', analyzedArtifacts: {},
      }));
      const svc = new AutoCorrectionService({
        ...models,
        failureDiagnosisService: { analyzeFailure: diagnoseMock },
        patchProposalService: { proposePatch: jest.fn(async () => ({ patchSummary: 'p', filesToChange: [], testsToRun: [] })) },
        correctionValidationService: { validateProposal: jest.fn(async () => ({ status: 'pending', summary: 's', steps: [] })) },
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const timeline = {
        items: [
          { id: 'ev-1', type: 'evidence', refId: 'ev-1', summary: 'cenário falhou com erro' },
          { id: 'ev-2', type: 'evidence', refId: 'ev-2', summary: 'execução concluída OK' },
          { id: 'msg-1', type: 'message', refId: 'msg-1', summary: 'cliente enviou mensagem' },
        ],
      };

      const runs = await svc.ensureForEntityFailures({ tenantId: 'tenant-1', entityId: 'entity-1', timeline });

      // Só o ev-1 (summary com "falhou") deve gerar run
      expect(runs).toHaveLength(1);
      expect(diagnoseMock).toHaveBeenCalledTimes(1);
    });

    test('não duplica runs (idempotência por wave)', async () => {
      const existingRun = { id: 'run-x', tenant_id: 'tenant-1', source_type: 'evidence', source_id: 'ev-1' };
      const models = makeModels({ runs: [existingRun] });
      const diagnoseMock = jest.fn();
      const svc = new AutoCorrectionService({
        ...models,
        failureDiagnosisService: { analyzeFailure: diagnoseMock },
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const timeline = {
        items: [{ id: 'ev-1', type: 'evidence', refId: 'ev-1', summary: 'cenário failed com erro' }],
      };

      const runs = await svc.ensureForEntityFailures({ tenantId: 'tenant-1', entityId: 'entity-1', timeline });

      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe('run-x');
      // analyzeFailure não deve ser chamado se run já existe
      expect(diagnoseMock).not.toHaveBeenCalled();
    });
  });
});
