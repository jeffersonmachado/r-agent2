'use strict';

function nowIso() {
  return new Date().toISOString();
}

const DEFAULT_MAX_VALUES_PER_KEY = 20;

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatchesText(text, keyword) {
  const rawKeyword = String(keyword || '').trim().toLowerCase();
  if (!rawKeyword) return false;
  if (rawKeyword.includes(' ')) return text.includes(rawKeyword);
  const regex = new RegExp(`\\b${escapeRegexLiteral(rawKeyword)}\\b`, 'i');
  return regex.test(text);
}

function addEntity(bucket, meta, key, value, source = 'regex', confidence = 0.7) {
  if (value === null || value === undefined || value === '') return;

  const item = {
    value,
    source,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.5)),
    updated_at: nowIso(),
  };

  if (!bucket[key]) {
    bucket[key] = item;
  } else if (Array.isArray(bucket[key])) {
    if (bucket[key].length >= DEFAULT_MAX_VALUES_PER_KEY) return;
    const signature = JSON.stringify(value);
    const exists = bucket[key].some((entry) => JSON.stringify(entry.value) === signature);
    if (!exists) bucket[key].push(item);
  } else if (JSON.stringify(bucket[key].value) !== JSON.stringify(value)) {
    bucket[key] = [bucket[key], item];
  }

  meta[key] = {
    source: item.source,
    confidence: item.confidence,
    updated_at: item.updated_at,
  };
}

function matchAll(text, regex) {
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    matches.push(m);
  }
  return matches;
}

function extractEntitiesFromText(text, { tenant_id, channel, keywords, tenantKeywords } = {}) {
  const warnings = [];
  const entities = {};
  const meta = {};
  const input = String(text || '');
  const lower = input.toLowerCase();

  if (!input.trim()) {
    warnings.push('empty_text');
    return { entities, meta, warnings };
  }

  const emails = matchAll(input, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
  emails.forEach((m) => addEntity(entities, meta, 'email', m[0].toLowerCase(), 'regex', 0.95));

  const phones = matchAll(input, /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[-\s]?\d{4}\b/g);
  phones.forEach((m) => addEntity(entities, meta, 'phone', String(m[0]).replace(/\D+/g, ''), 'regex', 0.85));

  const cpfs = matchAll(input, /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g);
  cpfs.forEach((m) => addEntity(entities, meta, 'cpf', String(m[0]).replace(/\D+/g, ''), 'regex', 0.92));

  const cnpjs = matchAll(input, /\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g);
  cnpjs.forEach((m) => addEntity(entities, meta, 'cnpj', String(m[0]).replace(/\D+/g, ''), 'regex', 0.92));

  const money = matchAll(input, /(?:R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\b\d+[\.,]\d{2}\s?(?:reais|brl)\b)/gi);
  money.forEach((m) => addEntity(entities, meta, 'money', m[0], 'regex', 0.8));

  const dates = matchAll(input, /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g);
  dates.forEach((m) => addEntity(entities, meta, 'date', m[0], 'regex', 0.75));

  const times = matchAll(input, /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g);
  times.forEach((m) => addEntity(entities, meta, 'time', m[0], 'regex', 0.75));

  const idPatterns = [
    { key: 'order_id', regex: /(?:pedido|order)\s*(?:n[oº°]?\s*)?[:#-]?\s*([a-z0-9\-_]{3,})/gi },
    { key: 'ticket_id', regex: /(?:ticket|chamado)\s*(?:n[oº°]?\s*)?[:#-]?\s*([a-z0-9\-_]{3,})/gi },
    { key: 'invoice_id', regex: /(?:fatura|invoice|nota)\s*(?:n[oº°]?\s*)?[:#-]?\s*([a-z0-9\-_]{3,})/gi },
    { key: 'contract_id', regex: /(?:contrato|contract)\s*(?:n[oº°]?\s*)?[:#-]?\s*([a-z0-9\-_]{3,})/gi },
  ];
  idPatterns.forEach((pattern) => {
    const matches = matchAll(lower, pattern.regex);
    matches.forEach((m) => addEntity(entities, meta, pattern.key, m[1], 'regex', 0.82));
  });

  if (/erro|status|http/i.test(input)) {
    const statuses = matchAll(input, /\b(?:http\s*)?(?:status\s*)?(4\d{2}|5\d{2})\b/gi);
    statuses.forEach((m) => addEntity(entities, meta, 'http_status', Number(m[1]), 'regex', 0.78));
  }

  const errorCodes = matchAll(input, /\b(?:erro|error|code|c[oó]digo)\s*[:#-]?\s*([a-z]{1,5}-?\d{2,6}|\d{3,6})\b/gi);
  errorCodes.forEach((m) => addEntity(entities, meta, 'error_code', m[1], 'regex', 0.76));

  const defaultProductKeywords = ['plano', 'premium', 'pro', 'enterprise', 'starter', 'produto', 'assinatura'];
  const tenantKeywordList = Array.isArray(tenantKeywords)
    ? tenantKeywords
    : [];
  const sourceKeywords = Array.isArray(keywords) && keywords.length > 0
    ? keywords
    : (tenantKeywordList.length > 0 ? tenantKeywordList : defaultProductKeywords);
  const effectiveKeywords = Array.from(new Set(
    sourceKeywords
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  ));

  const foundProducts = effectiveKeywords.filter((kw) => keywordMatchesText(lower, kw));
  foundProducts.forEach((kw) => addEntity(entities, meta, 'product_or_plan', kw, 'regex', 0.68));

  if (!tenant_id) warnings.push('tenant_id_missing');
  if (!channel) warnings.push('channel_missing');

  return { entities, meta, warnings };
}

module.exports = {
  extractEntitiesFromText,
};
