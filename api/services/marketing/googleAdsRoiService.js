'use strict';

const { Op } = require('sequelize');
const { Order, MarketingLead } = require('../../db/models');
const { normalizePhone, normalizeText } = require('../evidenceUtils');
const googleAdsKeywordInsightService = require('./googleAdsKeywordInsightService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeStr(value, fallback = '') {
  return safeToString(value, fallback).trim();
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMetricNumber(value, decimals = 4) {
  return Number(safeNumber(value, 0).toFixed(decimals));
}

function parsePaging({ limit = 100, offset = 0 } = {}) {
  return {
    limit: Math.min(Math.max(Number(limit) || 100, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  };
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function extractLeadAttribution(lead) {
  const attrs = safeObject(lead?.attributes) || {};
  return safeObject(attrs.lastAttribution) || safeObject(attrs.attribution) || null;
}

function extractOrderAttribution(order) {
  const ctx = safeObject(order?.context) || {};
  return safeObject(ctx.marketingAttribution) || safeObject(ctx.lastAttribution) || safeObject(ctx.attribution) || null;
}

function deriveOrderAttribution(order, leadByPhone) {
  const direct = extractOrderAttribution(order);
  if (direct) return direct;
  const phone = normalizePhone(order?.customer_phone);
  if (!phone) return null;
  const lead = leadByPhone.get(phone);
  if (!lead) return null;
  return extractLeadAttribution(lead);
}

function entityMatchScore({ entityType, item, attribution }) {
  const source = safeObject(attribution) || {};
  const campaignId = safeStr(source.campaignId || source.campaign_id);
  const adGroupId = safeStr(source.adGroupId || source.ad_group_id);
  const utmCampaign = normalizeText(source.utm_campaign || source.campaignName || source.campaign || '');
  const utmTerm = normalizeText(source.utm_term || source.keywordText || source.searchTerm || '');
  const itemCampaignId = safeStr(item.campaignId);
  const itemAdGroupId = safeStr(item.adGroupId);
  const itemCampaignName = normalizeText(item.campaignName || '');
  const itemKeyword = normalizeText(item.keywordText || '');
  const itemSearchTerm = normalizeText(item.searchTerm || '');

  if (entityType === 'campaign') {
    if (campaignId && campaignId === itemCampaignId) return 1;
    if (utmCampaign && itemCampaignName && utmCampaign === itemCampaignName) return 0.95;
    return 0;
  }

  if (entityType === 'ad_group') {
    if (campaignId && campaignId !== itemCampaignId) return 0;
    if (adGroupId && adGroupId === itemAdGroupId) return 1;
    return 0;
  }

  if (entityType === 'keyword') {
    if (campaignId && campaignId !== itemCampaignId) return 0;
    if (adGroupId && itemAdGroupId && adGroupId !== itemAdGroupId) return 0;
    if (utmTerm && itemKeyword && utmTerm === itemKeyword) return 0.95;
    return 0;
  }

  if (entityType === 'search_term') {
    if (campaignId && campaignId !== itemCampaignId) return 0;
    if (adGroupId && itemAdGroupId && adGroupId !== itemAdGroupId) return 0;
    if (utmTerm && itemSearchTerm && utmTerm === itemSearchTerm) return 0.95;
    return 0;
  }

  return 0;
}

async function loadReconciledOrders({ tenantId, startDate, endDate }) {
  const where = {
    tenant_key: safeStr(tenantId),
    created_at: {
      [Op.gte]: new Date(`${startDate}T00:00:00.000Z`),
      [Op.lte]: new Date(`${endDate}T23:59:59.999Z`),
    },
    status: { [Op.not]: 'cancelled' },
  };
  const [orders, leads] = await Promise.all([
    Order().findAll({ where, order: [['created_at', 'DESC']], limit: 5000 }),
    MarketingLead().findAll({ where: { tenant_key: safeStr(tenantId) }, limit: 5000 }),
  ]);

  const leadByPhone = new Map();
  for (const rawLead of leads || []) {
    const lead = rawLead.toJSON ? rawLead.toJSON() : rawLead;
    const phone = normalizePhone(lead?.phone);
    if (phone && !leadByPhone.has(phone)) leadByPhone.set(phone, lead);
  }

  return (orders || [])
    .map((rawOrder) => (rawOrder.toJSON ? rawOrder.toJSON() : rawOrder))
    .map((order) => ({
      ...order,
      _attribution: deriveOrderAttribution(order, leadByPhone),
    }))
    .filter((order) => safeObject(order._attribution));
}

function buildReconciledAggregation(items, orders, entityType) {
  const byKey = new Map();
  for (const item of items || []) {
    const key = [
      entityType,
      safeStr(item.campaignId),
      safeStr(item.adGroupId),
      normalizeText(item.keywordText || ''),
      normalizeText(item.searchTerm || ''),
    ].join('|');
    byKey.set(key, { revenue: 0, orders: 0 });
  }

  for (const order of orders || []) {
    const revenue = safeNumber(order?.total_amount, 0);
    if (revenue <= 0) continue;

    let bestKey = null;
    let bestScore = 0;
    for (const item of items || []) {
      const score = entityMatchScore({ entityType, item, attribution: order._attribution });
      if (score > bestScore) {
        bestScore = score;
        bestKey = [
          entityType,
          safeStr(item.campaignId),
          safeStr(item.adGroupId),
          normalizeText(item.keywordText || ''),
          normalizeText(item.searchTerm || ''),
        ].join('|');
      }
    }

    if (bestKey && bestScore > 0) {
      const current = byKey.get(bestKey) || { revenue: 0, orders: 0 };
      current.revenue += revenue;
      current.orders += 1;
      byKey.set(bestKey, current);
    }
  }

  return byKey;
}

function sortItems(items, sortBy = 'conversionValue', sortOrder = 'desc') {
  const direction = safeStr(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => {
    const l = left?.[sortBy];
    const r = right?.[sortBy];
    if (typeof l === 'string' || typeof r === 'string') {
      return safeStr(l).localeCompare(safeStr(r)) * direction;
    }
    return (safeNumber(l, 0) - safeNumber(r, 0)) * direction;
  });
}

function enrichMetrics(item) {
  const cost = safeNumber(item.cost, 0);
  const value = safeNumber(item.conversionValue, 0);
  const conversions = safeNumber(item.conversions, 0);
  const clicks = safeNumber(item.clicks, 0);
  return {
    ...item,
    roi: cost > 0 ? normalizeMetricNumber((value - cost) / cost, 4) : null,
    roas: cost > 0 ? normalizeMetricNumber(value / cost, 4) : null,
    margin: normalizeMetricNumber(value - cost, 4),
    costPerConversion: conversions > 0 ? normalizeMetricNumber(cost / conversions, 4) : null,
    valuePerClick: clicks > 0 ? normalizeMetricNumber(value / clicks, 4) : null,
  };
}

function enrichWithReconciledRevenue(item, reconciled) {
  const internalRevenue = safeNumber(reconciled?.revenue, 0);
  const cost = safeNumber(item.cost, 0);
  return {
    ...item,
    internalRevenue: normalizeMetricNumber(internalRevenue, 4),
    attributedOrders: safeNumber(reconciled?.orders, 0),
    reconciledMargin: normalizeMetricNumber(internalRevenue - cost, 4),
    reconciledRoas: cost > 0 ? normalizeMetricNumber(internalRevenue / cost, 4) : null,
    reconciledRoi: cost > 0 ? normalizeMetricNumber((internalRevenue - cost) / cost, 4) : null,
  };
}

function aggregateBy(items, entityType) {
  const map = new Map();
  for (const item of items || []) {
    const keyParts = {
      campaign: [safeStr(item.campaignId)],
      ad_group: [safeStr(item.campaignId), safeStr(item.adGroupId)],
      keyword: [safeStr(item.campaignId), safeStr(item.adGroupId), safeStr(item.keywordText).toLowerCase(), safeStr(item.matchType)],
      search_term: [safeStr(item.campaignId), safeStr(item.adGroupId), safeStr(item.searchTerm).toLowerCase(), safeStr(item.matchedKeywordText).toLowerCase()],
    };
    const key = (keyParts[entityType] || keyParts.campaign).join('|');
    const current = map.get(key) || {
      entityType,
      campaignId: safeStr(item.campaignId),
      campaignName: safeStr(item.campaignName),
      adGroupId: safeStr(item.adGroupId),
      adGroupName: safeStr(item.adGroupName),
      keywordId: safeStr(item.keywordId || item.matchedKeywordId),
      keywordText: safeStr(item.keywordText || item.matchedKeywordText),
      searchTerm: safeStr(item.searchTerm),
      matchType: safeStr(item.matchType || item.matchedKeywordMatchType),
      firstDate: safeStr(item.firstDate),
      lastDate: safeStr(item.lastDate),
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conversionValue: 0,
    };
    current.impressions += safeNumber(item.impressions, 0);
    current.clicks += safeNumber(item.clicks, 0);
    current.cost += safeNumber(item.cost, 0);
    current.conversions += safeNumber(item.conversions, 0);
    current.conversionValue += safeNumber(item.conversionValue, 0);
    if (safeStr(item.firstDate) && (!current.firstDate || safeStr(item.firstDate) < current.firstDate)) current.firstDate = safeStr(item.firstDate);
    if (safeStr(item.lastDate) && (!current.lastDate || safeStr(item.lastDate) > current.lastDate)) current.lastDate = safeStr(item.lastDate);
    map.set(key, current);
  }
  return Array.from(map.values()).map(enrichMetrics);
}

function buildSummary(keywordItems, searchTermItems) {
  const keywordTotals = keywordItems.reduce((acc, item) => {
    acc.cost += safeNumber(item.cost, 0);
    acc.conversionValue += safeNumber(item.conversionValue, 0);
    acc.conversions += safeNumber(item.conversions, 0);
    acc.clicks += safeNumber(item.clicks, 0);
    acc.impressions += safeNumber(item.impressions, 0);
    return acc;
  }, { cost: 0, conversionValue: 0, conversions: 0, clicks: 0, impressions: 0 });

  const searchTermTotals = searchTermItems.reduce((acc, item) => {
    acc.cost += safeNumber(item.cost, 0);
    acc.conversionValue += safeNumber(item.conversionValue, 0);
    acc.conversions += safeNumber(item.conversions, 0);
    return acc;
  }, { cost: 0, conversionValue: 0, conversions: 0 });

  return {
    keywords: {
      items: keywordItems.length,
      impressions: keywordTotals.impressions,
      clicks: keywordTotals.clicks,
      cost: normalizeMetricNumber(keywordTotals.cost, 4),
      conversions: normalizeMetricNumber(keywordTotals.conversions, 4),
      conversionValue: normalizeMetricNumber(keywordTotals.conversionValue, 4),
      roi: keywordTotals.cost > 0 ? normalizeMetricNumber((keywordTotals.conversionValue - keywordTotals.cost) / keywordTotals.cost, 4) : null,
      roas: keywordTotals.cost > 0 ? normalizeMetricNumber(keywordTotals.conversionValue / keywordTotals.cost, 4) : null,
      margin: normalizeMetricNumber(keywordTotals.conversionValue - keywordTotals.cost, 4),
    },
    searchTerms: {
      items: searchTermItems.length,
      cost: normalizeMetricNumber(searchTermTotals.cost, 4),
      conversions: normalizeMetricNumber(searchTermTotals.conversions, 4),
      conversionValue: normalizeMetricNumber(searchTermTotals.conversionValue, 4),
      roi: searchTermTotals.cost > 0 ? normalizeMetricNumber((searchTermTotals.conversionValue - searchTermTotals.cost) / searchTermTotals.cost, 4) : null,
      roas: searchTermTotals.cost > 0 ? normalizeMetricNumber(searchTermTotals.conversionValue / searchTermTotals.cost, 4) : null,
      margin: normalizeMetricNumber(searchTermTotals.conversionValue - searchTermTotals.cost, 4),
    },
  };
}

function buildReconciledSummary(items) {
  const totals = (items || []).reduce((acc, item) => {
    acc.internalRevenue += safeNumber(item.internalRevenue, 0);
    acc.cost += safeNumber(item.cost, 0);
    acc.attributedOrders += safeNumber(item.attributedOrders, 0);
    return acc;
  }, { internalRevenue: 0, cost: 0, attributedOrders: 0 });

  return {
    internalRevenue: normalizeMetricNumber(totals.internalRevenue, 4),
    attributedOrders: totals.attributedOrders,
    reconciledMargin: normalizeMetricNumber(totals.internalRevenue - totals.cost, 4),
    reconciledRoas: totals.cost > 0 ? normalizeMetricNumber(totals.internalRevenue / totals.cost, 4) : null,
    reconciledRoi: totals.cost > 0 ? normalizeMetricNumber((totals.internalRevenue - totals.cost) / totals.cost, 4) : null,
  };
}

async function getGoogleAdsRoiBreakdown({ tenantId, startDate = null, endDate = null, campaignId = null, adGroupId = null, entity = 'campaign', sortBy = 'conversionValue', sortOrder = 'desc', limit = 100, offset = 0 } = {}) {
  const normalizedEntity = ['campaign', 'ad_group', 'keyword', 'search_term'].includes(safeStr(entity)) ? safeStr(entity) : 'campaign';

  const [keywordsOut, searchTermsOut] = await Promise.all([
    googleAdsKeywordInsightService.listKeywordPerformance({ tenantId, startDate, endDate, campaignId, adGroupId, sortBy: 'cost', sortOrder: 'desc', limit: 5000, offset: 0 }),
    googleAdsKeywordInsightService.listSearchTermPerformance({ tenantId, startDate, endDate, campaignId, adGroupId, sortBy: 'cost', sortOrder: 'desc', limit: 5000, offset: 0 }),
  ]);
  if (!keywordsOut.ok) return keywordsOut;
  if (!searchTermsOut.ok) return searchTermsOut;

  const keywordItems = Array.isArray(keywordsOut.items) ? keywordsOut.items : [];
  const searchTermItems = Array.isArray(searchTermsOut.items) ? searchTermsOut.items : [];
  const sourceItems = normalizedEntity === 'search_term' ? searchTermItems : keywordItems;
  const aggregated = aggregateBy(sourceItems, normalizedEntity);
  const reconciledOrders = await loadReconciledOrders({
    tenantId,
    startDate: keywordsOut.startDate || searchTermsOut.startDate,
    endDate: keywordsOut.endDate || searchTermsOut.endDate,
  }).catch(() => []);
  const reconciledMap = buildReconciledAggregation(aggregated, reconciledOrders, normalizedEntity);
  const withRevenue = aggregated.map((item) => {
    const key = [
      normalizedEntity,
      safeStr(item.campaignId),
      safeStr(item.adGroupId),
      normalizeText(item.keywordText || ''),
      normalizeText(item.searchTerm || ''),
    ].join('|');
    return enrichWithReconciledRevenue(item, reconciledMap.get(key));
  });
  const items = sortItems(withRevenue, sortBy, sortOrder);
  const paging = parsePaging({ limit, offset });

  return {
    ok: true,
    entity: normalizedEntity,
    startDate: keywordsOut.startDate || searchTermsOut.startDate || null,
    endDate: keywordsOut.endDate || searchTermsOut.endDate || null,
    summary: {
      ...buildSummary(keywordItems, searchTermItems),
      reconciled: buildReconciledSummary(withRevenue),
    },
    total: items.length,
    items: items.slice(paging.offset, paging.offset + paging.limit),
    ...paging,
  };
}

module.exports = {
  getGoogleAdsRoiBreakdown,
};