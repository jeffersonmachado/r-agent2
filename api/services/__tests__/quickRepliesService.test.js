'use strict';

const {
  createQuickReply,
  searchByContext,
  deleteQuickReply,
} = require('../quickRepliesService');

describe('quickRepliesService.searchByContext', () => {
  const tenantId = `tenant-test-${Date.now()}`;
  const createdIds = [];

  afterAll(() => {
    for (const id of createdIds) {
      deleteQuickReply(id);
    }
  });

  test('aplica limite máximo seguro (20) mesmo com valor alto', () => {
    for (let i = 0; i < 30; i += 1) {
      const result = createQuickReply({
        tenantId,
        title: `Resposta ${i}`,
        message: `Mensagem de suporte foo ${i}`,
        tags: ['suporte'],
        category: 'geral',
      });
      if (result.success && result.quickReply && result.quickReply.id) {
        createdIds.push(result.quickReply.id);
      }
    }

    const replies = searchByContext('foo suporte', tenantId, 999);
    expect(Array.isArray(replies)).toBe(true);
    expect(replies.length).toBeLessThanOrEqual(20);
    expect(replies.length).toBeGreaterThan(0);
  });
});
