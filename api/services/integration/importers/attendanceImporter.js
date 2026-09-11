'use strict';

/**
 * Importador de CHECK-IN: EVO entry → VerticalAttendance.
 *
 * Idempotência dupla (determinística):
 *  1. vínculo `IntegrationObjectLink` (entry externo → attendance interna);
 *  2. dedup factual por (tenant, subject, checked_in_at) no serviço canônico
 *     `fitnessAttendanceService.recordExternalCheckIn`.
 *
 * Assim, reimportar o MESMO período ou uma janela SOBREPOSTA não duplica
 * frequência — requisito explícito da missão.
 */

const {
  buildContext, findExistingLink, persistLink, createStats, requireDependency,
} = require('./importerSupport');

const RESOURCE = 'entries';

function defaultDeps() {
  return {
    fitnessAttendanceService: require('../../vertical/fitnessAttendanceService'),
    linkService: require('../integrationObjectLinkService'),
    accessControlService: require('../../../modules/access-control/accessControlService'),
    logger: require('../../../utils/logger'),
  };
}

/** Resolve a identidade de acesso do aluno a partir dos vínculos do membro. */
async function resolveSubjectForEntry({ linkService, ctx, memberExternalId }) {
  const subjectLink = await findExistingLink({ linkService, ctx, resourceType: 'members_subject', externalId: memberExternalId });
  if (subjectLink) return subjectLink.internal_id;
  const memberLink = await findExistingLink({ linkService, ctx, resourceType: 'members', externalId: memberExternalId });
  if (memberLink && memberLink.metadata && memberLink.metadata.accessSubjectId) return memberLink.metadata.accessSubjectId;
  return null;
}

/**
 * @returns {Promise<{ outcome: 'created'|'unchanged'|'rejected', reason?: string, internalId?: string }>}
 */
async function importEntry({ record, tenantId, connectionId, connection, deps = null, stats = null }) {
  const d = deps || defaultDeps();
  const attendanceService = requireDependency(d, 'fitnessAttendanceService');
  const linkService = requireDependency(d, 'linkService');

  const ctx = buildContext({ tenantId, provider: 'evo', connectionId, connection, stats });
  const externalId = String(record.externalId);
  const memberExternalId = String(record.memberExternalId);

  const existingLink = await findExistingLink({ linkService, ctx, resourceType: RESOURCE, externalId });
  if (existingLink) return { outcome: 'unchanged', internalId: existingLink.internal_id };

  if (!record.occurredAt) {
    return { outcome: 'rejected', reason: 'entry_without_occurred_at', externalId };
  }

  const subjectId = await resolveSubjectForEntry({ linkService, ctx, memberExternalId });
  if (!subjectId) {
    // Sem aluno vinculado a entrada é um órfão: rejeita explicitamente e o
    // serviço de sync contabiliza (nunca cria presença sem identidade).
    return { outcome: 'rejected', reason: 'access_subject_not_linked', externalId };
  }

  const idempotencyKey = `integration:${ctx.provider}:${ctx.connectionId}:entry:${externalId}`;
  const { attendance, created } = await attendanceService.recordExternalCheckIn({
    tenantId: ctx.tenantId,
    subjectId,
    membershipId: null,
    unitId: record.unitId || (ctx.connection && ctx.connection.external_unit_id) || null,
    deviceId: record.deviceId || null,
    occurredAt: record.occurredAt,
    idempotencyKey,
    integrationMetadata: {
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      externalEntryId: externalId,
    },
  });

  const attendanceId = attendance && attendance.id ? attendance.id : null;
  if (!attendanceId) return { outcome: 'rejected', reason: 'attendance_not_persisted', externalId };

  await persistLink({
    linkService, ctx, resourceType: RESOURCE, externalId,
    internalType: 'VerticalAttendance', internalId: String(attendanceId),
    metadata: { subjectId, externalMemberId: memberExternalId, occurredAt: record.occurredAt },
  });

  return { outcome: created ? 'created' : 'unchanged', internalId: String(attendanceId) };
}

module.exports = {
  importEntry,
  resolveSubjectForEntry,
  RESOURCE,
  createStats,
};
