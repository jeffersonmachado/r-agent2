'use strict';

/**
 * Autoridade de aprovação da superfície de Security Intelligence.
 *
 * Problema que este módulo resolve (achado P0 da auditoria de 2026-10-10): as
 * rotas aceitavam `approvedBy`/`authorizedBy` vindos do CORPO da requisição, de
 * modo que a identidade que assina a aceitação de risco era AUTODECLARADA — e
 * bastava ter acesso à tela (classificação DEVELOPMENT) para aprovar qualquer
 * risco, porque nenhuma permissão por ação era exigida.
 *
 * Duas invariantes, ambas server-side:
 *   1. A identidade de quem aprova é DERIVADA do ator autenticado (`req.agent`,
 *      populado por `requireAuth`); o cliente NÃO pode declará-la. Tentar
 *      declarar é recusa explícita, não descarte silencioso — aceitar em
 *      silêncio deixaria a trilha de auditoria sem saber que houve tentativa.
 *   2. Autorização é POR AÇÃO (`security_intel:<action>`): ler/scanear, aceitar
 *      risco (waiver), revogar isenção e submeter missão de correção são
 *      autorizações distintas. Ter acesso à superfície não concede nenhuma
 *      delas — `read` não implica `waiver_approve`.
 *
 * Módulo PURO de propósito: zero `require` do app (nenhuma dependência de banco,
 * Express ou logger), portanto carregável offline sem `node_modules` e testável
 * sem infraestrutura. Quem injeta a checagem de permissão é a rota, via
 * `requirePermission` (o mesmo middleware RBAC usado pelo resto da API).
 */

/** Recurso RBAC. As ações vivem em `ROLE_PERMISSIONS` (owner/admin) e o
 *  super_admin tem bypass — engenharia de plataforma segue autorizada. */
const SECURITY_INTEL_RESOURCE = 'security_intel';

/**
 * Ações autorizáveis. A granularidade segue o que a decisão exige, não o verbo
 * HTTP: `scan` cobre varredura e PLANEJAMENTO de correção (nada é aplicado),
 * `patch_mission` é SUBMETER a correção ao Roteador (execução governada).
 */
const SECURITY_INTEL_ACTIONS = Object.freeze({
  READ: 'read',
  SCAN: 'scan',
  // Solicitar isenção de risco e CONCEDER a isenção são ações distintas — e, por
  // segregação de funções, de atores distintos.
  WAIVER_REQUEST: 'waiver_request',
  WAIVER_APPROVE: 'waiver_approve',
  WAIVER_REVOKE: 'waiver_revoke',
  PATCH_MISSION: 'patch_mission',
});

/**
 * Campos do corpo que declarariam identidade de aprovação. Presença com valor
 * útil = tentativa de autodeclarar autoridade (recusada com 400).
 */
const DECLARED_IDENTITY_FIELDS = Object.freeze([
  'approvedBy', 'approved_by',
  'authorizedBy', 'authorized_by',
  'approver', 'approverId', 'approver_id',
]);

/** Código de recusa para identidade autodeclarada. */
const APPROVAL_IDENTITY_NOT_ACCEPTED = 'approval_identity_not_accepted';
/** Código de recusa quando o ator autenticado não tem identidade utilizável. */
const APPROVAL_IDENTITY_UNRESOLVABLE = 'approval_identity_unresolvable';

function approvalError(code, detail) {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  error.statusCode = code === APPROVAL_IDENTITY_NOT_ACCEPTED ? 400 : 403;
  return error;
}

function isUsefulValue(value) {
  if (typeof value === 'string') return value.trim() !== '';
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/**
 * Recusa qualquer tentativa de declarar a identidade do aprovador no corpo.
 * Ausência, `null`, `''` e `false` são aceitos (não declaram nada).
 *
 * @param {Object} body - corpo já parseado da requisição
 * @throws {Error} com `code = approval_identity_not_accepted`
 */
function assertNoDeclaredIdentity(body) {
  if (!body || typeof body !== 'object') return;
  for (const field of DECLARED_IDENTITY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (isUsefulValue(body[field])) {
      throw approvalError(APPROVAL_IDENTITY_NOT_ACCEPTED, field);
    }
  }
}

/**
 * Deriva a identidade canônica do ator autenticado.
 *
 * `key` é estável e em minúsculas, própria para comparação de segregação de
 * funções e chave de idempotência; `label` é o que vai para as colunas de
 * auditoria (`approved_by`, `created_by`) e para a UI.
 *
 * @param {Object} agent - ator populado por `requireAuth`
 * @returns {{id:string,label:string,key:string,role:(string|null),platformRole:(string|null),platformClassification:(string|null)}|null}
 */
function resolveApprovalIdentity(agent) {
  if (!agent || typeof agent !== 'object') return null;
  const id = String(agent.id || '').trim();
  const label = String(agent.username || agent.email || '').trim();
  const effectiveId = id || label;
  if (!effectiveId) return null;
  return Object.freeze({
    id: effectiveId,
    label: label || effectiveId,
    key: effectiveId.toLowerCase(),
    role: agent.role || null,
    platformRole: agent.platformRole || null,
    platformClassification: agent.platformClassification || null,
  });
}

/**
 * Constrói a autoridade de aprovação do request.
 *
 * @param {Object} params
 * @param {Object} params.agent - ator autenticado (server-side)
 * @param {(resource:string, action:string)=>{allowed:boolean,error?:string}} params.permissionCheck
 *   checagem RBAC já ligada ao request (normalmente `requirePermission`).
 * @returns {{identity:Object, actor:string, allows:(action:string)=>boolean, denialFor:(action:string)=>({allowed:boolean,error?:string})}|null}
 *   `null` quando o ator não tem identidade utilizável (chamador deve negar).
 */
function createApprovalAuthority({ agent, permissionCheck } = {}) {
  const identity = resolveApprovalIdentity(agent);
  if (!identity) return null;

  const decisions = new Map();

  function denialFor(action) {
    const key = String(action || '').trim();
    if (!key) return { allowed: false, error: `Ação de autorização não informada` };
    if (decisions.has(key)) return decisions.get(key);
    let decision = { allowed: false, error: `Permissão negada: ${key} em ${SECURITY_INTEL_RESOURCE}` };
    if (typeof permissionCheck === 'function') {
      const result = permissionCheck(SECURITY_INTEL_RESOURCE, key);
      if (result && result.allowed) decision = { allowed: true };
      else if (result && result.error) decision = { allowed: false, error: result.error };
    }
    decisions.set(key, decision);
    return decision;
  }

  return Object.freeze({
    identity,
    actor: identity.label,
    denialFor,
    allows: (action) => denialFor(action).allowed === true,
  });
}

module.exports = {
  SECURITY_INTEL_RESOURCE,
  SECURITY_INTEL_ACTIONS,
  DECLARED_IDENTITY_FIELDS,
  APPROVAL_IDENTITY_NOT_ACCEPTED,
  APPROVAL_IDENTITY_UNRESOLVABLE,
  approvalError,
  assertNoDeclaredIdentity,
  resolveApprovalIdentity,
  createApprovalAuthority,
};
