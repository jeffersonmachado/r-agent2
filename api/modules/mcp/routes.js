'use strict';

/**
 * MCP Control Plane — rotas de administração (§M8/§M9).
 *
 * Este módulo é a superfície de GESTÃO das conexões MCP externas. Ele existe
 * porque persistência sem API não é control plane: até 2026-09-12 as conexões
 * vinham de `config.get('mcp.connections')` e não havia como criar, habilitar,
 * desabilitar, testar, redescobrir ou revalidar schema sem reiniciar o processo
 * com uma config nova.
 *
 * Classificação: **DEVELOPMENT** (§M9). Configuração técnica de MCP é ferramenta
 * de engenharia — o mesmo racional de QA Waves/QA Mesh. A superfície não expõe
 * sequer diagnóstico cru a usuário PRODUCTION: `schemaFingerprint`, endpoint
 * bruto e estado de discovery ficam confinados aqui.
 *
 * Segredo NUNCA passa por esta API: aceita-se apenas `credentialRef` (§M4). O
 * serviço recusa payload com segredo em claro e o erro é explícito.
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

function statusForError(error) {
  if (error && SERVICE_ERROR_STATUS[error.code]) return SERVICE_ERROR_STATUS[error.code];
  return 500;
}

function createMcpRoutes({ buildDeps }) {
  const router = express.Router();

  /** §M9 — toda a superfície de administração MCP exige DEVELOPMENT. */
  function enforceDevelopment(deps, req, res) {
    const check = checkClassification(req, 'DEVELOPMENT');
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
  function guard(deps, req, res) {
    const auth = deps.requireAuth(req, res);
    if (!auth) return null;
    if (!enforceDevelopment(deps, req, res)) return null;
    return auth;
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
        input: deps.parseJsonBody(req),
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
        patch: deps.parseJsonBody(req),
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

  // ── TEST CONNECTION (marca VALIDATING e registra saúde) ─────────────────
  router.post('/mcp/connections/:id/test', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { markValidating, recordHealth } = require('../../services/mcp/mcpConnectionService');
      await markValidating({ tenantId, id: req.params.id });
      // Sem servidor MCP real configurado a validação NÃO pode ser declarada
      // bem-sucedida: o resultado é explícito e honesto.
      const connection = await recordHealth({
        tenantId,
        id: req.params.id,
        ok: false,
        error: 'mcp_external_server_not_configured: nenhuma conexão de teste disponível',
        degradedAfter: 1,
      });
      deps.sendJson(res, 502, {
        connection,
        error: 'mcp_external_server_not_configured',
        message: 'Teste de conexão exige servidor MCP externo real; nenhum está configurado.',
      });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── DISCOVER TOOLS (fingerprint + SCHEMA_CHANGED) ───────────────────────
  router.post('/mcp/connections/:id/discover', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { recordDiscovery } = require('../../services/mcp/mcpConnectionService');
      const body = deps.hasJsonContentType(req) ? deps.parseJsonBody(req) : {};
      const tools = Array.isArray(body.tools) ? body.tools : [];
      const result = await recordDiscovery({ tenantId, id: req.params.id, tools });
      deps.sendJson(res, 200, { connection: result, schemaChanged: result.schemaChanged, toolCount: result.toolCount });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  // ── REVALIDATE SCHEMA (SCHEMA_CHANGED exige ação explícita) ─────────────
  router.post('/mcp/connections/:id/revalidate-schema', async (req, res) => {
    const deps = buildDeps();
    const auth = guard(deps, req, res);
    if (!auth) return;
    const tenantId = resolveTenant(deps, req, res, auth);
    if (!tenantId) return;
    try {
      const { getConnection, recordDiscovery, LIFECYCLE_STATES } = require('../../services/mcp/mcpConnectionService');
      const current = await getConnection({ tenantId, id: req.params.id });
      if (current.status !== LIFECYCLE_STATES.SCHEMA_CHANGED) {
        return deps.sendJson(res, 409, {
          error: 'revalidation_not_required',
          status: current.status,
          message: 'Revalidação só é exigida quando o schema remoto mudou.',
        });
      }
      const body = deps.hasJsonContentType(req) ? deps.parseJsonBody(req) : {};
      const tools = Array.isArray(body.tools) ? body.tools : [];
      // A revalidação ACEITA o novo schema de forma explícita (fingerprint novo).
      const result = await recordDiscovery({
        tenantId,
        id: req.params.id,
        tools,
        schemaFingerprint: body.schemaFingerprint || undefined,
      });
      const connection = await recordDiscovery({
        tenantId,
        id: req.params.id,
        tools,
        schemaFingerprint: result.schema_fingerprint || result.schemaFingerprint,
      });
      deps.sendJson(res, 200, { connection, revalidated: true });
    } catch (error) {
      fail(deps, res, error);
    }
  });

  return router;
}

module.exports = { createMcpRoutes, SERVICE_ERROR_STATUS, statusForError };
