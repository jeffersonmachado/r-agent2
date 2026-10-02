'use strict';

/**
 * api/services/engineeringRouter/engineeringRunnerClient.js — ER-V1-SEAL-003 (Dedicated
 * Execution Runner).
 *
 * Substitui a chamada IN-PROCESS a `executionSandbox.js` por uma requisição HTTP para o
 * Engineering Runner — um serviço SEPARADO (services/engineering-runner/), o único autorizado a
 * ter o Docker socket do host montado. A API principal (este processo) NUNCA importa
 * `executionSandbox.js` nem tem acesso a `docker` — só fala com o runner via este cliente.
 *
 * Mesma assinatura e mesmo contrato de retorno de `executionSandbox.runInSandbox` (mesmos
 * `.code` de erro: `SANDBOX_UNAVAILABLE`/`SANDBOX_INVALID_WORKSPACE`) — `testRunnerService.js`
 * troca o import sem precisar mudar nenhuma outra linha.
 *
 * FAIL-CLOSED: se o runner não estiver configurado, não responder, ou responder com erro, a
 * task NUNCA roda no host como fallback — propaga `SANDBOX_UNAVAILABLE` explicitamente. Nunca
 * existe um caminho de "spawn local se o runner falhar".
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { policyMs } = require('../../utils/operationDeadline');

const RUNNER_URL = process.env.ENGINEERING_RUNNER_URL || null;
const RUNNER_TOKEN = process.env.ENGINEERING_RUNNER_TOKEN || null;

/**
 * Vocabulário de recusa do RUNNER → vocabulário de erro da API.
 *
 * DEFEITO REAL medido em 2026-10-02 (`tests/unit/engineeringRouterExecutionSandboxSecurity.test.js`
 * vermelho na trunk): o runner recusa um cwd fora de `ENGINEERING_ROUTER_WORKSPACE_ROOT` servindo
 * `400 {error: 'cwd_not_allowed', message: ...}` — a recusa estruturada vive no campo `error`
 * (`services/engineering-runner/src/httpServer.js::validateWorkspaceCwd`). Este cliente lia
 * `body.code`, campo que o runner NUNCA envia, então TODA recusa estruturada caía no default
 * `SANDBOX_UNAVAILABLE`. "Esse cwd não é um workspace isolado conhecido" chegava ao chamador como
 * "sandbox indisponível" — diagnóstico DIFERENTE e enganoso: manda o operador procurar um Docker
 * caído em vez do caminho recusado. O comentário abaixo já prometia "preserva o código real,
 * nunca mascara"; a promessa existia, o mecanismo não.
 *
 * Mapeia-se apenas o que tem contraparte semântica exata em `executionSandbox.js`; recusas sem
 * contraparte mantêm o vocabulário do runner em `error.runnerError`, nunca um código inventado.
 */
const RUNNER_ERROR_CODE_MAP = Object.freeze({
  cwd_not_allowed: 'SANDBOX_INVALID_WORKSPACE',
});

function sandboxUnavailable(detail) {
  const error = new Error(`SANDBOX_UNAVAILABLE: ${detail} (fail-closed, nunca cai de volta para spawn sem sandbox)`);
  error.code = 'SANDBOX_UNAVAILABLE';
  return error;
}

/**
 * @returns {boolean} - nunca faz I/O; só reflete se o cliente está configurado para falar com
 *   um runner. Uma resposta `true` aqui NÃO garante que o runner está de pé — só que há um
 *   endereço configurado para tentar. Disponibilidade real só é conhecida na chamada real.
 */
function isRunnerConfigured() {
  return Boolean(RUNNER_URL && RUNNER_TOKEN);
}

/**
 * Mesma assinatura de `executionSandbox.runInSandbox({executable, args, cwd, env, timeoutMs,
 * network})` — retorna `{exitCode, stdout, stderr, timedOut, signal}` ou lança com `.code`
 * `SANDBOX_UNAVAILABLE`/`SANDBOX_INVALID_WORKSPACE`.
 */
async function runInSandbox({ executable, args, cwd, env, timeoutMs, network = 'none', signal = null }) {
  if (!isRunnerConfigured()) {
    throw sandboxUnavailable('ENGINEERING_RUNNER_URL/ENGINEERING_RUNNER_TOKEN não configurados — nenhum runner dedicado disponível');
  }

  const executionId = crypto.randomUUID();
  // Deadlines do Timeout Policy Registry (nunca magic number): o request HTTP espera o comando
  // (`timeoutMs`, já resolvido pela política do chamador) + a janela de terminação graciosa do
  // container + a folga de resposta do runner. Assim o runner sempre tem tempo de encerrar o child
  // e devolver TIMEOUT estruturado antes de o cliente desistir.
  // Clamp no teto do runner (RUNNER_MAX_COMMAND — o MESMO valor que o runner aceita): deadline
  // adaptativo nunca vira contrato recusado.
  const requestedMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : policyMs('INTEGRATION_TEST');
  const commandMs = Math.min(requestedMs, policyMs('RUNNER_MAX_COMMAND'));
  const graceMs = policyMs('REGRESSION_CHILD_TERMINATION_GRACE');
  const requestTimeoutMs = commandMs + graceMs + policyMs('RUNNER_REQUEST_SLACK');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  // Cancelamento cooperativo do chamador (lease perdido / NO_PROGRESS) fecha a conexão: o runner
  // detecta e encerra o container graciosamente.
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) onCallerAbort();
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let response;
  try {
    response = await fetch(`${RUNNER_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RUNNER_TOKEN}`,
      },
      body: JSON.stringify({ executionId, executable, args, cwd, env, timeoutMs: commandMs, network, graceMs }),
      signal: controller.signal,
    });
  } catch (err) {
    if (signal && signal.aborted) {
      const cancelled = new Error('execução cancelada cooperativamente pelo chamador');
      cancelled.code = 'OPERATION_CANCELLED';
      throw cancelled;
    }
    logger.warn('[engineeringRunnerClient] falha ao alcançar o Engineering Runner', { executionId, error: err.message });
    throw sandboxUnavailable(`falha ao alcançar o Engineering Runner em ${RUNNER_URL}: ${err.message}`);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw sandboxUnavailable(`resposta do Engineering Runner não é JSON válido: ${err.message}`);
  }

  if (!response.ok) {
    // O runner propaga o mesmo `.code` que `executionSandbox.js` lançaria in-process
    // (SANDBOX_UNAVAILABLE/SANDBOX_INVALID_WORKSPACE) — preserva o código real, nunca mascara.
    // A recusa estruturada do runner vive em `error` (nunca em `code`): o código da API é
    // RESOLVIDO a partir dela, e o valor original do runner é preservado em `runnerError` para
    // que o detalhe nunca se perca na tradução.
    const runnerError = typeof body?.error === 'string' ? body.error : null;
    const error = new Error(body?.message || runnerError || `Engineering Runner respondeu ${response.status}`);
    error.code = body?.code || RUNNER_ERROR_CODE_MAP[runnerError] || 'SANDBOX_UNAVAILABLE';
    if (runnerError) error.runnerError = runnerError;
    throw error;
  }

  return {
    exitCode: body.exitCode,
    stdout: body.stdout,
    stderr: body.stderr,
    timedOut: body.timedOut,
    signal: body.signal,
    ...(body.terminatedBy ? { terminatedBy: body.terminatedBy } : {}),
    ...(body.cancelled ? { cancelled: true } : {}),
  };
}

module.exports = {
  runInSandbox,
  isRunnerConfigured,
};
