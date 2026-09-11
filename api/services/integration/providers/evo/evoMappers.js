'use strict';

/**
 * Mapeadores EVO → DTO normalizado.
 *
 * Regra da camada: `response.data.foo.bar` NÃO pode existir em services de
 * domínio (Fitness/CRM/Billing/Workspace). Toda a semântica do provedor morre
 * aqui e sai como DTO estável.
 *
 * Cada DTO carrega apenas conteúdo útil, necessário e seguro:
 * - nada de biometria/foto facial;
 * - nada de dado de cartão (PAN/CVV);
 * - nada de payload cru em `metadata` (metadata é curado, não depósito).
 */

const { IntegrationError, INTEGRATION_ERROR_CODES } = require('../../integrationRedaction');

const DEFAULT_CURRENCY = 'BRL';
const ALLOWED_CURRENCIES = new Set(['BRL', 'USD', 'EUR']);

/** Primeiro campo definido (e não vazio) dentre os candidatos do contrato. */
function pickField(source, candidates = []) {
  if (!source || typeof source !== 'object') return null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = source[candidate];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

/** Converte para ISO-8601. Aceita ISO, `YYYY-MM-DD`, `DD/MM/YYYY` e epoch ms. */
function toIsoDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch.toISOString();
  }
  const str = String(value).trim();
  if (!str) return null;
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(str);
  if (brMatch) {
    const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = brMatch;
    const date = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.000Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Converte valor monetário para número finito (aceita "1.234,56" e "1234.56"). */
function toAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let str = String(value).trim().replace(/[^\d.,-]/g, '');
  if (!str) return null;
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && hasDot) {
    // último separador é o decimal
    str = str.lastIndexOf(',') > str.lastIndexOf('.')
      ? str.replace(/\./g, '').replace(',', '.')
      : str.replace(/,/g, '');
  } else if (hasComma) {
    str = str.replace(',', '.');
  }
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCurrency(value) {
  if (!value) return DEFAULT_CURRENCY;
  const upper = String(value).trim().toUpperCase().slice(0, 3);
  return ALLOWED_CURRENCIES.has(upper) ? upper : DEFAULT_CURRENCY;
}

function toStatus(value, map, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const key = String(value).trim().toLowerCase();
  return (map && map[key]) || map?.[String(value)] || fallback || key;
}

function toBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  if (['1', 'true', 'sim', 'yes', 'active', 'ativo'].includes(str)) return true;
  if (['0', 'false', 'nao', 'não', 'no', 'inactive', 'inativo'].includes(str)) return false;
  return fallback;
}

function toExternalId(value) {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();
  if (str.length > 255) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.PROVIDER_SCHEMA_DRIFT, 'external id excede o limite suportado', {
      length: str.length,
    });
  }
  return str;
}

/**
 * Checagem de schema drift: campos obrigatórios ausentes/ inválidos no registro.
 * Lança `integration_provider_schema_drift` com a lista — o lote é rejeitado
 * explicitamente, nunca importado pela metade em silêncio.
 */
function assertRequiredFields(dto, required, resource) {
  const missing = required.filter((field) => dto[field] === null || dto[field] === undefined);
  if (missing.length > 0) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.PROVIDER_SCHEMA_DRIFT,
      `registro de ${resource} sem campos obrigatórios`,
      { resource, missing },
    );
  }
  return dto;
}

function mapWithFields(raw, fields) {
  const out = {};
  for (const [key, candidates] of Object.entries(fields || {})) {
    out[key] = pickField(raw, candidates);
  }
  return out;
}

function mapMember(raw, contract) {
  const fields = contract.resources.members.fields;
  const mapped = mapWithFields(raw, fields);
  return {
    externalId: toExternalId(mapped.externalId),
    name: mapped.name ? String(mapped.name).trim().slice(0, 200) : null,
    email: mapped.email ? String(mapped.email).trim().toLowerCase().slice(0, 255) : null,
    phone: mapped.phone ? String(mapped.phone).trim().slice(0, 40) : null,
    document: mapped.document ? String(mapped.document).replace(/[^\dA-Za-z]/g, '').slice(0, 32) : null,
    status: toStatus(mapped.status, contract.statusMap.member, 'active'),
    birthDate: toIsoDate(mapped.birthDate),
    unitId: mapped.unitId ? String(mapped.unitId) : null,
    joinedAt: toIsoDate(mapped.joinedAt),
  };
}

function mapProspect(raw, contract) {
  const fields = contract.resources.prospects.fields;
  const mapped = mapWithFields(raw, fields);
  return {
    externalId: toExternalId(mapped.externalId),
    name: mapped.name ? String(mapped.name).trim().slice(0, 200) : null,
    email: mapped.email ? String(mapped.email).trim().toLowerCase().slice(0, 255) : null,
    phone: mapped.phone ? String(mapped.phone).trim().slice(0, 40) : null,
    document: mapped.document ? String(mapped.document).replace(/[^\dA-Za-z]/g, '').slice(0, 32) : null,
    status: mapped.status ? String(mapped.status).trim().slice(0, 40) : 'prospect',
    stage: mapped.stage ? String(mapped.stage).trim().slice(0, 40) : 'lead',
    unitId: mapped.unitId ? String(mapped.unitId) : null,
    createdAt: toIsoDate(mapped.createdAt),
  };
}

