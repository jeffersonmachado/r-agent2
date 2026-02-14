const { validateVoiceFlow } = require('../utils/voiceFlowValidator');

describe('validateVoiceFlow (kind=voice)', () => {
  test('valida um fluxo simples start -> voice_prompt_listen -> voice_hangup', () => {
    const flow = {
      tenantId: 't1',
      id: 'f1',
      name: 'URA',
      version: 1,
      kind: 'voice',
      nodes: [
        { id: 's', type: 'start', next: 'n1', config: {} },
        {
          id: 'n1',
          type: 'voice_prompt_listen',
          config: { text: 'Olá', variable: 'utterance', recordSeconds: 6 },
          next: 'h',
        },
        { id: 'h', type: 'voice_hangup', config: {} },
      ],
    };

    const res = validateVoiceFlow(flow);
    expect(res).toHaveProperty('valid', true);
    expect(Array.isArray(res.errors)).toBe(true);
    expect(res.errors.filter((e) => String(e.severity || 'error') === 'error')).toHaveLength(0);
  });

  test('falha quando não há start', () => {
    const flow = {
      kind: 'voice',
      nodes: [{ id: 'a', type: 'voice_hangup' }],
    };
    const res = validateVoiceFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === 'VOICE_START_NODE_COUNT')).toBe(true);
  });

  test('falha em tipo não suportado', () => {
    const flow = {
      kind: 'voice',
      nodes: [
        { id: 's', type: 'start', next: 'x' },
        { id: 'x', type: 'message', next: 'h', config: { text: 'oi' } },
        { id: 'h', type: 'voice_hangup' },
      ],
    };
    const res = validateVoiceFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === 'VOICE_UNSUPPORTED_NODE_TYPE')).toBe(true);
  });

  test('falha em nó órfão (não alcançável do start)', () => {
    const flow = {
      kind: 'voice',
      nodes: [
        { id: 's', type: 'start', next: 'h' },
        { id: 'h', type: 'voice_hangup' },
        { id: 'orphan', type: 'voice_hangup' },
      ],
    };
    const res = validateVoiceFlow(flow);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === 'VOICE_ORPHAN_NODE')).toBe(true);
  });
});

