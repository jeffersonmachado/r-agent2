const {
  addAgentMessage,
  addTicketNote,
  transferTicket,
  updateOutboundMessageMeta,
  createTicket,
  getTicketBySession,
  getTicketByConversationId,
} = require('../../api/services/queueService');

describe('QueueService - Defensive Coercions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addTicketNote - hostile author coercion', () => {
    it('should handle hostile toString getter in author parameter', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });
      expect(ticket).toBeDefined();

      // Hostile author with malicious toString()
      const hosileAuthor = {
        get toString() {
          throw new Error('Malicious toString');
        },
      };

      // Should not throw; safe coercion catches error
      expect(() => {
        addTicketNote(ticket.id, 'Test note', hosileAuthor);
      }).not.toThrow();
    });

    it('should handle hostile note.trim() via toString poison', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });

      // Hostile note with toString() thrower
      const hostileNote = {
        toString() {
          throw new Error('Poisoned toString');
        },
      };

      expect(() => {
        addTicketNote(ticket.id, hostileNote, 'author');
      }).not.toThrow();
    });
  });

  describe('transferTicket - hostile queue/assignedTo normalization', () => {
    it('should handle hostile queue parameter (toString thrower)', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });

      const hostileQueue = {
        toString() {
          throw new Error('Malicious queue toString');
        },
      };

      // Should not throw; safeTrim catches error
      expect(() => {
        transferTicket(ticket.id, { queue: hostileQueue });
      }).not.toThrow();
    });

    it('should handle hostile assignedTo (trim() after toString thrower)', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });

      const hostileAssignee = {
        toString() {
          throw new Error('Malicious assignedTo');
        },
      };

      expect(() => {
        transferTicket(ticket.id, { assignedTo: hostileAssignee });
      }).not.toThrow();
    });
  });

  describe('updateOutboundMessageMeta - hostile deliveryStatus coercion', () => {
    it('should handle hostile deliveryStatus toString', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });
      addAgentMessage(ticket.id, 'test msg', 'agent123', {});

      const hostileStatus = {
        toString() {
          throw new Error('Malicious deliveryStatus');
        },
      };

      expect(() => {
        updateOutboundMessageMeta(ticket.id, { deliveryStatus: hostileStatus });
      }).not.toThrow();
    });

    it('should handle hostile clientMessageId and externalMessageId', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });
      addAgentMessage(ticket.id, 'test msg', 'agent123', {});

      const hostileId = {
        toString() {
          throw new Error('Malicious messageId');
        },
      };

      expect(() => {
        updateOutboundMessageMeta(ticket.id, {
          clientMessageId: hostileId,
          externalMessageId: hostileId,
        });
      }).not.toThrow();
    });

    it('should persist and clear failure details on status transitions', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });
      addAgentMessage(ticket.id, 'test msg', 'agent123', { clientMessageId: 'cli-1' });

      const failed = updateOutboundMessageMeta(ticket.id, {
        clientMessageId: 'cli-1',
        deliveryStatus: 'failed',
        reasonCode: 'outside_window_24h',
        lastError: 'Template required',
        errorCode: '131047',
        errorType: 'window_violation',
        failedAt: '2026-03-24T10:20:30.000Z',
        attempts: 2,
      });

      const failedMsg = failed.messages[failed.messages.length - 1];
      expect(failedMsg.deliveryStatus).toBe('failed');
      expect(failedMsg.reasonCode).toBe('outside_window_24h');
      expect(failedMsg.lastError).toBe('Template required');
      expect(failedMsg.errorCode).toBe('131047');
      expect(failedMsg.errorType).toBe('window_violation');
      expect(failedMsg.failedAt).toBe('2026-03-24T10:20:30.000Z');
      expect(failedMsg.attempts).toBe(2);

      const sent = updateOutboundMessageMeta(ticket.id, {
        clientMessageId: 'cli-1',
        deliveryStatus: 'sent',
      });
      const sentMsg = sent.messages[sent.messages.length - 1];
      expect(sentMsg.deliveryStatus).toBe('sent');
      expect(sentMsg.reasonCode).toBeUndefined();
      expect(sentMsg.lastError).toBeUndefined();
      expect(sentMsg.errorCode).toBeUndefined();
      expect(sentMsg.errorType).toBeUndefined();
      expect(sentMsg.failedAt).toBeUndefined();
      expect(sentMsg.attempts).toBeUndefined();
    });
  });

  describe('addAgentMessage - hostile media coercions', () => {
    it('should handle hostile mediaType (toLowerCase after trim after toString)', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });

      const hostileMediaType = {
        toString() {
          throw new Error('Malicious mediaType');
        },
      };

      expect(() => {
        addAgentMessage(ticket.id, 'message', 'agent123', {
          mediaType: hostileMediaType,
        });
      }).not.toThrow();
    });

    it('should handle hostile mediaUrl and fileName (trim coercions)', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });

      const hostileUrl = {
        toString() {
          throw new Error('Malicious URL');
        },
      };

      expect(() => {
        addAgentMessage(ticket.id, 'message', 'agent123', {
          mediaUrl: hostileUrl,
          fileName: hostileUrl,
        });
      }).not.toThrow();
    });

    it('should handle hostile documentId and mimeType', () => {
      const ticket = createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });

      const hostileDoc = {
        toString() {
          throw new Error('Malicious doc id');
        },
      };

      expect(() => {
        addAgentMessage(ticket.id, 'message', 'agent123', {
          documentId: hostileDoc,
          mimeType: hostileDoc,
        });
      }).not.toThrow();
    });
  });

  describe('getTicketBySession - safe sessionId coercion', () => {
    it('should handle hostile sessionId with toString thrower', () => {
      createTicket({ tenantId: 'tenant1', sessionId: 'sess123', queue: 'queue1' });

      const hostileSessionId = {
        toString() {
          throw new Error('Malicious sessionId');
        },
      };

      // Should not throw; safeToString catches error and returns fallback
      const result = getTicketBySession(hostileSessionId);
      expect(result).toBeNull(); // Fallback: null when coercion fails
    });
  });

  describe('getTicketByConversationId - safe dual coercion', () => {
    it('should handle hostile conversationId', () => {
      const hostileConvId = {
        toString() {
          throw new Error('Malicious conversationId');
        },
      };

      const result = getTicketByConversationId(hostileConvId, 'tenant1');
      expect(result).toBeNull();
    });

    it('should handle hostile tenantId', () => {
      const hostileTenantId = {
        toString() {
          throw new Error('Malicious tenantId');
        },
      };

      const result = getTicketByConversationId('conv123', hostileTenantId);
      expect(result).toBeNull();
    });
  });

  describe('backward compatibility - nominal cases still work', () => {
    it('should preserve normal string coercions', () => {
      const ticket = createTicket({ tenantId: 'tenant2', sessionId: 'sess456', queue: 'queue2' });

      // Nominal string values should work unchanged
      const updated = transferTicket(ticket.id, {
        queue: 'new_queue',
        assignedTo: 'agent123',
      });

      expect(updated).toBeDefined();
      expect(updated.queue).toBe('new_queue');
      expect(updated.assignedTo).toBe('agent123');
    });

    it('should preserve normal note addition', () => {
      const ticket = createTicket({ tenantId: 'tenant2', sessionId: 'sess456', queue: 'queue2' });

      const updated = addTicketNote(ticket.id, 'Normal note', 'John Doe');
      expect(updated).toBeDefined();
      expect(updated.messages).toHaveLength(1);
      expect(updated.messages[0].text).toBe('Normal note');
      expect(updated.messages[0].authorName).toBe('John Doe');
    });

    it('should preserve media metadata in addAgentMessage', () => {
      const ticket = createTicket({ tenantId: 'tenant2', sessionId: 'sess456', queue: 'queue2' });

      const updated = addAgentMessage(ticket.id, 'File message', 'agent123', {
        mediaType: 'image/png',
        mediaUrl: 'https://example.com/file.png',
        fileName: 'photo.png',
        mimeType: 'image/png',
        clientMessageId: 'cmsg-123',
      });

      expect(updated).toBeDefined();
      expect(updated.messages).toBeDefined();
      const msg = updated.messages[updated.messages.length - 1];
      expect(msg.type).toBe('image/png');
      expect(msg.mediaUrl).toBe('https://example.com/file.png');
      expect(msg.fileName).toBe('photo.png');
      expect(msg.clientMessageId).toBe('cmsg-123');
    });
  });
});
