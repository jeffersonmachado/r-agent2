'use strict';

const { processNormalizedInboundEvent } = require('../api/services/messageProcessor');

async function run() {
  const flows = new Map();
  flows.set('flow-smoke', {
    id: 'flow-smoke',
    tenantId: 'tenant-smoke',
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
    flowId: 'flow-smoke',
    saveSessionEvents: () => {},
  };

  const base = {
    event_type: 'message',
    channel: 'api',
    media: 'text',
    direction: 'inbound',
    tenant_id: 'tenant-smoke',
    lead_id: 'lead-smoke-1',
    session_id: 'session-smoke-1',
    correlation_id: 'corr-smoke-1',
    metadata: { source: 'smoke-script' },
    voice_metadata: {},
  };

  const messages = [
    { trace: 'trace-s1', text: 'Quero preço dos planos' },
    { trace: 'trace-s2', text: 'Tenho interesse e quero contratar' },
    { trace: 'trace-s3', text: 'Pode fechar, vamos avançar na compra' },
  ];

  const stages = [];
  for (const msg of messages) {
    // eslint-disable-next-line no-await-in-loop
    const out = await processNormalizedInboundEvent({
      ...base,
      trace_id: msg.trace,
      timestamp: new Date().toISOString(),
      payload: { text: msg.text },
    }, deps);

    const stage = out && out.state && out.state.metadata ? out.state.metadata.last_stage : null;
    stages.push(stage);
    console.log(`[SMOKE] ${msg.trace} -> stage=${stage}`);
  }

  const expected = ['interest', 'consideration', 'decision'];
  const ok = stages.length === expected.length && stages.every((s, i) => s === expected[i]);

  if (!ok) {
    throw new Error(`Stage inválido. Esperado=${expected.join(' > ')} recebido=${stages.join(' > ')}`);
  }

  console.log('[SMOKE] ✅ Funil Generalista IA evoluiu corretamente em 3 mensagens');
}

run().catch((err) => {
  console.error('[SMOKE] ❌ Falha:', err && err.message ? err.message : err);
  process.exit(1);
});