function mapPlan(raw, contract) {
  const fields = contract.resources.plans.fields;
  const mapped = mapWithFields(raw, fields);
  return {
    externalId: toExternalId(mapped.externalId),
    name: mapped.name ? String(mapped.name).trim().slice(0, 200) : null,
    type: mapped.type ? String(mapped.type).trim().slice(0, 60) : null,
    amount: toAmount(mapped.amount),
    cycle: mapped.cycle ? String(mapped.cycle).trim().slice(0, 40) : null,
    active: toBoolean(mapped.active, true),
  };
}

function mapMembership(raw, contract) {
  const fields = contract.resources.memberships.fields;
  const mapped = mapWithFields(raw, fields);
  const startAt = toIsoDate(mapped.startAt);
  const endAt = toIsoDate(mapped.endAt);
  return {
    externalId: toExternalId(mapped.externalId),
    memberExternalId: toExternalId(mapped.memberExternalId),
    planExternalId: mapped.planExternalId !== null && mapped.planExternalId !== undefined ? toExternalId(mapped.planExternalId) : null,
    planName: mapped.planName ? String(mapped.planName).trim().slice(0, 200) : null,
    planType: mapped.planType ? String(mapped.planType).trim().slice(0, 60) : null,
    status: mapped.status ? String(mapped.status).trim().slice(0, 40) : 'active',
    billingStatus: toStatus(mapped.billingStatus, contract.statusMap.membershipBilling, 'active'),
    startAt,
    endAt,
    dueDate: toIsoDate(mapped.dueDate),
    renewalAt: toIsoDate(mapped.renewalAt),
    unitId: mapped.unitId ? String(mapped.unitId) : null,
  };
}

function mapEntry(raw, contract) {
  const fields = contract.resources.entries.fields;
  const mapped = mapWithFields(raw, fields);
  return {
    externalId: toExternalId(mapped.externalId),
    memberExternalId: toExternalId(mapped.memberExternalId),
    unitId: mapped.unitId ? String(mapped.unitId) : null,
    occurredAt: toIsoDate(mapped.occurredAt),
    deviceId: mapped.deviceId ? String(mapped.deviceId).slice(0, 80) : null,
  };
}

function mapSale(raw, contract) {
  const fields = contract.resources.sales.fields;
  const mapped = mapWithFields(raw, fields);
  return {
    externalId: toExternalId(mapped.externalId),
    memberExternalId: mapped.memberExternalId !== null && mapped.memberExternalId !== undefined ? toExternalId(mapped.memberExternalId) : null,
    status: toStatus(mapped.status, contract.statusMap.transaction, 'pending'),
    amount: toAmount(mapped.amount),
    currency: toCurrency(mapped.currency),
    type: mapped.type ? String(mapped.type).trim().slice(0, 60) : 'sale',
    occurredAt: toIsoDate(mapped.occurredAt),
    dueAt: toIsoDate(mapped.dueAt),
    paidAt: toIsoDate(mapped.paidAt),
  };
}

function mapReceivable(raw, contract) {
  const fields = contract.resources.receivables.fields;
  const mapped = mapWithFields(raw, fields);
  return {
    externalId: toExternalId(mapped.externalId),
    memberExternalId: mapped.memberExternalId !== null && mapped.memberExternalId !== undefined ? toExternalId(mapped.memberExternalId) : null,
    saleExternalId: mapped.saleExternalId !== null && mapped.saleExternalId !== undefined ? toExternalId(mapped.saleExternalId) : null,
    status: toStatus(mapped.status, contract.statusMap.transaction, 'pending'),
    amount: toAmount(mapped.amount),
    currency: toCurrency(mapped.currency),
    type: mapped.type ? String(mapped.type).trim().slice(0, 60) : 'receivable',
    dueAt: toIsoDate(mapped.dueAt),
    paidAt: toIsoDate(mapped.paidAt),
  };
}

const MAPPERS = Object.freeze({
  members: { map: mapMember, required: ['externalId'] },
  prospects: { map: mapProspect, required: ['externalId'] },
  plans: { map: mapPlan, required: ['externalId'] },
  memberships: { map: mapMembership, required: ['externalId', 'memberExternalId'] },
  entries: { map: mapEntry, required: ['externalId', 'memberExternalId', 'occurredAt'] },
  sales: { map: mapSale, required: ['externalId'] },
  receivables: { map: mapReceivable, required: ['externalId'] },
});

/** Normaliza um registro bruto do provedor para o DTO do recurso. */
function normalizeResourceRecord(resource, raw, contract) {
  const entry = MAPPERS[resource];
  if (!entry) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.RESOURCE_UNSUPPORTED, `recurso não suportado pelo adaptador: ${resource}`, { resource });
  }
  const dto = entry.map(raw, contract);
  return assertRequiredFields(dto, entry.required, resource);
}

module.exports = {
  pickField,
  toIsoDate,
  toAmount,
  toCurrency,
  toStatus,
  toBoolean,
  toExternalId,
  assertRequiredFields,
  normalizeResourceRecord,
  MAPPERS,
  DEFAULT_CURRENCY,
  ALLOWED_CURRENCIES,
};
