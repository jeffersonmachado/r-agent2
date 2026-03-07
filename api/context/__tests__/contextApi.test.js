'use strict';

jest.mock('../contextStore', () => ({
  getContext: jest.fn(),
  patchContext: jest.fn(),
}));

jest.mock('../../services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ ok: true })),
}));

const { getContext, patchContext } = require('../contextStore');
const contextApi = require('..');

describe('contextApi governance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getContext.mockResolvedValue({
      tenant_id: 't1',
      session_id: 's1',
      trace_id: 'trace-1',
      tags: ['intent:support', 'severity:medium', 'topic:suporte'],
      entities: {},
      entity_meta: {},
      funnel_state: { stage: 'support', intent: 'support', severity: 'medium', next_action: 'educate' },
    });
    patchContext.mockImplementation(async (_tenant, _session, patch) => ({
      tenant_id: 't1',
      session_id: 's1',
      trace_id: patch.trace_id || 'trace-1',
      tags: patch.tags || ['intent:support', 'severity:medium'],
      entities: patch.entities || {},
      entity_meta: patch.entity_meta || {},
      funnel_state: patch.funnel_state || { stage: 'support', intent: 'support', severity: 'medium' },
    }));
  });

  test('bloqueia alteração de intent/severity por módulo não-owner sem override', async () => {
    await expect(
      contextApi.applyTags('t1', 's1', { add: ['intent:sales'] }, { module: 'crm' }),
    ).rejects.toMatchObject({ code: 'funnel_tag_mutation_not_allowed' });
  });

  test('permite alteração de funnel por owner', async () => {
    const out = await contextApi.setFunnelState(
      't1',
      's1',
      { intent: 'support', severity: 'high' },
      { module: 'orchestrator' },
    );
    expect(out.funnel_state.intent).toBe('support');
    expect(patchContext).toHaveBeenCalled();
  });

  test('aplica merge de entidades', async () => {
    const out = await contextApi.applyEntities('t1', 's1', {
      order_id: { value: 'X-1', source: 'regex', confidence: 0.8, updated_at: new Date().toISOString() },
    }, {}, { module: 'crm' });
    expect(out.entities.order_id.value).toBe('X-1');
    expect(patchContext).toHaveBeenCalled();
  });
});
