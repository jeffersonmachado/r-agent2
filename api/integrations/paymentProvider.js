'use strict';

const logger = require('../utils/logger');
const config = require('../utils/config');

const PROVIDER_ASAAS = 'asaas';
const PROVIDER_MERCADO_PAGO = 'mercado_pago';

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function requireConfig(path) {
  const value = config.getFromFile(path);
  if (isBlank(value)) {
    const err = new Error(`required_config_missing:${path}`);
    err.code = 'required_config_missing';
    throw err;
  }
  return String(value).trim();
}

function normalizeProvider(value) {
  const configured = config.getFromFile('billing.provider');
  const raw = String(value || configured || '').trim().toLowerCase();
  if (!raw) {
    const err = new Error('required_config_missing:billing.provider');
    err.code = 'required_config_missing';
    throw err;
  }
  if (raw === 'mercadopago' || raw === 'mercado-pago' || raw === 'mp') return PROVIDER_MERCADO_PAGO;
  if (raw === PROVIDER_ASAAS) return PROVIDER_ASAAS;
  const err = new Error(`invalid_payment_provider:${raw}`);
  err.code = 'invalid_payment_provider';
  throw err;
}

function providerConfig(provider) {
  if (provider === PROVIDER_MERCADO_PAGO) {
    return {
      provider,
      baseUrl: requireConfig('billing.providers.mercadoPago.baseUrl'),
      apiKey: requireConfig('billing.providers.mercadoPago.accessToken'),
      webhookSecret: requireConfig('billing.providers.mercadoPago.webhookSecret'),
    };
  }
  return {
    provider,
    baseUrl: requireConfig('billing.providers.asaas.baseUrl'),
    apiKey: requireConfig('billing.providers.asaas.apiKey'),
    webhookSecret: requireConfig('billing.providers.asaas.webhookSecret'),
  };
}

function providerHeaders(cfg, idempotencyKey) {
  if (cfg.provider === PROVIDER_MERCADO_PAGO) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    };
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    return headers;
  }
  const headers = {
    'Content-Type': 'application/json',
    access_token: cfg.apiKey,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return headers;
}

