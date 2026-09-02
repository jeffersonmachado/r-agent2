/**
 * Cache em memória da resolução webhook → channel_account.
 *
 * resolveTenantForWebhook (channelGatewayService) fazia um findOne em
 * channel_accounts por external_id a CADA webhook/batch de status, embora a
 * cardinalidade de contas seja baixíssima. Este cache (TTL curto) elimina a
 * query repetida.
 *
 * Regras:
 * - Chave: `${channelType}:${externalId}` (a resolução por webhook é global —
 *   o tenant é derivado DA account; não há escopo de tenant no lookup).
 * - Somente acertos (account encontrada) são cacheados; misses sempre vão ao
 *   DB para não atrasar onboarding de contas novas.
 * - Invalidação explícita no CRUD de channel_accounts
 *   (channelAccountsService create/update/delete); TTL é apenas backstop.
 */

'use strict';

const WEBHOOK_ACCOUNT_CACHE_TTL_MS = 60 * 1000;

/** @type {Map<string, { account: object, expiresAt: number }>} */
const accountCache = new Map();

function buildKey(channelType, externalId) {
  return `${channelType}:${externalId}`;
}

function getCachedAccount(channelType, externalId) {
  const key = buildKey(channelType, externalId);
  const entry = accountCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    accountCache.delete(key);
    return null;
  }
  return entry.account;
}

function setCachedAccount(channelType, externalId, account) {
  if (!account) return;
  accountCache.set(buildKey(channelType, externalId), {
    account,
    expiresAt: Date.now() + WEBHOOK_ACCOUNT_CACHE_TTL_MS,
  });
}

function invalidateCachedAccount(channelType, externalId) {
  if (channelType === undefined || channelType === null) return;
  if (externalId === undefined || externalId === null || externalId === '') return;
  accountCache.delete(buildKey(channelType, externalId));
}

function clearAccountCache() {
  accountCache.clear();
}

module.exports = {
  WEBHOOK_ACCOUNT_CACHE_TTL_MS,
  getCachedAccount,
  setCachedAccount,
  invalidateCachedAccount,
  clearAccountCache,
};
