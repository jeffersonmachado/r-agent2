'use strict';

/**
 * Fase 2 — entrega (SSE com replay) e segurança das rotas LRO.
 *
 * O que este arquivo prova, com HTTP REAL e PostgreSQL REAL (banco descartável da suíte):
 *   #1  replay por `Last-Event-ID` sem lacuna (só o que faltou volta);
 *   #4  (parte de leitura) tenant e classificação: operação de outro tenant é 404 e classe
 *       insuficiente é 403 `classification_forbidden` — menu não é autorização;
 *   comandos ilegais respondem 409 com o código do núcleo puro.
 *
 * A verificação de token é a mesma `requireAuth` do produto, no caminho de short-circuit
 * (`req.token === token`), que é o caminho usado quando o tenantValidation já validou o token.
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let lro = null;
let servidor = null;
let base = null;
let disponivel = false;
let motivo = null;

const TOKEN = 'token-de-teste-lro';

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-routes', available: false, reason: motivo, requirement: 'postgres',
  });
}

/** Ator de teste: `requireAuth` aceita o short-circuit quando req.token/agent/session conferem. */
function ator(role, tenantId) {
  return {
    token: TOKEN,
    // Classificação de plataforma vem de `platformRole` (users.platform_role), NUNCA do role do
    // tenant — política de `experience-segregation.js`. Role de tenant 'operator' sem platformRole
    // é PRODUCTION; 'engineer' como platformRole é DEVELOPMENT.
    agent: { id: `agent-${role}`, role, tenantId, platformRole: role },
    session: { id: 'sessao-teste' },
  };
}

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-routes');
    if (!banco) { motivo = 'provisionamento indisponível'; return; }
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    lro = require('../../api/services/lro/lroService');
    const { criarRouterLro } = require('../../api/modules/lro/routes');

    const app = express();
    // Injeta o ator conforme o cabeçalho de teste — o resto (tenant, classificação, transição)
    // é o código de produção.
    app.use((req, _res, next) => {
      const role = String(req.headers['x-test-role'] || 'engineer');
      const tenantId = String(req.headers['x-test-tenant'] || 'system');
      Object.assign(req, ator(role, tenantId));
      next();
    });
    app.use(criarRouterLro());

    servidor = http.createServer(app);
    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
    disponivel = true;
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

const espera = (n) => new Promise((resolve) => setTimeout(resolve, n));

async function criar({ tenantId = 'system', visibilityClass = 'DEVELOPMENT' } = {}) {
  return lro.createOperation({
    tenantId, operationType: 'qa_waves', visibilityClass, ownerActorId: 'jest',
  });
}

describe('LRO rotas — entrega e segurança', () => {
  test('#1 SSE faz replay a partir de Last-Event-ID sem lacuna', async () => {
    if (skipIfUnavailable()) return;
    const op = await criar();
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
    await lro.transition(op.id, { to: 'RUNNING', actorId: 'jest' });

    const resposta = await fetch(`${base}/api/lro/${op.id}/events?snapshot=1`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Test-Role': 'engineer', 'Last-Event-ID': '2' },
    });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toContain('text/event-stream');
    const corpo = await resposta.text();
    const ids = [...corpo.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    // Eventos 1(CREATED),2(QUEUED) já conhecidos pelo cliente → só 3 (RUNNING) volta.
    expect(ids).toEqual([3]);
  }, 60000);

  test('#1 sem cursor, o snapshot entrega todos os eventos em ordem', async () => {
    if (skipIfUnavailable()) return;
    const op = await criar();
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
    const corpo = await (await fetch(`${base}/api/lro/${op.id}/events?snapshot=1`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Test-Role': 'engineer' },
    })).text();
    const ids = [...corpo.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids).toEqual([1, 2]);
  }, 60000);

  test('#4 operação de OUTRO tenant responde 404 (não confirma existência)', async () => {
    if (skipIfUnavailable()) return;
    const op = await criar({ tenantId: 'tenant-alheio' });
    const resposta = await fetch(`${base}/api/lro/${op.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Test-Role': 'engineer', 'X-Test-Tenant': 'system' },
    });
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).error).toBe('operation_not_found');
  }, 60000);

  test('#4 classe insuficiente é 403 classification_forbidden (menu não é autorização)', async () => {
    if (skipIfUnavailable()) return;
    const op = await criar({ visibilityClass: 'DEVELOPMENT' });
    // `operator` é ator PRODUCTION: não pode ver superfície de engenharia.
    const resposta = await fetch(`${base}/api/lro/${op.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Test-Role': 'operator' },
    });
    expect(resposta.status).toBe(403);
    expect((await resposta.json()).error).toBe('classification_forbidden');
  }, 60000);

  test('comando ilegal responde 409 com o código do núcleo puro', async () => {
    if (skipIfUnavailable()) return;
    const op = await criar();
    const resposta = await fetch(`${base}/api/lro/${op.id}/transition`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Test-Role': 'engineer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'COMPLETED', outcome: 'GO' }), // CREATED -> COMPLETED é ilegal
    });
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).error).toBe('TRANSICAO_INVALIDA');
  }, 60000);

  test('comando válido transiciona e o evento seguinte fica disponível', async () => {
    if (skipIfUnavailable()) return;
    const op = await criar();
    const resposta = await fetch(`${base}/api/lro/${op.id}/transition`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Test-Role': 'engineer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'QUEUED' }),
    });
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).operation.status).toBe('QUEUED');

    await espera(50);
    const corpo = await (await fetch(`${base}/api/lro/${op.id}/events?snapshot=1`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Test-Role': 'engineer' },
    })).text();
    expect(corpo).toMatch(/event: QUEUED/);
  }, 60000);

  test('sem token não há acesso (401)', async () => {
    if (skipIfUnavailable()) return;
    const op = await criar();
    const resposta = await fetch(`${base}/api/lro/${op.id}`, {
      headers: { Authorization: 'Bearer token-errado' },
    });
    expect(resposta.status).toBe(401);
  }, 60000);
});
