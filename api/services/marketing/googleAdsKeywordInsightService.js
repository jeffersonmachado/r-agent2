'use strict';

const crypto = require('crypto');
const { MarketingAdsKeywordMetric, MarketingAdsSearchTermMetric } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { generateAiResponse } = require('../aiProviderService');
const googleAdsConversionService = require('./googleAdsConversionService');

function dbAvailable() {
  return !!getSequelize();
}

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

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePaging({ limit = 100, offset = 0 } = {}) {
  return {
    limit: Math.min(Math.max(Number(limit) || 100, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  };
}

function normalizeCustomerId(value) {
  return safeStr(value).replace(/\D+/g, '');
}

function normalizeDateString(value, fallbackDate = new Date()) {
  if (!value) {
    return fallbackDate.toISOString().slice(0, 10);
  }
  const parsed = new Date(safeToString(value));
  if (Number.isNaN(parsed.getTime())) {
    return fallbackDate.toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function defaultDateRange({ startDate = null, endDate = null, days = 30 } = {}) {
  const end = normalizeDateString(endDate, new Date());
  if (startDate) {
    return { startDate: normalizeDateString(startDate), endDate: end };
  }
  const base = new Date(`${end}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - Math.max(Number(days) || 30, 1) + 1);
  return {
    startDate: base.toISOString().slice(0, 10),
    endDate: end,
  };
}

function normalizeMetricNumber(value, decimals = 4) {
  return Number(safeNumber(value, 0).toFixed(decimals));
}

function microsToCurrency(value) {
  return normalizeMetricNumber(safeNumber(value, 0) / 1000000, 4);
}

function deterministicId(prefix, parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);
  return `${prefix}-${hash}`;
}

function getFetchFn() {
  if (typeof global.fetch === 'function') return global.fetch;
  // eslint-disable-next-line global-require
  return require('node-fetch');
}

function ensureGoogleAdsReadiness(settings) {
  if (!settings || settings.enabled !== true) return { ok: false, error: 'integration_disabled' };
  if (!normalizeCustomerId(settings.customerId)) return { ok: false, error: 'customer_id_required' };
  if (!safeStr(settings.developerToken)) return { ok: false, error: 'developer_token_required' };
  if (!safeStr(settings.clientId)) return { ok: false, error: 'client_id_required' };
  if (!safeStr(settings.clientSecret)) return { ok: false, error: 'client_secret_required' };
  if (!safeStr(settings.refreshToken)) return { ok: false, error: 'refresh_token_required' };
  return { ok: true };
}

async function requestAccessToken(settings) {
  const fetchFn = getFetchFn();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    refresh_token: settings.refreshToken,
  });

  const response = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !safeStr(payload.access_token)) {
    throw new Error(`google_oauth_failed:${response.status}:${safeStr(payload.error_description || payload.error || 'token_unavailable')}`);
  }
  return payload.access_token;
}

async function searchStream({ settings, query, accessToken = null }) {
  const readiness = ensureGoogleAdsReadiness(settings);
  if (!readiness.ok) {
    throw new Error(readiness.error);
  }
  const token = accessToken || await requestAccessToken(settings);
  const fetchFn = getFetchFn();
  const customerId = normalizeCustomerId(settings.customerId);
  const response = await fetchFn(`https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': settings.developerToken,
      ...(settings.loginCustomerId ? { 'login-customer-id': normalizeCustomerId(settings.loginCustomerId) } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json().catch(() => ([]));
  if (!response.ok) {
    throw new Error(`google_ads_query_failed:${response.status}:${safeStr(payload.error?.message || payload.message || 'unknown_error')}`);
  }
  const chunks = Array.isArray(payload) ? payload : [payload];
  return chunks.flatMap((chunk) => (Array.isArray(chunk?.results) ? chunk.results : []));
}

function normalizeKeywordMetricRow(row) {
  const metrics = safeObject(row?.metrics) || {};
  const campaign = safeObject(row?.campaign) || {};
  const adGroup = safeObject(row?.adGroup) || {};
  const criterion = safeObject(row?.adGroupCriterion) || {};
  const keyword = safeObject(criterion.keyword) || {};
  const segments = safeObject(row?.segments) || {};

  return {
    metricDate: normalizeDateString(segments.date),
    campaignId: safeStr(campaign.id),
    campaignName: safeStr(campaign.name),
    adGroupId: safeStr(adGroup.id),
    adGroupName: safeStr(adGroup.name),
    keywordId: safeStr(criterion.criterionId),
    keywordText: safeStr(keyword.text),
    matchType: safeStr(keyword.matchType),
    status: safeStr(criterion.status),
    impressions: Math.max(Math.floor(safeNumber(metrics.impressions, 0)), 0),
    clicks: Math.max(Math.floor(safeNumber(metrics.clicks, 0)), 0),
    cost: microsToCurrency(metrics.costMicros),
    conversions: normalizeMetricNumber(metrics.conversions, 4),
    conversionValue: normalizeMetricNumber(metrics.conversionsValue, 4),
    averageCpc: metrics.averageCpc != null ? microsToCurrency(metrics.averageCpc) : null,
    ctr: metrics.ctr != null ? normalizeMetricNumber(metrics.ctr, 6) : null,
    metadata: safeObject(row) || {},
  };
}

function normalizeSearchTermMetricRow(row) {
  const metrics = safeObject(row?.metrics) || {};
  const campaign = safeObject(row?.campaign) || {};
  const adGroup = safeObject(row?.adGroup) || {};
  const searchTermView = safeObject(row?.searchTermView) || {};
  const criterion = safeObject(row?.adGroupCriterion) || {};
  const keyword = safeObject(criterion.keyword) || {};
  const segments = safeObject(row?.segments) || {};

  return {
    metricDate: normalizeDateString(segments.date),
    campaignId: safeStr(campaign.id),
    campaignName: safeStr(campaign.name),
    adGroupId: safeStr(adGroup.id),
    adGroupName: safeStr(adGroup.name),
    searchTerm: safeStr(searchTermView.searchTerm),
    matchType: safeStr(searchTermView.matchType),
    matchedKeywordId: safeStr(criterion.criterionId),
    matchedKeywordText: safeStr(keyword.text),
    matchedKeywordMatchType: safeStr(keyword.matchType),
    status: safeStr(searchTermView.status),
    impressions: Math.max(Math.floor(safeNumber(metrics.impressions, 0)), 0),
    clicks: Math.max(Math.floor(safeNumber(metrics.clicks, 0)), 0),
    cost: microsToCurrency(metrics.costMicros),
    conversions: normalizeMetricNumber(metrics.conversions, 4),
    conversionValue: normalizeMetricNumber(metrics.conversionsValue, 4),
    averageCpc: metrics.averageCpc != null ? microsToCurrency(metrics.averageCpc) : null,
    ctr: metrics.ctr != null ? normalizeMetricNumber(metrics.ctr, 6) : null,
    metadata: safeObject(row) || {},
  };
}

async function syncKeywordPerformance({ tenantId, startDate = null, endDate = null } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const range = defaultDateRange({ startDate, endDate, days: 30 });
  const settingsOut = await googleAdsConversionService.getGoogleAdsSettingsForUpload({ tenantId: tenantKey });
  if (!settingsOut.ok) return settingsOut;
  const settings = settingsOut.value;

  const keywordQuery = [
    'SELECT',
    '  segments.date,',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  ad_group_criterion.criterion_id,',
    '  ad_group_criterion.status,',
    '  ad_group_criterion.keyword.text,',
    '  ad_group_criterion.keyword.match_type,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.cost_micros,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.average_cpc,',
    '  metrics.ctr',
    'FROM keyword_view',
    `WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'`,
    '  AND ad_group_criterion.type = KEYWORD',
  ].join(' ');

  const searchTermQuery = [
    'SELECT',
    '  segments.date,',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  search_term_view.search_term,',
    '  search_term_view.status,',
    '  search_term_view.match_type,',
    '  ad_group_criterion.criterion_id,',
    '  ad_group_criterion.keyword.text,',
    '  ad_group_criterion.keyword.match_type,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.cost_micros,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.average_cpc,',
    '  metrics.ctr',
    'FROM search_term_view',
    `WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'`,
  ].join(' ');

  const [keywordRows, searchTermRows] = await Promise.all([
    requestAccessToken(settings).then((accessToken) => Promise.all([
      searchStream({ settings, query: keywordQuery, accessToken }),
      searchStream({ settings, query: searchTermQuery, accessToken }),
    ])),
  ]);

  const [resolvedKeywordRows, resolvedSearchTermRows] = keywordRows;

  const KeywordModel = MarketingAdsKeywordMetric();
  const SearchTermModel = MarketingAdsSearchTermMetric();

  let keywordSynced = 0;
  for (const rawRow of resolvedKeywordRows) {
    const row = normalizeKeywordMetricRow(rawRow);
    if (!row.campaignId || !row.keywordText) continue;
    const id = deterministicId('madskw', [tenantKey, row.metricDate, row.campaignId, row.adGroupId || '-', row.keywordId || row.keywordText, row.matchType || '-']);
    // eslint-disable-next-line no-await-in-loop
    await KeywordModel.upsert({
      id,
      tenant_key: tenantKey,
      platform: 'google_ads',
      metric_date: row.metricDate,
      campaign_id: row.campaignId,
      campaign_name: row.campaignName || null,
      ad_group_id: row.adGroupId || null,
      ad_group_name: row.adGroupName || null,
      keyword_id: row.keywordId || null,
      keyword_text: row.keywordText,
      match_type: row.matchType || null,
      status: row.status || null,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.cost,
      conversions: row.conversions,
      conversion_value: row.conversionValue,
      average_cpc: row.averageCpc,
      ctr: row.ctr,
      metadata: row.metadata,
    });
    keywordSynced += 1;
  }

  let searchTermSynced = 0;
  for (const rawRow of resolvedSearchTermRows) {
    const row = normalizeSearchTermMetricRow(rawRow);
    if (!row.campaignId || !row.searchTerm) continue;
    const id = deterministicId('madsst', [tenantKey, row.metricDate, row.campaignId, row.adGroupId || '-', row.searchTerm.toLowerCase(), row.matchedKeywordId || row.matchedKeywordText || '-']);
    // eslint-disable-next-line no-await-in-loop
    await SearchTermModel.upsert({
      id,
      tenant_key: tenantKey,
      platform: 'google_ads',
      metric_date: row.metricDate,
      campaign_id: row.campaignId,
      campaign_name: row.campaignName || null,
      ad_group_id: row.adGroupId || null,
      ad_group_name: row.adGroupName || null,
      search_term: row.searchTerm,
      match_type: row.matchType || null,
      matched_keyword_id: row.matchedKeywordId || null,
      matched_keyword_text: row.matchedKeywordText || null,
      matched_keyword_match_type: row.matchedKeywordMatchType || null,
      status: row.status || null,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.cost,
      conversions: row.conversions,
      conversion_value: row.conversionValue,
      average_cpc: row.averageCpc,
      ctr: row.ctr,
      metadata: row.metadata,
    });
    searchTermSynced += 1;
  }

  return {
    ok: true,
    startDate: range.startDate,
    endDate: range.endDate,
    keywordRows: resolvedKeywordRows.length,
    searchTermRows: resolvedSearchTermRows.length,
    keywordSynced,
    searchTermSynced,
  };
}

function withinDateRange(metricDate, startDate, endDate) {
  const value = safeStr(metricDate);
  if (!value) return false;
  return value >= startDate && value <= endDate;
}

function aggregateKeywordRows(rows) {
  const map = new Map();
  for (const raw of rows) {
    const row = raw.toJSON ? raw.toJSON() : raw;
    const key = [
      safeStr(row.campaign_id),
      safeStr(row.ad_group_id),
      safeStr(row.keyword_text).toLowerCase(),
      safeStr(row.match_type),
    ].join('|');
    const current = map.get(key) || {
      campaignId: safeStr(row.campaign_id),
      campaignName: safeStr(row.campaign_name),
      adGroupId: safeStr(row.ad_group_id),
      adGroupName: safeStr(row.ad_group_name),
      keywordId: safeStr(row.keyword_id),
      keywordText: safeStr(row.keyword_text),
      matchType: safeStr(row.match_type),
      status: safeStr(row.status),
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conversionValue: 0,
      firstDate: safeStr(row.metric_date),
      lastDate: safeStr(row.metric_date),
    };
    current.impressions += safeNumber(row.impressions, 0);
    current.clicks += safeNumber(row.clicks, 0);
    current.cost += safeNumber(row.cost, 0);
    current.conversions += safeNumber(row.conversions, 0);
    current.conversionValue += safeNumber(row.conversion_value, 0);
    if (safeStr(row.metric_date) < current.firstDate) current.firstDate = safeStr(row.metric_date);
    if (safeStr(row.metric_date) > current.lastDate) current.lastDate = safeStr(row.metric_date);
    map.set(key, current);
  }

  return Array.from(map.values()).map((item) => ({
    ...item,
    ctr: item.impressions > 0 ? normalizeMetricNumber(item.clicks / item.impressions, 6) : 0,
    averageCpc: item.clicks > 0 ? normalizeMetricNumber(item.cost / item.clicks, 4) : 0,
    costPerConversion: item.conversions > 0 ? normalizeMetricNumber(item.cost / item.conversions, 4) : null,
    roas: item.cost > 0 ? normalizeMetricNumber(item.conversionValue / item.cost, 4) : null,
  }));
}

function aggregateSearchTermRows(rows) {
  const map = new Map();
  for (const raw of rows) {
    const row = raw.toJSON ? raw.toJSON() : raw;
    const key = [
      safeStr(row.campaign_id),
      safeStr(row.ad_group_id),
      safeStr(row.search_term).toLowerCase(),
      safeStr(row.matched_keyword_text).toLowerCase(),
    ].join('|');
    const current = map.get(key) || {
      campaignId: safeStr(row.campaign_id),
      campaignName: safeStr(row.campaign_name),
      adGroupId: safeStr(row.ad_group_id),
      adGroupName: safeStr(row.ad_group_name),
      searchTerm: safeStr(row.search_term),
      matchType: safeStr(row.match_type),
      matchedKeywordId: safeStr(row.matched_keyword_id),
      matchedKeywordText: safeStr(row.matched_keyword_text),
      matchedKeywordMatchType: safeStr(row.matched_keyword_match_type),
      status: safeStr(row.status),
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conversionValue: 0,
      firstDate: safeStr(row.metric_date),
      lastDate: safeStr(row.metric_date),
    };
    current.impressions += safeNumber(row.impressions, 0);
    current.clicks += safeNumber(row.clicks, 0);
    current.cost += safeNumber(row.cost, 0);
    current.conversions += safeNumber(row.conversions, 0);
    current.conversionValue += safeNumber(row.conversion_value, 0);
    if (safeStr(row.metric_date) < current.firstDate) current.firstDate = safeStr(row.metric_date);
    if (safeStr(row.metric_date) > current.lastDate) current.lastDate = safeStr(row.metric_date);
    map.set(key, current);
  }

  return Array.from(map.values()).map((item) => ({
    ...item,
    ctr: item.impressions > 0 ? normalizeMetricNumber(item.clicks / item.impressions, 6) : 0,
    averageCpc: item.clicks > 0 ? normalizeMetricNumber(item.cost / item.clicks, 4) : 0,
    costPerConversion: item.conversions > 0 ? normalizeMetricNumber(item.cost / item.conversions, 4) : null,
    roas: item.cost > 0 ? normalizeMetricNumber(item.conversionValue / item.cost, 4) : null,
  }));
}

function sortItems(items, sortBy = 'cost', sortOrder = 'desc') {
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

async function listKeywordPerformance({ tenantId, startDate = null, endDate = null, campaignId = null, adGroupId = null, matchType = null, sortBy = 'cost', sortOrder = 'desc', limit = 100, offset = 0 } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  const range = defaultDateRange({ startDate, endDate, days: 30 });
  const Model = MarketingAdsKeywordMetric();
  const rows = await Model.findAll({ where: { tenant_key: tenantKey, platform: 'google_ads' } });
  const filtered = rows.filter((raw) => {
    const row = raw.toJSON ? raw.toJSON() : raw;
    if (!withinDateRange(row.metric_date, range.startDate, range.endDate)) return false;
    if (campaignId && safeStr(row.campaign_id) !== safeStr(campaignId)) return false;
    if (adGroupId && safeStr(row.ad_group_id) !== safeStr(adGroupId)) return false;
    if (matchType && safeStr(row.match_type).toLowerCase() !== safeStr(matchType).toLowerCase()) return false;
    return true;
  });
  const items = sortItems(aggregateKeywordRows(filtered), sortBy, sortOrder);
  const paging = parsePaging({ limit, offset });
  return {
    ok: true,
    total: items.length,
    items: items.slice(paging.offset, paging.offset + paging.limit),
    startDate: range.startDate,
    endDate: range.endDate,
    ...paging,
  };
}

async function listSearchTermPerformance({ tenantId, startDate = null, endDate = null, campaignId = null, adGroupId = null, sortBy = 'cost', sortOrder = 'desc', limit = 100, offset = 0 } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  const range = defaultDateRange({ startDate, endDate, days: 30 });
  const Model = MarketingAdsSearchTermMetric();
  const rows = await Model.findAll({ where: { tenant_key: tenantKey, platform: 'google_ads' } });
  const filtered = rows.filter((raw) => {
    const row = raw.toJSON ? raw.toJSON() : raw;
    if (!withinDateRange(row.metric_date, range.startDate, range.endDate)) return false;
    if (campaignId && safeStr(row.campaign_id) !== safeStr(campaignId)) return false;
    if (adGroupId && safeStr(row.ad_group_id) !== safeStr(adGroupId)) return false;
    return true;
  });
  const items = sortItems(aggregateSearchTermRows(filtered), sortBy, sortOrder);
  const paging = parsePaging({ limit, offset });
  return {
    ok: true,
    total: items.length,
    items: items.slice(paging.offset, paging.offset + paging.limit),
    startDate: range.startDate,
    endDate: range.endDate,
    ...paging,
  };
}

function normalizeTerm(value) {
  return safeStr(value).toLowerCase();
}

function heuristicRecommendations({ keywords, searchTerms, options = {} }) {
  const minClicks = Math.max(safeNumber(options.minClicks, 8), 1);
  const minImpressions = Math.max(safeNumber(options.minImpressions, 100), 1);
  const minCost = Math.max(safeNumber(options.minCost, 20), 0);
  const includeMinConversions = Math.max(safeNumber(options.includeMinConversions, 1), 0);

  const keywordSet = new Set(keywords.map((item) => normalizeTerm(item.keywordText)));
  const recommendations = [];

  for (const term of searchTerms) {
    if (term.clicks >= minClicks && term.conversions >= includeMinConversions && term.conversionValue > 0 && !keywordSet.has(normalizeTerm(term.searchTerm))) {
      recommendations.push({
        action: 'include_keyword',
        source: 'heuristic',
        confidence: 0.86,
        entityType: 'search_term',
        term: term.searchTerm,
        campaignId: term.campaignId,
        campaignName: term.campaignName,
        adGroupId: term.adGroupId,
        adGroupName: term.adGroupName,
        matchedKeywordText: term.matchedKeywordText,
        rationale: 'O termo já converteu e ainda não aparece como keyword explícita no portfólio sincronizado.',
        reasonCode: 'search_term_converting_without_exact_keyword',
        metrics: {
          impressions: term.impressions,
          clicks: term.clicks,
          cost: normalizeMetricNumber(term.cost, 4),
          conversions: normalizeMetricNumber(term.conversions, 4),
          conversionValue: normalizeMetricNumber(term.conversionValue, 4),
          roas: term.roas,
        },
      });
    }
    if (term.impressions < minImpressions) continue;
    if (term.clicks >= minClicks && term.cost >= minCost && term.conversions <= 0) {
      recommendations.push({
        action: 'add_negative_keyword',
        source: 'heuristic',
        confidence: 0.83,
        entityType: 'search_term',
        term: term.searchTerm,
        campaignId: term.campaignId,
        campaignName: term.campaignName,
        adGroupId: term.adGroupId,
        adGroupName: term.adGroupName,
        matchedKeywordText: term.matchedKeywordText,
        rationale: 'O termo consumiu clique e custo sem gerar conversão dentro da janela analisada.',
        reasonCode: 'search_term_spend_without_conversion',
        metrics: {
          impressions: term.impressions,
          clicks: term.clicks,
          cost: normalizeMetricNumber(term.cost, 4),
          conversions: normalizeMetricNumber(term.conversions, 4),
          conversionValue: normalizeMetricNumber(term.conversionValue, 4),
          ctr: term.ctr,
        },
      });
    }
  }

  for (const keyword of keywords) {
    if (keyword.impressions < minImpressions) continue;
    if (keyword.clicks >= minClicks && keyword.cost >= minCost && keyword.conversions <= 0) {
      recommendations.push({
        action: 'remove_or_pause_keyword',
        source: 'heuristic',
        confidence: 0.81,
        entityType: 'keyword',
        keywordText: keyword.keywordText,
        matchType: keyword.matchType,
        campaignId: keyword.campaignId,
        campaignName: keyword.campaignName,
        adGroupId: keyword.adGroupId,
        adGroupName: keyword.adGroupName,
        rationale: 'A keyword acumulou gasto e clique sem conversão, indicando baixa eficiência.',
        reasonCode: 'keyword_spend_without_conversion',
        metrics: {
          impressions: keyword.impressions,
          clicks: keyword.clicks,
          cost: normalizeMetricNumber(keyword.cost, 4),
          conversions: normalizeMetricNumber(keyword.conversions, 4),
          conversionValue: normalizeMetricNumber(keyword.conversionValue, 4),
          ctr: keyword.ctr,
        },
      });
    }
  }

  return recommendations.sort((left, right) => safeNumber(right.metrics?.cost, 0) - safeNumber(left.metrics?.cost, 0));
}

function fallbackAiSummary({ recommendations, winners, losers }) {
  const topWinner = winners[0];
  const topLoser = losers[0];
  return {
    summary: [
      topWinner ? `Melhor oportunidade: ${topWinner.keywordText} com ROAS ${topWinner.roas ?? 'n/a'} e valor ${topWinner.conversionValue}.` : 'Nenhuma keyword vencedora clara na janela analisada.',
      topLoser ? `Maior ineficiência: ${topLoser.keywordText} consumiu ${topLoser.cost} sem conversões.` : 'Nenhuma keyword crítica para pausa foi identificada.',
      `Foram geradas ${recommendations.length} recomendações heurísticas para inclusão, negativação ou remoção.`,
    ].join(' '),
    suggestions: recommendations.slice(0, 5).map((item) => ({
      action: item.action,
      term: item.term || item.keywordText || '',
      rationale: item.rationale,
      confidence: item.confidence,
    })),
  };
}

function stripJsonFence(text) {
  const raw = safeStr(text);
  if (!raw) return '';
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

async function aiAnalyzeKeywordPortfolio({ tenantId, range, keywordItems, searchTermItems, recommendations }) {
  if (!tenantId || recommendations.length === 0) {
    return fallbackAiSummary({
      recommendations,
      winners: keywordItems.filter((item) => safeNumber(item.conversions, 0) > 0).sort((a, b) => safeNumber(b.roas, 0) - safeNumber(a.roas, 0)),
      losers: keywordItems.filter((item) => safeNumber(item.cost, 0) > 0 && safeNumber(item.conversions, 0) <= 0).sort((a, b) => safeNumber(b.cost, 0) - safeNumber(a.cost, 0)),
    });
  }

  const winners = keywordItems
    .filter((item) => safeNumber(item.conversions, 0) > 0)
    .sort((a, b) => safeNumber(b.roas, 0) - safeNumber(a.roas, 0))
    .slice(0, 5)
    .map((item) => ({ keyword: item.keywordText, conversions: item.conversions, cost: item.cost, value: item.conversionValue, roas: item.roas }));
  const badTerms = searchTermItems
    .filter((item) => safeNumber(item.clicks, 0) > 0 && safeNumber(item.conversions, 0) <= 0)
    .sort((a, b) => safeNumber(b.cost, 0) - safeNumber(a.cost, 0))
    .slice(0, 5)
    .map((item) => ({ searchTerm: item.searchTerm, cost: item.cost, clicks: item.clicks, matchedKeyword: item.matchedKeywordText }));

  const prompt = [
    'Você é um analista sênior de Google Ads focado em search.',
    'Analise os dados de keywords e search terms abaixo e gere recomendações acionáveis para otimização.',
    'Responda em JSON puro com o formato:',
    '{"summary":"...","suggestions":[{"action":"include_keyword|add_negative_keyword|remove_or_pause_keyword","term":"...","rationale":"...","confidence":0.0}]}.',
    'Use no máximo 5 sugestões e escreva em português brasileiro.',
    `Janela: ${range.startDate} até ${range.endDate}.`,
    `Keywords vencedoras: ${JSON.stringify(winners)}.`,
    `Search terms problemáticos: ${JSON.stringify(badTerms)}.`,
    `Recomendações heurísticas já identificadas: ${JSON.stringify(recommendations.slice(0, 10))}.`,
  ].join('\n');

  try {
    const aiResponse = await generateAiResponse(prompt, tenantId, {
      source: 'marketing.google_ads.keyword_analysis',
      caller: 'googleAdsKeywordInsightService.aiAnalyzeKeywordPortfolio',
    });
    const parsed = JSON.parse(stripJsonFence(aiResponse?.text || ''));
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.map((item) => ({
        action: safeStr(item?.action),
        term: safeStr(item?.term),
        rationale: safeStr(item?.rationale),
        confidence: safeNumber(item?.confidence, 0.7),
      })).filter((item) => item.action && item.term)
      : [];
    if (!safeStr(parsed?.summary) && suggestions.length === 0) {
      throw new Error('ai_empty_analysis');
    }
    return {
      summary: safeStr(parsed.summary),
      suggestions,
    };
  } catch (_) {
    return fallbackAiSummary({
      recommendations,
      winners: keywordItems.filter((item) => safeNumber(item.conversions, 0) > 0).sort((a, b) => safeNumber(b.roas, 0) - safeNumber(a.roas, 0)),
      losers: keywordItems.filter((item) => safeNumber(item.cost, 0) > 0 && safeNumber(item.conversions, 0) <= 0).sort((a, b) => safeNumber(b.cost, 0) - safeNumber(a.cost, 0)),
    });
  }
}

async function analyzeKeywordPortfolio({ tenantId, startDate = null, endDate = null, options = {} } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const range = defaultDateRange({ startDate, endDate, days: 30 });
  const [keywordOut, searchTermOut] = await Promise.all([
    listKeywordPerformance({ tenantId, startDate: range.startDate, endDate: range.endDate, limit: 5000, offset: 0 }),
    listSearchTermPerformance({ tenantId, startDate: range.startDate, endDate: range.endDate, limit: 5000, offset: 0 }),
  ]);
  if (!keywordOut.ok) return keywordOut;
  if (!searchTermOut.ok) return searchTermOut;

  const keywordItems = keywordOut.items;
  const searchTermItems = searchTermOut.items;
  const recommendations = heuristicRecommendations({ keywords: keywordItems, searchTerms: searchTermItems, options });
  const ai = await aiAnalyzeKeywordPortfolio({
    tenantId: safeStr(tenantId),
    range,
    keywordItems,
    searchTermItems,
    recommendations,
  });

  return {
    ok: true,
    startDate: range.startDate,
    endDate: range.endDate,
    totals: {
      keywords: keywordItems.length,
      searchTerms: searchTermItems.length,
      keywordCost: normalizeMetricNumber(keywordItems.reduce((sum, item) => sum + safeNumber(item.cost, 0), 0), 4),
      keywordConversionValue: normalizeMetricNumber(keywordItems.reduce((sum, item) => sum + safeNumber(item.conversionValue, 0), 0), 4),
      searchTermCost: normalizeMetricNumber(searchTermItems.reduce((sum, item) => sum + safeNumber(item.cost, 0), 0), 4),
    },
    recommendations,
    ai,
  };
}

module.exports = {
  syncKeywordPerformance,
  listKeywordPerformance,
  listSearchTermPerformance,
  analyzeKeywordPortfolio,
};