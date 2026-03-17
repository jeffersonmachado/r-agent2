'use strict';

// ── shared mock runtime (mutated per test in beforeEach) ───────────────────────
const mockRuntime = {
  inspector: {
    getInstanceState: jest.fn(),
    getExecutionHistory: jest.fn().mockResolvedValue([]),
    getCurrentWaitingState: jest.fn().mockResolvedValue(null),
    explainWhyStopped: jest.fn().mockResolvedValue(null),
    getExecutionPath: jest.fn().mockResolvedValue([]),
    listInstances: jest.fn().mockResolvedValue([]),
  },
  instanceStore: {
    listWaitingInstances: jest.fn().mockResolvedValue([]),
  },
  resumeService: {
    resumeExternalEvent: jest.fn().mockResolvedValue({ ok: true }),
  },
  cancelProcess: jest.fn().mockResolvedValue({ ok: true }),
  resumeProcess: jest.fn().mockResolvedValue({ ok: true }),
  recoverRuntimeState: jest.fn().mockResolvedValue({}),
  ensureCompiledProcess: jest.fn().mockReturnValue({}),
};

// ── mock all heavy dependencies ────────────────────────────────────────────────
jest.mock('../../api/db/models', () => ({
  Flow: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) }),
}));

jest.mock('../../api/core/process-runtime/processRuntimeService', () => ({
  ProcessRuntimeService: jest.fn(),
}));

jest.mock('../../api/core/process-runtime/processCanonicalAdapter', () => ({
  compileCanonicalProcessDefinition: jest.fn().mockReturnValue({}),
  engineFlowToCanonicalProcess: jest.fn().mockReturnValue({}),
}));

jest.mock('../../api/core/process-analytics/processAnalyticsService', () => ({
  ProcessAnalyticsService: jest.fn(),
}));

jest.mock('../../api/core/process-analytics/processBottleneckService', () => ({
  ProcessBottleneckService: jest.fn(),
}));

jest.mock('../../api/core/process-analytics/processVersionComparisonService', () => ({
  ProcessVersionComparisonService: jest.fn(),
}));

jest.mock('../../api/core/process-simulation/processSimulationService', () => ({
  ProcessSimulationService: jest.fn(),
}));

jest.mock('../../api/core/process-intelligence/processOptimizationService', () => ({
  ProcessOptimizationService: jest.fn(),
}));

// ── wire mock constructor BEFORE requiring SUT ─────────────────────────────────
const { ProcessRuntimeService } = require('../../api/core/process-runtime/processRuntimeService');
ProcessRuntimeService.mockImplementation(() => mockRuntime);

const service = require('../../api/services/durableProcessService');

// ──────────────────────────────────────────────────────────────────────────────

describe('durableProcessService', () => {
  beforeEach(() => {
    // Re-wire constructor so the lazily created singleton always returns mockRuntime
    ProcessRuntimeService.mockImplementation(() => mockRuntime);
    // Reset inspector mocks to known defaults (individual mockReset + re-mock)
    mockRuntime.recoverRuntimeState.mockReset().mockResolvedValue({});
    mockRuntime.inspector.getInstanceState.mockReset().mockResolvedValue(null);
    mockRuntime.inspector.getExecutionHistory.mockReset().mockResolvedValue([]);
    mockRuntime.inspector.getCurrentWaitingState.mockReset().mockResolvedValue(null);
    mockRuntime.inspector.explainWhyStopped.mockReset().mockResolvedValue(null);
    mockRuntime.inspector.getExecutionPath.mockReset().mockResolvedValue([]);
    mockRuntime.instanceStore.listWaitingInstances.mockReset().mockResolvedValue([]);
    mockRuntime.cancelProcess.mockReset().mockResolvedValue({ ok: true });
    mockRuntime.resumeProcess.mockReset().mockResolvedValue({ ok: true });
  });

  // ─── filterExecutionHistory (pure, synchronous) ──────────────────────────────

  test('filterExecutionHistory – filtra por eventType e respeita limit', () => {
    const events = [
      { eventType: 'NODE_ENTER', nodeId: 'n1' },
      { eventType: 'NODE_EXIT',  nodeId: 'n1' },
      { eventType: 'NODE_ENTER', nodeId: 'n2' },
      { eventType: 'NODE_ENTER', nodeId: 'n3' },
    ];
    // limit = 2: takes from the end of the filtered array
    const result = service.filterExecutionHistory(events, { eventType: 'NODE_ENTER', limit: 2 });
    expect(result).toEqual([
      { eventType: 'NODE_ENTER', nodeId: 'n2' },
      { eventType: 'NODE_ENTER', nodeId: 'n3' },
    ]);
  });

  test('filterExecutionHistory – tolera itens com proxy revogado (safeGet não lança)', () => {
    const { proxy: hostileItem, revoke } = Proxy.revocable({ eventType: 'NODE_ENTER', nodeId: 'n1' }, {});
    revoke(); // any property access on hostileItem now throws TypeError

    const events = [hostileItem, { eventType: 'NODE_ENTER', nodeId: 'n2' }];
    let result;
    expect(() => {
      result = service.filterExecutionHistory(events, { eventType: 'NODE_ENTER' });
    }).not.toThrow();
    // hostileItem is excluded (safeGet → undefined → '' ≠ 'NODE_ENTER')
    expect(result).toEqual([{ eventType: 'NODE_ENTER', nodeId: 'n2' }]);
  });

  test('filterExecutionHistory – tolera objeto filters com proxy revogado (safeGet não lança)', () => {
    const { proxy: hostileFilter, revoke } = Proxy.revocable({ eventType: 'NODE_ENTER', nodeId: 'n1' }, {});
    revoke();

    const events = [{ eventType: 'NODE_ENTER', nodeId: 'n1' }];
    let result;
    expect(() => {
      result = service.filterExecutionHistory(events, hostileFilter);
    }).not.toThrow();
    // safeGet on revoked proxy → undefined → eventType/nodeId = '' → no filter applied
    expect(result).toEqual([{ eventType: 'NODE_ENTER', nodeId: 'n1' }]);
  });

  // ─── tenant isolation with hostile instance metadata ─────────────────────────

  test('getProcessInstance – metadata proxy revogado não lança, retorna execution_not_found', async () => {
    const { proxy: hostiMeta, revoke } = Proxy.revocable({ tenantId: 'tenant-a' }, {});
    revoke(); // accessing hostiMeta.tenantId now throws

    const instance = { executionId: 'exec-1', status: 'running', metadata: hostiMeta };
    mockRuntime.inspector.getInstanceState.mockResolvedValueOnce(instance);

    // safeGet(instance, 'metadata', 'tenantId') catches the throw → returns undefined
    // safeToString(undefined) → '' ≠ safeToString('tenant-b') → isolation check fails safely
    const result = await service.getProcessInstance('exec-1', 'tenant-b');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('execution_not_found');
  });

  test('cancelProcessInstance – metadata proxy revogado não lança, retorna execution_not_found', async () => {
    const { proxy: hostiMeta, revoke } = Proxy.revocable({ tenantId: 'tenant-a' }, {});
    revoke();

    const instance = { executionId: 'exec-2', status: 'running', metadata: hostiMeta };
    mockRuntime.inspector.getInstanceState.mockResolvedValueOnce(instance);

    const result = await service.cancelProcessInstance('exec-2', 'cancelled', {}, 'tenant-b');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('execution_not_found');
    // runtime.cancelProcess must NOT be called when tenant check fails
    expect(mockRuntime.cancelProcess).not.toHaveBeenCalled();
  });
});
