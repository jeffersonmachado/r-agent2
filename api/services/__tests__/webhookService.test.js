const http = require('http');
const {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  triggerWebhooks,
  getAvailableEvents,
  calculateSignature,
} = require('../webhookService');

// Mock do logger
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('webhookService', () => {
  const testTenantId = 'tenant-test';

  beforeEach(() => {
    // Limpa webhooks antes de cada teste
    const webhooks = listWebhooks(testTenantId);
    webhooks.forEach((webhook) => {
      deleteWebhook(webhook.id);
    });
  });

  describe('createWebhook', () => {
    test('cria webhook válido', () => {
      const result = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
      });

      expect(result.success).toBe(true);
      expect(result.webhook).toBeDefined();
      expect(result.webhook.url).toBe('https://example.com/webhook');
      expect(result.webhook.events).toEqual(['ticket.created']);
      expect(result.webhook.active).toBe(true);
      expect(result.webhook.secret).toBeUndefined(); // Secret não deve ser retornado
    });

    test('rejeita URL inválida', () => {
      const result = createWebhook({
        tenantId: testTenantId,
        url: 'not-a-url',
        events: ['ticket.created'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('rejeita evento inválido', () => {
      const result = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['invalid.event'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('aceita múltiplos eventos', () => {
      const result = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created', 'ticket.assigned', 'ticket.closed'],
      });

      expect(result.success).toBe(true);
      expect(result.webhook.events).toHaveLength(3);
    });

    test('usa valores padrão para timeout e retries', () => {
      const result = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
      });

      expect(result.webhook.timeout).toBe(5000);
      expect(result.webhook.retries).toBe(3);
    });

    test('aceita timeout e retries customizados', () => {
      const result = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
        timeout: 10000,
        retries: 5,
      });

      expect(result.webhook.timeout).toBe(10000);
      expect(result.webhook.retries).toBe(5);
    });
  });

  describe('listWebhooks', () => {
    test('retorna lista vazia quando não há webhooks', () => {
      const webhooks = listWebhooks(testTenantId);
      expect(webhooks).toEqual([]);
    });

    test('retorna webhooks do tenant', () => {
      createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook1',
        events: ['ticket.created'],
      });

      createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook2',
        events: ['ticket.assigned'],
      });

      const webhooks = listWebhooks(testTenantId);
      expect(webhooks).toHaveLength(2);
    });

    test('não retorna webhooks de outros tenants', () => {
      createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook1',
        events: ['ticket.created'],
      });

      createWebhook({
        tenantId: 'other-tenant',
        url: 'https://example.com/webhook2',
        events: ['ticket.created'],
      });

      const webhooks = listWebhooks(testTenantId);
      expect(webhooks).toHaveLength(1);
    });
  });

  describe('getWebhook', () => {
    test('retorna webhook existente', () => {
      const created = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
      });

      const webhook = getWebhook(created.webhook.id);
      expect(webhook).toBeDefined();
      expect(webhook.id).toBe(created.webhook.id);
      expect(webhook.secret).toBeUndefined();
    });

    test('retorna null para webhook inexistente', () => {
      const webhook = getWebhook('non-existent');
      expect(webhook).toBeNull();
    });
  });

  describe('updateWebhook', () => {
    test('atualiza URL do webhook', () => {
      const created = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
      });

      const result = updateWebhook(created.webhook.id, {
        url: 'https://newurl.com/webhook',
      });

      expect(result.success).toBe(true);
      expect(result.webhook.url).toBe('https://newurl.com/webhook');
    });

    test('atualiza eventos do webhook', () => {
      const created = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
      });

      const result = updateWebhook(created.webhook.id, {
        events: ['ticket.assigned', 'ticket.closed'],
      });

      expect(result.success).toBe(true);
      expect(result.webhook.events).toEqual(['ticket.assigned', 'ticket.closed']);
    });

    test('atualiza status ativo', () => {
      const created = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
      });

      const result = updateWebhook(created.webhook.id, {
        active: false,
      });

      expect(result.success).toBe(true);
      expect(result.webhook.active).toBe(false);
    });

    test('retorna erro para webhook inexistente', () => {
      const result = updateWebhook('non-existent', {
        url: 'https://example.com/webhook',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('deleteWebhook', () => {
    test('deleta webhook existente', () => {
      const created = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
      });

      const result = deleteWebhook(created.webhook.id);
      expect(result.success).toBe(true);

      const webhook = getWebhook(created.webhook.id);
      expect(webhook).toBeNull();
    });

    test('retorna erro para webhook inexistente', () => {
      const result = deleteWebhook('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('getAvailableEvents', () => {
    test('retorna lista de eventos disponíveis', () => {
      const events = getAvailableEvents();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      expect(events).toContain('ticket.created');
      expect(events).toContain('ticket.assigned');
    });
  });

  describe('calculateSignature', () => {
    test('calcula assinatura HMAC corretamente', () => {
      const payload = JSON.stringify({ event: 'test', data: {} });
      const secret = 'test-secret';
      const signature = calculateSignature(payload, secret);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(64); // SHA256 hex = 64 chars
    });

    test('assinatura é determinística', () => {
      const payload = JSON.stringify({ event: 'test' });
      const secret = 'test-secret';
      const sig1 = calculateSignature(payload, secret);
      const sig2 = calculateSignature(payload, secret);

      expect(sig1).toBe(sig2);
    });
  });

  describe('triggerWebhooks', () => {
    test('não dispara webhooks se não houver webhooks ativos', async () => {
      // Não cria webhooks, então não deve disparar nada
      await expect(
        triggerWebhooks(testTenantId, 'ticket.created', { ticketId: '123' })
      ).resolves.not.toThrow();
    });

    test('dispara webhook ativo para evento correspondente', async () => {
      // Cria um servidor HTTP mock para receber o webhook
      let receivedRequest = null;
      const server = http.createServer((req, res) => {
        let data = '';
        req.on('data', (chunk) => {
          data += chunk;
        });
        req.on('end', () => {
          receivedRequest = {
            headers: req.headers,
            body: JSON.parse(data),
          };
          res.writeHead(200);
          res.end();
        });
      });

      await new Promise((resolve) => {
        server.listen(0, () => {
          const port = server.address().port;
          const webhookUrl = `http://localhost:${port}/webhook`;

          const created = createWebhook({
            tenantId: testTenantId,
            url: webhookUrl,
            events: ['ticket.created'],
          });

          triggerWebhooks(testTenantId, 'ticket.created', {
            ticketId: '123',
            queue: 'suporte',
          }).then(() => {
            setTimeout(() => {
              server.close();
              resolve();
            }, 100);
          });
        });
      });

      expect(receivedRequest).toBeDefined();
      expect(receivedRequest.body.event).toBe('ticket.created');
      expect(receivedRequest.body.data.ticketId).toBe('123');
      expect(receivedRequest.headers['x-webhook-signature']).toBeDefined();
    });

    test('não dispara webhook inativo', async () => {
      const created = createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.created'],
        active: false,
      });

      // Não deve fazer requisição HTTP
      await expect(
        triggerWebhooks(testTenantId, 'ticket.created', { ticketId: '123' })
      ).resolves.not.toThrow();
    });

    test('não dispara webhook para evento não inscrito', async () => {
      createWebhook({
        tenantId: testTenantId,
        url: 'https://example.com/webhook',
        events: ['ticket.assigned'], // Não está inscrito em ticket.created
      });

      // Não deve fazer requisição HTTP
      await expect(
        triggerWebhooks(testTenantId, 'ticket.created', { ticketId: '123' })
      ).resolves.not.toThrow();
    });
  });
});

