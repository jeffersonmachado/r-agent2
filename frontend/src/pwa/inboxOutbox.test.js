import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueueReply,
  flushOutbox,
  listPending,
  pendingCount,
  failedCount,
  clearOutbox,
  generateClientMessageId,
} from './inboxOutbox';

describe('pwa/inboxOutbox', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('enfileira resposta pendente com metadados e clientMessageId estável', () => {
    const entry = enqueueReply({ conversationId: 'c1', body: 'Olá!' });
    expect(entry.conversationId).toBe('c1');
    expect(entry.body).toBe('Olá!');
    expect(entry.id).toMatch(/^outbox-/);
    expect(entry.clientMessageId).toBeTruthy();
    expect(entry.status).toBe('pending');
    expect(entry.attempts).toBe(0);
    expect(entry.createdAt).toBeTruthy();
    expect(pendingCount()).toBe(1);
  });

  it('respeita clientMessageId fornecido pelo caller (mesma chave da 1ª tentativa)', () => {
    const entry = enqueueReply({ conversationId: 'c1', body: 'Olá!', clientMessageId: 'cli-123' });
    expect(entry.clientMessageId).toBe('cli-123');
  });

  it('dedup por clientMessageId: retry do mesmo envio não duplica', () => {
    const first = enqueueReply({ conversationId: 'c1', body: 'Olá!', clientMessageId: 'cli-dup' });
    const second = enqueueReply({ conversationId: 'c1', body: 'Olá!', clientMessageId: 'cli-dup' });
    expect(second.id).toBe(first.id);
    expect(pendingCount()).toBe(1);
  });

  it('mesmo body com clientMessageIds diferentes NÃO colapsa (são mensagens distintas)', () => {
    enqueueReply({ conversationId: 'c1', body: 'Olá!', clientMessageId: 'cli-a' });
    enqueueReply({ conversationId: 'c1', body: 'Olá!', clientMessageId: 'cli-b' });
    expect(pendingCount()).toBe(2);
  });

  it('permite mesma mensagem em conversas diferentes', () => {
    enqueueReply({ conversationId: 'c1', body: 'Olá!' });
    enqueueReply({ conversationId: 'c2', body: 'Olá!' });
    expect(pendingCount()).toBe(2);
  });

  it('clientMessageId é estável entre reloads (re-lê do localStorage)', () => {
    const entry = enqueueReply({ conversationId: 'c1', body: 'Persiste' });
    const reloaded = listPending();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].clientMessageId).toBe(entry.clientMessageId);
    expect(reloaded[0].id).toBe(entry.id);
  });

  it('migração tolerante: entry antiga (sem clientMessageId) ganha um id estável ao carregar', () => {
    localStorage.setItem('rap_inbox_outbox', JSON.stringify([
      { id: 'outbox-legacy-1', conversationId: 'c1', body: 'antiga', queuedAt: '2026-09-01T10:00:00.000Z' },
    ]));
    const first = listPending();
    expect(first[0].clientMessageId).toBeTruthy();
    expect(first[0].createdAt).toBe('2026-09-01T10:00:00.000Z');
    expect(first[0].status).toBe('pending');
    // Segunda leitura: mesmo id (migração foi persistida).
    const second = listPending();
    expect(second[0].clientMessageId).toBe(first[0].clientMessageId);
  });

  it('flush reenvia em ordem com o clientMessageId e esvazia a fila', async () => {
    const e1 = enqueueReply({ conversationId: 'c1', body: 'Primeira' });
    const e2 = enqueueReply({ conversationId: 'c2', body: 'Segunda' });
    const replyFn = vi.fn(async () => ({}));

    const result = await flushOutbox(replyFn);

    expect(result).toEqual({ sent: 2, remaining: 0, failed: 0 });
    expect(replyFn).toHaveBeenNthCalledWith(1, 'c1', 'Primeira', e1.clientMessageId);
    expect(replyFn).toHaveBeenNthCalledWith(2, 'c2', 'Segunda', e2.clientMessageId);
    expect(pendingCount()).toBe(0);
    expect(listPending()).toEqual([]);
  });

  it('retry usa o MESMO clientMessageId da tentativa anterior', async () => {
    const entry = enqueueReply({ conversationId: 'c1', body: 'Retry', clientMessageId: 'cli-retry' });
    const replyFn = vi.fn().mockRejectedValueOnce(new Error('network down'));

    await flushOutbox(replyFn);
    expect(replyFn).toHaveBeenNthCalledWith(1, 'c1', 'Retry', 'cli-retry');

    replyFn.mockResolvedValueOnce({});
    const second = await flushOutbox(replyFn);
    expect(replyFn).toHaveBeenNthCalledWith(2, 'c1', 'Retry', 'cli-retry');
    expect(second).toEqual({ sent: 1, remaining: 0, failed: 0 });
    expect(entry.clientMessageId).toBe('cli-retry');
  });

  it('flush para no primeiro erro, registra attempts/lastError e volta para pending', async () => {
    enqueueReply({ conversationId: 'c1', body: 'Ok' });
    enqueueReply({ conversationId: 'c2', body: 'Falha' });
    enqueueReply({ conversationId: 'c3', body: 'Depois' });
    const replyFn = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('network down'));

    const result = await flushOutbox(replyFn);

    expect(result).toEqual({ sent: 1, remaining: 2, failed: 0 });
    expect(replyFn).toHaveBeenCalledTimes(2);
    const queue = listPending();
    expect(queue.map((item) => item.conversationId)).toEqual(['c2', 'c3']);
    expect(queue[0].status).toBe('pending');
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].lastAttemptAt).toBeTruthy();
    expect(queue[0].lastError).toBe('Não foi possível enviar');
    expect(queue[1].attempts).toBe(0);
  });

  it('após 5 tentativas marca failed (falha não-silenciosa) e não reenvia mais', async () => {
    enqueueReply({ conversationId: 'c1', body: 'Insistente' });
    const replyFn = vi.fn(async () => { throw new Error('network down'); });

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await flushOutbox(replyFn);
    }

    expect(replyFn).toHaveBeenCalledTimes(5);
    expect(failedCount()).toBe(1);
    expect(pendingCount()).toBe(0);
    const [entry] = listPending();
    expect(entry.status).toBe('failed');
    expect(entry.attempts).toBe(5);

    // Flush seguinte: entry failed é pulada, nada é reenviado.
    const result = await flushOutbox(replyFn);
    expect(replyFn).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ sent: 0, remaining: 0, failed: 1 });
  });

  it('entry órfã em sending (crash no meio do flush) volta para pending ao carregar', () => {
    localStorage.setItem('rap_inbox_outbox', JSON.stringify([
      {
        id: 'outbox-crash-1',
        conversationId: 'c1',
        body: 'crash',
        clientMessageId: 'cli-crash',
        createdAt: '2026-09-08T10:00:00.000Z',
        attempts: 1,
        status: 'sending',
        lastAttemptAt: '2026-09-08T10:01:00.000Z',
        lastError: null,
      },
    ]));
    const [entry] = listPending();
    expect(entry.status).toBe('pending');
    expect(entry.clientMessageId).toBe('cli-crash');
    expect(pendingCount()).toBe(1);
  });

  it('flush com fila vazia não chama a API', async () => {
    const replyFn = vi.fn();
    const result = await flushOutbox(replyFn);
    expect(result).toEqual({ sent: 0, remaining: 0, failed: 0 });
    expect(replyFn).not.toHaveBeenCalled();
  });

  it('clearOutbox remove todas as pendências', () => {
    enqueueReply({ conversationId: 'c1', body: 'x' });
    clearOutbox();
    expect(pendingCount()).toBe(0);
    expect(listPending()).toEqual([]);
  });

  it('tolera storage corrompido sem lançar', () => {
    localStorage.setItem('rap_inbox_outbox', '{not-json');
    expect(listPending()).toEqual([]);
    expect(pendingCount()).toBe(0);
  });

  it('generateClientMessageId produz ids únicos no charset seguro', () => {
    const a = generateClientMessageId();
    const b = generateClientMessageId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
