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
const HTTP_LIKE_CODES = Object.freeze({
  waiver_finding_key_required: 400,
  waiver_reason_required: 400,
  waiver_approver_required: 400,
  waiver_expiry_required: 400,
  waiver_expiry_not_in_future: 400,
  waiver_exceeds_max_days: 400,
  waiver_finding_not_found: 404,
  waiver_not_needed_for_vex_state: 409,
  waiver_not_found: 404,
});

function codedError(code, detail) {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  error.statusCode = HTTP_LIKE_CODES[code] || 400;
  return error;
}

function stateOf(row, now = new Date()) {
  if (row.revoked_at) return 'REVOKED';
  const expiry = new Date(row.expires_at);
  if (Number.isNaN(expiry.getTime())) return 'INVALID_EXPIRY';
  return expiry.getTime() > now.getTime() ? 'ACTIVE' : 'EXPIRED';
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
 * Valida a criação e devolve o que será gravado. Separado de `createWaiver` para
 * ser testável sem banco.
 */
function normalizeCreation({
  finding,
  findingKey,
  reason,
  approvedBy,
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
  const cleanApprover = String(approvedBy || '').trim();
  if (!cleanApprover) throw codedError('waiver_approver_required');

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
    approvedBy: cleanApprover,
    createdBy: createdBy || cleanApprover,
    expiresAt: expiry,
    compensatingControl: compensatingControl ? String(compensatingControl).trim() : null,
    maxWaiverDays: Number(maxWaiverDays),
  };
}

/**
 * Cria o waiver, liga-o ao achado e registra o evento (append-only).
 *
 * O evento é o que torna a decisão auditável na linha do tempo do achado: quem
 * aceitou, por quê, por quanto tempo.
 */
async function createWaiver({
  tenantKey = 'system',
  findingKey,
  reason,
  approvedBy,
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
    finding, findingKey, reason, approvedBy, createdBy,
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
        approved_by: normalized.approvedBy,
        created_by: normalized.createdBy,
        expires_at: normalized.expiresAt,
        metadata: { maxWaiverDays: normalized.maxWaiverDays, criteria: 'human_waiver_with_expiry' },
      },
      ...(tx || {}),
    });

    await finding.update({ waiver_id: waiver.id, status: 'MITIGATED' }, tx);
    await getSecurityFindingEvent().create({
      tenant_key: tenantKey,
      finding_key: findingKey,
      advisory_id: finding.advisory_id || null,
      event: 'WAIVER_APPLIED',
      from_status: finding.status,
      to_status: 'MITIGATED',
      from_severity: finding.severity || null,
      to_severity: finding.severity || null,
      actor: normalized.approvedBy,
      detail: {
        reason: normalized.reason,
        expiresAt: normalized.expiresAt.toISOString(),
        compensatingControl: normalized.compensatingControl,
        waiverKey,
      },
    }, tx);

    return { waiver, created };
  });

  return { ...outcome, waiverKey };
}

/** Revoga sem apagar: histórico permanece, isenção deixa de valer. */
async function revokeWaiver({ waiverKey, tenantKey = 'system', actor, reason = null } = {}) {
  if (!waiverKey) throw codedError('waiver_finding_key_required', 'waiverKey');
  await ensureConnected();
  const Waiver = getSecurityWaiver();
  const Finding = getSecurityFinding();

  const waiver = await Waiver.findOne({ where: { tenant_key: tenantKey, waiver_key: waiverKey } });
  if (!waiver) throw codedError('waiver_not_found', waiverKey);
  const alreadyRevoked = Boolean(waiver.revoked_at);
  if (alreadyRevoked) return { waiver, revoked: false, reason: 'already_revoked' };

  await waiver.update({
    revoked_at: new Date(),
    revoked_by: actor || 'unknown',
    revoke_reason: reason,
  });

  const finding = await Finding.findOne({ where: { tenant_key: tenantKey, finding_key: waiver.finding_key } });
  if (finding) {
    await finding.update({ waiver_id: null });
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

  return { waiver, revoked: true };
}

/** Waivers vigentes: não revogados e ainda não expirados. */
async function getActiveWaivers({ tenantKey = 'system', now = new Date() } = {}) {
  await ensureConnected();
  const Waiver = getSecurityWaiver();
  const { Op } = require('sequelize');
  return Waiver.findAll({
    where: {
      tenant_key: tenantKey,
      revoked_at: null,
      expires_at: { [Op.gt]: now },
    },
    order: [['expires_at', 'ASC']],
  });
}

/**
 * Formato aceito pelo gate (`evaluateReleaseSecurity`): `findingKey` +
 * `expiresAt`. O gate revalida a expiração por conta própria — defesa em
 * profundidade, e o motivo de existir `waiverExemption` no motor.
 */
async function waiversForGate({ tenantKey = 'system', now = new Date() } = {}) {
  const rows = await getActiveWaivers({ tenantKey, now });
  return rows.map((row) => ({
    findingKey: row.finding_key,
    expiresAt: row.expires_at,
    waiverKey: row.waiver_key,
    approvedBy: row.approved_by,
    reason: row.reason,
  }));
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
  computeWaiverKey,
  stateOf,
  normalizeCreation,
  createWaiver,
  revokeWaiver,
  getActiveWaivers,
  waiversForGate,
  listWaivers,
  getWaiver,
};
