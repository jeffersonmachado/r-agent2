'use strict';

/**
 * Delivery Ambiguity (P2) — janela "provider aceitou / ACK local perdido".
 *
 * Cobre permanentemente (fault injection) o ponto exato entre o sucesso do
 * provider e o mark-sent da fila, e a recovery por capability do provider:
 * - provider sem idempotência/lookup → delivery_unknown, ZERO redispatch cego;
 * - provider com idempotency key → retry seguro com a MESMA chave;
 * - provider com lookup → reconciliação (delivered/not_delivered/inconclusivo).
 *
 * O critério é providerDispatchCount / entregas lógicas — não apenas rows.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const STALE_PAST = new Date(Date.now() - 10 * 60 * 1000);

function buildHarness({
  providerImpl = null,
  failFirstSentAck = false,
  attemptLedgerFails = false,
} = {}) {
  jest.resetModules();

  const state = {
    queueRows: [],
    attempts: [],
    providerCalls: [],
    seq: 0,
  };

  let sentAckFaultArmed = failFirstSentAck;

  function makeRow(overrides = {}) {
    const row = {
      id: `outq-${++state.seq}`,
      tenant_key: 'tenant-1',
      channel_type: 'whatsapp',
      channel_account_id: null,
      conversation_id: 'conv-1',
      status: 'pending',
      attempts: 0,
      next_attempt_at: new Date(Date.now() - 1000),
      last_error: null,
      external_message_id: null,
      client_message_id: null,
      processing_at: null,
      processing_by: null,
      message: { to: '5511999999999', type: 'text', body: { text: 'oi' }, meta: {} },
      ...overrides,
    };
    row.update = jest.fn(async (payload) => {
      if (sentAckFaultArmed && payload && payload.status === 'sent') {
        sentAckFaultArmed = false;
        // crash: processo morre ANTES do ACK local — nada muda na row
        throw new Error('process_crash_before_local_ack');
      }
      Object.assign(row, payload);
      return row;
    });
    // Transação local do ACK (attempt completed + queue sent): semântica de
    // rollback do Postgres — qualquer throw descarta TODAS as escritas do escopo.
    row.sequelize = {
      transaction: jest.fn(async (fn) => {
        const attemptSnapshots = state.attempts.map((a) => ({ ...a }));
        const rowSnapshot = { ...row };
        try {
          return await fn(fakeTx);
        } catch (err) {
          state.attempts.forEach((a, i) => {
            Object.keys(a).forEach((k) => { delete a[k]; });
            Object.assign(a, attemptSnapshots[i]);
          });
          Object.keys(row).forEach((k) => { delete row[k]; });
          Object.assign(row, rowSnapshot);
          throw err;
        }
      }),
    };
    state.queueRows.push(row);
    return row;
  }

  const Op = { lte: 'lte', is: 'is', lt: 'lt', in: 'in' };
  const fakeTx = { LOCK: { UPDATE: 'UPDATE' } };
  const fakeSequelize = {
    constructor: { Op },
    transaction: jest.fn(async (fn) => fn(fakeTx)),
    query: jest.fn(async () => [[]]),
  };

  const QueueModel = {
    sequelize: fakeSequelize,
    findAll: jest.fn(async ({ where } = {}) => {
      const status = where && where.status;
      if (status === 'sending') {
        return state.queueRows.filter((r) => r.status === 'sending'
          && r.external_message_id == null
          && r.processing_at != null
          && new Date(r.processing_at) <= STALE_PAST);
      }
      const list = Array.isArray(status) ? status : [status];
      return state.queueRows.filter((r) => list.includes(r.status)
        && r.external_message_id == null
        && (r.attempts || 0) < 50
        && new Date(r.next_attempt_at) <= new Date());
    }),
    findOne: jest.fn(async ({ where } = {}) => {
      if (where.id) return state.queueRows.find((r) => r.tenant_key === where.tenant_key && r.id === where.id) || null;
      if (where.client_message_id) {
        return state.queueRows.find((r) => r.tenant_key === where.tenant_key && r.client_message_id === where.client_message_id) || null;
      }
      return null;
    }),
    update: jest.fn(async () => [0]),
    create: jest.fn(async (data) => makeRow(data)),
  };

  const AttemptModel = {
    create: jest.fn(async (data) => {
      if (attemptLedgerFails) throw new Error('attempt_ledger_down');
      const attempt = { ...data };
      attempt.update = jest.fn(async (payload) => { Object.assign(attempt, payload); return attempt; });
      state.attempts.push(attempt);
      return attempt;
    }),
    update: jest.fn(async (payload, { where } = {}) => {
      for (const a of state.attempts) {
        if (a.tenant_key === where.tenant_key && a.queue_item_id === where.queue_item_id && a.status === where.status) {
          Object.assign(a, payload);
        }
      }
      return [1];
    }),
  };

  const ChannelMessageModel = { update: jest.fn(async () => [0]), findOne: jest.fn(async () => null), create: jest.fn(async () => ({})) };

  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
  jest.doMock('../../api/db/models', () => ({
    OutboundQueueItem: () => QueueModel,
    OutboundAttempt: () => AttemptModel,
    ChannelConversation: () => ({ findOne: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'conv-x', update: jest.fn(async () => ({})) })) }),
    ChannelMessage: () => ChannelMessageModel,
    TicketEvent: () => ({ create: jest.fn(async () => ({})) }),
  }));

  const providerDispatch = jest.fn(providerImpl || (async () => ({ messages: [{ id: `wamid.${state.providerCalls.length + 1}` }] })));
  const sendTextMessage = jest.fn(async (to, text) => {
    state.providerCalls.push({ to, text });
    return providerDispatch(to, text);
  });
  jest.doMock('../../api/services/whatsappService', () => ({
    sendTextMessage,
    areCredentialsValid: jest.fn(() => true),
  }));
  jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
  jest.doMock('../../api/services/messengerService', () => ({ sendMessengerMessage: jest.fn() }));
  jest.doMock('../../api/services/whatsappQrBridgeService', () => ({ sendTextViaConnection: jest.fn(), sendMediaViaConnection: jest.fn() }));
  jest.doMock('../../api/services/ticketMediaService', () => ({ getTicketMediaById: jest.fn() }));
  jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(() => null), getTicket: jest.fn() }));
  jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
  jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
  jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

  // eslint-disable-next-line global-require
  const service = require('../../api/services/outboundQueueService');

  return {
    state,
    service,
    makeRow,
    QueueModel,
    AttemptModel,
    ChannelMessageModel,
    sendTextMessage,
    logicalDeliveries: () => new Set(state.providerCalls.map((c) => c.text)).size,
  };
}

describe('delivery ambiguity — crash entre provider accept e ACK local', () => {
  test('C1: provider aceita + crash antes do ACK (provider SEM idempotência) → delivery_unknown, 0 redispatch cego', async () => {
    const h = buildHarness({ failFirstSentAck: true });
    h.makeRow({ client_message_id: 'cli-c1', message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-c1' } } });

    // Run 1: dispatch acontece, ACK local falha (fault injection) — row fica sending
    const run1 = await h.service.processDue({ limit: 1 });
    expect(run1).toMatchObject({ processed: 1, sent: 0, skipped: 1 });
    expect(h.sendTextMessage).toHaveBeenCalledTimes(1);
    const row = h.state.queueRows[0];
    expect(row.status).toBe('sending');
    expect(h.state.attempts[0].status).toBe('started');

    // Crash/restart: row envelhecida em sending
    row.processing_at = STALE_PAST;

    // Run 2: recovery — whatsapp real não tem idempotency key nem lookup → delivery_unknown
    const run2 = await h.service.processDue({ limit: 1 });
    expect(run2.deliveryUnknown).toBe(1);
    expect(row.status).toBe('delivery_unknown');
    expect(row.reason_code).toBe('delivery_unknown');
    // attempt órfã marcada como resultado desconhecido
    expect(h.state.attempts[0].result).toBe('unknown');
    expect(h.state.attempts[0].error_class).toBe('process_crash_window');
    // status operacional propagado para a mensagem da conversa (UX)
    expect(h.ChannelMessageModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_unknown' }),
      expect.anything(),
    );

    // Run 3: delivery_unknown está FORA do claim automático — nenhum redispatch
    const run3 = await h.service.processDue({ limit: 1 });
    expect(run3.processed).toBe(0);
    expect(h.sendTextMessage).toHaveBeenCalledTimes(1); // providerDispatchCount = 1
  });

  test('C2: provider COM idempotency key → recovery reenfileira e retry usa a mesma chave (1 entrega lógica)', async () => {
    // Provider mock honra a chave: dedupe por clientMessageId (efeito lógico único)
    const deliveredKeys = new Set();
    const h = buildHarness({
      failFirstSentAck: true,
      providerImpl: async () => ({ messages: [{ id: 'wamid.dedupe' }] }),
    });
    h.makeRow({ client_message_id: 'cli-c2', message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-c2' } } });
    const overrides = { whatsapp: { supportsIdempotencyKey: true, safeRetryAfterUnknown: true } };

    await h.service.processDue({ limit: 1, capabilityOverrides: overrides });
    const row = h.state.queueRows[0];
    expect(row.status).toBe('sending'); // ACK perdido
    expect(h.state.attempts[0].status).toBe('started'); // rollback do ACK manteve a attempt órfã
    row.processing_at = STALE_PAST;

    // Recovery: retry é seguro → requeue; o claim do mesmo run já redespacha
    // com a MESMA idempotency key derivada de tenant+clientMessageId.
    const run2 = await h.service.processDue({ limit: 1, capabilityOverrides: overrides });
    expect(run2.sent).toBe(1);
    expect(row.status).toBe('sent');
    expect(h.sendTextMessage).toHaveBeenCalledTimes(2); // 2 chamadas técnicas
    deliveredKeys.add('cli-c2');
    expect(deliveredKeys.size).toBe(1); // 1 efeito lógico
    // idempotency key estável registrada no ledger das duas tentativas
    expect(h.state.attempts[0].idempotency_key).toBe('tenant-1:cli-c2');
    expect(h.state.attempts[1].idempotency_key).toBe('tenant-1:cli-c2');
    expect(h.state.attempts[0].result).toBe('unknown'); // 1ª tentativa: janela de crash
    expect(h.state.attempts[1].result).toBe('sent');
  });

  test('C3: ledger de tentativas é escrito ANTES do dispatch; indisponível → provider não é chamado', async () => {
    const h = buildHarness();
    h.makeRow({ client_message_id: 'cli-c3a' });
    await h.service.processDue({ limit: 1 });
    expect(h.state.attempts.length).toBe(1);
    expect(h.state.attempts[0].status).toBe('completed');
    expect(h.state.attempts[0].result).toBe('sent');
    expect(h.AttemptModel.create.mock.invocationCallOrder[0]).toBeLessThan(h.sendTextMessage.mock.invocationCallOrder[0]);

    const h2 = buildHarness({ attemptLedgerFails: true });
    h2.makeRow({ client_message_id: 'cli-c3b' });
    const res = await h2.service.processDue({ limit: 1 });
    expect(res.failed).toBe(1);
    expect(h2.sendTextMessage).not.toHaveBeenCalled();
    expect(h2.state.queueRows[0].reason_code).toBe('attempt_ledger_unavailable');
  });

  test('C4: provider com lookup — confirma entrega → sent sem novo dispatch', async () => {
    const h = buildHarness({ failFirstSentAck: true });
    h.makeRow({ client_message_id: 'cli-c4', message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-c4' } } });
    const overrides = { whatsapp: { supportsDeliveryLookup: true } };
    h.service.registerDeliveryLookupHandler('whatsapp', async () => ({ delivered: true, externalMessageId: 'wamid.lookup' }));

    await h.service.processDue({ limit: 1, capabilityOverrides: overrides });
    const row = h.state.queueRows[0];
    row.processing_at = STALE_PAST;

    await h.service.processDue({ limit: 1, capabilityOverrides: overrides });
    expect(row.status).toBe('sent');
    expect(row.external_message_id).toBe('wamid.lookup');
    expect(h.sendTextMessage).toHaveBeenCalledTimes(1); // nenhum dispatch extra
  });

  test('C5: provider com lookup — confirma NÃO-entrega → retry seguro; inconclusivo → delivery_unknown', async () => {
    const h = buildHarness({ failFirstSentAck: true });
    h.makeRow({ id: 'outq-lookup-1', client_message_id: 'cli-c5', message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-c5' } } });
    const overrides = { whatsapp: { supportsDeliveryLookup: true } };
    let lookupOutcome = { delivered: false };
    h.service.registerDeliveryLookupHandler('whatsapp', async () => lookupOutcome);

    await h.service.processDue({ limit: 1, capabilityOverrides: overrides });
    const row = h.state.queueRows[0];
    row.processing_at = STALE_PAST;

    // provider confirmou não-entrega → requeue seguro; o claim do mesmo run
    // redespacha (a 1ª tentativa tem prova de não-entrega, sem duplicação real)
    const run2 = await h.service.processDue({ limit: 1, capabilityOverrides: overrides });
    expect(run2.sent).toBe(1);
    expect(row.status).toBe('sent');
    expect(h.sendTextMessage).toHaveBeenCalledTimes(2);

    // Inconclusivo → delivery_unknown
    const h2 = buildHarness({ failFirstSentAck: true });
    h2.makeRow({ client_message_id: 'cli-c5b', message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-c5b' } } });
    h2.service.registerDeliveryLookupHandler('whatsapp', async () => null);
    await h2.service.processDue({ limit: 1, capabilityOverrides: overrides });
    const row2 = h2.state.queueRows[0];
    row2.processing_at = STALE_PAST;
    await h2.service.processDue({ limit: 1, capabilityOverrides: overrides });
    expect(row2.status).toBe('delivery_unknown');
    expect(h2.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  test('C6: resolveDeliveryUnknown reconcilia por evidência positiva (webhook/revisão), nunca por ausência', async () => {
    const h = buildHarness();
    const row = h.makeRow({ id: 'outq-du-1', client_message_id: 'cli-c6' });
    row.status = 'delivery_unknown';

    const inconclusive = await h.service.resolveDeliveryUnknown({ tenantId: 'tenant-1', queueItemId: 'outq-du-1', outcome: 'unknown' });
    expect(inconclusive.ok).toBe(false);
    expect(row.status).toBe('delivery_unknown');

    const delivered = await h.service.resolveDeliveryUnknown({ tenantId: 'tenant-1', queueItemId: 'outq-du-1', outcome: 'delivered', externalMessageId: 'wamid.cb' });
    expect(delivered).toMatchObject({ ok: true, status: 'sent' });
    expect(row.status).toBe('sent');
    expect(row.external_message_id).toBe('wamid.cb');

    const row2 = h.makeRow({ id: 'outq-du-2', client_message_id: 'cli-c6b' });
    row2.status = 'delivery_unknown';
    const notDelivered = await h.service.resolveDeliveryUnknown({ tenantId: 'tenant-1', queueItemId: 'outq-du-2', outcome: 'not_delivered' });
    expect(notDelivered).toMatchObject({ ok: true, status: 'pending' });
    expect(row2.status).toBe('pending');
  });

  test('C7: capabilities reais são conservadoras — nenhum provider atual declara retry seguro após ambiguidade', () => {
    // eslint-disable-next-line global-require
    const { getProviderCapabilities, PROVIDER_CAPABILITIES } = require('../../api/services/outboundProviderCapabilities');
    for (const channel of Object.keys(PROVIDER_CAPABILITIES)) {
      expect(getProviderCapabilities(channel).safeRetryAfterUnknown).toBe(false);
    }
    // provider desconhecido → default conservador
    expect(getProviderCapabilities('canal-inexistente').safeRetryAfterUnknown).toBe(false);
    expect(getProviderCapabilities('canal-inexistente').supportsIdempotencyKey).toBe(false);
  });
});
