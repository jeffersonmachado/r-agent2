'use strict';

/**
 * Waivers auditáveis — aceitação FORMAL e TEMPORÁRIA de risco por um humano.
 *
 * Regras que este serviço faz cumprir (todas fail-closed):
 *   - expiração é OBRIGATÓRIA e precisa estar NO FUTURO; o prazo não pode passar
 *     de `maxWaiverDays` (política: `releaseGate.maxWaiverDays`, default 90);
 *   - motivo com substância (mínimo de caracteres) e aprovador identificado são
 *     obrigatórios — "aceitamos o risco" sem autor e sem justificativa não é
 *     trilha de auditoria;
 *   - não se cria waiver para achado que NÃO é risco aberto (estado VEX
 *     `NOT_AFFECTED`/`FALSE_POSITIVE` ou já resolvido): isentar o que não é risco
 *     é maquiagem de métrica, não gestão de risco;
 *   - revogar NÃO apaga: o registro permanece como histórico (`revoked_at`,
 *     `revoked_by`, `revoke_reason`) e o achado volta a contar como risco aberto;
 *   - waiver expirado não isenta (o gate também recusa, mas aqui ele nem entra
 *     na lista de vigentes).
 *
 * Nada nesta camada isenta achado por si só: quem isenta é o motor de risco
 * (`computeRisk` recebe o waiver VIGENTE) e o gate (`evaluateReleaseSecurity`).
 */

const crypto = require('crypto');

const { connect, getSequelize } = require('../../db/sequelize');
const getSecurityWaiver = require('../../db/models/SecurityWaiver');
const getSecurityFinding = require('../../db/models/SecurityFinding');
const getSecurityFindingEvent = require('../../db/models/SecurityFindingEvent');

const DEFAULT_MAX_WAIVER_DAYS = 90;
const MIN_REASON_LENGTH = 20;

/**
 * Estados do ciclo de aprovação.
 *
 * `PENDING_APPROVAL` NÃO isenta nada: só `ACTIVE` alimenta `getActiveWaivers` e o
 * gate de release. A separação existe porque solicitar isenção de risco e
 * concedê-la são decisões diferentes (e, nesta capacidade, pessoas diferentes).
 */
const WAIVER_STATUS = Object.freeze({
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
});

const HTTP_LIKE_CODES = Object.freeze({
  waiver_finding_key_required: 400,
  waiver_reason_required: 400,
  waiver_expiry_required: 400,
  waiver_expiry_not_in_future: 400,
  waiver_exceeds_max_days: 400,
  waiver_finding_not_found: 404,
  waiver_not_needed_for_vex_state: 409,
  waiver_not_found: 404,
  // Decisões de AUTORIZAÇÃO da aprovação: o pedido é válido, o ator é que não
  // pode aprovar (403) — diferente de pedido malformado (400).
  waiver_requester_required: 403,
  waiver_approver_required: 403,
  waiver_self_approval_forbidden: 403,
  waiver_already_approved: 409,
  waiver_approval_conflict: 409,
  waiver_revoked_cannot_approve: 409,
  waiver_expired_cannot_approve: 409,
  waiver_scope_changed: 409,
});

function codedError(code, detail) {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  error.statusCode = HTTP_LIKE_CODES[code] || 400;
  return error;
}

function stateOf(row, now = new Date()) {
  if (row.revoked_at) return 'REVOKED';
  if (String(row.status || '').toUpperCase() === WAIVER_STATUS.PENDING_APPROVAL) return 'PENDING_APPROVAL';
  const expiry = new Date(row.expires_at);
  if (Number.isNaN(expiry.getTime())) return 'INVALID_EXPIRY';
  return expiry.getTime() > now.getTime() ? 'ACTIVE' : 'EXPIRED';
}

/** Principal canônico para comparação de identidade (segregação de funções). */
function normalizePrincipal(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return text === '' ? null : text;
}

