'use strict';

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const { MarketingLink, MarketingLinkClick } = require('../../db/models');

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(v) {
  return v == null ? '' : String(v).trim();
}

function generateCode() {
  const raw = crypto.randomBytes(5).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return raw || crypto.randomBytes(6).toString('hex').slice(0, 8);
}

function normalizeUrl(url) {
  const raw = safeStr(url);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function listLinks({ tenantId, limit = 200, offset = 0 }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const Model = MarketingLink();
  const rows = await Model.findAll({
    where: { tenant_key: String(tenantId) },
    order: [['updated_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return { ok: true, items: rows.map((r) => (r.toJSON ? r.toJSON() : r)) };
}

async function createLink({ tenantId, name, targetUrl, source, campaign, medium, content, term, code, status = 'active', metadata = {} }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId) return { ok: false, error: 'tenant_required' };
  const url = normalizeUrl(targetUrl);
  if (!url) return { ok: false, error: 'invalid_url' };

  const Model = MarketingLink();
  let finalCode = safeStr(code);
  if (!finalCode) finalCode = generateCode();

  // Garantir unicidade
  let attempts = 0;
  while (attempts < 5) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await Model.findOne({ where: { code: finalCode } });
    if (!existing) break;
    finalCode = generateCode();
    attempts += 1;
  }

  if (await Model.findOne({ where: { code: finalCode } })) {
    return { ok: false, error: 'code_collision' };
  }

  const row = await Model.create({
    id: newId('mlink'),
    tenant_key: String(tenantId),
    name: safeStr(name) || `Link ${finalCode}`,
    code: finalCode,
    target_url: url,
    status: safeStr(status) || 'active',
    source: safeStr(source) || null,
    campaign: safeStr(campaign) || null,
    medium: safeStr(medium) || null,
    content: safeStr(content) || null,
    term: safeStr(term) || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });

  return { ok: true, link: row.toJSON ? row.toJSON() : row };
}

async function getLinkByCode(code) {
  if (!dbAvailable()) return null;
  const Model = MarketingLink();
  const row = await Model.findOne({ where: { code: String(code) } });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

async function recordClick({ link, ip, userAgent, referrer }) {
  if (!dbAvailable() || !link) return { ok: false };
  const ClickModel = MarketingLinkClick();
  const LinkModel = MarketingLink();

  await ClickModel.create({
    id: newId('mclick'),
    tenant_key: String(link.tenant_key || link.tenantId || ''),
    link_id: String(link.id),
    code: String(link.code),
    target_url: String(link.target_url),
    source: link.source || null,
    campaign: link.campaign || null,
    medium: link.medium || null,
    content: link.content || null,
    term: link.term || null,
    ip: ip || null,
    user_agent: userAgent || null,
    referrer: referrer || null,
  });

  try {
    await LinkModel.update({
      click_count: (Number(link.click_count) || 0) + 1,
    }, { where: { id: String(link.id) } });
  } catch {
    // best-effort
  }

  return { ok: true };
}

function buildTrackedUrl(link, originalQuery = '') {
  const base = new URL(link.target_url);
  const params = base.searchParams;
  const mappings = {
    utm_source: link.source,
    utm_campaign: link.campaign,
    utm_medium: link.medium,
    utm_content: link.content,
    utm_term: link.term,
  };
  Object.entries(mappings).forEach(([key, value]) => {
    if (value && !params.has(key)) {
      params.set(key, String(value));
    }
  });

  if (originalQuery) {
    const extra = new URLSearchParams(originalQuery);
    extra.forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
  }

  return base.toString();
}

module.exports = {
  listLinks,
  createLink,
  getLinkByCode,
  recordClick,
  buildTrackedUrl,
};
