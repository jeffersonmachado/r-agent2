'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../channelGatewayService', () => ({
  ingestIncoming: jest.fn(async () => ({
    tenantId: 'tenant-wa',
    persist: { idempotent: false, conversationId: 'conv-1' },
  })),
}));

jest.mock('../conversationTicketLinkService', () => ({
  resolveOrCreateTicketFromIncomingMessage: jest.fn(async () => ({
    ticket: {
      id: 'ticket-1',
      tenantId: 'tenant-wa',
      status: 'open',
      mode: 'bot',
      assignedTo: null,
      context: {},
    },
  })),
  appendTicketMessage: jest.fn((id, msg) => ({
    id,
    tenantId: 'tenant-wa',
    status: 'open',
    mode: 'bot',
    assignedTo: null,
    context: {},
    lastMessage: msg?.text || '',
  })),
}));

jest.mock('../routingService', () => ({
  autoAssignTicket: jest.fn(async () => null),
}));

jest.mock('../websocketService', () => ({
  emitEvent: jest.fn(),
}));

jest.mock('../messageProcessor', () => ({
  processNormalizedInboundEvent: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../queueService', () => ({
  getTicket: jest.fn((id) => ({
    id,
    tenantId: 'tenant-wa',
    status: 'open',
    mode: 'bot',
    assignedTo: null,
    context: {},
  })),
  updateTicket: jest.fn((id, patch) => ({
    id,
    tenantId: 'tenant-wa',
    status: 'open',
    mode: 'bot',
    assignedTo: null,
    ...patch,
  })),
}));

jest.mock('../outboundQueueService', () => ({
  enqueueOutbound: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../whatsappQrService', () => ({
  resolveConnectionForInbound: jest.fn(async () => ({
    id: 'conn-wa-1',
    botEnabled: true,
    botFlowId: 'flow-wa-1',
  })),
}));

jest.mock('../planLimitsService', () => ({
  checkFeature: jest.fn(async () => ({ allowed: true })),
}));

jest.mock('../whatsappIvrService', () => {
  const actual = jest.requireActual('../whatsappIvrService');
  return {
    ...actual,
    getNormalizedWhatsAppIvrSetting: jest.fn(async () => ({
      ok: true,
      value: { enabled: false },
      departments: [],
      menuOptions: [],
    })),
  };
});

jest.mock('../whatsappIvrStateService', () => ({
  getState: jest.fn(async () => null),
  setState: jest.fn(async (_args) => true),
  resetState: jest.fn(async () => true),
}));

jest.mock('../push', () => ({
  sendToUser: jest.fn(async () => null),
  trimPreview: jest.fn((s) => String(s || '')),
}));

jest.mock('../push/notificationRules', () => ({
  shouldNotifyTicketMessage: jest.fn(() => false),
  selectRecipientUserIdsForTicket: jest.fn(() => []),
  consumeMessageDedup: jest.fn(() => ({ duplicate: false })),
}));

const { handleWhatsAppInbound } = require('../whatsappInboundService');
const channelGatewayService = require('../channelGatewayService');
const conversationTicketLinkService = require('../conversationTicketLinkService');
const whatsappQrService = require('../whatsappQrService');
const planLimitsService = require('../planLimitsService');
const { appendTicketMessage } = require('../conversationTicketLinkService');
const { processNormalizedInboundEvent } = require('../messageProcessor');
const whatsappIvrService = require('../whatsappIvrService');