async function ensureConnected() {
  const sequelize = getSequelize();
  if (!sequelize) {
    try {
      await connect(3, 500);
    } catch (error) {
      const wrapped = codedError('persistence_required', error.message);
      throw wrapped;
    }
  }
  return getSequelize();
}

/**
 * Executa em transação quando o Sequelize oferece uma.
 *
 * Atomicidade aqui não é preciosismo: sem ela, uma falha ao gravar o EVENTO
 * deixaria o waiver criado e o achado marcado como MITIGATED — isenção sem
 * trilha de auditoria, exatamente o estado que este serviço existe para impedir
 * (observado em prova end-to-end em 2026-10-08: dois waivers vigentes e apenas um
 * evento, com a criação interrompida no meio).
 */
function withTransaction(sequelize, fn) {
  if (sequelize && typeof sequelize.transaction === 'function') {
    return sequelize.transaction(fn);
  }
  return fn(null);
}

/** Chave determinística: a mesma isenção não é criada duas vezes. */
function computeWaiverKey({ tenantKey = 'system', findingKey, expiresAt }) {
  return crypto
    .createHash('sha256')
    .update(`${tenantKey}|${findingKey}|${new Date(expiresAt).toISOString()}`)
    .digest('hex')
    .slice(0, 40);
}

/**
 * Impressão do ESCOPO aprovado.
 *
 * Cobre o que a aceitação de risco efetivamente significa: o achado, o pacote, o
 * serviço, a severidade e o prazo. Se qualquer um mudar depois (upgrade muda o
 * `bomRef` e portanto o `finding_key`; a severidade pode subir; o prazo não pode
 * ser esticado por quem aprova), o hash deixa de casar e o waiver PARA de
 * isentar — aprovação não é reaproveitável para outro escopo.
 */
function computeScopeHash({ findingKey, advisoryId = null, packageName = null, service = null, severity = null, expiresAt }) {
  return crypto
    .createHash('sha256')
    .update([
      String(findingKey || ''),
      String(advisoryId || ''),
      String(packageName || ''),
      String(service || ''),
      String(severity || ''),
      new Date(expiresAt).toISOString(),
    ].join('|'))
    .digest('hex')
    .slice(0, 40);
}

/**
 * Valida a SOLICITAÇÃO e devolve o que será gravado. Separado de `requestWaiver`
 * para ser testável sem banco.
 *
 * Não existe aprovador aqui: quem solicita não concede. A identidade de quem
 * PEDE é `requestedBy`; a de quem APROVA é decidida em `approveWaiver`.
 */
function normalizeCreation({
  finding,
  findingKey,
  reason,
  requestedBy,
  createdBy = null,
  expiresAt,
  expiresInDays,
  compensatingControl = null,
  now = new Date(),
  maxWaiverDays = DEFAULT_MAX_WAIVER_DAYS,
} = {}) {
  if (!findingKey) throw codedError('waiver_finding_key_required');
  if (!finding) throw codedError('waiver_finding_not_found', findingKey);

  // Isentar o que já não é risco aberto não é gestão de risco: é métrica.
  const vexState = ['NOT_AFFECTED', 'FALSE_POSITIVE'].includes(finding.status);
  if (vexState || finding.resolved_at) {
    throw codedError('waiver_not_needed_for_vex_state', finding.status || 'RESOLVED');
  }

  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < MIN_REASON_LENGTH) {
    throw codedError('waiver_reason_required', `min_${MIN_REASON_LENGTH}_chars`);
  }
  const cleanRequester = String(requestedBy || '').trim();
  if (!cleanRequester) throw codedError('waiver_requester_required');

  let expiry = expiresAt ? new Date(expiresAt) : null;
  if (!expiry && Number.isFinite(Number(expiresInDays))) {
    expiry = new Date(now.getTime() + Number(expiresInDays) * 86400000);
  }
  if (!expiry || Number.isNaN(expiry.getTime())) throw codedError('waiver_expiry_required');
  if (expiry.getTime() <= now.getTime()) throw codedError('waiver_expiry_not_in_future');

  const horizon = new Date(now.getTime() + Number(maxWaiverDays) * 86400000);
  if (expiry.getTime() > horizon.getTime()) {
    throw codedError('waiver_exceeds_max_days', String(maxWaiverDays));
  }

  return {
    reason: cleanReason,
    requestedBy: cleanRequester,
    requestedAt: now,
    createdBy: createdBy || cleanRequester,
    expiresAt: expiry,
    compensatingControl: compensatingControl ? String(compensatingControl).trim() : null,
    maxWaiverDays: Number(maxWaiverDays),
    scopeHash: computeScopeHash({
      findingKey,
      advisoryId: finding.advisory_id,
      packageName: finding.package_name,
      service: finding.service,
      severity: finding.severity,
      expiresAt: expiry,
    }),
  };
}

