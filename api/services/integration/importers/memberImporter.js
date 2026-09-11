'use strict';

/**
 * Importador de PESSOAS: EVO member/prospect → MarketingLead → WorkspaceEntity
 * → AccessSubject.
 *
 * Reusa integralmente o CRM e o Workspace existentes (nenhum CRM paralelo).
 *
 * Identidade (missão §8/§9):
 * - a chave de sincronização é o `IntegrationObjectLink` (tenant+provider+
 *   connection+resource+external_id);
 * - e-mail/telefone são APOIO CONTROLADO apenas na PRIMEIRA vinculação;
 * - se o lead candidato já pertence a OUTRA identidade externa, NÃO há fusão:
 *   registra-se conflito e cria-se uma identidade própria para o novo membro.
 */

const {
  buildContext, findExistingLink, persistLink, recordConflict, createStats,
  supportIdentityFields, ensureInternalId, requireDependency,
} = require('./importerSupport');

const RESOURCE_MEMBERS = 'members';
const RESOURCE_PROSPECTS = 'prospects';

function defaultDeps() {
  // `WorkspaceEntityService` é uma classe com injeção de dependências (mesmo
  // padrão de `WorkspaceOperationsService`); sem deps os models vêm dos defaults.
  const WorkspaceEntityService = require('../../workspace/WorkspaceEntityService');
  return {
    marketingService: require('../../marketing/marketingService'),
    accessControlService: require('../../../modules/access-control/accessControlService'),
    workspaceEntityService: new WorkspaceEntityService({}),
    linkService: require('../integrationObjectLinkService'),
    MarketingLeadModel: require('../../../db/models').MarketingLead,
    logger: require('../../../utils/logger'),
  };
}

/**
 * Escolhe deterministicamente o lead candidato para primeira vinculação:
 * ordena por `created_at` e `id` (estável), nunca por heurística de similaridade.
 */
async function findLeadCandidates({ MarketingLeadModel, tenantId, email, phoneDigits }) {
  if (!MarketingLeadModel || (!email && !phoneDigits)) return [];
  const Model = MarketingLeadModel();
  const conditions = [];
  if (email) conditions.push({ tenant_key: tenantId, email });
  if (phoneDigits) {
    conditions.push({ tenant_key: tenantId, phone: { [require('sequelize').Op.like]: `%${phoneDigits}%` } });
  }
  const rows = await Model.findAll({ where: { [require('sequelize').Op.or]: conditions }, order: [['created_at', 'ASC'], ['id', 'ASC']] });
  return rows.map((row) => (row.toJSON ? row.toJSON() : row));
}

/** Verifica se o lead já pertence a outra identidade externa do mesmo provider. */
async function leadAlreadyLinked({ linkService, ctx, leadId }) {
  const link = await linkService.resolveExternal({
    tenantId: ctx.tenantId,
    provider: ctx.provider,
    connectionId: ctx.connectionId,
    internalType: 'MarketingLead',
    internalId: leadId,
  });
  return link || null;
}

/**
 * Importa um membro/prospect.
 *
 * @returns {Promise<{ outcome: 'created'|'updated'|'unchanged', internalId: string, leadId: string, subjectId?: string }>}
 */
