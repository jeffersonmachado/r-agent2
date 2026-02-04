/**
 * One-click bootstrap (tenant + admin + minimal operational assets).
 *
 * Goals:
 * - Idempotente (rodar 2x não duplica nem quebra)
 * - Reduz "tempo até operar" (tokens públicos + filas físicas + templates básicos)
 */

'use strict';

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { Tenant: TenantGetter, User: UserGetter } = require('../db/models');
const tenantService = require('./tenantService');
const { inviteUser, acceptInvitation } = require('./authService');
const { createInitialTemplates } = require('./onboardingService');
const { upsertQueue: upsertPhysicalQueue } = require('./physicalQueueService');
const { createPublicToken, listPublicTokens } = require('./publicAccessTokenService');

function dbAvailable() {
  return !!getSequelize();
}

function safeStr(v) {
  return v == null ? '' : String(v).trim();
}

async function getTenantRow(tenantKey) {
  const TenantModel = typeof TenantGetter === 'function' ? TenantGetter() : TenantGetter;
  return TenantModel.findOne({ where: { tenant_key: String(tenantKey) } });
}

async function getUserRowByEmail(email) {
  const UserModel = typeof UserGetter === 'function' ? UserGetter() : UserGetter;
  return UserModel.findOne({ where: { email: String(email) } });
}

async function ensureTenant({ tenantKey, name, site, ramoAtividade, objetivo, plan = 'trial', settings = {} }) {
  const existing = await getTenantRow(tenantKey);
  if (existing) return { created: false, tenant: existing.toJSON ? existing.toJSON() : existing };

  const res = await tenantService.createTenant({
    tenant_key: tenantKey,
    name,
    site,
    ramo_atividade: ramoAtividade,
    objetivo,
    plan,
    settings,
    // one-click bootstrap pode aceitar placeholders (trata como safe-mode)
    _aiSafeMode: true,
  });
  if (!res.success) {
    throw new Error(res.error || 'create_tenant_failed');
  }

  const row = await getTenantRow(tenantKey);
  return { created: true, tenant: row ? (row.toJSON ? row.toJSON() : row) : null };
}

async function ensureAdminUser({ tenantKey, email, password, username = null, name = null }) {
  const cleanEmail = safeStr(email);
  if (!cleanEmail) return { created: false, user: null, warning: 'admin_email_missing' };

  const existing = await getUserRowByEmail(cleanEmail);
  if (existing) {
    // Se já existe, não tentamos resetar senha aqui (evita side-effects).
    return { created: false, user: existing.toJSON ? existing.toJSON() : existing, warning: 'admin_user_already_exists' };
  }

  const invite = await inviteUser({
    tenantId: tenantKey,
    email: cleanEmail,
    role: 'admin',
    name: name || null,
    username: username || null,
  });
  if (!invite.success) {
    throw new Error(invite.error || 'invite_failed');
  }

  if (!password) {
    return {
      created: true,
      user: { email: cleanEmail, tenantId: tenantKey, status: 'pending', invitationToken: invite.invitationToken },
      warning: 'admin_password_missing_invitation_left_pending',
    };
  }

  const accept = await acceptInvitation(invite.invitationToken, String(password), username || cleanEmail.split('@')[0]);
  if (!accept.success) {
    throw new Error(accept.error || 'accept_invitation_failed');
  }

  return { created: true, user: accept.agent, token: accept.token };
}

async function ensurePublicToken({ tenantKey, kind, locationId = null, meta = {} }) {
  const list = await listPublicTokens({ tenantId: tenantKey, kind, locationId, active: true, includeToken: true });
  const existing = Array.isArray(list) ? list.find((t) => t && t.active === true) : (list?.items ? list.items.find((t) => t.active === true) : null);
  if (existing && existing.token && typeof existing.token === 'string' && existing.token.includes('***')) {
    // listPublicTokens por padrão mascara; ensure includeToken=true acima.
  }
  if (existing && existing.token && typeof existing.token === 'string' && !existing.token.includes('***')) {
    return { created: false, token: existing };
  }

  const created = await createPublicToken({
    tenantId: tenantKey,
    kind,
    locationId,
    meta,
  });
  return { created: true, token: created };
}

/**
 * Bootstrap idempotente.
 */
async function bootstrapTenantOneClick({
  tenantKey,
  tenantName,
  site = '',
  ramoAtividade = 'geral',
  objetivo = 'operar',
  plan = 'trial',
  segment = 'geral',
  locationId = null,
  adminEmail = '',
  adminPassword = null,
  adminUsername = null,
  createTokens = true,
} = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };

  const tk = safeStr(tenantKey);
  if (!tk) return { ok: false, error: 'tenantKey_required' };
  const name = safeStr(tenantName) || tk;

  const result = {
    ok: true,
    tenantKey: tk,
    created: {
      tenant: false,
      adminUser: false,
      templates: false,
      physicalQueue: false,
      tokens: {},
    },
    tenant: null,
    adminUser: null,
    adminToken: null,
    templates: null,
    physicalQueue: null,
    tokens: {},
    warnings: [],
  };

  // 1) Tenant
  const ensuredTenant = await ensureTenant({
    tenantKey: tk,
    name,
    site,
    ramoAtividade,
    objetivo,
    plan,
    settings: { segment },
  });
  result.created.tenant = ensuredTenant.created;
  result.tenant = ensuredTenant.tenant;

  // 2) Admin user (optional)
  try {
    const ensuredAdmin = await ensureAdminUser({
      tenantKey: tk,
      email: adminEmail,
      password: adminPassword,
      username: adminUsername,
      name: adminUsername || null,
    });
    result.created.adminUser = ensuredAdmin.created;
    result.adminUser = ensuredAdmin.user || null;
    result.adminToken = ensuredAdmin.token || null;
    if (ensuredAdmin.warning) result.warnings.push(ensuredAdmin.warning);
  } catch (err) {
    result.warnings.push(`admin_user_bootstrap_failed:${err.message}`);
  }

  // 3) Templates + quick replies + queue digital
  try {
    const createdTemplates = await createInitialTemplates(tk, { segment });
    result.created.templates = createdTemplates.success === true;
    result.templates = createdTemplates.success ? createdTemplates.created : null;
  } catch (err) {
    result.warnings.push(`templates_bootstrap_failed:${err.message}`);
  }

  // 4) Physical queue default (location-aware)
  try {
    const q = await upsertPhysicalQueue({
      tenantId: tk,
      locationId: locationId ? String(locationId) : null,
      name: 'Geral',
      status: 'active',
      rules: {},
    });
    result.created.physicalQueue = true;
    result.physicalQueue = q;
  } catch (err) {
    result.warnings.push(`physical_queue_bootstrap_failed:${err.message}`);
  }

  // 5) Public tokens
  if (createTokens) {
    const tokenKinds = ['storefront', 'kiosk', 'panel', 'station'];
    for (const kind of tokenKinds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const ensured = await ensurePublicToken({
          tenantKey: tk,
          kind,
          locationId: locationId ? String(locationId) : null,
          meta: { segment, locationId: locationId ? String(locationId) : null },
        });
        result.created.tokens[kind] = ensured.created;
        result.tokens[kind] = ensured.token;
      } catch (err) {
        result.warnings.push(`public_token_bootstrap_failed:${kind}:${err.message}`);
      }
    }
  }

  logger.info('[Bootstrap] one-click concluído', {
    tenantKey: tk,
    createdTenant: result.created.tenant,
    warnings: result.warnings.length,
  });

  return result;
}

module.exports = {
  bootstrapTenantOneClick,
};

