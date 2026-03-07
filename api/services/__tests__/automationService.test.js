'use strict';

jest.mock('../tenantSettingsService', () => ({
  getSetting: jest.fn(),
  upsertSetting: jest.fn(),
}));

jest.mock('../../context', () => ({
  getNormalizedContext: jest.fn(),
}));

jest.mock('../nlpService', () => ({
  analyzeText: jest.fn(),
}));

const tenantSettingsService = require('../tenantSettingsService');
const contextApi = require('../../context');
const nlpService = require('../nlpService');
const automationService = require('../automationService');

describe('automationService.runAutomation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('inclui normalized_context quando session_id é informado', async () => {
    tenantSettingsService.getSetting.mockResolvedValue({
      ok: true,
      value: {
        automations: [{ id: 'auto-1', name: 'A1', status: 'draft', definition: {} }],
      },
    });

    tenantSettingsService.upsertSetting.mockImplementation(async ({ value }) => ({
      ok: true,
      value,
    }));

    contextApi.getNormalizedContext.mockResolvedValue({
      tenant_id: 'tenant-1',
      session_id: 'sess-1',
      tags: ['intent:support'],
      entities: {},
      funnel_state: { stage: 'support', intent: 'support', severity: 'medium', next_action: 'educate' },
    });

    const out = await automationService.runAutomation('tenant-1', 'auto-1', { session_id: 'sess-1' });

    expect(out.ok).toBe(true);
    expect(out.run.session_id).toBe('sess-1');
    expect(out.run.normalized_context).toBeTruthy();
    expect(out.run.ai_analysis).toBeNull();
    expect(contextApi.getNormalizedContext).toHaveBeenCalledWith('tenant-1', 'sess-1');
  });

  test('mantém compatibilidade sem runContext', async () => {
    tenantSettingsService.getSetting.mockResolvedValue({
      ok: true,
      value: {
        automations: [{ id: 'auto-2', name: 'A2', status: 'draft', definition: {} }],
      },
    });

    tenantSettingsService.upsertSetting.mockImplementation(async ({ value }) => ({
      ok: true,
      value,
    }));

    const out = await automationService.runAutomation('tenant-1', 'auto-2');

    expect(out.ok).toBe(true);
    expect(out.run.session_id).toBeNull();
    expect(out.run.normalized_context).toBeNull();
    expect(out.run.ai_analysis).toBeNull();
    expect(contextApi.getNormalizedContext).not.toHaveBeenCalled();
  });

  test('inclui sentiment na análise de IA quando há texto no runContext', async () => {
    tenantSettingsService.getSetting.mockResolvedValue({
      ok: true,
      value: {
        automations: [{ id: 'auto-3', name: 'A3', status: 'draft', definition: {} }],
      },
    });
    tenantSettingsService.upsertSetting.mockImplementation(async ({ value }) => ({ ok: true, value }));
    nlpService.analyzeText.mockResolvedValue({
      intent: 'support',
      sentiment: 'negative',
      entities: { order_id: { value: 'A-100' } },
    });

    const out = await automationService.runAutomation('tenant-1', 'auto-3', {
      text: 'Estou muito insatisfeito com a entrega',
    });

    expect(out.ok).toBe(true);
    expect(nlpService.analyzeText).toHaveBeenCalledWith('Estou muito insatisfeito com a entrega', true);
    expect(out.run.ai_analysis).toEqual({
      text: 'Estou muito insatisfeito com a entrega',
      intent: 'support',
      sentiment: 'negative',
      entities_count: 1,
    });
    expect(out.automation.lastRunAiAnalysis).toEqual({
      text: 'Estou muito insatisfeito com a entrega',
      intent: 'support',
      sentiment: 'negative',
      entities_count: 1,
    });
  });

  test('não quebra execução quando análise NLP falha', async () => {
    tenantSettingsService.getSetting.mockResolvedValue({
      ok: true,
      value: {
        automations: [{ id: 'auto-4', name: 'A4', status: 'draft', definition: {} }],
      },
    });
    tenantSettingsService.upsertSetting.mockImplementation(async ({ value }) => ({ ok: true, value }));
    nlpService.analyzeText.mockRejectedValue(new Error('nlp down'));

    const out = await automationService.runAutomation('tenant-1', 'auto-4', {
      message: 'Preciso de ajuda urgente',
    });

    expect(out.ok).toBe(true);
    expect(out.run.ai_analysis).toEqual({
      text: 'Preciso de ajuda urgente',
      intent: null,
      sentiment: null,
      entities_count: 0,
      error: 'nlp_analysis_failed',
    });
  });
});