/**
 * SOLICITA a isenção. NÃO isenta nada e NÃO mitiga o achado.
 *
 * O waiver nasce `PENDING_APPROVAL`, com solicitante, motivo, prazo e o hash do
 * escopo pedido. Quem concede é `approveWaiver`, por outro principal — é isso que
 * torna a segregação de funções verificável e a auditoria honesta.
 */
async function requestWaiver({
  tenantKey = 'system',
  findingKey,
  reason,
  requestedBy,
  createdBy = null,
  expiresAt,
  expiresInDays,
  compensatingControl = null,
  maxWaiverDays = DEFAULT_MAX_WAIVER_DAYS,
  now = new Date(),
} = {}) {
  await ensureConnected();
  const Finding = getSecurityFinding();
  const Waiver = getSecurityWaiver();

  const finding = await Finding.findOne({ where: { tenant_key: tenantKey, finding_key: findingKey } });
  const normalized = normalizeCreation({
    finding, findingKey, reason, requestedBy, createdBy,
    expiresAt, expiresInDays, compensatingControl, now, maxWaiverDays,
  });

  const waiverKey = computeWaiverKey({ tenantKey, findingKey, expiresAt: normalized.expiresAt });
  const outcome = await withTransaction(getSequelize(), async (transaction) => {
    const tx = transaction ? { transaction } : undefined;
    const [waiver, created] = await Waiver.findOrCreate({
      where: { tenant_key: tenantKey, waiver_key: waiverKey },
      defaults: {
        tenant_key: tenantKey,
        waiver_key: waiverKey,
        finding_key: findingKey,
        advisory_id: finding.advisory_id || null,
        package_name: finding.package_name || null,
        service: finding.service || null,
        severity: finding.severity || null,
        reason: normalized.reason,
        compensating_control: normalized.compensatingControl,
        // Solicitação: sem aprovador e sem mitigação.
        status: WAIVER_STATUS.PENDING_APPROVAL,
        approved_by: null,
        approved_at: null,
        requested_by: normalized.requestedBy,
        requested_at: normalized.requestedAt,
        scope_hash: normalized.scopeHash,
        approval_version: 1,
        created_by: normalized.createdBy,
        expires_at: normalized.expiresAt,
        metadata: {
          maxWaiverDays: normalized.maxWaiverDays,
          criteria: 'human_waiver_with_expiry',
          scopeHash: normalized.scopeHash,
        },
      },
      ...(tx || {}),
    });

    await getSecurityFindingEvent().create({
      tenant_key: tenantKey,
      finding_key: findingKey,
      advisory_id: finding.advisory_id || null,
      event: 'WAIVER_REQUESTED',
      from_status: finding.status,
      to_status: finding.status,
      from_severity: finding.severity || null,
      to_severity: finding.severity || null,
      actor: normalized.requestedBy,
      detail: {
        reason: normalized.reason,
        expiresAt: normalized.expiresAt.toISOString(),
        compensatingControl: normalized.compensatingControl,
        waiverKey,
        scopeHash: normalized.scopeHash,
      },
    }, tx);

    return { waiver, created };
  });

  return {
    ...outcome,
    waiverKey,
    status: (outcome.waiver && outcome.waiver.status) || WAIVER_STATUS.PENDING_APPROVAL,
  };
}

