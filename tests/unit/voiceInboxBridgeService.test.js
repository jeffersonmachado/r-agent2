'use strict';

/**
 * Voice + Digital — ponte chamada → Inbox (voiceInboxBridgeService).
 * Models mockados (padrão tenantRecommendationStats): stores em memória.
 */

const { Op } = require('sequelize');

function buildConversationModel(store) {
  return {
    findOne: jest.fn(async ({ where } = {}) => {
      const found = store.find((item) => {
        if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
        if (where?.channel_type) {
          if (where.channel_type[Op.ne]) {
            if (item.channel_type === where.channel_type[Op.ne]) return false;
          } else if (item.channel_type !== where.channel_type) return false;
        }
        if (where?.external_id && item.external_id !== where.external_id) return false;
        if (where?.[Op.or]) {
          return where[Op.or].some((clause) =>
            (clause.external_id && item.external_id === clause.external_id) ||
            (clause.contact_id && item.contact_id === clause.contact_id));
        }
        return true;
      });
      if (!found) return null;
      return Object.assign(found, {
        update: jest.fn(async (patch) => {
          Object.assign(found, patch);
          return found;
        }),
      });
    }),
    create: jest.fn(async (data) => {
      store.push(data);
      return data;
    }),
  };
}

function buildMessageModel(store) {
  return {
    findOne: jest.fn(async ({ where } = {}) => store.find((item) =>
      (!where?.tenant_key || item.tenant_key === where.tenant_key) &&
      (!where?.external_message_id || item.external_message_id === where.external_message_id)) || null),
    create: jest.fn(async (data) => {
      store.push(data);
      return data;
    }),
  };
}

function buildLeadModel(store) {
  return {
    findAll: jest.fn(async ({ where } = {}) => {
      const pattern = where?.phone?.[Op.iLike];
      const needle = pattern ? pattern.replace(/%/g, '') : null;
      return store.filter((item) =>
        item.tenant_key === where?.tenant_key && needle && String(item.phone || '').includes(needle));
    }),
  };
}

const registerInbound = jest.fn(async () => {});
const linkMessageReceived = jest.fn(async () => null);
const linkRecordingToCallMessage = jest.fn(async () => ({ linked: false, reason: 'recording_not_found' }));

function loadService({ conversations = [], messages = [], leads = [] } = {}) {
  jest.resetModules();
  registerInbound.mockClear();
  linkMessageReceived.mockClear();
  linkRecordingToCallMessage.mockClear();
  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
  jest.doMock('../../api/db/models', () => ({
    ChannelConversation: () => buildConversationModel(conversations),
    ChannelMessage: () => buildMessageModel(messages),
    MarketingLead: () => buildLeadModel(leads),
  }));
  jest.doMock('../../api/services/channelConversationService', () => ({
    registerInboundMessageActivity: registerInbound,
  }));
  jest.doMock('../../api/services/workspace/WorkspaceLinkAutomationService', () =>
    jest.fn().mockImplementation(() => ({ linkMessageReceived })));
  jest.doMock('../../api/services/pbx/voiceRecordingLinkService', () => ({
    linkRecordingToCallMessage,
  }));
  // eslint-disable-next-line global-require
  const service = require('../../api/services/pbx/voiceInboxBridgeService');
  return { service, conversations, messages, leads };
}

const missedInbound = {
  cdrId: 42,
  uniqueid: '1700000000.1',
  src: '5511999887766',
  dst: '1001',
  disposition: 'NO ANSWER',
  duration: 25,
  billsec: 0,
  endedAt: '2026-09-06T10:00:25.000Z',
};

