'use strict';

jest.mock('../../utils/redisClient', () => ({
  getRedisClientOrNull: jest.fn(() => null),
}));

jest.mock('../../../engine/executeStep', () => ({
  executeStep: jest.fn(),
}));

jest.mock('../../../engine/compiledFlowCache', () => ({
  getOrCompileFlow: jest.fn((f) => f),
}));

jest.mock('../outboundQueueService', () => ({
  enqueueOutbound: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ ok: true })),
}));

const { executeStep } = require('../../../engine/executeStep');
const { processVoiceInboundEvent } = require('../voiceRuntimeService');

describe('Voice generalista smoke (jest)', () => {
  beforeEach(() => {
    executeStep.mockImplementation(async (state, _flow, ctx) => ({
      state: {
        ...state,
        metadata: {
          ...(state.metadata || {}),
        },
      },
      output: {
        type: 'message',
        text: `Recebido voz: ${ctx?.input?.text || ''}`,
      },
      events: [{ type: 'step', timestamp: new Date().toISOString() }],
    }));
  });

  test('processa 3 eventos voice/audio na mesma sessão e evolui stage', async () => {
    const flows = new Map();
    flows.set('flow-voice-smoke-jest', {
      id: 'flow-voice-smoke-jest',
      tenantId: 'tenant-voice-smoke',
      version: 1,
      kind: 'chat',
      nodes: [
        { id: 'start', type: 'start', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    });

    const deps = {
      flows,
      sessionEvents: new Map(),
      flowId: 'flow-voice-smoke-jest',
      saveSessionEvents: jest.fn(),
    };

    const base = {
      event_type: 'message',
      channel: 'voice',
      media: 'audio',
      direction: 'inbound',
      tenant_id: 'tenant-voice-smoke',
      lead_id: 'lead-voice-1',
      session_id: 'session-voice-1',
      correlation_id: 'corr-voice-1',
      metadata: { source: 'voice-jest-smoke', request_tts: false },
      voice_metadata: { partials: [], barge_in: false },
    };

    const r1 = await processVoiceInboundEvent({
      ...base,
      trace_id: 'vtrace-j1',
      timestamp: new Date().toISOString(),
      payload: { asr_text: 'Quero preço dos planos', audio_url: 'https://example.invalid/a1.ogg' },
    }, deps);

    const r2 = await processVoiceInboundEvent({
      ...base,
      trace_id: 'vtrace-j2',
      timestamp: new Date().toISOString(),
      payload: { asr_text: 'Tenho interesse e quero contratar', audio_url: 'https://example.invalid/a2.ogg' },
    }, deps);

    const r3 = await processVoiceInboundEvent({
      ...base,
      trace_id: 'vtrace-j3',
      timestamp: new Date().toISOString(),
      payload: { asr_text: 'Pode fechar, vamos avançar na compra', audio_url: 'https://example.invalid/a3.ogg' },
    }, deps);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);

    expect(r1.state.metadata.last_stage).toBe('interest');
    expect(r2.state.metadata.last_stage).toBe('consideration');
    expect(r3.state.metadata.last_stage).toBe('decision');

    expect(r1.voice.input.voice_metadata.asr_text).toBe('Quero preço dos planos');
    expect(r2.voice.input.voice_metadata.asr_text).toBe('Tenho interesse e quero contratar');
    expect(r3.voice.input.voice_metadata.asr_text).toBe('Pode fechar, vamos avançar na compra');
  });
});
