'use strict';

/**
 * MCP Connection Delegation — delegação EXPLÍCITA de escopo de conexão para
 * portadores de capabilities canônicas.
 *
 * Problema que este módulo resolve: o External MCP Tool Adapter registra cada
 * proxy com a permissão ESCOPADA da conexão (`mcp.t<tenantToken>.<connection>`).
 * Um consumidor capability-neutral (ex.: o research principal, que pede a
 * CAPABILITY `research.search` — nunca o provider nem o nome da conexão) não
 * possui esse escopo e jamais alcançaria o provider externo. A alternativa
 * errada seria conceder `mcp.*` ou registrar a tool com permissão genérica.
 *
 * A delegação é POLICY persistida da conexão (`delegatedCapabilities`): a
 * conexão declara nominalmente QUAIS capabilities canônicas autorizam o uso do
 * seu escopo. Um ator que já possui a permissão da capability (ex.:
 * `research.search`) recebe o escopo da conexão APENAS para efeito de
 * verificação de permissão no registry — e somente enquanto a conexão estiver
 * habilitada.
 *
 * O que a delegação NÃO é:
 *  - não é wildcard: `*` e `mcp.*` são recusados na configuração (fail closed);
 *  - não é cross-tenant: o isolamento de tenant continua no guard de execução
 *    do proxy (adapter) e no binding de tenant da resolução de provider
 *    (capability-resolution) — a camada de permissão do registry é
 *    deliberadamente tenant-agnóstica (o escopo `mcp.t*` como STRING também
 *    nunca provou tenant; quem prova é o contexto governado);
 *  - não é automática: sem `delegatedCapabilities` declarado, nenhum escopo é
 *    delegado (controle negativo provado em teste).
 */

const crypto = require('crypto');

function sanitizeToolIdPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * Token opaco e determinístico do tenant para ids/permissões de tools
 * externas (não reversível, não vaza tenantId).
 */
function externalMcpTenantToken(tenantId) {
  return crypto.createHash('sha256').update(String(tenantId)).digest('hex').slice(0, 12);
}

/** Permissão ESCOPADA da conexão (a mesma exigida pelos proxies do adapter). */
function externalMcpConnectionScope(tenantId, connectionName) {
  return `mcp.t${externalMcpTenantToken(tenantId)}.${sanitizeToolIdPart(connectionName)}`;
}

/**
 * Valida a delegação declarada na config da conexão. Fail closed:
 *  - wildcard (`*`, `mcp.*`, qualquer entrada com `*`) é proibido;
 *  - toda capability delegada precisa ser capability DECLARADA da conexão
 *    (valor do `toolCapabilityMap` ou entrada de `allowedCapabilities`) — não se
 *    delega o que a conexão não afirma prover;
 *  - entradas vazias/não-string são recusadas.
 *
 * @returns {string[]} lista normalizada (sem duplicatas, ordem preservada)
 */
function validateDelegatedCapabilities(connection) {
  const raw = connection?.delegatedCapabilities;
  if (raw === undefined || raw === null) return [];
  const name = connection?.name || 'unnamed';
  if (!Array.isArray(raw)) {
    throw new Error(`mcp_connection_invalid: delegatedCapabilities deve ser uma lista (${name})`);
  }
  const declared = new Set([
    ...(Array.isArray(connection.allowedCapabilities) ? connection.allowedCapabilities : []),
    ...Object.values(connection.toolCapabilityMap || {}),
  ].map((capability) => String(capability)));
  const normalized = [];
  for (const entry of raw) {
    const capability = String(entry ?? '').trim();
    if (!capability) {
      throw new Error(`mcp_connection_invalid: delegatedCapabilities não aceita entradas vazias (${name})`);
    }
    if (capability.includes('*')) {
      throw new Error(`mcp_connection_invalid: delegatedCapabilities não aceita wildcard ('${capability}') (${name})`);
    }
    if (!declared.has(capability)) {
      throw new Error(
        `mcp_connection_invalid: delegatedCapabilities '${capability}' não é capability declarada da conexão (${name})`,
      );
    }
    if (!normalized.includes(capability)) normalized.push(capability);
  }
  return normalized;
}

/**
 * Cria o resolver de delegação consultado pelo Canonical Tool Registry.
 *
 * Para cada conexão HABILITADA com `delegatedCapabilities` declarado: se o ator
 * já possui ao menos uma das capabilities delegadas, o escopo da conexão é
 * concedido para a verificação de permissão. Determinístico (saída ordenada).
 * Ator com `*` não precisa de delegação (o registry já o trata).
 *
 * @param {object} args
 * @param {object} args.hub  MCP Client Hub (fonte viva das conexões)
 * @returns {(actor: object) => string[]}
 */
function createConnectionDelegationResolver({ hub } = {}) {
  if (!hub || typeof hub.listConnections !== 'function') {
    throw new Error('mcp_delegation_hub_required');
  }
  return function resolveDelegatedPermissions(actor = {}) {
    const held = new Set(Array.isArray(actor?.permissions) ? actor.permissions : []);
    if (held.has('*')) return [];
    const granted = [];
    for (const connection of hub.listConnections()) {
      if (connection.enabled === false) continue;
      const delegated = Array.isArray(connection.delegatedCapabilities) ? connection.delegatedCapabilities : [];
      if (delegated.length === 0) continue;
      if (!delegated.some((capability) => held.has(capability))) continue;
      granted.push(externalMcpConnectionScope(connection.tenant, connection.name));
    }
    return granted.sort();
  };
}

module.exports = {
  sanitizeToolIdPart,
  externalMcpTenantToken,
  externalMcpConnectionScope,
  validateDelegatedCapabilities,
  createConnectionDelegationResolver,
};
