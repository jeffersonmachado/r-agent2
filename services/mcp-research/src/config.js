'use strict';

/**
 * Configuração do container MCP Research — TUDO via env, fail-closed.
 *
 * Variáveis:
 *   PORT / MCP_RESEARCH_PORT        porta HTTP (default 8080)
 *   MCP_RESEARCH_MODE               ONLINE | OFFLINE (default ONLINE)
 *   MCP_RESEARCH_TOKEN              bearer serviço-a-serviço (OBRIGATÓRIO;
 *                                   análogo ao RAG_INTERNAL_TOKEN). Sem ele o
 *                                   processo recusa subir — nunca anônimo.
 *   MCP_RESEARCH_SNAPSHOT_DIR       diretório de snapshot (OBRIGATÓRIO em
 *                                   OFFLINE; ignorado em ONLINE)
 *   MCP_RESEARCH_TIMEOUT_MS         timeout por salto de fetch (default 15000)
 *   MCP_RESEARCH_MAX_BYTES          teto de resposta (default 2 MiB)
 *   MCP_RESEARCH_MAX_REDIRECTS      teto de saltos (default 3)
 *
 * SOMENTE TESTE (NUNCA em produção; o gate verifica que os defaults são
 * estritos):
 *   MCP_RESEARCH_ALLOW_PRIVATE_NETWORK=true   exceção de política de endpoint
 *   MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP=true    para alcançar fixtures locais.
 */

const MODES = Object.freeze(['ONLINE', 'OFFLINE']);

function configError(message) {
  const error = new Error(`mcp_research_config_invalid: ${message}`);
  error.code = 'mcp_research_config_invalid';
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

function parseMode(value) {
  const mode = String(value || 'ONLINE').trim().toUpperCase();
  if (!MODES.includes(mode)) {
    throw configError(`MCP_RESEARCH_MODE inválido '${value}' (esperado: ${MODES.join('|')})`);
  }
  return mode;
}

/**
 * @param {object} [env] mapa de ambiente (default process.env)
 * @param {object} [overrides] injeção de teste — mesma validação aplicada
 */
function loadConfig(env = process.env, overrides = {}) {
  const source = { ...env, ...overrides };
  const mode = parseMode(source.MCP_RESEARCH_MODE);

  const authToken = typeof source.MCP_RESEARCH_TOKEN === 'string' && source.MCP_RESEARCH_TOKEN.length > 0
    ? source.MCP_RESEARCH_TOKEN
    : null;
  if (!authToken) {
    throw configError('MCP_RESEARCH_TOKEN ausente — o servidor nunca sobe anônimo');
  }

  const snapshotDir = typeof source.MCP_RESEARCH_SNAPSHOT_DIR === 'string'
    && source.MCP_RESEARCH_SNAPSHOT_DIR.trim().length > 0
    ? source.MCP_RESEARCH_SNAPSHOT_DIR.trim()
    : null;
  if (mode === 'OFFLINE' && !snapshotDir) {
    throw configError('MCP_RESEARCH_SNAPSHOT_DIR é obrigatório em MCP_RESEARCH_MODE=OFFLINE');
  }

  const allowPrivateNetwork = source.MCP_RESEARCH_ALLOW_PRIVATE_NETWORK === 'true';
  const allowPlaintextHttp = source.MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP === 'true';

  return Object.freeze({
    port: parseInteger(source.MCP_RESEARCH_PORT ?? source.PORT, 8080, { min: 0, max: 65535, field: 'PORT' }),
    host: typeof source.MCP_RESEARCH_HOST === 'string' && source.MCP_RESEARCH_HOST.trim()
      ? source.MCP_RESEARCH_HOST.trim()
      : '0.0.0.0',
    mode,
    authToken,
    snapshotDir,
    // Exceções de política de endpoint — TEST-ONLY. O default é a política
    // estrita (loopback/privado/metadata proibidos, https obrigatório).
    endpointPolicy: Object.freeze({
      allowPrivateNetwork,
      allowPlaintextHttp,
    }),
    timeoutMs: parseInteger(source.MCP_RESEARCH_TIMEOUT_MS, 15000, { min: 100, max: 60000, field: 'MCP_RESEARCH_TIMEOUT_MS' }),
    maxBytes: parseInteger(source.MCP_RESEARCH_MAX_BYTES, 2 * 1024 * 1024, { min: 1024, max: 16 * 1024 * 1024, field: 'MCP_RESEARCH_MAX_BYTES' }),
    maxRedirects: parseInteger(source.MCP_RESEARCH_MAX_REDIRECTS, 3, { min: 0, max: 10, field: 'MCP_RESEARCH_MAX_REDIRECTS' }),
    maxRequestBodyBytes: parseInteger(source.MCP_RESEARCH_MAX_BODY_BYTES, 1024 * 1024, { min: 1024, max: 8 * 1024 * 1024, field: 'MCP_RESEARCH_MAX_BODY_BYTES' }),
    maxSearchResults: parseInteger(source.MCP_RESEARCH_MAX_RESULTS, 25, { min: 1, max: 50, field: 'MCP_RESEARCH_MAX_RESULTS' }),
  });
}

module.exports = { MODES, loadConfig };
