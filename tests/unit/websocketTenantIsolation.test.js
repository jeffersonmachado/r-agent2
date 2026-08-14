'use strict';

jest.mock('../../api/services/authService', () => ({ validateToken: jest.fn() }));
jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const websocketService = require('../../api/services/websocketService');

function client(id, tenantId, authenticated = true) {
  return {
    id,
    tenantId,
    agentId: authenticated ? `agent-${id}` : null,
    authenticated,
    executionIds: new Set(),
    ws: { readyState: 1, send: jest.fn() },
  };
}

describe('WebSocket tenant isolation', () => {
  const { clients, tenantClients } = websocketService._internal;

  afterEach(() => {
    clients.clear();
    tenantClients.clear();
  });

  test('evento de tenant chega apenas a cliente autenticado do mesmo tenant', () => {
    const tenantA = client('a', 'tenant-a');
    const anonymous = client('anonymous', 'tenant-a', false);
    const tenantB = client('b', 'tenant-b');
    clients.set(tenantA.id, tenantA);
    clients.set(anonymous.id, anonymous);
    clients.set(tenantB.id, tenantB);
    tenantClients.set('tenant-a', new Set([tenantA, anonymous]));
    tenantClients.set('tenant-b', new Set([tenantB]));

    websocketService.emitEvent('rpa.execution.updated', { log: 'sensitive' }, { tenantId: 'tenant-a' });

    expect(tenantA.ws.send).toHaveBeenCalledTimes(1);
    expect(anonymous.ws.send).not.toHaveBeenCalled();
    expect(tenantB.ws.send).not.toHaveBeenCalled();
  });

  test('evento sem tenant nem agente é descartado, sem broadcast global', () => {
    const tenantA = client('a', 'tenant-a');
    const tenantB = client('b', 'tenant-b');
    clients.set(tenantA.id, tenantA);
    clients.set(tenantB.id, tenantB);
    tenantClients.set('tenant-a', new Set([tenantA]));
    tenantClients.set('tenant-b', new Set([tenantB]));

    expect(websocketService.emitEvent('rpa.execution.updated', { log: 'sensitive' })).toBe(0);
    expect(tenantA.ws.send).not.toHaveBeenCalled();
    expect(tenantB.ws.send).not.toHaveBeenCalled();
  });

  test('evento direcionado por agente também exige e respeita o tenant', () => {
    const tenantA = client('a', 'tenant-a');
    const sameAgentOtherTenant = client('b', 'tenant-b');
    sameAgentOtherTenant.agentId = tenantA.agentId;
    clients.set(tenantA.id, tenantA);
    clients.set(sameAgentOtherTenant.id, sameAgentOtherTenant);
    tenantClients.set('tenant-a', new Set([tenantA]));
    tenantClients.set('tenant-b', new Set([sameAgentOtherTenant]));

    websocketService.emitEvent(
      'generation.progress',
      { stage: 'rag' },
      { tenantId: 'tenant-a', agentId: tenantA.agentId },
    );

    expect(tenantA.ws.send).toHaveBeenCalledTimes(1);
    expect(sameAgentOtherTenant.ws.send).not.toHaveBeenCalled();

    websocketService.emitEvent('generation.progress', { stage: 'done' }, { agentId: tenantA.agentId });
    expect(tenantA.ws.send).toHaveBeenCalledTimes(1);
    expect(sameAgentOtherTenant.ws.send).not.toHaveBeenCalled();
  });
});
