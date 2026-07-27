'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessInstanceInspector } = require('../../api/core/process-runtime/processInstanceInspector');

describe('ProcessInstanceInspector', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('retorna estado, historico e caminho no fluxo nominal', withTimeout(async () => {
    const instanceStore = {
      loadInstance: jest.fn(async () => ({
        executionId: 'exec-1',
        status: 'waiting',
        waitingState: { type: 'external_event', correlationKey: 'corr-1' },
      })),
      listInstances: jest.fn(async () => ([{ executionId: 'exec-1' }])),
    };
    const executionRepository = {
      listEventsByExecution: jest.fn(async () => ([
        { sequence: 1, eventType: 'PROCESS_STARTED' },
        { sequence: 2, eventType: 'NODE_ENTER' },
      ])),
      getLastEvent: jest.fn(async () => ({ eventType: 'NODE_ENTER' })),
    };
    const replayService = {
      getExecutionPath: jest.fn(() => ([{ nodeId: 'start-1' }, { nodeId: 'task-1' }])),
    };

    const inspector = new ProcessInstanceInspector({ instanceStore, executionRepository, replayService });

    const state = await inspector.getInstanceState('exec-1');
    const items = await inspector.listInstances({ status: 'waiting' });
    const history = await inspector.getExecutionHistory('exec-1');
    const waitingState = await inspector.getCurrentWaitingState('exec-1');
    const stopped = await inspector.explainWhyStopped('exec-1');
    const path = await inspector.getExecutionPath('exec-1');

    expect(state.executionId).toBe('exec-1');
    expect(items).toEqual([{ executionId: 'exec-1' }]);
    expect(history).toHaveLength(2);
    expect(waitingState).toEqual({ type: 'external_event', correlationKey: 'corr-1' });
    expect(stopped).toEqual({
      reason: 'waiting',
      waitingState: { type: 'external_event', correlationKey: 'corr-1' },
      lastEventType: 'NODE_ENTER',
    });
    expect(path).toEqual([{ nodeId: 'start-1' }, { nodeId: 'task-1' }]);
  }, 5000));

  test('listInstances tolera filtros revogados e erro do store retornando []', withTimeout(async () => {
    const { proxy: hostileFilters, revoke } = Proxy.revocable({ status: 'waiting' }, {});
    revoke();

    const instanceStore = {
      loadInstance: jest.fn(async () => null),
      listInstances: jest.fn(async () => {
        throw new Error('store failed');
      }),
    };
    const executionRepository = {
      listEventsByExecution: jest.fn(async () => []),
      getLastEvent: jest.fn(async () => null),
    };

    const inspector = new ProcessInstanceInspector({
      instanceStore,
      executionRepository,
      replayService: { getExecutionPath: jest.fn(() => []) },
    });

    const listed = await inspector.listInstances(hostileFilters);
    expect(listed).toEqual([]);
  }, 5000));

  test('explainWhyStopped tolera metadata e lastEvent hostis', withTimeout(async () => {
    const { proxy: hostileMetadata, revoke: revokeMetadata } = Proxy.revocable({ error: 'boom' }, {});
    revokeMetadata();
    const { proxy: hostileEvent, revoke: revokeEvent } = Proxy.revocable({ eventType: 'NODE_FAIL' }, {});
    revokeEvent();

    const instanceStore = {
      loadInstance: jest
        .fn()
        .mockResolvedValueOnce({
          executionId: 'exec-2',
          status: 'waiting',
          waitingState: { type: 'timer', resumeAt: '2026-01-01T00:00:00.000Z' },
        })
        .mockResolvedValueOnce({
          executionId: 'exec-3',
          status: 'failed',
          metadata: hostileMetadata,
        }),
      listInstances: jest.fn(async () => []),
    };
    const executionRepository = {
      listEventsByExecution: jest.fn(async () => []),
      getLastEvent: jest.fn(async () => hostileEvent),
    };

    const inspector = new ProcessInstanceInspector({
      instanceStore,
      executionRepository,
      replayService: { getExecutionPath: jest.fn(() => []) },
    });

    const waitingStop = await inspector.explainWhyStopped('exec-2');
    const failedStop = await inspector.explainWhyStopped('exec-3');

    expect(waitingStop).toEqual({
      reason: 'waiting',
      waitingState: { type: 'timer', resumeAt: '2026-01-01T00:00:00.000Z' },
      lastEventType: null,
    });
    expect(failedStop).toEqual({ reason: 'failed', error: null });
  }, 5000));

  test('getExecutionPath tolera repositorio e replay hostis', withTimeout(async () => {
    const { proxy: hostileExecutionId, revoke } = Proxy.revocable({ value: 'exec-4' }, {});
    revoke();

    const inspector = new ProcessInstanceInspector({
      instanceStore: {
        loadInstance: jest.fn(async () => null),
      },
      executionRepository: {
        listEventsByExecution: jest.fn(async () => {
          throw new Error('repo failed');
        }),
      },
      replayService: {
        getExecutionPath: jest.fn(() => {
          throw new Error('replay failed');
        }),
      },
    });

    const history = await inspector.getExecutionHistory(hostileExecutionId);
    const path = await inspector.getExecutionPath('exec-4');

    expect(history).toEqual([]);
    expect(path).toEqual([]);
  }, 5000));

  test('suporta stores de classe cujos métodos dependem de this (regressão: safeAsyncCall desvinculado)', withTimeout(async () => {
    // Regressão observada em runtime real (2026-07-27): GET /api/process-instances
    // retornava lista vazia e GET /api/process-instances/:id retornava not_found
    // mesmo com instâncias persistidas. Causa: safeAsyncCall invocava os métodos
    // do store desvinculados (fn(...args)); SequelizeProcessInstanceStore depende
    // de `this` (this.model/this._fallback), lançava TypeError e o catch genérico
    // engolia o erro retornando o fallback silenciosamente.
    class ClassBasedStore {
      constructor() {
        this.rows = new Map([['exec-class-1', { executionId: 'exec-class-1', status: 'completed' }]]);
      }

      async loadInstance(executionId) {
        return this.rows.get(executionId) || null;
      }

      async listInstances() {
        return Array.from(this.rows.values());
      }
    }

    class ClassBasedRepository {
      constructor() {
        this.events = [{ sequence: 1, eventType: 'PROCESS_STARTED' }];
      }

      async listEventsByExecution() {
        return this.events;
      }

      async getLastEvent() {
        return this.events[this.events.length - 1];
      }
    }

    const inspector = new ProcessInstanceInspector({
      instanceStore: new ClassBasedStore(),
      executionRepository: new ClassBasedRepository(),
      replayService: { getExecutionPath: () => [] },
    });

    const state = await inspector.getInstanceState('exec-class-1');
    const items = await inspector.listInstances({});
    const history = await inspector.getExecutionHistory('exec-class-1');

    expect(state).toEqual({ executionId: 'exec-class-1', status: 'completed' });
    expect(items).toEqual([{ executionId: 'exec-class-1', status: 'completed' }]);
    expect(history).toHaveLength(1);
  }, 5000));
});
