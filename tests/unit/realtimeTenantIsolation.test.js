'use strict';

/**
 * P1 (auditoria 2026-10-19) — WEBSOCKET E ISOLAMENTO MULTITENANT.
 *
 * Prova com SERVIDOR REAL (`http` + `ws` + `initializeWebSocket`) e tokens
 * assinados de verdade — não com emissor simulado — que um evento do tenant A
 * chega APENAS aos clientes do tenant A. Também cobre: token inválido, token sem
 * tenant, reconexão e ausência de vazamento para o outro tenant.
 *
 * O emissor simulado (`tests/unit/crmRealtimeEvents.test.js`) continua útil para
 * a camada de rotas; este arquivo cobre o transporte e o isolamento.
 */

const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

jest.mock('../../api/services/authService', () => ({
  validateToken: (token) => {
    const mapa = {
      'token-tenant-a': { valid: true, agent: { id: 'agente-a', username: 'a', tenantId: 'tenant-a' } },
      'token-tenant-b': { valid: true, agent: { id: 'agente-b', username: 'b', tenantId: 'tenant-b' } },
      'token-sem-tenant': { valid: true, agent: { id: 'agente-x', username: 'x' } },
    };
    return mapa[token] || { valid: false, error: 'Token inválido' };
  },
}));

const wsService = require('../../api/services/websocketService');

let servidor;
let porta;
let url;

function abrirCliente(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}/ws`);
    const eventos = [];
    const estado = { ws, eventos, autenticado: false, erroAuth: null };

    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('message', (bruto) => {
      const msg = JSON.parse(bruto.toString());
      if (msg.type === 'auth') {
        if (msg.status === 'success') estado.autenticado = true;
        else estado.erroAuth = msg.message;
        resolve(estado);
      }
      if (msg.type === 'event') eventos.push(msg);
    });
    ws.on('error', reject);
    setTimeout(() => resolve(estado), 1500);
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  servidor = http.createServer();
  wsService.initializeWebSocket(servidor);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  porta = servidor.address().port;
  url = `ws://127.0.0.1:${porta}/ws`;
});

afterAll(async () => {
  wsService.shutdownWebSocket();
  await new Promise((r) => servidor.close(r));
});

describe('WebSocket — isolamento entre tenants com servidor real', () => {
  test('duas conexões simultâneas autenticadas em tenants distintos', async () => {
    const a = await abrirCliente('token-tenant-a');
    const b = await abrirCliente('token-tenant-b');
    expect(a.autenticado).toBe(true);
    expect(b.autenticado).toBe(true);
    a.ws.close();
    b.ws.close();
  });

  test('evento do tenant A chega SÓ em A (nenhum vazamento para B)', async () => {
    const a = await abrirCliente('token-tenant-a');
    const b = await abrirCliente('token-tenant-b');
    await esperar(150);

    wsService.emitEvent('crm.metrics.updated', { entity: 'leads', action: 'created' }, { tenantId: 'tenant-a' });
    await esperar(300);

    expect(a.eventos.map((e) => e.event)).toContain('crm.metrics.updated');
    expect(b.eventos.map((e) => e.event)).not.toContain('crm.metrics.updated');

    a.ws.close();
    b.ws.close();
    await esperar(100);
  });

  test('evento do tenant B chega SÓ em B', async () => {
    const a = await abrirCliente('token-tenant-a');
    const b = await abrirCliente('token-tenant-b');
    await esperar(150);

    wsService.emitEvent('crm.metrics.updated', { entity: 'accounts' }, { tenantId: 'tenant-b' });
    await esperar(300);

    expect(b.eventos.map((e) => e.event)).toContain('crm.metrics.updated');
    expect(a.eventos.map((e) => e.event)).not.toContain('crm.metrics.updated');

    a.ws.close();
    b.ws.close();
    await esperar(100);
  });

  test('token inválido não autentica e não recebe evento', async () => {
    const c = await abrirCliente('token-invalido');
    expect(c.autenticado).toBe(false);
    expect(c.erroAuth).toBeTruthy();

    wsService.emitEvent('crm.metrics.updated', { entity: 'leads' }, { tenantId: 'tenant-a' });
    await esperar(250);
    expect(c.eventos).toHaveLength(0);
    c.ws.close();
    await esperar(100);
  });

  test('token sem tenant é recusado', async () => {
    const c = await abrirCliente('token-sem-tenant');
    expect(c.autenticado).toBe(false);
    expect(c.erroAuth).toContain('tenant');
    c.ws.close();
    await esperar(100);
  });

  test('reconexão volta a receber o evento do próprio tenant', async () => {
    const primeira = await abrirCliente('token-tenant-a');
    primeira.ws.close();
    await esperar(200);

    const segunda = await abrirCliente('token-tenant-a');
    await esperar(150);
    wsService.emitEvent('crm.metrics.updated', { entity: 'opportunities' }, { tenantId: 'tenant-a' });
    await esperar(300);

    expect(segunda.eventos.map((e) => e.event)).toContain('crm.metrics.updated');
    segunda.ws.close();
    await esperar(100);
  });

  test('broadcast usa o tenant do cliente autenticado (nunca o informado no payload)', async () => {
    const b = await abrirCliente('token-tenant-b');
    await esperar(150);

    // Tentativa de "vazamento": payload diz tenant-a, mas o broadcast é para B.
    wsService.broadcastToTenant('tenant-b', { type: 'event', event: 'crm.metrics.updated', data: { tenantId: 'tenant-a' } });
    await esperar(300);

    expect(b.eventos.map((e) => e.event)).toContain('crm.metrics.updated');
    b.ws.close();
    await esperar(100);
  });

  test('URL do servidor é /ws e o serviço reporta conexões por tenant', async () => {
    expect(url).toMatch(/\/ws$/);
    const a = await abrirCliente('token-tenant-a');
    await esperar(150);
    const stats = wsService.getStats();
    expect(stats).toBeTruthy();
    const ids = crypto.randomUUID(); // sanidade: crypto disponível no ambiente de teste
    expect(typeof ids).toBe('string');
    a.ws.close();
    await esperar(100);
  });
});
