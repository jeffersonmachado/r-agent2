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

const fs = require('fs');
const path = require('path');
const http = require('http');
const { isAuthorized, writeUnauthorized } = require('./auth');

// Reaproveita o Execution Sandbox e a redação de segredo JÁ existentes e provados
// (ER-V1-FINAL-001/ERV1-CLOSE-002) — nunca uma segunda implementação paralela. Este runner
// roda a partir do MESMO checkout do monorepo que a API (mesmo padrão de
// services/mcp-research, que reusa api/services/research/* por caminho relativo idêntico).
const { runInSandbox, isSandboxAvailable } = require('../../../api/services/engineeringRouter/executionSandbox');
const { redactText } = require('../../../engine/engineeringRouter/secretRedaction');
// ER-V1-SEALFIX-003 (Runner Trust Boundary) — o runner tem o Docker socket real do host: NUNCA
// confia que a API (chamador) já validou nada disso, revalida tudo de forma independente,
// reusando as MESMAS policies já provadas (nunca uma segunda allowlist divergente).
const { validateStructuredCommand } = require('../../../engine/engineeringRouter/commandPolicy');
const { SAFE_ENV_PASSTHROUGH_KEYS } = require('../../../api/services/engineeringRouter/safeEngineeringEnvironment');

// V1: única rede permitida é `none` — decidido exclusivamente por esta constante do runner,
// NUNCA por um valor que o caller envie. Uma exceção futura precisaria mudar esta lista aqui,
// nunca aceitar uma string arbitrária vinda da requisição.
const ALLOWED_NETWORKS = Object.freeze(['none']);

// Allowlist reconstruída no runner — mesma fonte de verdade que a API usa para montar o env
// seguro (safeEngineeringEnvironment.js), mas aplicada aqui de forma INDEPENDENTE: mesmo que o
// caller (API/orchestrator) já tenha filtrado, o runner nunca aceita um env arbitrário no corpo
// da requisição — reconstrói do zero, descartando silenciosamente qualquer chave fora da lista.
const RUNNER_ENV_ALLOWLIST = new Set([...SAFE_ENV_PASSTHROUGH_KEYS, 'HOME']);

const DANGEROUS_CWD_PREFIXES = Object.freeze(['/etc', '/root', '/home', '/var/run', '/proc', '/sys']);

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

/**
 * ER-V1-SEALFIX-003 — fronteira de rede: a ÚNICA rede permitida em V1 é `none`, decidida
 * exclusivamente pela policy do runner (`ALLOWED_NETWORKS`). Um caller que peça qualquer outra
 * coisa (`host`, `bridge`, `container:<id>`, rede customizada) é recusado explicitamente — nunca
 * repassado ao Docker silenciosamente nem sobrescrito em silêncio sem o caller saber.
 */
function validateNetworkPolicy(network) {
  if (network === undefined) return { ok: true, value: 'none' };
  if (ALLOWED_NETWORKS.includes(network)) return { ok: true, value: network };
  return { ok: false, reason: `network "${network}" não é permitida pela policy do runner (permitido: ${ALLOWED_NETWORKS.join(', ')})` };
}

/**
 * ER-V1-SEALFIX-003 — fronteira de filesystem: resolve `cwd` por `realpath` (fecha escape via
 * symlink) e exige que o caminho REAL esteja estritamente dentro de `workspaceRoot` — nunca
 * confia que a string enviada já é segura só porque "parece" um path de workspace. Bloqueia
 * explicitamente prefixos perigosos conhecidos como defesa em profundidade adicional, mesmo que
 * o contain-check já devesse cobri-los.
 */
