'use strict';

/**
 * Segregação Replay×RPA (W2-B / HARD-007):
 *
 * Matriz esperada nas rotas /rpa/* (api/modules/rpa-tests/):
 * - SUPPORT (auditor): leitura/diagnóstico — GET/DELETE /rpa/recordings,
 *   GET /rpa/execution/:id, GET /rpa/execution/:id/report.
 * - DEVELOPMENT (super_admin): escrita técnica — POST /rpa/record/start,
 *   POST /rpa/record/stop/:id, GET /rpa/record/status/:id, POST /rpa/execute/:id,
 *   POST /rpa/execution/:id/(cancel|continue|next).
 * - PRODUCTION (demais roles): 403 em qualquer rota /rpa/.
 *
 * Coerência de política: SUPPORT_VISIBLE_ROUTES só lista rotas de replay que o
 * frontend realmente expõe a auditor (página /rpa-replays, nunca /dev/*).
 */

const fs = require('fs');
const path = require('path');

const { handleRpaRecordingsRoutes } = require('../../api/modules/rpa-tests/handleRpaRecordingsRoutes');
const { handleRpaExecutionRoutes } = require('../../api/modules/rpa-tests/handleRpaExecutionRoutes');
const { SUPPORT_VISIBLE_ROUTES } = require('../../api/modules/agent-os/experience-segregation');

const buildCtx = ({ method, pathname, role }) => {
  const responses = [];
  const sendJson = (res, status, payload) => {
    responses.push({ status, payload });
  };

  const req = {
    method,
    agent: { id: `agent-${role}`, username: role, role, tenantId: 'tenant-qa' },
    headers: {},
  };

  const deps = {
    requireAuth: () => ({ valid: true }),
    sendJson,
    badRequest: (res, message) => sendJson(res, 400, { error: 'bad_request', message }),
    hasJsonContentType: () => true,
    parseJsonBody: async () => ({ seedName: 'seed-1' }),
    logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    listRecordings: () => [],
    deleteRecording: () => ({ success: true, deletedId: 'rec-1', message: 'removida' }),
    startManualRecording: async () => ({ success: true, recordingId: 'rec-1' }),
    stopManualRecording: async () => ({ success: true }),
    getRecordingStatus: () => ({ success: true, status: 'recording' }),
    executeRecording: async () => ({ success: true, executionId: 'exec-1' }),
    getExecutionStatus: () => ({ id: 'exec-1', recordingId: 'rec-1', status: 'completed' }),
    cancelExecution: async () => ({ success: true }),
    continueExecution: () => ({ success: true }),
    nextStep: () => ({ success: true }),
  };

  return { ctx: { req, res: {}, method, pathname, deps }, responses };
};

const runRecordings = (args) => {
  const { ctx, responses } = buildCtx(args);
  return handleRpaRecordingsRoutes(ctx).then((handled) => ({ handled, responses }));
};

const runExecution = (args) => {
  const { ctx, responses } = buildCtx(args);
  return handleRpaExecutionRoutes(ctx).then((handled) => ({ handled, responses }));
};

describe('Segregação Replay×RPA — escrita técnica exige DEVELOPMENT', () => {
  test('SUPPORT (auditor) em POST /rpa/record/start → 403 classification_required DEVELOPMENT', async () => {
    const { handled, responses } = await runRecordings({ method: 'POST', pathname: '/rpa/record/start', role: 'auditor' });

    expect(handled).toBe(true);
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe(403);
    expect(responses[0].payload.error).toBe('classification_required');
    expect(responses[0].payload.required).toBe('DEVELOPMENT');
    expect(responses[0].payload.classification).toBe('SUPPORT');
  });

  test('SUPPORT (auditor) em POST /rpa/record/stop/:id e GET /rpa/record/status/:id → 403', async () => {
    const stop = await runRecordings({ method: 'POST', pathname: '/rpa/record/stop/rec-1', role: 'auditor' });
    const status = await runRecordings({ method: 'GET', pathname: '/rpa/record/status/rec-1', role: 'auditor' });

    expect(stop.responses[0].status).toBe(403);
    expect(stop.responses[0].payload.required).toBe('DEVELOPMENT');
    expect(status.responses[0].status).toBe(403);
    expect(status.responses[0].payload.required).toBe('DEVELOPMENT');
  });

  test('SUPPORT (auditor) em POST /rpa/execute/:id e controles de execução → 403', async () => {
    const execute = await runExecution({ method: 'POST', pathname: '/rpa/execute/rec-1', role: 'auditor' });
    const cancel = await runExecution({ method: 'POST', pathname: '/rpa/execution/exec-1/cancel', role: 'auditor' });
    const cont = await runExecution({ method: 'POST', pathname: '/rpa/execution/exec-1/continue', role: 'auditor' });
    const next = await runExecution({ method: 'POST', pathname: '/rpa/execution/exec-1/next', role: 'auditor' });

    for (const result of [execute, cancel, cont, next]) {
      expect(result.handled).toBe(true);
      expect(result.responses[0].status).toBe(403);
      expect(result.responses[0].payload.required).toBe('DEVELOPMENT');
    }
  });

  test('DEVELOPMENT (super_admin) em POST /rpa/record/start e /rpa/execute/:id → permitido', async () => {
    const record = await runRecordings({ method: 'POST', pathname: '/rpa/record/start', role: 'super_admin' });
    const execute = await runExecution({ method: 'POST', pathname: '/rpa/execute/rec-1', role: 'super_admin' });

    expect(record.responses[0].status).toBe(200);
    expect(record.responses[0].payload.success).toBe(true);
    expect(execute.responses[0].status).toBe(200);
    expect(execute.responses[0].payload.success).toBe(true);
  });
});