async function importPerson({ record, resourceType, tenantId, connectionId, connection, deps = null, stats = null }) {
  const d = deps || defaultDeps();
  const marketingService = requireDependency(d, 'marketingService');
  const accessControlService = requireDependency(d, 'accessControlService');
  const linkService = requireDependency(d, 'linkService');
  const workspaceEntityService = requireDependency(d, 'workspaceEntityService');

  const ctx = buildContext({ tenantId, provider: 'evo', connectionId, connection, stats });
  const normalizedResource = resourceType === RESOURCE_PROSPECTS ? RESOURCE_PROSPECTS : RESOURCE_MEMBERS;
  const isProspect = normalizedResource === RESOURCE_PROSPECTS;
  const externalId = String(record.externalId);

  if (!record.name && !record.email && !record.phone) {
    // Sem nenhum identificador humano não há lead útil: rejeitado explicitamente.
    return { outcome: 'rejected', reason: 'member_without_identity_fields', externalId };
  }

  const existingLink = await findExistingLink({ linkService, ctx, resourceType: normalizedResource, externalId });
  if (existingLink) {
    // Já mapeado: atualiza apenas dados de contato que chegaram.
    const { ok, lead, created } = await marketingService.upsertLead({
      tenantId: ctx.tenantId,
      email: record.email || null,
      phone: record.phone || null,
      name: record.name || null,
      attributesPatch: isProspect
        ? { evoProspectStage: record.stage, evoExternalId: externalId }
        : { evoMemberStatus: record.status, evoExternalId: externalId },
    });
    if (!ok) return { outcome: 'rejected', reason: `lead_upsert_failed:${lead || 'unknown'}`, externalId };
    await persistLink({
      linkService, ctx, resourceType: normalizedResource, externalId,
      internalType: 'MarketingLead', internalId: lead.id,
      metadata: { ...existingLink.metadata, lastSeenAt: new Date().toISOString() },
    });
    return { outcome: created ? 'created' : 'updated', internalId: lead.id, leadId: lead.id, subjectId: existingLink.metadata && existingLink.metadata.accessSubjectId ? existingLink.metadata.accessSubjectId : undefined };
  }

  // ── Primeira vinculação ────────────────────────────────────────────────
  const { email, phoneDigits } = supportIdentityFields({ email: record.email, phone: record.phone });
  const candidates = await findLeadCandidates({ MarketingLeadModel: d.MarketingLeadModel, tenantId: ctx.tenantId, email, phoneDigits });

  let matchedLead = null;
  let matchedBy = null;
  if (candidates.length > 0) {
    const candidate = candidates[0]; // determinístico: mais antigo, id desempata
    const conflictingLink = await leadAlreadyLinked({ linkService, ctx, leadId: candidate.id });
    if (conflictingLink) {
      recordConflict({
        stats, logger: d.logger, ctx,
        reason: 'person_already_linked_to_other_external_identity',
        resourceType: normalizedResource,
        externalId,
        candidates: [{ leadId: candidate.id, conflictingExternalId: conflictingLink.external_id }],
      });
      // Não funde: segue para criação de identidade própria.
    } else {
      matchedLead = candidate;
      matchedBy = email && candidate.email === email ? 'email' : 'phone';
    }
  }

  let lead = matchedLead;
  if (!lead) {
    const { ok, lead: upserted, created } = await marketingService.upsertLead({
      tenantId: ctx.tenantId,
      email: record.email || null,
      phone: record.phone || null,
      name: record.name || null,
      attributesPatch: {
        evoExternalId: externalId,
        integrationSource: 'evo',
        ...(isProspect ? { evoProspectStage: record.stage } : { evoMemberStatus: record.status }),
      },
      stage: isProspect ? 'lead' : 'customer',
    });
    if (!ok) return { outcome: 'rejected', reason: `lead_upsert_failed:${upserted || 'unknown'}`, externalId };
    lead = upserted;
    if (!created) {
      // upsertLead pode ter casado por e-mail/telefone: revalida o conflito.
      const conflictingLink = await leadAlreadyLinked({ linkService, ctx, leadId: lead.id });
      if (conflictingLink) {
        recordConflict({
          stats, logger: d.logger, ctx,
          reason: 'person_already_linked_to_other_external_identity',
          resourceType: normalizedResource,
          externalId,
          candidates: [{ leadId: lead.id, conflictingExternalId: conflictingLink.external_id }],
        });
        return { outcome: 'rejected', reason: 'identity_conflict_requires_support_handling', externalId, leadId: lead.id };
      }
      matchedLead = lead;
      matchedBy = email || phoneDigits ? 'email_or_phone' : null;
    }
  }

  // Workspace: entidade canônica + vínculo com o lead (reuso total).
  const entity = await workspaceEntityService.getOrCreateEntityFromContact({
    tenantId: ctx.tenantId,
    contact: {
      name: record.name || null,
      email: record.email || null,
      phone: record.phone || null,
      source: `integration:${ctx.provider}`,
      type: isProspect ? 'prospect' : 'contact',
      refId: `${ctx.connectionId}:${externalId}`,
    },
  });
  if (entity && entity.id) {
    await workspaceEntityService.linkEntity({ tenantId: ctx.tenantId, entityId: entity.id, sourceType: 'lead', sourceId: lead.id, confidence: 1 });
  }

  // AccessSubject: identidade de acesso do RAP. `customer_id` = MarketingLead.id
  // (identidade interna do RAP), nunca o id externo do provedor.
  const subject = await accessControlService.ensureSubject({
    tenantId: ctx.tenantId,
    customerId: String(lead.id),
    verticalProfile: 'fitness',
    metadata: {
      name: record.name || null,
      phone: record.phone || null,
      email: record.email || null,
      leadId: lead.id,
      source: 'integration',
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      externalResourceType: normalizedResource,
      externalId,
    },
  });

  const internalId = matchedLead ? String(matchedLead.id) : String(lead.id);
  await persistLink({
    linkService, ctx, resourceType: normalizedResource, externalId,
    internalType: 'MarketingLead', internalId,
    metadata: {
      matchedBy: matchedBy || 'created',
      workspaceEntityId: entity && entity.id ? entity.id : null,
      accessSubjectId: subject && subject.id ? subject.id : null,
      adoptedExistingLead: Boolean(matchedLead),
    },
  });

  // Vínculo do subject também fica rastreável por resource próprio, para que
  // memberships/entries resolvam a identidade de acesso sem re-derivar.
  if (subject && subject.id) {
    await persistLink({
      linkService, ctx, resourceType: `${normalizedResource}_subject`, externalId,
      internalType: 'AccessSubject', internalId: String(subject.id),
      metadata: { derivedFrom: normalizedResource },
    });
  }

  return {
    outcome: 'created',
    internalId,
    leadId: lead.id,
    subjectId: subject && subject.id ? subject.id : undefined,
    deterministicId: ensureInternalId({ ctx, resourceType: normalizedResource, externalId, prefix: isProspect ? 'prosp' : 'member' }),
  };
}

module.exports = {
  importPerson,
  findLeadCandidates,
  RESOURCE_MEMBERS,
  RESOURCE_PROSPECTS,
  createStats,
};