async function providerRequest({ cfg, method, path, body, idempotencyKey }) {
  if (!cfg.apiKey) {
    const err = new Error(`payment_provider_not_configured:${cfg.provider}`);
    err.code = 'payment_provider_not_configured';
    throw err;
  }

  const url = `${cfg.baseUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: providerHeaders(cfg, idempotencyKey),
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || data?.cause?.[0]?.description || `provider_http_${response.status}`;
    const err = new Error(String(message));
    err.code = 'payment_provider_http_error';
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function mapAsaasStatus(status) {
  const normalized = String(status || '').toUpperCase();
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(normalized)) return 'confirmed';
  if (['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(normalized)) return 'pending';
  if (['OVERDUE'].includes(normalized)) return 'overdue';
  if (['REFUNDED', 'RECEIVED_REFUND'].includes(normalized)) return 'refunded';
  if (['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'CHARGEBACK_REVERSED'].includes(normalized)) return 'chargeback';
  if (['DELETED'].includes(normalized)) return 'cancelled';
  return 'pending';
}

function mapMercadoPagoStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'approved') return 'confirmed';
  if (normalized === 'pending' || normalized === 'in_process') return 'pending';
  if (normalized === 'refunded') return 'refunded';
  if (normalized === 'charged_back') return 'chargeback';
  if (normalized === 'rejected' || normalized === 'cancelled') return 'cancelled';
  return 'pending';
}

async function createCustomer({ provider, tenantId, customer, idempotencyKey }) {
  const cfg = providerConfig(provider);
  if (cfg.provider === PROVIDER_MERCADO_PAGO) {
    return {
      id: String(customer?.externalId || customer?.document || customer?.email || customer?.phone || `${tenantId}-anonymous`),
      raw: { synthetic: true },
    };
  }

  const payload = {
    name: String(customer?.name || customer?.fullName || `Customer ${tenantId}`),
    cpfCnpj: customer?.document ? String(customer.document).replace(/\D+/g, '') : undefined,
    email: customer?.email ? String(customer.email) : undefined,
    mobilePhone: customer?.phone ? String(customer.phone).replace(/\D+/g, '') : undefined,
    externalReference: String(customer?.externalId || customer?.subjectId || customer?.customerId || ''),
    notificationDisabled: false,
  };

  const data = await providerRequest({
    cfg,
    method: 'POST',
    path: '/customers',
    body: payload,
    idempotencyKey,
  });

  return { id: String(data?.id || ''), raw: data };
}

async function createSingleCharge({ provider, customerId, amount, dueDate, description, metadata, idempotencyKey }) {
  const cfg = providerConfig(provider);

  if (cfg.provider === PROVIDER_MERCADO_PAGO) {
    const payload = {
      transaction_amount: Number(amount),
      description: String(description || 'Pagamento vertical'),
      payment_method_id: 'pix',
      payer: {
        id: customerId,
      },
      metadata: metadata || {},
      date_of_expiration: dueDate || undefined,
    };

    const data = await providerRequest({
      cfg,
      method: 'POST',
      path: '/v1/payments',
      body: payload,
      idempotencyKey,
    });

    return {
      transactionId: String(data?.id || ''),
      status: mapMercadoPagoStatus(data?.status),
      paymentUrl: data?.point_of_interaction?.transaction_data?.ticket_url || null,
      raw: data,
    };
  }

  const payload = {
    customer: customerId,
    billingType: String(config.getFromFile('billing.providers.asaas.billingType', 'PIX')).toUpperCase(),
    value: Number(amount),
    dueDate: dueDate,
    description: String(description || 'Pagamento vertical'),
    externalReference: metadata?.reference || undefined,
  };

  const data = await providerRequest({
    cfg,
    method: 'POST',
    path: '/payments',
    body: payload,
    idempotencyKey,
  });

  return {
    transactionId: String(data?.id || ''),
    status: mapAsaasStatus(data?.status),
    paymentUrl: data?.invoiceUrl || null,
    raw: data,
  };
}

async function createRecurringSubscription({ provider, customerId, amount, nextDueDate, cycle = 'MONTHLY', description, metadata, idempotencyKey }) {
  const cfg = providerConfig(provider);

  if (cfg.provider === PROVIDER_MERCADO_PAGO) {
    const payload = {
      reason: String(description || 'Assinatura vertical'),
      payer_email: metadata?.email || undefined,
      auto_recurring: {
        frequency: cycle === 'YEARLY' ? 12 : 1,
        frequency_type: 'months',
        transaction_amount: Number(amount),
        currency_id: String(metadata?.currency || 'BRL'),
        start_date: nextDueDate || undefined,
      },
      external_reference: metadata?.reference || undefined,
    };

    const data = await providerRequest({
      cfg,
      method: 'POST',
      path: '/preapproval',
      body: payload,
      idempotencyKey,
    });

    return {
      subscriptionId: String(data?.id || ''),
      status: mapMercadoPagoStatus(data?.status),
      raw: data,
    };
  }

  const payload = {
    customer: customerId,
    billingType: String(config.getFromFile('billing.providers.asaas.billingType', 'PIX')).toUpperCase(),
    value: Number(amount),
    nextDueDate,
    cycle,
    description: String(description || 'Assinatura vertical'),
    externalReference: metadata?.reference || undefined,
  };

  const data = await providerRequest({
    cfg,
    method: 'POST',
    path: '/subscriptions',
    body: payload,
    idempotencyKey,
  });

  return {
    subscriptionId: String(data?.id || ''),
    status: mapAsaasStatus(data?.status),
    raw: data,
  };
}

async function fetchTransactionStatus({ provider, externalTransactionId }) {
  const cfg = providerConfig(normalizeProvider(provider));
  const extId = String(externalTransactionId || '').trim();
  if (!extId) {
    const err = new Error('external_transaction_id_required');
    err.code = 'validation_error';
    throw err;
  }

  if (cfg.provider === PROVIDER_MERCADO_PAGO) {
    const data = await providerRequest({
      cfg,
      method: 'GET',
      path: `/v1/payments/${encodeURIComponent(extId)}`,
      body: null,
    });
    return {
      status: mapMercadoPagoStatus(data?.status),
      providerStatus: data?.status || null,
      raw: data,
    };
  }

  const data = await providerRequest({
    cfg,
    method: 'GET',
    path: `/payments/${encodeURIComponent(extId)}`,
    body: null,
  });
  return {
    status: mapAsaasStatus(data?.status),
    providerStatus: data?.status || null,
    raw: data,
  };
}

async function fetchSubscriptionStatus({ provider, externalSubscriptionId }) {
  const cfg = providerConfig(normalizeProvider(provider));
  const extId = String(externalSubscriptionId || '').trim();
  if (!extId) {
    const err = new Error('external_subscription_id_required');
    err.code = 'validation_error';
    throw err;
  }

  if (cfg.provider === PROVIDER_MERCADO_PAGO) {
    const data = await providerRequest({
      cfg,
      method: 'GET',
      path: `/preapproval/${encodeURIComponent(extId)}`,
      body: null,
    });
    return {
      status: mapMercadoPagoStatus(data?.status),
      providerStatus: data?.status || null,
      raw: data,
    };
  }

  const data = await providerRequest({
    cfg,
    method: 'GET',
    path: `/subscriptions/${encodeURIComponent(extId)}`,
    body: null,
  });
  return {
    status: mapAsaasStatus(data?.status),
    providerStatus: data?.status || null,
    raw: data,
  };
}

function normalizeWebhook({ provider, body = {}, headers = {} }) {
  const cfg = providerConfig(provider);
  const rawEventId = body?.eventId || body?.id || headers['x-request-id'] || headers['x-event-id'] || null;

  if (cfg.provider === PROVIDER_MERCADO_PAGO) {
    const status = body?.data?.status || body?.status || body?.resource?.status || null;
    return {
      provider: cfg.provider,
      eventId: rawEventId ? String(rawEventId) : null,
      externalTransactionId: String(body?.data?.id || body?.resource?.id || body?.id || ''),
      externalSubscriptionId: body?.data?.subscription_id ? String(body.data.subscription_id) : null,
      status: mapMercadoPagoStatus(status),
      raw: body,
    };
  }

  const payment = body?.payment || body?.subscription || body;
  const status = payment?.status || body?.event;

  return {
    provider: cfg.provider,
    eventId: rawEventId ? String(rawEventId) : null,
    externalTransactionId: payment?.id ? String(payment.id) : null,
    externalSubscriptionId: body?.subscription?.id ? String(body.subscription.id) : null,
    status: mapAsaasStatus(status),
    raw: body,
  };
}

function verifyWebhookSignature({ provider, headers = {} }) {
  const cfg = providerConfig(provider);
  if (!cfg.webhookSecret) return true;

  const token = String(headers['x-webhook-token'] || headers['x-signature'] || '').trim();
  if (!token) return false;
  return token === cfg.webhookSecret;
}

module.exports = {
  PROVIDER_ASAAS,
  PROVIDER_MERCADO_PAGO,
  normalizeProvider,
  createCustomer,
  createSingleCharge,
  createRecurringSubscription,
  fetchTransactionStatus,
  fetchSubscriptionStatus,
  normalizeWebhook,
  verifyWebhookSignature,
};
