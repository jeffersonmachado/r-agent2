const { buildConversationReplay } = require('../replay');

describe('buildConversationReplay', () => {
  test('reconstrói mensagens, handoffs e nodesVisited em ordem cronológica', () => {
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
        type: 'MESSAGE_OUT',
        payload: { text: 'Olá' },
      },
      {
        id: '3',
        timestamp: '2025-01-01T10:00:02.000Z',
        sessionId: 's1',
        flowId: 'f1',
        nodeId: 'n2',
        type: 'MESSAGE_IN',
        payload: { text: 'Oi' },
      },
      {
        id: '4',
        timestamp: '2025-01-01T10:00:03.000Z',
        sessionId: 's1',
        flowId: 'f1',
        nodeId: 'n3',
        type: 'HANDOFF',
        payload: { queue: 'suporte_n1' },
      },
    ];

    const replay = buildConversationReplay(events);

    expect(replay.sessionId).toBe('s1');
    expect(replay.flowId).toBe('f1');

    expect(replay.messages).toHaveLength(2);
    expect(replay.messages[0]).toEqual({
      from: 'bot',
      text: 'Olá',
      at: '2025-01-01T10:00:01.000Z',
    });
    expect(replay.messages[1]).toEqual({
      from: 'user',
      text: 'Oi',
      at: '2025-01-01T10:00:02.000Z',
    });

    expect(replay.handoffs).toHaveLength(1);
    expect(replay.handoffs[0]).toEqual({
      queue: 'suporte_n1',
      at: '2025-01-01T10:00:03.000Z',
    });

    expect(replay.nodesVisited).toHaveLength(1);
    expect(replay.nodesVisited[0]).toEqual({
      nodeId: 'n1',
      at: '2025-01-01T10:00:00.000Z',
    });
  });

  test('retorna estruturas vazias para lista de eventos vazia', () => {
    const replay = buildConversationReplay([]);

    expect(replay.sessionId).toBeNull();
    expect(replay.flowId).toBeNull();
    expect(replay.messages).toEqual([]);
    expect(replay.handoffs).toEqual([]);
    expect(replay.nodesVisited).toEqual([]);
    expect(replay.rawEvents).toEqual([]);
  });

  test('lança erro se events não for um array', () => {
    expect(() => buildConversationReplay(null)).toThrow();
    expect(() => buildConversationReplay(undefined)).toThrow();
    expect(() => buildConversationReplay({})).toThrow();
  });
});


