'use strict';

/**
 * ER-V1-SEAL-002 (Full Durable Resume) — "concurrent start": duas chamadas HTTP REAIS e
 * simultâneas de `POST /engineering/tasks/:id/run` para a MESMA task. A garantia de lock real
 * (`lockForRun`, Postgres real via `SELECT ... FOR UPDATE`) já tem cobertura no nível de serviço
 * em `tests/integration/engineeringTaskConcurrencyAndRestart.test.js` — este teste prova a MESMA
 * garantia end-to-end pela camada HTTP real (servidor Express real + `beginRun` real, nunca
 * mockado), que é onde a missão exige a prova (POST real, não só o serviço interno).
 *
 * Convenção real do projeto (api/modules/engineering-router/routes.js): a segunda chamada
 * concorrente recebe HTTP 409 (`task_already_running`) — nunca duas execuções efetivas da
 * mesma task simultaneamente.
 */

const express = require('express');
const http = require('http');
const { createEngineeringRouterRoutes } = require('../../api/modules/engineering-router/routes');
const sequelizeModule = require('../../api/db/sequelize');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const engineeringRouterService = require('../../api/services/engineeringRouter/engineeringRouterService');

let dbAvailable = false;
let dbReason = null;
const createdTaskIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  return true;
}

/**
 * FAIL-CLOSED (auditoria 2026-10-20).
 *
 * A versão anterior fazia `if (skipIfNoDatabase()) return;` — sem PostgreSQL o corpo test
 * terminava SEM NENHUMA asserção e o Jest contabilizava PASS. O gate de concorrência subia verde
 * em ambiente onde nada foi executado.
 *
 * Agora: banco obrigatório indisponível ⇒ `INFRA_ERROR` explícito. Suíte vermelha é o resultado
 * honesto; PASS sem execução nunca é.
 */
function requireDatabase() {
  if (dbAvailable) return;
  const error = new Error(
    `POSTGRES_UNAVAILABLE: ${dbReason || 'sem detalhe'} — este teste exige PostgreSQL real e NÃO pode passar sem ele`,
  );
  error.code = 'INFRA_ERROR';
  throw error;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  const getModels = require('../../api/db/models');
  try {
    for (const taskId of createdTaskIds) {
      const Task = getModels.getEngineeringTask();
      await Task.destroy({ where: { id: taskId } });
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
});

function startServer() {
  const deps = {
    requireAuth: (req) => { req.agent = { platformClassification: 'DEVELOPMENT' }; return { valid: true }; },
    sendJson: (res, status, body) => { res.status(status).json(body); },
    badRequest: (res, message) => { res.status(400).json({ error: 'bad_request', message }); },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => req.body,
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    // REAL — nunca mockado: é exatamente esta função (beginRun -> lockForRun -> Postgres real)
    // que precisa provar a garantia de concorrência ponta a ponta.
    engineeringRouterService,
    engineeringTaskService,
    engineeringModelStatsService: { listModelsWithStats: async () => [] },
    releaseClosureService: { getReleaseClosure: async () => ({ cleanReleaseState: false }) },
  };
  const app = express();
  app.use(express.json());
  app.use(createEngineeringRouterRoutes({ buildDeps: () => deps }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

describe('ER-V1-SEAL-002 — concurrent start via HTTP real (POST /engineering/tasks/:id/run)', () => {
  jest.setTimeout(30000);
  let server;

  afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  test('duas requisições HTTP reais e simultâneas para a mesma task: só uma é aceita (202), a outra recebe 409 real', async () => {
    if (skipIfNoDatabase()) {
      requireDatabase(); // lança INFRA_ERROR — nunca retorna em silêncio
    }

    // Evidência de que o banco está REALMENTE conectado nesta execução.
    const [probe] = await sequelizeModule.getSequelize().query('SELECT 1 AS ok');
    expect(Number(probe[0].ok)).toBe(1);

    const task = await engineeringTaskService.createTask({
      title: 'jest-concurrent-run-http',
      objective: 'objetivo de teste — nunca precisa completar a execução real, só provar o lock HTTP.',
      // Sem allowedPaths/testCommands realistas de propósito: a task pode falhar internamente
      // durante a execução real fire-and-forget (sem credencial de IA configurada) — isso é
      // irrelevante para este teste, que só prova o comportamento SÍNCRONO do lock antes da
      // resposta HTTP, nunca o resultado final da execução em si.
      allowedPaths: ['tests/fixtures/engineering-router-sandbox/**'],
      testCommands: ['true'],
      maxIterations: 1,
    }, { createdBy: 'jest-concurrent-run-http' });
    createdTaskIds.push(task.id);

    server = await startServer();
    const url = `${baseUrl(server)}/engineering/tasks/${task.id}/run`;

    const [first, second] = await Promise.all([
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exatamente uma execução efetiva (202 ACCEPTED) e a outra rejeitada por lock real (409) —
    // nunca as duas 202 (duplicaria a execução), nunca as duas 409 (nenhuma execução aconteceria).
    expect(statuses).toEqual([202, 409]);

    const rejected = first.status === 409 ? first : second;
    const rejectedBody = await rejected.json();
    expect(rejectedBody.error).toBe('task_already_running');
  }, 30000);
});