/**
 * APROVA a isenção solicitada: aqui, e somente aqui, o achado vira `MITIGATED`.
 *
 * Garantias (todas fail-closed):
 *   - o aprovador precisa ser identificado (identidade derivada na rota);
 *   - SEGREGAÇÃO DE FUNÇÕES: `requested_by !== approved_by` — quem pede não concede;
 *   - ESCOPO: o hash do escopo atual precisa casar com o pedido; se o achado
 *     mudou (pacote/serviço/severidade/prazo), a aprovação não é reaproveitada;
 *   - `PENDING_APPROVAL` → `ACTIVE` por CAS: aprovações concorrentes ou replay
 *     perdem a corrida em vez de mitigar duas vezes (idempotente quando já ACTIVE);
 *   - waiver revogado ou já expirado não pode ser aprovado.
 */
async function approveWaiver({ waiverKey, tenantKey = 'system', approvedBy, now = new Date() } = {}) {
  if (!waiverKey) throw codedError('waiver_finding_key_required', 'waiverKey');
  const cleanApprover = String(approvedBy || '').trim();
  if (!cleanApprover) throw codedError('waiver_approver_required');
  await ensureConnected();
  const Waiver = getSecurityWaiver();
  const Finding = getSecurityFinding();

  const waiver = await Waiver.findOne({ where: { tenant_key: tenantKey, waiver_key: waiverKey } });
  if (!waiver) throw codedError('waiver_not_found', waiverKey);

  const status = String(waiver.status || '').toUpperCase();
  if (waiver.revoked_at || status === WAIVER_STATUS.REVOKED) {
    throw codedError('waiver_revoked_cannot_approve', waiverKey);
  }
  const expiry = new Date(waiver.expires_at);
  if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime()) {
    throw codedError('waiver_expired_cannot_approve', waiverKey);
  }
  if (status === WAIVER_STATUS.ACTIVE) {
    return { waiver, approved: false, reason: 'already_approved' };
  }

  const requester = normalizePrincipal(waiver.requested_by);
  if (!requester) throw codedError('waiver_requester_required', waiverKey);
  if (requester === normalizePrincipal(cleanApprover)) {
    throw codedError('waiver_self_approval_forbidden', requester);
  }

  const finding = await Finding.findOne({ where: { tenant_key: tenantKey, finding_key: waiver.finding_key } });
  if (!finding) throw codedError('waiver_finding_not_found', waiver.finding_key);

  const currentScopeHash = computeScopeHash({
    findingKey: waiver.finding_key,
    advisoryId: finding.advisory_id,
    packageName: finding.package_name,
    service: finding.service,
    severity: finding.severity,
    expiresAt: waiver.expires_at,
  });
  if (waiver.scope_hash && waiver.scope_hash !== currentScopeHash) {
    throw codedError('waiver_scope_changed', waiverKey);
  }
  const previousStatus = finding.status;

  const outcome = await withTransaction(getSequelize(), async (transaction) => {
    const tx = transaction ? { transaction } : undefined;
    const [affected] = await Waiver.update({
      status: WAIVER_STATUS.ACTIVE,
      approved_by: cleanApprover,
      approved_at: now,
      approval_version: (Number(waiver.approval_version) || 1) + 1,
    }, {
      where: { id: waiver.id, tenant_key: tenantKey, status: WAIVER_STATUS.PENDING_APPROVAL },
      ...(tx || {}),
    });
    if (affected !== 1) throw codedError('waiver_approval_conflict', waiverKey);

    await finding.update({ waiver_id: waiver.id, status: 'MITIGATED' }, tx);
    await getSecurityFindingEvent().create({
      tenant_key: tenantKey,
      finding_key: waiver.finding_key,
      advisory_id: waiver.advisory_id || null,
      event: 'WAIVER_APPROVED',
      from_status: previousStatus,
      to_status: 'MITIGATED',
      from_severity: finding.severity || null,
      to_severity: finding.severity || null,
      actor: cleanApprover,
      detail: {
        waiverKey,
        requestedBy: waiver.requested_by,
        scopeHash: currentScopeHash,
        expiresAt: new Date(waiver.expires_at).toISOString(),
      },
    }, tx);

    return { approved: true };
  });

  return { waiver, ...outcome, approvedBy: cleanApprover, scopeHash: currentScopeHash };
}

