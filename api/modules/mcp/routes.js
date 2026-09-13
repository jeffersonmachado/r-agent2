'use strict';

/**
 * MCP Control Plane — rotas de administração (§M8–§M13).
 *
 * Este módulo é a superfície de GESTÃO das conexões MCP externas. Ele existe
 * porque persistência sem API não é control plane: até 2026-09-12 as conexões
 * vinham de `config.get('mcp.connections')` e não havia como criar, habilitar,
 * desabilitar, testar, redescobrir ou revalidar schema sem reiniciar o processo
 * com uma config nova.
 *
 * Classificação (§M13): ESCRITA e diagnóstico técnico exigem **DEVELOPMENT** —
 * configurar MCP externo é ferramenta de engenharia (mesmo racional de QA
 * Waves/QA Mesh) e a resposta expõe endpoint, fingerprint e inventário. As
 * leituras de saúde/ecossistema são somente-leitura e exigem **SUPPORT**: quem
 * opera precisa saber se o ecossistema externo está vivo, mas PRODUCTION nunca
 * vê internals.
 *
 * `POST :id/discover` NÃO aceita inventário do cliente (§M9): o inventário vem
 * SEMPRE de `tools/list` do servidor remoto. Um corpo com `tools` é RECUSADO (não
 * ignorado) para que nenhum cliente antigo acredite que o inventário enviado foi
 * aceito.
 *
 * Segredo NUNCA passa por esta API: aceita-se apenas `credentialRef` (§M4).
 */

const express = require('express');
const { checkClassification } = require('../../middleware/requireClassification');

const SERVICE_ERROR_STATUS = Object.freeze({
  mcp_connection_invalid: 400,
  mcp_connection_duplicate: 409,
  mcp_connection_not_found: 404,
  mcp_endpoint_blocked: 422,
  mcp_auth_forbidden: 422,
  persistence_required: 503,
});

/** Códigos de descoberta/teste → status HTTP (falha NUNCA vira 200). */
const DISCOVERY_ERROR_STATUS = Object.freeze({
  MCP_ENDPOINT_NOT_CONFIGURED: 422,
  MCP_ENDPOINT_BLOCKED: 422,
  MCP_AUTH_FORBIDDEN: 422,
  MCP_AUTH_UNAVAILABLE: 422,
  MCP_CONNECTION_NOT_FOUND: 404,
  MCP_CONNECTION_TENANT_MISMATCH: 404,
  MCP_CONNECTION_DISABLED: 409,
  MCP_REVALIDATION_NOT_REQUIRED: 409,
  MCP_TOOL_INVENTORY_INVALID: 502,
  MCP_DISCOVERY_FAILED: 502,
});

function statusForError(error) {
  if (error && SERVICE_ERROR_STATUS[error.code]) return SERVICE_ERROR_STATUS[error.code];
  if (error && DISCOVERY_ERROR_STATUS[error.code]) return DISCOVERY_ERROR_STATUS[error.code];
  return 500;
}

