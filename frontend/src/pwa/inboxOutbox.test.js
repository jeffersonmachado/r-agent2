import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueueReply,
  flushOutbox,
  listPending,
  pendingCount,
  clearOutbox,
} from './inboxOutbox';

describe('pwa/inboxOutbox', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('enfileira resposta pendente com metadados', () => {
    const entry = enqueueReply({ conversationId: 'c1', body: 'Olá!' });
    expect(entry.conversationId).toBe('c1');
    expect(entry.body).toBe('Olá!');
    expect(entry.id).toMatch(/^outbox-/);
    expect(pendingCount()).toBe(1);
    expect(listPending()[0].queuedAt).toBeTruthy();
  });

  it('dedup por (conversationId, body): double-click não duplica', () => {
    const first = enqueueReply({ conversationId: 'c1', body: 'Olá!' });
    const second = enqueueReply({ conversationId: 'c1', body: 'Olá!' });
    expect(second.id).toBe(first.id);
    expect(pendingCount()).toBe(1);
  });

  it('permite mesma mensagem em conversas diferentes', () => {
    enqueueReply({ conversationId: 'c1', body: 'Olá!' });
    enqueueReply({ conversationId: 'c2', body: 'Olá!' });
    expect(pendingCount()).toBe(2);
  });

  it('flush reenvia em ordem e esvazia a fila', async () => {
    enqueueReply({ conversationId: 'c1', body: 'Primeira' });
    enqueueReply({ conversationId: 'c2', body: 'Segunda' });
    const replyFn = vi.fn(async () => ({}));

    const result = await flushOutbox(replyFn);

    expect(result).toEqual({ sent: 2, remaining: 0 });
    expect(replyFn).toHaveBeenNthCalledWith(1, 'c1', 'Primeira');
    expect(replyFn).toHaveBeenNthCalledWith(2, 'c2', 'Segunda');
    expect(pendingCount()).toBe(0);
  });

  it('flush para no primeiro erro e preserva o restante da fila', async () => {
    enqueueReply({ conversationId: 'c1', body: 'Ok' });
    enqueueReply({ conversationId: 'c2', body: 'Falha' });
    enqueueReply({ conversationId: 'c3', body: 'Depois' });
    const replyFn = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('network down'));

    const result = await flushOutbox(replyFn);

    expect(result).toEqual({ sent: 1, remaining: 2 });
    expect(replyFn).toHaveBeenCalledTimes(2);
    expect(listPending().map((item) => item.conversationId)).toEqual(['c2', 'c3']);
  });

  it('flush com fila vazia não chama a API', async () => {
    const replyFn = vi.fn();
    const result = await flushOutbox(replyFn);
    expect(result).toEqual({ sent: 0, remaining: 0 });
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
});
