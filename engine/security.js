/**
 * Controles auxiliares de segurança para a engine.
 *
 * Objetivos:
 * - Isolamento total por tenant (helpers para checagens consistentes).
 * - Logs sem PII (masking configurável antes de expor eventos/logs).
 * - Replay acessível apenas por permissão (helpers de autorização).
 * - Auditoria de ações administrativas (geração de eventos de auditoria).
 *
 * Importante:
 * - Este módulo NÃO toca diretamente em IO (sem banco, sem HTTP).
 *   Ele apenas fornece funções puras/utilitárias para o backend.
 * - A engine continua determinística; decisões de autorização são
 *   tomadas na camada de aplicação usando estes helpers.
 */

/**
 * @typedef {import('./flowTypes').EngineEvent} EngineEvent
 */

/**
 * Representa o contexto de segurança/identidade de quem faz a ação.
 *
 * @typedef {Object} SecurityContext
 * @property {string} tenantId
 * @property {string} actorId
 * @property {string[]} [roles]
 * @property {string[]} [permissions]
 */

/**
 * Representa um evento de auditoria administrativa.
 *
 * @typedef {Object} AdminAuditEvent
 * @property {string} id
 * @property {string} at
 * @property {string} tenantId
 * @property {string} actorId
 * @property {string} action           - Ex.: "flow.publish", "flow.rollback", "plugin.install"
 * @property {string} targetType       - Ex.: "flow", "plugin", "tenant"
 * @property {string} targetId
 * @property {Object<string, any>} [details]
 */

/**
 * Verifica se dois tenants são idênticos, usada para garantir
 * isolamento entre sessão/fluxo/eventos.
 *
 * @param {string} tenantA
 * @param {string} tenantB
 * @returns {boolean}
 */
function isSameTenant(tenantA, tenantB) {
  return Boolean(tenantA) && Boolean(tenantB) && tenantA === tenantB;
}

/**
 * Máscara simples para possíveis PII em um texto.
 *
 * Observação:
 * - Esta função é propositalmente conservadora; ela tenta mascarar
 *   padrões comuns (e-mail, números longos) mas NÃO substitui uma
 *   política de DLP completa.
 *
 * @param {string} text
 * @returns {string}
 */
function maskText(text) {
  if (typeof text !== 'string') return text;

  let result = text;

  // Máscara básica de e-mails: mantém só primeira letra e domínio.
  result = result.replace(
    /([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*?)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    (_, first, rest, domain) => `${first}***@${domain}`,
  );

  // Máscara de sequências longas de dígitos (ex.: telefones, possíveis CPFs)
  result = result.replace(/\d{4,}/g, (match) => '*'.repeat(match.length));

  return result;
}

/**
 * Aplica masking em campos potencialmente sensíveis de um payload.
 *
 * Decisão:
 * - Usamos uma lista de chaves "provavelmente sensíveis".
 * - O chamador pode sempre fazer masking adicional fora da engine.
 *
 * @param {Object<string, any>} payload
 * @param {string[]} [keysToMask]
 * @returns {Object<string, any>}
 */
function maskPayload(payload, keysToMask) {
  if (!payload || typeof payload !== 'object') return payload;

  const sensitiveKeys =
    Array.isArray(keysToMask) && keysToMask.length > 0
      ? keysToMask
      : ['email', 'phone', 'cpf', 'document', 'userId', 'customerId'];

  const clone = { ...payload };

  for (const key of Object.keys(clone)) {
    const value = clone[key];
    if (sensitiveKeys.includes(key)) {
      if (typeof value === 'string') {
        clone[key] = maskText(value);
      } else if (typeof value === 'number') {
        clone[key] = '***';
      } else {
        clone[key] = '[masked]';
      }
    }
  }

  return clone;
}

/**
 * Gera uma cópia sanitizada de EngineEvent[] para uso em logs,
 * dashboards ou exposição em APIs, aplicando masking básico.
 *
 * @param {EngineEvent[]} events
 * @param {{ keysToMask?: string[] }} [options]
 * @returns {EngineEvent[]}
 */
function sanitizeEventsForLogging(events, options) {
  if (!Array.isArray(events)) return [];
  const keysToMask = options && options.keysToMask;

  return events.map((ev) => {
    const cleanPayload =
      ev.payload && typeof ev.payload === 'object' ? maskPayload(ev.payload, keysToMask) : ev.payload;

    return {
      ...ev,
      payload: cleanPayload,
    };
  });
}

/**
 * Verifica se um usuário (SecurityContext) pode acessar o replay
 * de uma sessão/fluxo de um determinado tenant.
 *
 * Regra mínima:
 * - tenantId do contexto deve ser igual ao tenant dos dados.
 * - E o usuário deve ter permissão "replay:read" ou papel "admin".
 *
 * Observação:
 * - Este helper não lança; apenas retorna boolean. A camada HTTP
 *   deve transformá-lo em 403/404 conforme a política.
 *
 * @param {SecurityContext} ctx
 * @param {string} dataTenantId
 * @returns {boolean}
 */
function canAccessReplay(ctx, dataTenantId) {
  if (!ctx || !isSameTenant(ctx.tenantId, dataTenantId)) return false;
  const roles = ctx.roles || [];
  const perms = ctx.permissions || [];

  if (roles.includes('admin')) return true;
  if (perms.includes('replay:read')) return true;

  return false;
}

/**
 * Cria um evento de auditoria administrativa.
 *
 * Uso típico:
 * - Ao publicar/rollback de fluxo.
 * - Ao instalar/remover plugins.
 * - Ao alterar configurações sensíveis de tenant.
 *
 * Persistência:
 * - Este módulo não persiste nada; o backend deve salvar o evento
 *   em sua tabela/índice de auditoria.
 *
 * @param {SecurityContext} ctx
 * @param {{ action: string, targetType: string, targetId: string, details?: Object<string, any> }} data
 * @returns {AdminAuditEvent}
 */
function buildAdminAuditEvent(ctx, data) {
  const now = new Date().toISOString();

  return {
    id: `${ctx.tenantId}:${ctx.actorId}:${data.action}:${now}`,
    at: now,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: data.action,
    targetType: data.targetType,
    targetId: data.targetId,
    details: data.details || {},
  };
}

module.exports = {
  isSameTenant,
  maskText,
  maskPayload,
  sanitizeEventsForLogging,
  canAccessReplay,
  buildAdminAuditEvent,
};


