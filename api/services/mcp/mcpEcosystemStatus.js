'use strict';

/**
 * mcpEcosystemStatus — estado HONESTO do ecossistema MCP externo (§M18).
 *
 * Problema que este módulo resolve: não existia nenhum lugar que respondesse
 * "existe ecossistema MCP externo?" sem inventar. Um "LIVE" otimista é a pior
 * resposta possível: o operador acredita que há integração externa operando e
 * descobre o contrário quando uma capability falta em produção.
 *
 * Aqui `LIVE` exige EVIDÊNCIA de descoberta real persistida (`last_discovery_at`)
 * mais saúde. Configuração declarada sem verificação NUNCA vira `LIVE`.
 *
 * Estados:
 *   NOT_CONFIGURED        — nenhuma conexão habilitada (o caso padrão do RAP hoje)
 *   CONFIGURED_UNVERIFIED — há conexões habilitadas, nenhuma com descoberta real
 *   PARTIAL               — há evidência real em parte das conexões (ou falha em uma)
 *   LIVE                  — TODAS as conexões habilitadas têm descoberta real e saúde
 */

const connectionService = require('./mcpConnectionService');

const MCP_EXTERNAL_ECOSYSTEM = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONFIGURED_UNVERIFIED: 'CONFIGURED_UNVERIFIED',
  PARTIAL: 'PARTIAL',
  LIVE: 'LIVE',
});

const HEALTHY_STATUSES = new Set([
  connectionService.LIFECYCLE_STATES.HEALTHY,
  connectionService.LIFECYCLE_STATES.CONFIGURED,
]);

/** Uma conexão só conta como VERIFICADA se houve descoberta real persistida. */
function isVerified(connection) {
  return Boolean(connection.last_discovery_at) && Number(connection.consecutive_failures || 0) === 0;
}

function describeConnection(connection) {
  return {
    id: connection.id,
    tenant: connection.tenant_key,
    name: connection.name,
    endpointConfigured: Boolean(String(connection.endpoint || '').trim()),
    status: connection.status,
    classification: connection.classification_ceiling,
    authType: connection.auth_type,
    verified: isVerified(connection),
    lastDiscoveryAt: connection.last_discovery_at || null,
    schemaFingerprint: connection.schema_fingerprint || null,
    discoveredToolCount: Array.isArray(connection.discovered_tools) ? connection.discovered_tools.length : 0,
    mappingVersion: connection.mapping_version || null,
    revalidationRequired: connection.metadata?.revalidationRequired === true,
    consecutiveFailures: Number(connection.consecutive_failures) || 0,
  };
}

/**
 * Deriva o estado do ecossistema externo do que está PERSISTIDO.
 * Nunca consulta a rede: é um relatório de estado, não um probe.
 *
 * @param {object} [args]
 * @param {string|null} [args.tenantId] limita a um tenant (senão, todos)
 */
async function getExternalEcosystemStatus({ tenantId = null } = {}) {
  const rows = tenantId
    ? await connectionService.listConnections({ tenantId, includeDisabled: false })
    : await connectionService.listAllEnabledConnections();

  const connections = rows.map(describeConnection);
  const verified = connections.filter((connection) => connection.verified);
  const unverified = connections.filter((connection) => !connection.verified);
  const unhealthy = connections.filter(
    (connection) => !HEALTHY_STATUSES.has(connection.status) && connection.status !== connectionService.LIFECYCLE_STATES.SCHEMA_CHANGED,
  );
  const revalidationPending = connections.filter((connection) => connection.revalidationRequired);

  let status;
  if (connections.length === 0) status = MCP_EXTERNAL_ECOSYSTEM.NOT_CONFIGURED;
  else if (verified.length === 0) status = MCP_EXTERNAL_ECOSYSTEM.CONFIGURED_UNVERIFIED;
  else if (verified.length === connections.length && unhealthy.length === 0) status = MCP_EXTERNAL_ECOSYSTEM.LIVE;
  else status = MCP_EXTERNAL_ECOSYSTEM.PARTIAL;

  return {
    status,
    tenantScope: tenantId ? String(tenantId) : 'all',
    generatedFrom: 'persisted_control_plane',
    live: false,
    evidence: {
      enabledConnections: connections.length,
      verifiedConnections: verified.length,
      unverifiedConnections: unverified.length,
      unhealthyConnections: unhealthy.length,
      connectionsRequiringRevalidation: revalidationPending.length,
    },
    connections,
  };
}

module.exports = {
  MCP_EXTERNAL_ECOSYSTEM,
  isVerified,
  describeConnection,
  getExternalEcosystemStatus,
};
