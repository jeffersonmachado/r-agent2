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

function safeStr(v, fallback = '') {
  if (v == null) return fallback;
  try { return String(v).trim(); } catch (_) { return fallback; }
}

function safeToString(v, fallback = '') {
  if (v == null) return fallback;
  try { return String(v); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err, fallback);
  } catch (_) { return safeToString(err, fallback); }
}

async function getTenantRow(tenantKey) {
  const TenantModel = typeof TenantGetter === 'function' ? TenantGetter() : TenantGetter;
  return TenantModel.findOne({ where: { tenant_key: safeStr(tenantKey) } });
}

async function getUserRowByEmail(email) {
  const UserModel = typeof UserGetter === 'function' ? UserGetter() : UserGetter;
  return UserModel.findOne({ where: { email: safeStr(email) } });
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

  const accept = await acceptInvitation(invite.invitationToken, safeToString(password), username || cleanEmail.split('@')[0]);
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
  suites = null,
  locationId = null,
  locationIds = null,
  adminEmail = '',
  adminPassword = null,
  adminUsername = null,
  createTokens = true,
  tokenKinds = null,
  createTemplates = true,
  createPhysicalQueue = null,
} = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };

  const tk = safeStr(tenantKey);
  if (!tk) return { ok: false, error: 'tenantKey_required' };
  const name = safeStr(tenantName) || tk;

  const result = {
    ok: true,
    tenantKey: tk,
    startedAt: new Date().toISOString(),
    suites: Array.isArray(suites) ? suites.map((s) => safeStr(s)).filter(Boolean) : [],
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
    report: {
      steps: [],
    },
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
  result.report.steps.push({
    step: 'tenant',
    ok: true,
    created: ensuredTenant.created === true,
    tenantKey: tk,
  });

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
    result.report.steps.push({
      step: 'admin_user',
      ok: true,
      created: ensuredAdmin.created === true,
      warning: ensuredAdmin.warning || null,
      email: safeStr(adminEmail) || null,
    });
  } catch (err) {
    result.warnings.push(`admin_user_bootstrap_failed:${safeErrorMessage(err)}`);
    result.report.steps.push({
      step: 'admin_user',
      ok: false,
      error: safeErrorMessage(err) || 'admin_user_bootstrap_failed',
      email: safeStr(adminEmail) || null,
    });
  }

  // 3) Templates + quick replies + queue digital
  if (createTemplates) {
    try {
      const createdTemplates = await createInitialTemplates(tk, { segment });
      result.created.templates = createdTemplates.success === true;
      result.templates = createdTemplates.success ? createdTemplates.created : null;
      result.report.steps.push({
        step: 'templates',
        ok: createdTemplates.success === true,
        created: createdTemplates.success === true,
        segment,
      });
    } catch (err) {
      result.warnings.push(`templates_bootstrap_failed:${safeErrorMessage(err)}`);
      result.report.steps.push({
        step: 'templates',
        ok: false,
        error: safeErrorMessage(err) || 'templates_bootstrap_failed',
        segment,
      });
    }
  } else {
    result.report.steps.push({ step: 'templates', ok: true, skipped: true });
  }

  const locsRaw = Array.isArray(locationIds) ? locationIds : (locationId != null ? [locationId] : []);
  const locs = locsRaw.map((x) => (x == null ? null : safeStr(x))).filter((x) => x !== '');
  const effectiveLocs = locs.length > 0 ? locs : [null];

  // Suite defaults (opções por suíte)
  const suiteList = Array.isArray(suites) ? suites.map((s) => safeStr(s).toLowerCase()).filter(Boolean) : [];
  const suiteTokenKinds = (() => {
    if (!suiteList.length) return null;
    const kinds = new Set();
    if (suiteList.includes('fast_service') || suiteList.includes('physical')) {
      kinds.add('kiosk');
      kinds.add('panel');
      kinds.add('station');
    }
    if (suiteList.includes('orders') || suiteList.includes('delivery') || suiteList.includes('storefront')) {
      kinds.add('storefront');
    }
    return kinds.size ? Array.from(kinds) : null;
  })();
  const createPhysicalQueueEffective = createPhysicalQueue == null
    ? (suiteList.length ? (suiteList.includes('fast_service') || suiteList.includes('physical')) : true)
    : createPhysicalQueue === true;

  // 4) Physical queue default (location-aware)
  if (createPhysicalQueueEffective) {
    for (const loc of effectiveLocs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const q = await upsertPhysicalQueue({
          tenantId: tk,
          locationId: loc ? safeStr(loc) : null,
          name: 'Geral',
          status: 'active',
          rules: {},
        });
        result.created.physicalQueue = true;
        result.physicalQueue = q;
        result.report.steps.push({
          step: 'physical_queue',
          ok: true,
          created: true,
          locationId: loc || null,
          queueId: q?.id || null,
        });
      } catch (err) {
        result.warnings.push(`physical_queue_bootstrap_failed:${safeErrorMessage(err)}`);
        result.report.steps.push({
          step: 'physical_queue',
          ok: false,
          error: safeErrorMessage(err) || 'physical_queue_bootstrap_failed',
          locationId: loc || null,
        });
      }
    }
  } else {
    result.report.steps.push({ step: 'physical_queue', ok: true, skipped: true });
  }

  // 5) Public tokens
  if (createTokens) {
    const kinds = Array.isArray(tokenKinds) && tokenKinds.length
      ? tokenKinds.map((k) => safeStr(k)).filter(Boolean)
      : (suiteTokenKinds || ['storefront', 'kiosk', 'panel', 'station']);
    for (const loc of effectiveLocs) {
      for (const kind of kinds) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const ensured = await ensurePublicToken({
            tenantKey: tk,
            kind,
            locationId: loc ? safeStr(loc) : null,
            meta: { segment, locationId: loc ? safeStr(loc) : null },
          });
          const key = loc ? `${kind}:${safeStr(loc)}` : kind;
          result.created.tokens[key] = ensured.created;
          result.tokens[key] = ensured.token;
          result.report.steps.push({
            step: 'public_token',
            ok: true,
            created: ensured.created === true,
            kind,
            locationId: loc || null,
            tokenId: ensured?.token?.id || null,
          });
        } catch (err) {
          result.warnings.push(`public_token_bootstrap_failed:${kind}:${safeErrorMessage(err)}`);
          result.report.steps.push({
            step: 'public_token',
            ok: false,
            error: safeErrorMessage(err) || 'public_token_bootstrap_failed',
            kind,
            locationId: loc || null,
          });
        }
      }
    }
  } else {
    result.report.steps.push({ step: 'public_tokens', ok: true, skipped: true });
  }

  logger.info('[Bootstrap] one-click concluído', {
    tenantKey: tk,
    createdTenant: result.created.tenant,
    warnings: result.warnings.length,
  });

  result.completedAt = new Date().toISOString();
  result.durationMs = new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime();

  return result;
}

module.exports = {
  bootstrapTenantOneClick,
};
