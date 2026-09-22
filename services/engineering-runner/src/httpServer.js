'use strict';

/**
 * services/engineering-runner/src/httpServer.js — ER-V1-SEAL-003 (Dedicated Execution Runner).
 *
 * Servidor HTTP mínimo (módulo `http` nativo, zero dependências externas — mesmo espírito
 * minimalista de services/mcp-research). Único processo do projeto autorizado a invocar
 * `executionSandbox.js` (o único que precisa do Docker socket do host montado nele).
 *
 * Contrato:
 *   GET  /health   → sempre 200, não autenticado (estado do processo, nunca dado/capability).
 *   POST /execute  → autenticado (Bearer ENGINEERING_RUNNER_TOKEN), aceita SOMENTE um contrato
 *                    ESTRUTURADO {executionId, executable, args[], cwd, env{}, timeoutMs,
 *                    network} — NUNCA uma string de shell arbitrária, NUNCA raw docker args do
 *                    LLM (o mesmo contrato que `executionSandbox.runInSandbox` já aceitava
 *                    in-process, agora exposto via rede em vez de import direto). Resposta
 *                    estruturada {executionId, exitCode, durationMs, stdout, stderr, timedOut,
 *                    signal} — stdout/stderr SEMPRE redigidos antes de sair do processo do
 *                    runner (defesa em profundidade: o cliente HTTP também redige antes de
 *                    persistir, mas o runner nunca deve deixar um segredo cru atravessar a rede).
 */

const http = require('http');
const { isAuthorized, writeUnauthorized } = require('./auth');

// Reaproveita o Execution Sandbox e a redação de segredo JÁ existentes e provados
// (ER-V1-FINAL-001/ERV1-CLOSE-002) — nunca uma segunda implementação paralela. Este runner
// roda a partir do MESMO checkout do monorepo que a API (mesmo padrão de
// services/mcp-research, que reusa api/services/research/* por caminho relativo idêntico).
const { runInSandbox, isSandboxAvailable } = require('../../../api/services/engineeringRouter/executionSandbox');
const { redactText } = require('../../../engine/engineeringRouter/secretRedaction');

function readJsonBody(req, { maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(Object.assign(new Error('invalid_json'), { code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Validação ESTRUTURAL do contrato — recusa qualquer forma de shell cru ou args fora do
 * formato esperado. `executable`/cada item de `args` precisam ser strings simples; nunca um
 * objeto, nunca algo que permita reconstrução de comando shell arbitrário no lado do runner.
 */
function validateExecuteRequest(body, { maxTimeoutMs }) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'corpo da requisição ausente ou inválido' };
  const { executionId, executable, args, cwd, env, timeoutMs, network } = body;

  if (typeof executionId !== 'string' || !executionId) return { ok: false, reason: 'executionId (string) é obrigatório' };
  if (typeof executable !== 'string' || !executable) return { ok: false, reason: 'executable (string) é obrigatório' };
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return { ok: false, reason: 'args deve ser um array de strings' };
  if (typeof cwd !== 'string' || !cwd) return { ok: false, reason: 'cwd (string, path absoluto do workspace) é obrigatório' };
  if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env))) return { ok: false, reason: 'env, quando presente, deve ser um objeto simples de string->string' };
  if (env && Object.values(env).some((v) => typeof v !== 'string')) return { ok: false, reason: 'todos os valores de env devem ser strings' };
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > maxTimeoutMs)) {
    return { ok: false, reason: `timeoutMs deve ser inteiro positivo até ${maxTimeoutMs}` };
  }
  if (network !== undefined && typeof network !== 'string') return { ok: false, reason: 'network, quando presente, deve ser string' };

  return { ok: true, value: { executionId, executable, args, cwd, env: env || {}, timeoutMs, network } };
}

function createHttpServer({ config, logger = console } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok', sandboxAvailable: isSandboxAvailable() });
      return;
    }

    if (req.method === 'POST' && req.url === '/execute') {
      if (!isAuthorized(req, config.authToken)) {
        writeUnauthorized(res);
        return;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, { error: 'bad_request', code: err.code || 'bad_request', message: err.message });
        return;
      }

      const validation = validateExecuteRequest(body, { maxTimeoutMs: config.maxTimeoutMs });
      if (!validation.ok) {
        sendJson(res, 400, { error: 'invalid_execute_contract', message: validation.reason });
        return;
      }

      const { executionId, executable, args, cwd, env, timeoutMs, network } = validation.value;
      const startedAt = Date.now();
      try {
        const result = await runInSandbox({ executable, args, cwd, env, timeoutMs, network });
        sendJson(res, 200, {
          executionId,
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
          stdout: redactText(result.stdout || ''),
          stderr: redactText(result.stderr || ''),
          timedOut: result.timedOut,
          signal: result.signal,
        });
      } catch (err) {
        // SANDBOX_UNAVAILABLE / SANDBOX_INVALID_WORKSPACE — fail-closed explícito, nunca uma
        // execução silenciosa sem sandbox. O código do erro sobrevive na resposta HTTP para o
        // cliente (engineeringRunnerClient.js) tratar exatamente como tratava o erro local.
        logger.error?.('[engineering-runner] execução falhou', { executionId, code: err.code, error: err.message });
        sendJson(res, 502, { executionId, error: err.message, code: err.code || 'EXECUTION_FAILED' });
      }
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });

  return {
    start: () => new Promise((resolve) => { server.listen(config.port, config.host, resolve); }),
    stop: () => new Promise((resolve, reject) => { server.close((err) => (err ? reject(err) : resolve())); }),
    server,
  };
}

module.exports = { createHttpServer, validateExecuteRequest };
