'use strict';

/**
 * Importador FINANCEIRO: EVO sale/receivable → BillingTransaction.
 *
 * Arquitetura canônica preservada (missão §12):
 *   EVO → BillingTransaction → evento canônico → projeção Workspace/PaymentEvent.
 *
 * Sem dual-write inconsistente: `PaymentEvent` é escrito SÓ pela projeção
 * canônica (`WorkspaceOperationsService.createPaymentEvent`), nunca em paralelo
 * pela integração.
 *
 * Idempotência: vínculo externo + dedup por (tenant, provider,
 * external_transaction_id). NÃO usa `billingService.createCharge`, que é o
 * fluxo de SOLICITAR cobrança (com notificação e transição de billing) e não de
 * importar transação já existente no provedor.
 */

const { getSequelize } = require('../../../db/sequelize');
const { BillingTransaction } = require('../../../db/models');
const { appendEventV1 } = require('../../eventLedgerService');
const {
  buildContext, findExistingLink, persistLink, createStats, ensureInternalId,
} = require('./importerSupport');
const { isUniqueViolation } = require('../integrationDb');
const { IntegrationError, INTEGRATION_ERROR_CODES } = require('../integrationRedaction');

const RESOURCE_SALES = 'sales';
const RESOURCE_RECEIVABLES = 'receivables';

/** Status do provedor → status canônico de BillingTransaction. */
const TRANSACTION_STATUS = Object.freeze({
  paid: 'paid',
  pending: 'pending',
  overdue: 'overdue',
  cancelled: 'cancelled',
  refunded: 'refunded',
});

function defaultDeps() {
  return {
    BillingTransactionModel: BillingTransaction,
    linkService: require('../integrationObjectLinkService'),
    workspaceOperationsService: require('../../workspace/WorkspaceOperationsService'),
    appendEventV1,
    logger: require('../../../utils/logger'),
  };
}

