'use strict';

/**
 * Importador de MATRÍCULA: EVO membership → AccessMembership.
 *
 * Preserva a identidade interna do RAP: o id da matrícula é determinístico
 * (derivado do escopo tenant+provider+conexão+recurso+id externo) e NUNCA é o
 * id externo do EVO. O vínculo fica em `IntegrationObjectLink`.
 *
 * Campos mapeados são apenas os semanticamente compatíveis e existentes no
 * domínio: plan_name, plan_type, status, billing_status, start_at, end_at,
 * due_date, renewal_at. Nada de despejar o JSON do provedor em metadata.
 */

const {
  buildContext, findExistingLink, persistLink, createStats, ensureInternalId, requireDependency,
} = require('./importerSupport');

const RESOURCE = 'memberships';

function defaultDeps() {
  return {
    accessControlService: require('../../../modules/access-control/accessControlService'),
    fitnessMembershipService: require('../../vertical/fitnessMembershipService'),
    billingOrchestrationService: require('../../vertical/billingOrchestrationService'),
    linkService: require('../integrationObjectLinkService'),
    logger: require('../../../utils/logger'),
  };
}

/** Campos de detalhe sincronizados a partir do provedor (allowlist explícita). */
function buildDetailPatch(record) {
  const patch = {};
  if (record.planName !== null && record.planName !== undefined) patch.plan_name = record.planName;
  if (record.planType !== null && record.planType !== undefined) patch.plan_type = record.planType;
  if (record.startAt !== null && record.startAt !== undefined) patch.start_at = record.startAt;
  if (record.endAt !== null && record.endAt !== undefined) patch.end_at = record.endAt;
  if (record.dueDate !== null && record.dueDate !== undefined) patch.due_date = record.dueDate;
  if (record.renewalAt !== null && record.renewalAt !== undefined) patch.renewal_at = record.renewalAt;
  return patch;
}

/**
 * @returns {Promise<{ outcome: 'created'|'updated'|'unchanged'|'rejected', reason?: string, internalId?: string }>}
 */
async function importMembership({ record, tenantId, connectionId, connection, deps = null, stats = null }) {
  const d = deps || defaultDeps();
  const accessControlService = requireDependency(d, 'accessControlService');
  const fitnessMembershipService = requireDependency(d, 'fitnessMembershipService');
  const billingOrchestrationService = requireDependency(d, 'billingOrchestrationService');
  const linkService = requireDependency(d, 'linkService');

  const ctx = buildContext({ tenantId, provider: 'evo', connectionId, connection, stats });
  const externalId = String(record.externalId);
  const memberExternalId = String(record.memberExternalId);

  // A matrícula depende do aluno: sem vínculo do membro não há como amarrar a
  // identidade de acesso. Rejeita explicitamente (a ordem do initial sync é
  // members → memberships, então isso só ocorre com dado inconsistente).
  const memberLink = await findExistingLink({ linkService, ctx, resourceType: 'members', externalId: memberExternalId });
  if (!memberLink) {
    return { outcome: 'rejected', reason: 'member_not_linked', externalId };
  }
  const subjectLink = await findExistingLink({ linkService, ctx, resourceType: 'members_subject', externalId: memberExternalId });
  const subjectId = subjectLink ? subjectLink.internal_id : null;
  if (!subjectId) {
    return { outcome: 'rejected', reason: 'access_subject_not_linked', externalId };
  }

  const existingLink = await findExistingLink({ linkService, ctx, resourceType: RESOURCE, externalId });
  const internalId = existingLink
    ? existingLink.internal_id
    : ensureInternalId({ ctx, resourceType: RESOURCE, externalId, prefix: 'amem' });

  const created = await accessControlService.upsertMembership({
    tenantId: ctx.tenantId,
    subjectId,
    membershipId: internalId,
    vertical: 'fitness',
    customerId: memberLink.internal_id,
    planName: record.planName || null,
    billingStatus: record.billingStatus || 'active',
    status: record.status || 'active',
    unitScope: record.unitId ? [String(record.unitId)] : [],
    metadata: {
      source: 'integration',
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      externalMembershipId: externalId,
      externalPlanId: record.planExternalId || null,
    },
  });

  if (!created) return { outcome: 'rejected', reason: 'membership_upsert_failed', externalId };

  // Detalhes estruturais (datas/tipo) via serviço canônico, com allowlist.
  const detailPatch = buildDetailPatch(record);
  let detailsUpdated = false;
  if (Object.keys(detailPatch).length > 0) {
    try {
      await fitnessMembershipService.updateMembershipDetails({
        tenantId: ctx.tenantId,
        membershipId: internalId,
        fields: detailPatch,
      });
      detailsUpdated = true;
    } catch (error) {
      if (error && error.code === 'no_fields_to_update') {
        detailsUpdated = false;
      } else {
        throw error;
      }
    }
  }

  // Billing: usa a máquina de estados canônica quando a transição é válida;
  // caso contrário registra no vínculo para tratamento (nunca força estado).
  let billingApplied = false;
  const desiredBilling = record.billingStatus || null;
  if (desiredBilling) {
    const current = await fitnessMembershipService.getMembershipDetail({ tenantId: ctx.tenantId, membershipId: internalId });
    const currentBilling = current ? current.billing_status : null;
    if (currentBilling !== desiredBilling) {
      try {
        await billingOrchestrationService.updateBillingStatus({
          tenantId: ctx.tenantId,
          membershipId: internalId,
          toStatus: desiredBilling,
          reason: 'integration_sync',
          actor: `integration:${ctx.provider}`,
        });
        billingApplied = true;
      } catch (error) {
        if (!error || error.code !== 'invalid_billing_transition') throw error;
        if (d.logger && d.logger.warn) {
          d.logger.warn('[Integration] transição de billing inválida ignorada no import', {
            membershipId: internalId, from: currentBilling, to: desiredBilling,
          });
        }
      }
    }
  }

  const priorMetadata = existingLink && existingLink.metadata ? existingLink.metadata : {};
  await persistLink({
    linkService, ctx, resourceType: RESOURCE, externalId,
    internalType: 'AccessMembership', internalId,
    metadata: {
      ...priorMetadata,
      accessSubjectId: subjectId,
      externalPlanId: record.planExternalId || null,
      lastSeenAt: new Date().toISOString(),
    },
  });

  return {
    outcome: existingLink ? (detailsUpdated || billingApplied ? 'updated' : 'unchanged') : 'created',
    internalId,
  };
}

/**
 * Importa o catálogo de planos de forma BOUNDED (referência operacional).
 * Não cria domínio paralelo: os planos do EVO são a autoridade; guardamos
 * apenas um catálogo curado e limitado para exibição/diagnóstico.
 */
const PLAN_CATALOG_LIMIT = 500;

function mergePlanCatalog(existingCatalog, records) {
  const catalog = Array.isArray(existingCatalog) ? [...existingCatalog] : [];
  const byId = new Map(catalog.map((plan) => [String(plan.externalId), plan]));
  for (const record of records) {
    byId.set(String(record.externalId), {
      externalId: String(record.externalId),
      name: record.name || null,
      type: record.type || null,
      amount: record.amount === undefined ? null : record.amount,
      cycle: record.cycle || null,
      active: record.active !== false,
    });
  }
  return [...byId.values()].slice(0, PLAN_CATALOG_LIMIT);
}

module.exports = {
  importMembership,
  buildDetailPatch,
  mergePlanCatalog,
  PLAN_CATALOG_LIMIT,
  RESOURCE,
  createStats,
};