describe('Segregação Replay×RPA — leitura/diagnóstico permanece SUPPORT', () => {
  test('SUPPORT (auditor) em GET /rpa/recordings → permitido', async () => {
    const { handled, responses } = await runRecordings({ method: 'GET', pathname: '/rpa/recordings', role: 'auditor' });

    expect(handled).toBe(true);
    expect(responses[0].status).toBe(200);
    expect(responses[0].payload.recordings).toEqual([]);
  });

  test('SUPPORT (auditor) em GET /rpa/execution/:id (status, leitura pura) → permitido', async () => {
    const { responses } = await runExecution({ method: 'GET', pathname: '/rpa/execution/exec-1', role: 'auditor' });

    expect(responses[0].status).toBe(200);
    expect(responses[0].payload.id).toBe('exec-1');
  });
});

describe('Segregação Replay×RPA — PRODUCTION sem acesso a /rpa/*', () => {
  test.each([
    ['GET', '/rpa/recordings', 'SUPPORT'],
    ['DELETE', '/rpa/recordings/rec-1', 'SUPPORT'],
    ['POST', '/rpa/record/start', 'DEVELOPMENT'],
    ['POST', '/rpa/execute/rec-1', 'DEVELOPMENT'],
    ['GET', '/rpa/execution/exec-1', 'SUPPORT'],
  ])('PRODUCTION (admin) em %s %s → 403', async (method, pathname, expectedRequired) => {
    const runner = pathname.startsWith('/rpa/execution') || pathname.startsWith('/rpa/execute') ? runExecution : runRecordings;
    const { handled, responses } = await runner({ method, pathname, role: 'admin' });

    expect(handled).toBe(true);
    expect(responses[0].status).toBe(403);
    expect(responses[0].payload.error).toBe('classification_required');
    expect(responses[0].payload.required).toBe(expectedRequired);
    expect(responses[0].payload.classification).toBe('PRODUCTION');
  });
});

describe('Coerência de política SUPPORT ↔ frontend (página de replays)', () => {
  const frontendRoot = path.join(__dirname, '..', '..', 'frontend', 'src');

  test('SUPPORT_VISIBLE_ROUTES lista /rpa-replays e não lista rotas /dev/* (bloqueadas no frontend)', () => {
    expect(SUPPORT_VISIBLE_ROUTES).toContain('/rpa-replays');
    expect(SUPPORT_VISIBLE_ROUTES).not.toContain('/dev/rpa-replays');
    expect(SUPPORT_VISIBLE_ROUTES.some((route) => route.startsWith('/dev/'))).toBe(false);
  });

  test('menu.js expõe o item rpa-replays a auditor no alias /rpa-replays', () => {
    const menuSource = fs.readFileSync(path.join(frontendRoot, 'navigation', 'menu.js'), 'utf8');
    const itemLine = menuSource.split('\n').find((line) => line.includes("id: 'rpa-replays'"));

    expect(itemLine).toBeDefined();
    expect(itemLine).toContain("path: '/rpa-replays'");
    expect(itemLine).toContain("'auditor'");
  });

  test('menuPermissions.js não trata /rpa-replays como prefixo protegido super_admin-only', () => {
    const source = fs.readFileSync(path.join(frontendRoot, 'utils', 'menuPermissions.js'), 'utf8');
    const prefixesLine = source.split('\n').find((line) => line.includes('PROTECTED_PATH_PREFIXES = ['));

    expect(prefixesLine).toBeDefined();
    expect(prefixesLine).not.toContain("'/rpa-replays'");
    expect(prefixesLine).toContain("'/rpa-seeds'");
  });
});
