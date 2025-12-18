const { setMetricsCollector, recordMetricsForStep, _internal } = require('../metrics');

describe('metrics', () => {
  afterEach(() => {
    setMetricsCollector(null);
  });

  const compiledFlow = {
    tenantId: 't1',
    id: 'f1',
    name: 'Fluxo',
    version: 1,
    versionHash: 'abc',
    nodes: [],
    metadata: {},
  };

  const stateBefore = {
    tenantId: 't1',
    sessionId: 's1',
    flowId: 'f1',
    flowVersion: 1,
    currentNodeId: 'n1',
    variables: {},
    history: [],
    metadata: {},
  };

  test('buildMetricEvents marca eventos de IA corretamente', () => {
    const events = [
      {
        id: '1',
        timestamp: '2025-01-01T10:00:00.000Z',
        sessionId: 's1',
        flowId: 'f1',
        nodeId: 'n1',
        type: 'NODE_ENTER',
        payload: {},
      },
      {
        id: '2',
        timestamp: '2025-01-01T10:00:01.000Z',
        sessionId: 's1',
        flowId: 'f1',
        nodeId: 'n1',
        type: 'AI_REQUESTED',
        payload: {},
      },
      {
        id: '3',
        timestamp: '2025-01-01T10:00:02.000Z',
        sessionId: 's1',
        flowId: 'f1',
        nodeId: 'n1',
        type: 'AI_ERROR',
        payload: {},
      },
    ];

    const metrics = _internal.buildMetricEvents(stateBefore, compiledFlow, events);

    expect(metrics).toHaveLength(3);

    expect(metrics[0]).toMatchObject({
      isAiEvent: false,
      isAiError: false,
    });

    expect(metrics[1]).toMatchObject({
      isAiEvent: true,
      isAiError: false,
    });

    expect(metrics[2]).toMatchObject({
      isAiEvent: true,
      isAiError: true,
    });
  });

  test('recordMetricsForStep não lança erro se não houver collector', () => {
    expect(() =>
      recordMetricsForStep(stateBefore, compiledFlow, {
        nextState: stateBefore,
        events: [],
        output: null,
      }),
    ).not.toThrow();
  });

  test('recordMetricsForStep chama collector com eventos agregados', (done) => {
    const events = [
      {
        id: '1',
        timestamp: '2025-01-01T10:00:00.000Z',
        sessionId: 's1',
        flowId: 'f1',
        nodeId: 'n1',
        type: 'NODE_ENTER',
        payload: {},
      },
    ];

    setMetricsCollector((metricEvents) => {
      try {
        expect(metricEvents).toHaveLength(1);
        expect(metricEvents[0]).toMatchObject({
          tenantId: 't1',
          flowId: 'f1',
          flowVersion: 1,
          sessionId: 's1',
          nodeId: 'n1',
          eventType: 'NODE_ENTER',
        });
        done();
      } catch (err) {
        done(err);
      }
    });

    recordMetricsForStep(stateBefore, compiledFlow, {
      nextState: stateBefore,
      events,
      output: null,
    });
  });
});


