const { NodeRegistry } = require('../nodeRegistry');
const { runStep } = require('../runner');
const { startNodeHandler, endNodeHandler } = require('../nodes/basicNodes');
const {
  voicePromptListenNodeHandler,
  voiceListenAsrNodeHandler,
  voiceGatherDtmfNodeHandler,
  voiceHangupNodeHandler,
} = require('../nodes/voiceNodes');

describe('voice nodes (kind=voice)', () => {
  function createRegistry() {
    const r = new NodeRegistry();
    r.register('start', startNodeHandler);
    r.register('end', endNodeHandler);
    r.register('voice_prompt_listen', voicePromptListenNodeHandler);
    r.register('voice_listen_asr', voiceListenAsrNodeHandler);
    r.register('voice_gather_dtmf', voiceGatherDtmfNodeHandler);
    r.register('voice_hangup', voiceHangupNodeHandler);
    return r;
  }

  test('voice_listen_asr aguarda input e mantém no mesmo nó', async () => {
    const registry = createRegistry();
    const flow = {
      tenantId: 't1',
      id: 'f1',
      name: 'URA',
      version: 1,
      kind: 'voice',
      nodes: [
        { id: 's', type: 'start', next: 'p', config: {} },
        { id: 'p', type: 'voice_prompt_listen', next: 'l', config: { text: 'Diga algo' } },
        { id: 'l', type: 'voice_listen_asr', next: 'h', config: { variable: 'utterance' } },
        { id: 'h', type: 'voice_hangup', config: {} },
      ],
    };

    let state = {
      tenantId: 't1',
      sessionId: 'sess-1',
      flowId: 'f1',
      flowVersion: 1,
      currentNodeId: 's',
      variables: {},
      history: [],
      metadata: { channel: 'voice' },
    };

    // start -> p
    let out = await runStep(flow, state, registry, undefined, {});
    state = out.nextState;
    expect(state.currentNodeId).toBe('p');

    // p -> l
    out = await runStep(flow, state, registry, undefined, {});
    state = out.nextState;
    expect(state.currentNodeId).toBe('l');

    // l (sem input) -> mantém em l (waitForInput)
    out = await runStep(flow, state, registry, undefined, {});
    state = out.nextState;
    expect(out.output).toMatchObject({ type: 'voice', action: 'listen_asr', waitForInput: true });
    expect(state.currentNodeId).toBe('l');

    // l (com input) -> h
    out = await runStep(flow, state, registry, { voice: { transcript: 'oi' } }, {});
    state = out.nextState;
    expect(state.variables.utterance).toBe('oi');
    expect(state.currentNodeId).toBe('h');
  });

  test('voice_gather_dtmf aguarda dígitos e mantém no mesmo nó', async () => {
    const registry = createRegistry();
    const flow = {
      tenantId: 't1',
      id: 'f2',
      name: 'URA DTMF',
      version: 1,
      kind: 'voice',
      nodes: [
        { id: 's', type: 'start', next: 'g', config: {} },
        { id: 'g', type: 'voice_gather_dtmf', next: 'e', config: { variable: 'choice', maxDigits: 1 } },
        { id: 'e', type: 'end', config: {} },
      ],
    };

    let state = {
      tenantId: 't1',
      sessionId: 'sess-2',
      flowId: 'f2',
      flowVersion: 1,
      currentNodeId: 's',
      variables: {},
      history: [],
      metadata: { channel: 'voice' },
    };

    // start -> g
    let out = await runStep(flow, state, registry, undefined, {});
    state = out.nextState;
    expect(state.currentNodeId).toBe('g');

    // g sem input -> mantém
    out = await runStep(flow, state, registry, undefined, {});
    state = out.nextState;
    expect(out.output).toMatchObject({ type: 'voice', action: 'gather_dtmf', waitForInput: true });
    expect(state.currentNodeId).toBe('g');

    // g com dtmf -> end
    out = await runStep(flow, state, registry, { voice: { dtmf: '1' } }, {});
    state = out.nextState;
    expect(state.variables.choice).toBe('1');
    expect(state.currentNodeId).toBe('e');
  });
});