function validateWorkspaceCwd(cwd, workspaceRoot) {
  for (const dangerous of DANGEROUS_CWD_PREFIXES) {
    if (cwd === dangerous || cwd.startsWith(`${dangerous}/`)) {
      return { ok: false, reason: `cwd "${cwd}" aponta para um caminho de sistema proibido (${dangerous})` };
    }
  }
  let realCwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch (err) {
    return { ok: false, reason: `cwd "${cwd}" não pôde ser resolvido (${err.code || err.message}) — workspace precisa existir antes da execução` };
  }
  let realWorkspaceRoot;
  try {
    realWorkspaceRoot = fs.realpathSync(workspaceRoot);
  } catch (_) {
    realWorkspaceRoot = path.resolve(workspaceRoot);
  }
  const withinRoot = realCwd === realWorkspaceRoot || realCwd.startsWith(`${realWorkspaceRoot}${path.sep}`);
  if (!withinRoot) {
    return { ok: false, reason: `cwd resolvido ("${realCwd}") está fora de ENGINEERING_ROUTER_WORKSPACE_ROOT ("${realWorkspaceRoot}") — nunca executa fora de um workspace isolado conhecido` };
  }
  return { ok: true, value: realCwd };
}

/**
 * ER-V1-SEALFIX-003 — reconstrói o env do zero a partir da allowlist do runner: qualquer chave
 * fora dela é descartada silenciosamente (nunca propagada), mesmo que o caller a tenha enviado.
 * "Secrets não propagam" por construção — nenhuma chave da allowlist é um segredo.
 */
function sanitizeExecutionEnv(callerEnv) {
  const sanitized = {};
  for (const key of Object.keys(callerEnv || {})) {
    if (RUNNER_ENV_ALLOWLIST.has(key)) sanitized[key] = callerEnv[key];
  }
  return sanitized;
}

function createHttpServer({ config, logger = console } = {}) {
  // ER-V1-SEALFIX-003 — limite de concorrência: evita abuso acidental (um caller com bug em
  // loop, ou vários workers da API disputando o mesmo runner) esgotar o host com containers
  // Docker demais simultâneos. Novo pedido além do limite é recusado explicitamente (503),
  // nunca enfileirado silenciosamente (o caller decide se tenta de novo).
  let inFlight = 0;

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

      // ER-V1-SEALFIX-003 — fronteira de segurança do runner: TUDO abaixo é revalidado de forma
      // independente, nunca confiando que a API (chamador) já validou. Cada rejeição é 400
      // explícito, nunca uma execução silenciosa com um valor "ajustado"/"corrigido" sem o
      // caller saber.
      const commandValidation = validateStructuredCommand(executable, args);
      if (!commandValidation.ok) {
        sendJson(res, 400, { executionId, error: 'command_not_allowed', message: commandValidation.reason });
        return;
      }
      const networkValidation = validateNetworkPolicy(network);
      if (!networkValidation.ok) {
        sendJson(res, 400, { executionId, error: 'network_not_allowed', message: networkValidation.reason });
        return;
      }
      const cwdValidation = validateWorkspaceCwd(cwd, config.workspaceRoot);
      if (!cwdValidation.ok) {
        sendJson(res, 400, { executionId, error: 'cwd_not_allowed', message: cwdValidation.reason });
        return;
      }
      const safeEnv = sanitizeExecutionEnv(env);

      if (inFlight >= config.maxConcurrentExecutions) {
        sendJson(res, 503, { executionId, error: 'runner_at_capacity', message: `limite de ${config.maxConcurrentExecutions} execuções concorrentes atingido — tente novamente` });
        return;
      }

      inFlight += 1;
      const startedAt = Date.now();
      try {
        const result = await runInSandbox({ executable, args, cwd: cwdValidation.value, env: safeEnv, timeoutMs, network: networkValidation.value });
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
      } finally {
        inFlight -= 1;
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

module.exports = {
  createHttpServer, validateExecuteRequest,
  validateNetworkPolicy, validateWorkspaceCwd, sanitizeExecutionEnv,
  ALLOWED_NETWORKS, RUNNER_ENV_ALLOWLIST, DANGEROUS_CWD_PREFIXES,
};
