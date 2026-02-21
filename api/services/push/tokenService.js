'use strict';

const crypto = require('crypto');
const { PushToken } = require('../../db/models');

const ALLOWED_PLATFORMS = new Set(['android', 'ios']);

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizePlatform(platform) {
  return String(platform || '').trim().toLowerCase();
}

function assertPlatform(platform) {
  const normalized = normalizePlatform(platform);
  if (!ALLOWED_PLATFORMS.has(normalized)) {
    throw new Error('platform inválida. Use: android ou ios');
  }
  return normalized;
}

function assertToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    throw new Error('token é obrigatório');
  }
  return value;
}

function toPublicRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    platform: row.platform,
    token: row.token,
    deviceName: row.device_name || null,
    deviceId: row.device_id || null,
    appVersion: row.app_version || null,
    lastSeenAt: row.last_seen_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function registerPushToken({
  tenantId,
  userId,
  platform,
  token,
  deviceName = null,
  deviceId = null,
  appVersion = null,
}) {
  const Model = PushToken();
  const normalizedPlatform = assertPlatform(platform);
  const normalizedToken = assertToken(token);
  const now = new Date();

  const existing = await Model.findOne({
    where: {
      platform: normalizedPlatform,
      token: normalizedToken,
    },
  });

  if (existing) {
    const updated = await existing.update({
      tenant_id: String(tenantId),
      user_id: String(userId),
      device_name: deviceName ? String(deviceName) : null,
      device_id: deviceId ? String(deviceId) : null,
      app_version: appVersion ? String(appVersion) : null,
      last_seen_at: now,
      updated_at: now,
    });
    return toPublicRow(updated);
  }

  const created = await Model.create({
    id: newId('push-token'),
    tenant_id: String(tenantId),
    user_id: String(userId),
    platform: normalizedPlatform,
    token: normalizedToken,
    device_name: deviceName ? String(deviceName) : null,
    device_id: deviceId ? String(deviceId) : null,
    app_version: appVersion ? String(appVersion) : null,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  });

  return toPublicRow(created);
}

async function unregisterPushToken({ tenantId, userId, platform, token }) {
  const Model = PushToken();
  const normalizedPlatform = assertPlatform(platform);
  const normalizedToken = assertToken(token);

  const removed = await Model.destroy({
    where: {
      tenant_id: String(tenantId),
      user_id: String(userId),
      platform: normalizedPlatform,
      token: normalizedToken,
    },
  });

  return removed > 0;
}

async function removePushTokenByPlatformAndToken({ platform, token }) {
  const Model = PushToken();
  const normalizedPlatform = assertPlatform(platform);
  const normalizedToken = assertToken(token);

  const removed = await Model.destroy({
    where: {
      platform: normalizedPlatform,
      token: normalizedToken,
    },
  });

  return removed > 0;
}

async function listPushTokensForUser({ tenantId, userId }) {
  const Model = PushToken();
  const rows = await Model.findAll({
    where: {
      tenant_id: String(tenantId),
      user_id: String(userId),
    },
    order: [['updated_at', 'DESC']],
    limit: 200,
  });

  return rows.map(toPublicRow);
}

module.exports = {
  ALLOWED_PLATFORMS,
  registerPushToken,
  unregisterPushToken,
  removePushTokenByPlatformAndToken,
  listPushTokensForUser,
  assertPlatform,
  assertToken,
};