describe('voiceInboxBridgeService.recordCallToInbox', () => {
  test('chamada perdida inbound vira conversa de voz + mensagem call com unread (registerInbound)', async () => {
    const { service, conversations, messages } = loadService();
    const out = await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });

    expect(out.bridged).toBe(true);
    expect(out.direction).toBe('in');
    expect(out.answered).toBe(false);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      tenant_key: 'tenant-a',
      channel_type: 'voice',
      external_id: '5511999887766',
      status: 'open',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'call',
      direction: 'in',
      external_message_id: 'pbx-call:tenant-a:1700000000.1',
    });
    expect(messages[0].body.text).toContain('Chamada perdida de 5511999887766');
    expect(messages[0].body.call).toMatchObject({ answered: false, direction: 'in', phone: '5511999887766' });
    expect(registerInbound).toHaveBeenCalledTimes(1);
  });

  test('ao registrar a chamada, dispara link para a timeline do Workspace e para a gravação (best-effort)', async () => {
    const { service } = loadService();
    const out = await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });

    expect(out.bridged).toBe(true);
    expect(linkMessageReceived).toHaveBeenCalledTimes(1);
    expect(linkMessageReceived).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      messageId: out.messageId,
    }));
    expect(linkRecordingToCallMessage).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      uniqueid: '1700000000.1',
    });
  });

  test('falha do link de Workspace/gravação NÃO quebra o registro da chamada', async () => {
    linkMessageReceived.mockRejectedValueOnce(new Error('workspace down'));
    linkRecordingToCallMessage.mockRejectedValueOnce(new Error('recording down'));
    const { service, messages } = loadService();
    const out = await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });

    expect(out.bridged).toBe(true);
    expect(messages).toHaveLength(1);
  });

  test('chamada atendida inbound entra no histórico SEM unread', async () => {
    const { service, messages } = loadService();
    const out = await service.recordCallToInbox({
      tenantId: 'tenant-a',
      call: { ...missedInbound, uniqueid: '1700000001.2', disposition: 'ANSWERED', billsec: 125 },
    });

    expect(out.answered).toBe(true);
    expect(messages[0].body.text).toContain('Chamada recebida de 5511999887766 — 2 min 5 s');
    expect(registerInbound).not.toHaveBeenCalled();
  });

  test('chamada outbound (ramal → externo) tem direction out e texto correto', async () => {
    const { service, conversations, messages } = loadService();
    const out = await service.recordCallToInbox({
      tenantId: 'tenant-a',
      call: {
        ...missedInbound,
        uniqueid: '1700000002.3',
        src: '1001',
        dst: '5511999887766',
        disposition: 'ANSWERED',
        billsec: 65,
      },
    });

    expect(out.direction).toBe('out');
    expect(conversations[0].external_id).toBe('5511999887766');
    expect(messages[0].body.text).toContain('Chamada realizada para 5511999887766 — 1 min 5 s');
    expect(registerInbound).not.toHaveBeenCalled();
  });

  test('chamada interna entre ramais NÃO vira conversa', async () => {
    const { service, conversations, messages } = loadService();
    const out = await service.recordCallToInbox({
      tenantId: 'tenant-a',
      call: { ...missedInbound, src: '1001', dst: '1002' },
    });

    expect(out).toMatchObject({ bridged: false, reason: 'internal_call' });
    expect(conversations).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  test('idempotente: segunda chamada com mesmo uniqueid é ignorada', async () => {
    const { service, messages } = loadService();
    await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });
    const second = await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });

    expect(second).toMatchObject({ bridged: true, skipped: true, reason: 'already_bridged' });
    expect(messages).toHaveLength(1);
  });

  test('resolve contato de conversa whatsapp existente com o mesmo número', async () => {
    const conversations = [{
      id: 'conv-wa',
      tenant_key: 'tenant-a',
      channel_type: 'whatsapp',
      external_id: '5511999887766',
      contact_id: 'contact-9',
      metadata: { contactName: 'Maria Silva' },
    }];
    const { service } = loadService({ conversations });

    await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });

    const voiceConv = conversations.find((c) => c.channel_type === 'voice');
    expect(voiceConv.contact_id).toBe('contact-9');
    expect(voiceConv.metadata.contactName).toBe('Maria Silva');
  });

  test('resolve contato via MarketingLead com telefone equivalente (dígitos)', async () => {
    const leads = [{
      id: 'lead-7',
      tenant_key: 'tenant-a',
      phone: '+55 (11) 99988-7766',
      name: 'João Souza',
    }];
    const { service, conversations } = loadService({ leads });

    await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });

    expect(conversations[0].contact_id).toBe('lead-7');
    expect(conversations[0].metadata.contactName).toBe('João Souza');
  });

  test('conversa de voz existente é reutilizada (sem duplicar)', async () => {
    const conversations = [{
      id: 'conv-voice',
      tenant_key: 'tenant-a',
      channel_type: 'voice',
      external_id: '5511999887766',
      contact_id: null,
      metadata: {},
    }];
    const { service } = loadService({ conversations });

    await service.recordCallToInbox({ tenantId: 'tenant-a', call: missedInbound });

    expect(conversations.filter((c) => c.channel_type === 'voice')).toHaveLength(1);
  });
});

describe('voiceInboxBridgeService helpers', () => {
  const { service } = loadService();

  test('pickExternalNumber: ramal (<=5 dígitos) nunca é o externo', () => {
    expect(service.pickExternalNumber({ src: '1001', dst: '5511999887766' })).toBe('5511999887766');
    expect(service.pickExternalNumber({ src: '5511999887766', dst: '1001' })).toBe('5511999887766');
    expect(service.pickExternalNumber({ src: '1001', dst: '1002' })).toBeNull();
  });

  test('isAnsweredCall: disposition ANSWERED ou billsec > 0', () => {
    expect(service.isAnsweredCall({ disposition: 'ANSWERED', billsec: 0 })).toBe(true);
    expect(service.isAnsweredCall({ disposition: 'NO ANSWER', billsec: 0 })).toBe(false);
    expect(service.isAnsweredCall({ disposition: 'BUSY', billsec: 3 })).toBe(true);
  });

  test('formatDuration', () => {
    expect(service.formatDuration(45)).toBe('45 s');
    expect(service.formatDuration(125)).toBe('2 min 5 s');
    expect(service.formatDuration(120)).toBe('2 min');
  });
});
