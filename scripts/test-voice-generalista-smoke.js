'use strict';

const { processVoiceInboundEvent } = require('../api/services/voiceRuntimeService');

async function run() {
  const flows = new Map();
  flows.set('flow-voice-smoke', {
    id: 'flow-voice-smoke',
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
    flowId: 'flow-voice-smoke',
    saveSessionEvents: () => {},
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
    metadata: { source: 'voice-smoke-script', request_tts: false },
    voice_metadata: {
      partials: [],
      barge_in: false,
    },
  };

  const messages = [
    { trace: 'vtrace-1', asr_text: 'Quero preço dos planos' },
    { trace: 'vtrace-2', asr_text: 'Tenho interesse e quero contratar' },
    { trace: 'vtrace-3', asr_text: 'Pode fechar, vamos avançar na compra' },
  ];

  const stages = [];
  for (const msg of messages) {
    // eslint-disable-next-line no-await-in-loop
    const out = await processVoiceInboundEvent({
      ...base,
      trace_id: msg.trace,
      timestamp: new Date().toISOString(),
      payload: {
        asr_text: msg.asr_text,
        audio_url: 'https://example.invalid/audio.ogg',
      },
    }, deps);

    const stage = out && out.state && out.state.metadata ? out.state.metadata.last_stage : null;
    const asrText = out && out.voice && out.voice.input && out.voice.input.voice_metadata
      ? out.voice.input.voice_metadata.asr_text
      : null;

    if (!asrText) {
      throw new Error(`ASR não preenchido no evento ${msg.trace}`);
    }

    stages.push(stage);
    console.log(`[VOICE-SMOKE] ${msg.trace} -> stage=${stage} asr=${asrText}`);
  }

  const expected = ['interest', 'consideration', 'decision'];
  const ok = stages.length === expected.length && stages.every((s, i) => s === expected[i]);

  if (!ok) {
    throw new Error(`Stage inválido. Esperado=${expected.join(' > ')} recebido=${stages.join(' > ')}`);
  }

  console.log('[VOICE-SMOKE] ✅ VoiceRuntimeStub processou 3 eventos e evoluiu estágio corretamente');
}

run().catch((err) => {
  console.error('[VOICE-SMOKE] ❌ Falha:', err && err.message ? err.message : err);
  process.exit(1);
});
