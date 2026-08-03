/**
 * Testes do broadcast do websocketService:
 * - JSON.stringify executado uma única vez por broadcast (fora do loop)
 * - índice Map<tenantKey, Set<client>> evita varrer clientes de outros tenants
 * - remoção do índice em todos os caminhos de desconexão (via removeClient)
 */

jest.mock('../../api/services/authService', () => ({
  validateToken: jest.fn(),
}));

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { broadcastToTenant, _internal } = require('../../api/services/websocketService');

function fakeClient(id, tenantId) {
  return {
    id,
    tenantId,
    agentId: null,
    executionIds: new Set(),
    ws: { readyState: 1, send: jest.fn() },
  };
}

function addClient(client) {
  _internal.clients.set(client.id, client);
  const key = client.tenantId || null;
  if (!_internal.tenantClients.has(key)) {
    _internal.tenantClients.set(key, new Set());
  }
  _internal.tenantClients.get(key).add(client);
}

describe('websocketService - broadcast', () => {
  beforeEach(() => {
    _internal.clients.clear();
    _internal.tenantClients.clear();
  });

  test('serializa o payload uma única vez para múltiplos clientes do tenant', () => {
    const c1 = fakeClient('c1', 'tenant-a');
    const c2 = fakeClient('c2', 'tenant-a');
    addClient(c1);
    addClient(c2);

    const spy = jest.spyOn(JSON, 'stringify');
    try {
      broadcastToTenant('tenant-a', { type: 'event', event: 'ticket.created', data: { id: 1 } });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(c1.ws.send).toHaveBeenCalledTimes(1);
      expect(c2.ws.send).toHaveBeenCalledTimes(1);
      // Ambos recebem exatamente o mesmo payload serializado
      expect(c1.ws.send.mock.calls[0][0]).toBe(c2.ws.send.mock.calls[0][0]);
    } finally {
      spy.mockRestore();
    }
  });

  test('índice por tenant isola o broadcast (não envia para outros tenants)', () => {
    const cA = fakeClient('cA', 'tenant-a');
    const cB = fakeClient('cB', 'tenant-b');
    addClient(cA);
    addClient(cB);

    broadcastToTenant('tenant-a', { type: 'event', event: 'ticket.created' });

    expect(cA.ws.send).toHaveBeenCalledTimes(1);
    expect(cB.ws.send).not.toHaveBeenCalled();
  });

  test('removeClient tira o cliente do índice por tenant (desconexão)', () => {
    const c1 = fakeClient('c1', 'tenant-a');
    addClient(c1);

    _internal.removeClient('c1');

    expect(_internal.clients.has('c1')).toBe(false);
    expect(_internal.tenantClients.has('tenant-a')).toBe(false);

    broadcastToTenant('tenant-a', { type: 'event', event: 'ticket.created' });
    expect(c1.ws.send).not.toHaveBeenCalled();
  });

  test('broadcast para tenant sem clientes indexados não falha', () => {
    expect(() => broadcastToTenant('tenant-inexistente', { type: 'event' })).not.toThrow();
  });
});
