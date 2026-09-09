'use strict';

/**
 * Modelo de capacidades dos providers/canais outbound.
 *
 * Fonte da decisão de recovery do OutboundQueue: após uma tentativa cujo
 * resultado externo não pode ser determinado (crash entre "provider aceitou" e
 * ACK local), o que é seguro fazer depende do que o provider real suporta.
 *
 * Regra: NÃO inventar capacidade. Valores refletem a realidade técnica dos
 * providers implementados (sem idempotency key documentada na Meta Cloud API /
 * Graph API / whatsapp-web.js). Provider não listado recebe o default
 * conservador (tudo false) — fail-safe: estado ambíguo vira `delivery_unknown`
 * e nunca retry automático cego.
 *
 * Campos:
 * - supportsIdempotencyKey: provider aceita chave idempotente estável no envio
 *   (retry técnico com a mesma chave não duplica efeito externo).
 * - supportsDeliveryLookup: provider permite consultar o resultado de um envio
 *   anterior (por id externo ou chave idempotente).
 * - supportsExternalStatusQuery: equivalente a lookup por query de status.
 * - supportsStatusCallback: provider emite callback/webhook de status
 *   (delivered/read/failed) que pode reconciliar ambiguidade a posteriori.
 * - safeRetryAfterUnknown: retry automático após estado desconhecido é seguro
 *   (só verdadeiro quando idempotency key ou lookup garantem não-duplicação).
 */

const CONSERVATIVE_DEFAULT = Object.freeze({
  supportsIdempotencyKey: false,
  supportsDeliveryLookup: false,
  supportsExternalStatusQuery: false,
  supportsStatusCallback: false,
  safeRetryAfterUnknown: false,
});

const PROVIDER_CAPABILITIES = Object.freeze({
  // Meta WhatsApp Cloud API: sem idempotency key; reconciliação via webhooks
  // de status (message statuses) quando configurados.
  whatsapp: Object.freeze({
    supportsIdempotencyKey: false,
    supportsDeliveryLookup: false,
    supportsExternalStatusQuery: false,
    supportsStatusCallback: true,
    safeRetryAfterUnknown: false,
  }),
  // Bridge QR (whatsapp-web.js): sem idempotency key e sem lookup confiável.
  'whatsapp-qr': Object.freeze({
    supportsIdempotencyKey: false,
    supportsDeliveryLookup: false,
    supportsExternalStatusQuery: false,
    supportsStatusCallback: false,
    safeRetryAfterUnknown: false,
  }),
  // Meta Graph API (Instagram/Messenger): sem idempotency key documentada.
  instagram: Object.freeze({
    supportsIdempotencyKey: false,
    supportsDeliveryLookup: false,
    supportsExternalStatusQuery: false,
    supportsStatusCallback: true,
    safeRetryAfterUnknown: false,
  }),
  messenger: Object.freeze({
    supportsIdempotencyKey: false,
    supportsDeliveryLookup: false,
    supportsExternalStatusQuery: false,
    supportsStatusCallback: true,
    safeRetryAfterUnknown: false,
  }),
  // Email MVP: envio sintético, sem provider externo real plugado.
  email: Object.freeze({
    supportsIdempotencyKey: false,
    supportsDeliveryLookup: false,
    supportsExternalStatusQuery: false,
    supportsStatusCallback: false,
    safeRetryAfterUnknown: false,
  }),
});

function getProviderCapabilities(channelType, overrides = null) {
  if (overrides && typeof overrides === 'object' && overrides[channelType]) {
    return { ...CONSERVATIVE_DEFAULT, ...overrides[channelType] };
  }
  const known = PROVIDER_CAPABILITIES[channelType];
  if (known) return { ...known };
  return { ...CONSERVATIVE_DEFAULT };
}

module.exports = {
  PROVIDER_CAPABILITIES,
  CONSERVATIVE_DEFAULT,
  getProviderCapabilities,
};
