'use strict';

/**
 * Testes unitários do callInsightBridgeService (P5.15):
 * transcrição → insight na mensagem + WorkspaceInsight → NBA.
 */

const mockAnalyze = jest.fn();
const mockPersistInsight = jest.fn();
const mockLinkFindOne = jest.fn();

jest.mock('../../api/services/voice/callTranscriptInsightService', () => ({
  analyzeCallTranscript: (...args) => mockAnalyze(...args),
  INTENT_ALLOWLIST: new Set(['reagendar', 'cancelar', 'compra']),
}));

jest.mock('../../api/db/models', () => ({
  WorkspaceEntityLink: () => ({ findOne: (...args) => mockLinkFindOne(...args) }),
}));

jest.mock('../../api/services/workspace/WorkspaceInsightService', () =>
  jest.fn().mockImplementation(() => ({
    persistInsight: (...args) => mockPersistInsight(...args),
  })));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { processCallInsight } = require('../../api/services/voice/callInsightBridgeService');
const WorkspaceInsightService = require('../../api/services/workspace/WorkspaceInsightService');

function buildMessage(body) {
  return {
    id: 'msg-1',
    tenant_key: 't1',
    conversation_id: 'conv-1',
    type: 'call',
    body,
    update: jest.fn(async function update(patch) {
      Object.assign(this, patch);
      return this;
    }),
  };
}

const INSIGHT = {
  intent: 'reagendar',
  summary: 'Cliente quer remarcar a consulta.',
  urgency: 'alta',
  suggestedAction: 'Oferecer novos horários',
  analyzedAt: '2026-09-07T12:00:00Z',
  provider: 'openai',
};

describe('services/voice/callInsightBridgeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // resetMocks:true (config global) zera a implementação da classe após o
    // primeiro require lazy do bridge — rearmar a cada teste.
    WorkspaceInsightService.mockImplementation(() => ({
      persistInsight: (...args) => mockPersistInsight(...args),
    }));
    mockAnalyze.mockResolvedValue(INSIGHT);
    mockLinkFindOne.mockResolvedValue({ entity_id: 'ent-1' });
    mockPersistInsight.mockResolvedValue({ id: 'ins-1' });
  });

  it('transcrição → insight gravado na mensagem + WorkspaceInsight opportunity persistido', async () => {
    const message = buildMessage({
      type: 'call',
      call: { uniqueid: 'u1', direction: 'in' },
      transcription: { text: 'quero remarcar minha consulta', language: 'pt' },
    });

    const out = await processCallInsight({ tenantId: 't1', message });

    expect(out.processed).toBe(true);
    expect(out.insightPersisted).toBe(true);
    expect(message.body.call.insight).toMatchObject({ intent: 'reagendar', urgency: 'alta' });
    expect(mockPersistInsight).toHaveBeenCalledWith({
      tenantId: 't1',
      entityId: 'ent-1',
      insight: {
        type: 'opportunity',
        description: 'Cliente sinalizou pedido de reagendamento em ligação: Cliente quer remarcar a consulta.',
        confidence: 0.85,
        source: 'voice_call',
      },
    });
  });

  it('intent cancelar → insight risk', async () => {
    mockAnalyze.mockResolvedValue({ ...INSIGHT, intent: 'cancelar', urgency: 'media', summary: 'Cliente quer cancelar o plano.' });
    const message = buildMessage({ type: 'call', call: {}, transcription: { text: 'quero cancelar' } });

    const out = await processCallInsight({ tenantId: 't1', message });

    expect(out.processed).toBe(true);
    expect(mockPersistInsight).toHaveBeenCalledWith(expect.objectContaining({
      insight: expect.objectContaining({ type: 'risk', confidence: 0.7 }),
    }));
  });

  it('intent duvida/suporte/outro → insight na mensagem, mas SEM WorkspaceInsight (ruído)', async () => {
    mockAnalyze.mockResolvedValue({ ...INSIGHT, intent: 'duvida' });
    const message = buildMessage({ type: 'call', call: {}, transcription: { text: 'que horas vocês abrem?' } });

    const out = await processCallInsight({ tenantId: 't1', message });

    expect(out.processed).toBe(true);
    expect(out.insightPersisted).toBe(false);
    expect(mockPersistInsight).not.toHaveBeenCalled();
    expect(message.body.call.insight).toBeTruthy();
  });

  it('idempotente: mensagem já com insight não reprocessa', async () => {
    const message = buildMessage({
      type: 'call',
      call: { insight: INSIGHT },
      transcription: { text: 'x' },
    });

    const out = await processCallInsight({ tenantId: 't1', message });

    expect(out.processed).toBe(false);
    expect(out.reason).toBe('already_processed');
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('sem transcrição → no_transcription, sem IA', async () => {
    const message = buildMessage({ type: 'call', call: {} });

    const out = await processCallInsight({ tenantId: 't1', message });

    expect(out).toEqual({ processed: false, reason: 'no_transcription' });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('IA indisponível → insight_unavailable, mensagem intacta', async () => {
    mockAnalyze.mockResolvedValue(null);
    const message = buildMessage({ type: 'call', call: {}, transcription: { text: 'x' } });

    const out = await processCallInsight({ tenantId: 't1', message });

    expect(out).toEqual({ processed: false, reason: 'insight_unavailable' });
    expect(message.update).not.toHaveBeenCalled();
  });

  it('conversa sem entidade vinculada: insight na mensagem, sem persistir (fail-soft)', async () => {
    mockLinkFindOne.mockResolvedValue(null);
    const message = buildMessage({ type: 'call', call: {}, transcription: { text: 'x' } });

    const out = await processCallInsight({ tenantId: 't1', message });

    expect(out.processed).toBe(true);
    expect(out.insightPersisted).toBe(false);
    expect(message.body.call.insight).toBeTruthy();
  });
});
