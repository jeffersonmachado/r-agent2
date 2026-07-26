'use strict';

/**
 * Identificação de cliente de pedidos (customer_identification).
 *
 * Um pedido sem cliente vinculado é um órfão de negócio: não alimenta CRM,
 * retenção nem omnichannel. Este serviço resolve (ou cria) o cliente do
 * pedido como AccessSubject — a mesma entidade de cliente usada pelas
 * verticais (access-control) — a partir do telefone, que é a chave natural
 * dos canais (WhatsApp/storefront/balcão).
 *
 * O customerId é determinístico por (tenant, telefone normalizado): o mesmo
 * cliente em pedidos diferentes resolve para o mesmo subject, sem duplicar.
 */

const crypto = require('crypto');
const accessControlService = require('../modules/access-control/accessControlService');
const logger = require('../utils/logger');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function resolveCustomerId(tenantId, phone) {
  const digest = crypto
    .createHash('sha1')
    .update(`${tenantId}:${normalizePhone(phone)}`)
    .digest('hex')
    .slice(0, 16);
  return `cust-${digest}`;
}

/**
 * Resolve ou cria o cliente do pedido.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} [args.vertical] vertical da jornada (food, market, ...)
 * @param {string} [args.customerName]
 * @param {string} [args.customerPhone] chave natural; sem telefone não há
 *   como identificar o cliente — retorna null (pedido segue sem vínculo).
 * @param {string} [args.source] canal de origem (storefront, whatsapp, ...)
 * @returns {Promise<{ customerId: string, subjectId: string } | null>}
 */
async function ensureOrderCustomer({ tenantId, vertical = null, customerName = null, customerPhone = null, source = null } = {}) {
  if (!tenantId) {
    const err = new Error('tenantId required');
    err.code = 'missing_tenant';
    throw err;
  }
  if (!normalizePhone(customerPhone)) return null;

  const customerId = resolveCustomerId(tenantId, customerPhone);
  const subject = await accessControlService.ensureSubject({
    tenantId,
    customerId,
    verticalProfile: vertical || 'food',
    metadata: {
      name: customerName || null,
      phone: customerPhone,
      source: source || 'orders',
      identifiedBy: 'order_customer_service',
    },
  });

  logger.info('[OrderCustomer] cliente do pedido resolvido', {
    tenantId,
    customerId,
    subjectId: subject.id,
    vertical: vertical || 'food',
  });

  return { customerId, subjectId: subject.id };
}

module.exports = {
  ensureOrderCustomer,
  resolveCustomerId,
  normalizePhone,
};