describe('whatsappInboundService media inbound', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channelGatewayService.ingestIncoming.mockResolvedValue({
      tenantId: 'tenant-wa',
      persist: { idempotent: false, conversationId: 'conv-1' },
    });
    conversationTicketLinkService.resolveOrCreateTicketFromIncomingMessage.mockResolvedValue({
      ticket: {
        id: 'ticket-1',
        tenantId: 'tenant-wa',
        status: 'open',
        mode: 'bot',
        assignedTo: null,
        context: {},
      },
    });
    conversationTicketLinkService.appendTicketMessage.mockImplementation((id, msg) => ({
      id,
      tenantId: 'tenant-wa',
      status: 'open',
      mode: 'bot',
      assignedTo: null,
      context: {},
      lastMessage: msg?.text || '',
    }));
    whatsappQrService.resolveConnectionForInbound.mockResolvedValue({
      id: 'conn-wa-1',
      botEnabled: true,
      botFlowId: 'flow-wa-1',
    });
    planLimitsService.checkFeature.mockResolvedValue({ allowed: true });
    whatsappIvrService.getNormalizedWhatsAppIvrSetting.mockResolvedValue({
      ok: true,
      value: { enabled: false },
      departments: [],
      menuOptions: [],
    });
  });

  test('imagem sem legenda gera texto-resumo e propaga metadados de mídia', async () => {
    await handleWhatsAppInbound({
      source: 'cloud',
      tenantId: 'tenant-wa',
      payload: {
        message: {
          id: 'wamid-img-1',
          from: '5511999990000',
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'image',
          image: {
            id: 'media-img-1',
            mime_type: 'image/jpeg',
          },
        },
        value: { metadata: { phone_number_id: 'pn-1' } },
      },
      normalized: {
        messageType: 'image',
        text: null,
        media: { url: 'media-img-1', mimeType: 'image/jpeg' },
        externalMessageId: 'wamid-img-1',
        externalConversationId: '5511999990000',
      },
      deps: {
        flows: new Map(),
        sessionEvents: new Map(),
        saveSessionEvents: jest.fn(),
      },
    });

    expect(appendTicketMessage).toHaveBeenCalledTimes(1);
    const ledgerPayload = appendTicketMessage.mock.calls[0][1];
    expect(ledgerPayload.text).toBe('[imagem]');
    expect(ledgerPayload.messageType).toBe('image');
    expect(ledgerPayload.mediaUrl).toBe('media-img-1');
    expect(ledgerPayload.mimeType).toBe('image/jpeg');
    expect(ledgerPayload.fileName).toBeNull();

    expect(processNormalizedInboundEvent).toHaveBeenCalledTimes(1);
    const normalizedEvent = processNormalizedInboundEvent.mock.calls[0][0];
    expect(normalizedEvent.media).toBe('image');
    expect(normalizedEvent.payload.text).toBe('[imagem]');
    expect(normalizedEvent.payload.media).toEqual({
      type: 'image',
      url: 'media-img-1',
      mimeType: 'image/jpeg',
      fileName: null,
    });
  });

  test('documento sem legenda usa nome de arquivo e envia media=file no evento normalizado', async () => {
    await handleWhatsAppInbound({
      source: 'cloud',
      tenantId: 'tenant-wa',
      payload: {
        message: {
          id: 'wamid-doc-1',
          from: '5511999990001',
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'document',
          document: {
            id: 'media-doc-1',
            mime_type: 'application/pdf',
            filename: 'contrato.pdf',
          },
        },
        value: { metadata: { phone_number_id: 'pn-1' } },
      },
      normalized: {
        messageType: 'document',
        text: null,
        media: { url: 'media-doc-1', mimeType: 'application/pdf' },
        raw: { message: { document: { filename: 'contrato.pdf' } } },
        externalMessageId: 'wamid-doc-1',
        externalConversationId: '5511999990001',
      },
      deps: {
        flows: new Map(),
        sessionEvents: new Map(),
        saveSessionEvents: jest.fn(),
      },
    });

    expect(appendTicketMessage).toHaveBeenCalledTimes(1);
    const ledgerPayload = appendTicketMessage.mock.calls[0][1];
    expect(ledgerPayload.text).toBe('[documento] contrato.pdf');
    expect(ledgerPayload.messageType).toBe('document');
    expect(ledgerPayload.mediaUrl).toBe('media-doc-1');
    expect(ledgerPayload.mimeType).toBe('application/pdf');
    expect(ledgerPayload.fileName).toBe('contrato.pdf');

    expect(processNormalizedInboundEvent).toHaveBeenCalledTimes(1);
    const normalizedEvent = processNormalizedInboundEvent.mock.calls[0][0];
    expect(normalizedEvent.media).toBe('file');
    expect(normalizedEvent.payload.text).toBe('[documento] contrato.pdf');
    expect(normalizedEvent.payload.media).toEqual({
      type: 'document',
      url: 'media-doc-1',
      mimeType: 'application/pdf',
      fileName: 'contrato.pdf',
    });
  });

  test('audio sem texto gera placeholder e mantém tipo audio na engine', async () => {
    await handleWhatsAppInbound({
      source: 'cloud',
      tenantId: 'tenant-wa',
      payload: {
        message: {
          id: 'wamid-aud-1',
          from: '5511999990002',
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'audio',
          audio: {
            id: 'media-aud-1',
            mime_type: 'audio/ogg',
          },
        },
        value: { metadata: { phone_number_id: 'pn-1' } },
      },
      normalized: {
        messageType: 'audio',
        text: null,
        media: { url: 'media-aud-1', mimeType: 'audio/ogg' },
        externalMessageId: 'wamid-aud-1',
        externalConversationId: '5511999990002',
      },
      deps: {
        flows: new Map(),
        sessionEvents: new Map(),
        saveSessionEvents: jest.fn(),
      },
    });

    const ledgerPayload = appendTicketMessage.mock.calls[0][1];
    expect(ledgerPayload.text).toBe('[audio]');
    expect(ledgerPayload.messageType).toBe('audio');
    expect(ledgerPayload.mediaUrl).toBe('media-aud-1');
    expect(ledgerPayload.mimeType).toBe('audio/ogg');

    const normalizedEvent = processNormalizedInboundEvent.mock.calls[0][0];
    expect(normalizedEvent.media).toBe('audio');
    expect(normalizedEvent.payload.media).toEqual({
      type: 'audio',
      url: 'media-aud-1',
      mimeType: 'audio/ogg',
      fileName: null,
    });
  });

  test('video sem legenda gera placeholder e mantém tipo video na engine', async () => {
    await handleWhatsAppInbound({
      source: 'cloud',
      tenantId: 'tenant-wa',
      payload: {
        message: {
          id: 'wamid-vid-1',
          from: '5511999990003',
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'video',
          video: {
            id: 'media-vid-1',
            mime_type: 'video/mp4',
          },
        },
        value: { metadata: { phone_number_id: 'pn-1' } },
      },
      normalized: {
        messageType: 'video',
        text: null,
        media: { url: 'media-vid-1', mimeType: 'video/mp4' },
        externalMessageId: 'wamid-vid-1',
        externalConversationId: '5511999990003',
      },
      deps: {
        flows: new Map(),
        sessionEvents: new Map(),
        saveSessionEvents: jest.fn(),
      },
    });

    const ledgerPayload = appendTicketMessage.mock.calls[0][1];
    expect(ledgerPayload.text).toBe('[video]');
    expect(ledgerPayload.messageType).toBe('video');
    expect(ledgerPayload.mediaUrl).toBe('media-vid-1');
    expect(ledgerPayload.mimeType).toBe('video/mp4');

    const normalizedEvent = processNormalizedInboundEvent.mock.calls[0][0];
    expect(normalizedEvent.media).toBe('video');
    expect(normalizedEvent.payload.media).toEqual({
      type: 'video',
      url: 'media-vid-1',
      mimeType: 'video/mp4',
      fileName: null,
    });
  });

});