function normalizeTransactionStatus(value) {
  const key = value === null || value === undefined ? 'pending' : String(value).trim().toLowerCase();
  return TRANSACTION_STATUS[key] || 'pending';
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Resolve o cliente (MarketingLead) do membro para associar a transação. */
async function resolveCustomerId({ linkService, ctx, memberExternalId }) {
  if (!memberExternalId) return null;
  const memberLink = await findExistingLink({ linkService, ctx, resourceType: 'members', externalId: memberExternalId });
  return memberLink ? memberLink.internal_id : null;
}

/**
 * Importa uma transação (venda ou recebível).
 *
 * @returns {Promise<{ outcome: 'created'|'unchanged'|'rejected', reason?: string, internalId?: string }>}
 */
async function importTransaction({ record, resourceType, tenantId, connectionId, connection, deps = null, stats = null }) {
  const d = deps || defaultDeps();
  const linkService = requireDependencySafe(d, 'linkService');
  const Model = typeof d.BillingTransactionModel === 'function' ? d.BillingTransactionModel() : d.BillingTransactionModel;
  if (!Model) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.DB_UNAVAILABLE, 'BillingTransaction indisponível');
  }

  const ctx = buildContext({ tenantId, provider: 'evo', connectionId, connection, stats });
  const resource = resourceType === RESOURCE_RECEIVABLES ? RESOURCE_RECEIVABLES : RESOURCE_SALES;
  const externalId = String(record.externalId);
  const providerId = 'evo';

  const existingLink = await findExistingLink({ linkService, ctx, resourceType: resource, externalId });
  if (existingLink) return { outcome: 'unchanged', internalId: existingLink.internal_id };

  if (record.amount === null || record.amount === undefined) {
    return { outcome: 'rejected', reason: 'transaction_without_amount', externalId };
  }
  const amount = Number(record.amount);
  if (!Number.isFinite(amount)) {
    return { outcome: 'rejected', reason: 'transaction_invalid_amount', externalId };
  }
  // Valor negativo é semanticamente válido (estorno/crédito) e é preservado;
  // apenas é marcado para conferência.
  const amountNegative = amount < 0;

  const status = normalizeTransactionStatus(record.status);
  const dueAt = toDateOrNull(record.dueAt);
  const paidAt = toDateOrNull(record.paidAt);
  const customerId = await resolveCustomerId({ linkService, ctx, memberExternalId: record.memberExternalId });

  const internalId = ensureInternalId({ ctx, resourceType: resource, externalId, prefix: resource === RESOURCE_SALES ? 'bsale' : 'brecv' });
  const occurredAt = toDateOrNull(record.occurredAt);

  // Dedup por chave de negócio do provedor: escopada por tenant (o índice do
  // banco NÃO pode ser usado como chave global — external ids colidem entre
  // tenants/conexões).
  const existingByProvider = await Model.findOne({
    where: { tenant_key: ctx.tenantId, provider: providerId, external_transaction_id: externalId },
  }).catch(() => null);
  if (existingByProvider) {
    const plain = existingByProvider.toJSON ? existingByProvider.toJSON() : existingByProvider;
    await persistLink({
      linkService, ctx, resourceType: resource, externalId,
      internalType: 'BillingTransaction', internalId: String(plain.id),
      metadata: { adoptedExistingTransaction: true, customerId },
    });
    return { outcome: 'unchanged', internalId: String(plain.id) };
  }

  const now = new Date();
  const rowPayload = {
    id: internalId,
    tenant_key: ctx.tenantId,
    vertical: 'fitness',
    membership_id: null,
    bundle_id: null,
    subject_id: null,
    customer_id: customerId,
    provider: providerId,
    type: resource === RESOURCE_SALES ? 'one_time' : 'receivable',
    amount,
    currency: record.currency || 'BRL',
    status,
    due_at: dueAt,
    paid_at: paidAt,
    external_customer_id: record.memberExternalId || null,
    external_transaction_id: externalId,
    external_subscription_id: null,
    idempotency_key: `integration:${ctx.provider}:${ctx.connectionId}:${resource}:${externalId}`,
    metadata: {
      source: 'integration',
      connectionId: ctx.connectionId,
      externalResourceType: resource,
      externalSaleId: record.saleExternalId || null,
      occurredAt: occurredAt ? occurredAt.toISOString() : null,
      importedAt: now.toISOString(),
      amountNegative,
      externalUnitId: (ctx.connection && ctx.connection.external_unit_id) || null,
    },
  };

  let created;
  try {
    created = await Model.create(rowPayload);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await Model.findOne({ where: { tenant_key: ctx.tenantId, idempotency_key: rowPayload.idempotency_key } });
      if (raced) {
        const plain = raced.toJSON ? raced.toJSON() : raced;
        await persistLink({
          linkService, ctx, resourceType: resource, externalId,
          internalType: 'BillingTransaction', internalId: String(plain.id),
          metadata: { adoptedExistingTransaction: true, customerId },
        });
        return { outcome: 'unchanged', internalId: String(plain.id) };
      }
    }
    throw error;
  }

  const transaction = created.toJSON ? created.toJSON() : created;

  // Evento canônico (idempotente pelo ledger).
  const appendEvent = d.appendEventV1 || appendEventV1;
  await appendEvent({
    tenantId: ctx.tenantId,
    type: 'integration.transaction.imported',
    source: 'integration.billing',
    occurredAt: occurredAt || now,
    correlationId: String(transaction.id),
    subject: { type: 'billing_transaction', id: String(transaction.id) },
    actor: { type: 'integration', id: ctx.provider },
    idempotencyKey: `integration:${ctx.provider}:${ctx.connectionId}:${resource}:${externalId}`,
    payload: {
      provider: ctx.provider,
      connectionId: ctx.connectionId,
      resourceType: resource,
      externalTransactionId: externalId,
      status,
      amount,
      currency: rowPayload.currency,
      customerId,
    },
  }).catch(() => {});

  // Projeção canônica no Workspace: `PaymentEvent` é escrito SÓ por
  // `WorkspaceOperationsService.createPaymentEvent` (fluxo canônico existente),
  // e apenas quando existe entidade de workspace e a transação está paga.
  if (status === 'paid' && customerId) {
    try {
      const WorkspaceEntityLinkModel = d.WorkspaceEntityLinkModel
        ? d.WorkspaceEntityLinkModel()
        : require('../../../db/models').WorkspaceEntityLink();
      const entityLink = await WorkspaceEntityLinkModel.findOne({
        where: { tenant_id: ctx.tenantId, source_type: 'lead', source_id: String(customerId) },
      });
      const workspaceOperationsService = d.workspaceOperationsService || require('../../workspace/WorkspaceOperationsService');
      if (entityLink && typeof workspaceOperationsService.createPaymentEvent === 'function') {
        await workspaceOperationsService.createPaymentEvent({
          tenantId: ctx.tenantId,
          payload: {
            entityId: entityLink.entity_id,
            amount,
            status: 'paid',
            type: 'payment',
            metadata: {
              source: 'integration',
              provider: ctx.provider,
              connectionId: ctx.connectionId,
              externalTransactionId: externalId,
              billingTransactionId: String(transaction.id),
            },
          },
        });
      }
    } catch (error) {
      // Projeção é best-effort e NUNCA engole a falha: loga sanitizado.
      if (d.logger && d.logger.warn) {
        d.logger.warn('[Integration] falha ao projetar PaymentEvent', {
          transactionId: String(transaction.id),
          code: error && error.code ? error.code : 'unknown',
        });
      }
    }
  }

  await persistLink({
    linkService, ctx, resourceType: resource, externalId,
    internalType: 'BillingTransaction', internalId: String(transaction.id),
    metadata: { customerId, status, externalSaleId: record.saleExternalId || null },
  });

  return { outcome: 'created', internalId: String(transaction.id) };
}

function requireDependencySafe(deps, key) {
  if (!deps || !deps[key]) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, `importador financeiro sem dependência: ${key}`, { key });
  }
  return deps[key];
}

module.exports = {
  importTransaction,
  normalizeTransactionStatus,
  resolveCustomerId,
  RESOURCE_SALES,
  RESOURCE_RECEIVABLES,
  TRANSACTION_STATUS,
  createStats,
};