function createMcpRoutes({ buildDeps }) {
  const router = express.Router();

  /** §M13 — toda a superfície de ESCRITA/diagnóstico exige classificação mínima. */
  function enforceClassification(deps, req, res, min) {
    const check = checkClassification(req, min);
    if (!check.allowed) {
      deps.sendJson(res, 403, {
        error: 'classification_forbidden',
        required: check.required,
        classification: check.classification,
      });
      return false;
    }
    return true;
  }

  function resolveTenant(deps, req, res, auth) {
    try {
      return deps.tenantFromRequest(req, auth);
    } catch (_) {
      deps.badRequest(res, 'tenant_required');
      return null;
    }
  }

  /** Erro do serviço vira resposta HTTP explícita — nunca 200 com falha dentro. */
  function fail(deps, res, error) {
    const status = statusForError(error);
    const payload = { error: error.code || 'mcp_error', message: error.message };
    if (error.decision) payload.decision = error.decision;
    if (error.authState) payload.authState = error.authState;
    deps.sendJson(res, status, payload);
  }

  // Proteção de identidade/tenant: nenhuma rota aceita tenant do payload.
  function guard(deps, req, res, min = 'DEVELOPMENT') {
    const auth = deps.requireAuth(req, res);
    if (!auth) return null;
    if (!enforceClassification(deps, req, res, min)) return null;
    return auth;
  }

  /** Seam de teste: em produção é `{}` e o transporte é o de rede real. */
  function discoveryDeps(deps) {
    return deps.discoveryDeps || {};
  }

  /** Resultado de descoberta/teste: `ok:false` vira status HTTP de falha. */
  function sendDiscoveryResult(deps, res, result, successStatus = 200) {
    if (result.ok) return deps.sendJson(res, successStatus, result);
    return deps.sendJson(res, DISCOVERY_ERROR_STATUS[result.code] || 502, {
      error: result.code,
      message: result.message,
      connection: result.connection || null,
    });
  }

  /**
   * Corpo JSON da requisição — SEMPRE aguardado.
   *
   * Defeito real corrigido aqui: `deps.parseJsonBody` é ASSÍNCRONO (devolve
   * Promise — ver `api/express/httpHelpers.js`, e todos os outros módulos usam
   * `await deps.parseJsonBody(req)`). Tratá-lo como objeto síncrono tinha duas
   * consequências silenciosas:
   *
   *   - `body.tools` era SEMPRE `undefined`, então o guard de §M9 (recusar
   *     inventário declarado pelo cliente) era CÓDIGO MORTO no caminho HTTP;
   *   - `create`/`update` recebiam uma Promise como `input`, e a validação
   *     falhava por "name obrigatório" — a rota de criação não criava nada.
   *
   * Nada disso aparecia porque o teste da API mockava o serviço. É a diferença
   * entre testar a rota e testar a si mesmo.
   */
  async function readJsonBody(deps, req) {
    if (!deps.hasJsonContentType(req)) return {};
    const parsed = await deps.parseJsonBody(req);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  /** §M9 — recusa inventário declarado pelo cliente (nunca "aceito e ignorado"). */
  function rejectClientToolInventory(deps, res, body) {
    if (!body || body.tools === undefined) return false;
    deps.sendJson(res, 400, {
      error: 'MCP_CLIENT_TOOL_INVENTORY_FORBIDDEN',
      message: 'o inventário de tools vem de `tools/list` do servidor remoto e nunca do cliente',
    });
    return true;
  }

  // ── Auth capabilities REAIS (§M13/§M14) ─────────────────────────────────
  router.get('/mcp/connections/auth-capabilities', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    try {
      const { authCapabilitiesReport } = require('../../services/mcp/mcpConnectionService');
      deps.sendJson(res, 200, { modes: authCapabilitiesReport() });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── LIST ────────────────────────────────────────────────────────────────
  router.get('/mcp/connections', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { listConnections } = require('../../services/mcp/mcpConnectionService');
      const includeDisabled = String(req.query.includeDisabled || 'true') !== 'false';
      const connections = await listConnections({ tenantId, includeDisabled });
      deps.sendJson(res, 200, { connections, total: connections.length });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── ECOSYSTEM (SUPPORT: somente leitura do estado PERSISTIDO) ───────────
  router.get('/mcp/ecosystem', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res, 'SUPPORT');
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { getExternalEcosystemStatus } = require('../../services/mcp/mcpEcosystemStatus');
      deps.sendJson(res, 200, await getExternalEcosystemStatus({ tenantId }));
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── READ ────────────────────────────────────────────────────────────────
  router.get('/mcp/connections/:id', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { getConnection } = require('../../services/mcp/mcpConnectionService');
      deps.sendJson(res, 200, { connection: await getConnection({ tenantId, id: req.params.id }) });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── HEALTH (SUPPORT: saúde PERSISTIDA, sem ida à rede) ─────────────────
  router.get('/mcp/connections/:id/health', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res, 'SUPPORT');
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { getConnectionHealth } = require('../../services/mcp/mcpDiscoveryService');
      deps.sendJson(res, 200, { health: await getConnectionHealth({ tenantId, id: req.params.id }) });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── CREATE ──────────────────────────────────────────────────────────────
  router.post('/mcp/connections', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    if (!deps.hasJsonContentType(req)) return deps.badRequest(res, 'json_content_type_required');
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { createConnection } = require('../../services/mcp/mcpConnectionService');
      const created = await createConnection({
        tenantId,
        input: await readJsonBody(deps, req),
        actor: auth.username || auth.userId || null,
      });
      deps.sendJson(res, 201, { connection: created });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── UPDATE ──────────────────────────────────────────────────────────────
  router.patch('/mcp/connections/:id', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    if (!deps.hasJsonContentType(req)) return deps.badRequest(res, 'json_content_type_required');
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { updateConnection } = require('../../services/mcp/mcpConnectionService');
      const updated = await updateConnection({
        tenantId,
        id: req.params.id,
        patch: await readJsonBody(deps, req),
        actor: auth.username || auth.userId || null,
      });
      deps.sendJson(res, 200, { connection: updated });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── ENABLE / DISABLE (estado persistido, nunca remoção) ─────────────────
  router.post('/mcp/connections/:id/(enable|disable)', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { setEnabled } = require('../../services/mcp/mcpConnectionService');
      const enabled = /\/enable$/.test(req.path);
      const connection = await setEnabled({ tenantId, id: req.params.id, enabled });
      deps.sendJson(res, 200, { connection });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── TEST CONNECTION (§M10: endpoint + TLS/SSRF + auth + MCP + negociação) ─────────────────
  router.post('/mcp/connections/:id/test', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    // §M9 — o teste também NÃO aceita inventário declarado pelo cliente: o que
    // vale é o `tools/list` do servidor remoto. Recusar (em vez de ignorar)
    // impede que um cliente conclua que o inventário enviado foi considerado.
    if (rejectClientToolInventory(deps, res, await readJsonBody(deps, req))) return;
    try {
      const { probeConnection } = require('../../services/mcp/mcpDiscoveryService');
      const result = await probeConnection({
        tenantId,
        id: req.params.id,
        deps: discoveryDeps(deps),
        // O teste é DIAGNÓSTICO: uma conexão desabilitada pode ser testada antes
        // de ser habilitada. Este caminho NÃO registra tool nenhuma.
        allowDisabledProbe: true,
      });
      sendDiscoveryResult(deps, res, result);
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── DISCOVER TOOLS (§M9: inventário REAL via `tools/list`) ───────────────
  router.post('/mcp/connections/:id/discover', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    const body = await readJsonBody(deps, req);
    if (rejectClientToolInventory(deps, res, body)) return;
    try {
      const { discoverConnectionTools } = require('../../services/mcp/mcpDiscoveryService');
      const result = await discoverConnectionTools({ tenantId, id: req.params.id, deps: discoveryDeps(deps) });
      sendDiscoveryResult(deps, res, result);
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── REVALIDATE (§M12: schema novo exige aceite EXPLÍCITO) ────────────────
  const revalidateHandler = async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    const body = await readJsonBody(deps, req);
    if (rejectClientToolInventory(deps, res, body)) return;
    try {
      const { revalidateConnection } = require('../../services/mcp/mcpDiscoveryService');
      const result = await revalidateConnection({ tenantId, id: req.params.id, deps: discoveryDeps(deps) });
      sendDiscoveryResult(deps, res, result);
    } catch (error) {
      fail(deps, res, error);
    }
  };
  router.post('/mcp/connections/:id/revalidate', revalidateHandler);
  // Alias legado (mesma semântica) — não quebra clientes já emitidos.
  router.post('/mcp/connections/:id/revalidate-schema', revalidateHandler);

  return router;
}

module.exports = {
  createMcpRoutes,
  SERVICE_ERROR_STATUS,
  DISCOVERY_ERROR_STATUS,
  statusForError,
};