/** Revoga sem apagar: histórico permanece, isenção deixa de valer. */
async function revokeWaiver({ waiverKey, tenantKey = 'system', actor, reason = null } = {}) {
  if (!waiverKey) throw codedError('waiver_finding_key_required', 'waiverKey');
  await ensureConnected();
  const Waiver = getSecurityWaiver();
  const Finding = getSecurityFinding();

  const waiver = await Waiver.findOne({ where: { tenant_key: tenantKey, waiver_key: waiverKey } });
  if (!waiver) throw codedError('waiver_not_found', waiverKey);
  if (waiver.revoked_at) return { waiver, revoked: false, reason: 'already_revoked' };

  const wasActive = String(waiver.status || '').toUpperCase() === WAIVER_STATUS.ACTIVE;

  // CAS: duas revogações concorrentes não podem ambas se declarar vitoriosas.
  const [affected] = await Waiver.update({
    revoked_at: new Date(),
    revoked_by: actor || 'unknown',
    revoke_reason: reason,
    status: WAIVER_STATUS.REVOKED,
    approval_version: (Number(waiver.approval_version) || 1) + 1,
  }, {
    where: { id: waiver.id, tenant_key: tenantKey, revoked_at: null },
  });
  if (affected !== 1) {
    const current = await Waiver.findOne({ where: { tenant_key: tenantKey, waiver_key: waiverKey } });
    return { waiver: current || waiver, revoked: false, reason: 'already_revoked' };
  }

  // Só um waiver APROVADO tinha mitigado o achado; revogar uma SOLICITAÇÃO
  // pendente não pode mexer no estado do achado (não havia isenção vigente).
  if (!wasActive) return { waiver, revoked: true, mitigated: false };

  const finding = await Finding.findOne({ where: { tenant_key: tenantKey, finding_key: waiver.finding_key } });
  if (finding) {
    // O achado volta a RISCO ABERTO. Antes só `waiver_id` era limpo e o status
    // permanecia `MITIGATED` — um estado que afirma isenção sem isenção vigente
    // (o evento já registrava `UNDER_INVESTIGATION`: estado e trilha divergiam).
    await finding.update({ waiver_id: null, status: 'UNDER_INVESTIGATION' });
    await getSecurityFindingEvent().create({
      tenant_key: tenantKey,
      finding_key: waiver.finding_key,
      advisory_id: waiver.advisory_id || null,
      event: 'WAIVER_REVOKED',
      from_status: finding.status,
      to_status: 'UNDER_INVESTIGATION',
      from_severity: finding.severity || null,
      to_severity: finding.severity || null,
      actor: actor || 'unknown',
      detail: { waiverRevoked: waiverKey, reason },
    });
  }

  return { waiver, revoked: true, mitigated: true };
}

/** Waivers VIGENTES: aprovados (`ACTIVE`), não revogados e ainda não expirados. */
async function getActiveWaivers({ tenantKey = 'system', now = new Date() } = {}) {
  await ensureConnected();
  const Waiver = getSecurityWaiver();
  const { Op } = require('sequelize');
  return Waiver.findAll({
    where: {
      tenant_key: tenantKey,
      status: WAIVER_STATUS.ACTIVE,
      revoked_at: null,
      expires_at: { [Op.gt]: now },
    },
    order: [['expires_at', 'ASC']],
  });
}

