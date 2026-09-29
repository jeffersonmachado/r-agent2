'use strict';

const path = require('path');
const os = require('os');

/**
 * Configuração do Engineering Runner — TUDO via env, fail-closed (mesmo padrão de
 * services/mcp-research/src/config.js: sem token obrigatório, o processo nem sobe).
 *
 * Variáveis:
 *   PORT / ENGINEERING_RUNNER_PORT     porta HTTP (default 8090)
 *   ENGINEERING_RUNNER_TOKEN           bearer serviço-a-serviço (OBRIGATÓRIO;
 *                                      análogo a RAG_INTERNAL_TOKEN/MCP_RESEARCH_TOKEN).
 *                                      Sem ele o processo recusa subir — nunca anônimo.
 *   ENGINEERING_RUNNER_MAX_TIMEOUT_MS  teto absoluto de timeout aceito por execução
 *                                      (default 300000 — 5min; protege contra um
 *                                      contrato malicioso/errado pedindo timeout
 *                                      absurdo que prenderia o runner indefinidamente).
 *   ENGINEERING_ROUTER_WORKSPACE_ROOT  ER-V1-SEALFIX-003 (Runner Trust Boundary): MESMA env var
 *                                      que api/services/engineeringRouter/patchApplyService.js
 *                                      usa para materializar workspaces — o runner nunca confia
 *                                      no `cwd` que o caller envia sem antes confirmar que ele
 *                                      está DENTRO desta raiz (defesa em profundidade: mesmo que
 *                                      a API já valide, o runner que tem o Docker socket real
 *                                      revalida por conta própria).
 */

function registryRunnerMaxMs() {
  try {
    // eslint-disable-next-line global-require
    const registry = require('../../../config/timeout-policy.json');
    const value = Number(registry?.policies?.RUNNER_MAX_COMMAND?.default);
    return Number.isInteger(value) && value >= 1000 && value <= 600000 ? value : 300000;
  } catch (_) {
    return 300000;
  }
}

function configError(message) {
  const error = new Error(`engineering_runner_config_invalid: ${message}`);
  error.code = 'engineering_runner_config_invalid';
  return error;
}

function parseInteger(value, fallback, { min, max, field }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw configError(`${field} deve ser inteiro entre ${min} e ${max} (recebido: ${value})`);
  }
  return parsed;
}

/**
 * @param {object} [env] mapa de ambiente (default process.env)
 * @param {object} [overrides] injeção de teste — mesma validação aplicada
 */
function loadConfig(env = process.env, overrides = {}) {
  const source = { ...env, ...overrides };

  const authToken = typeof source.ENGINEERING_RUNNER_TOKEN === 'string' && source.ENGINEERING_RUNNER_TOKEN.length > 0
    ? source.ENGINEERING_RUNNER_TOKEN
    : null;
  if (!authToken) {
    throw configError('ENGINEERING_RUNNER_TOKEN ausente — o runner nunca sobe anônimo (o único guardião do Docker socket do host precisa de autenticação real)');
  }

  const workspaceRoot = path.resolve(
    typeof source.ENGINEERING_ROUTER_WORKSPACE_ROOT === 'string' && source.ENGINEERING_ROUTER_WORKSPACE_ROOT.trim()
      ? source.ENGINEERING_ROUTER_WORKSPACE_ROOT.trim()
      : path.join(os.tmpdir(), 'engineering-router-workspaces'),
  );

  return Object.freeze({
    port: parseInteger(source.ENGINEERING_RUNNER_PORT ?? source.PORT, 8090, { min: 0, max: 65535, field: 'PORT' }),
    host: typeof source.ENGINEERING_RUNNER_HOST === 'string' && source.ENGINEERING_RUNNER_HOST.trim()
      ? source.ENGINEERING_RUNNER_HOST.trim()
      : '0.0.0.0',
    authToken,
    // Teto por comando alinhado ao Timeout Policy Registry (`RUNNER_MAX_COMMAND`): o cliente clampa
    // no MESMO valor, então um deadline válido do lado da API nunca vira contrato recusado aqui
    // (que antes aparecia como INFRA_ERROR falso para REGRESSION_COMMAND).
    maxTimeoutMs: parseInteger(source.ENGINEERING_RUNNER_MAX_TIMEOUT_MS, registryRunnerMaxMs(), { min: 1000, max: 600000, field: 'ENGINEERING_RUNNER_MAX_TIMEOUT_MS' }),
    workspaceRoot,
    maxConcurrentExecutions: parseInteger(source.ENGINEERING_RUNNER_MAX_CONCURRENCY, 4, { min: 1, max: 64, field: 'ENGINEERING_RUNNER_MAX_CONCURRENCY' }),
  });
}

module.exports = { loadConfig };