/**
 * Formato aceito pelo gate (`evaluateReleaseSecurity`): `{ findingKey, expiresAt }`.
 *
 * Revalida o ESCOPO contra o estado ATUAL do achado: waiver cujo escopo mudou
 * depois da aprovação (pacote, serviço, severidade ou prazo) NÃO é entregue ao
 * motor como isenção — vai para `rejected`, para o chamador registrar o motivo
 * em vez de isentar em silêncio. O gate também revalida a expiração por conta
 * própria (defesa em profundidade).
 */
async function waiversForGate({ tenantKey = 'system', now = new Date() } = {}) {
  const rows = await getActiveWaivers({ tenantKey, now });
  if (rows.length === 0) return { waivers: [], rejected: [] };

  const Finding = getSecurityFinding();
  const { Op } = require('sequelize');
  const findings = await Finding.findAll({
    where: { tenant_key: tenantKey, finding_key: { [Op.in]: rows.map((row) => row.finding_key) } },
  });
  const byKey = new Map(findings.map((row) => [row.finding_key, row]));

  const waivers = [];
  const rejected = [];
  for (const row of rows) {
    const finding = byKey.get(row.finding_key) || null;
    const currentScopeHash = computeScopeHash({
      findingKey: row.finding_key,
      advisoryId: finding ? finding.advisory_id : row.advisory_id,
      packageName: finding ? finding.package_name : row.package_name,
      service: finding ? finding.service : row.service,
      severity: finding ? finding.severity : row.severity,
      expiresAt: row.expires_at,
    });
    if (row.scope_hash && row.scope_hash !== currentScopeHash) {
      rejected.push({ waiverKey: row.waiver_key, findingKey: row.finding_key, reason: 'waiver_scope_changed' });
      continue;
    }
    waivers.push({
      findingKey: row.finding_key,
      expiresAt: row.expires_at,
      waiverKey: row.waiver_key,
      approvedBy: row.approved_by,
      reason: row.reason,
      scopeHash: row.scope_hash || null,
    });
  }
  return { waivers, rejected };
}

async function listWaivers({
  tenantKey = 'system',
  state = 'ACTIVE',
  limit = 100,
  offset = 0,
  now = new Date(),
} = {}) {
  await ensureConnected();
  const Waiver = getSecurityWaiver();
  const where = { tenant_key: tenantKey };
  if (state === 'REVOKED') where.revoked_at = { [require('sequelize').Op.not]: null };
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows, count } = await Waiver.findAndCountAll({
    where,
    order: [['expires_at', 'ASC']],
    limit: boundedLimit,
    offset: Math.max(Number(offset) || 0, 0),
  });
  const items = rows
    .map((row) => ({ ...row.toJSON(), state: stateOf(row, now) }))
    .filter((row) => (state === 'ALL' ? true : row.state === state));
  return { total: count, limit: boundedLimit, offset: Math.max(Number(offset) || 0, 0), items };
}

async function getWaiver(waiverKey, { tenantKey = 'system', now = new Date() } = {}) {
  if (!waiverKey) throw codedError('waiver_finding_key_required', 'waiverKey');
  await ensureConnected();
  const row = await getSecurityWaiver().findOne({ where: { tenant_key: tenantKey, waiver_key: waiverKey } });
  if (!row) return null;
  return { ...row.toJSON(), state: stateOf(row, now) };
}

module.exports = {
  DEFAULT_MAX_WAIVER_DAYS,
  MIN_REASON_LENGTH,
  WAIVER_STATUS,
  computeWaiverKey,
  computeScopeHash,
  normalizePrincipal,
  stateOf,
  normalizeCreation,
  requestWaiver,
  approveWaiver,
  revokeWaiver,
  getActiveWaivers,
  waiversForGate,
  listWaivers,
  getWaiver,
};
