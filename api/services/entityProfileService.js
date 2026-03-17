const logger = require('../utils/logger');
const { generateAiResponse } = require('./aiProviderService');
const { getTenant } = require('./tenantService');

/**
 * @typedef {{
 *  sourceType?: 'uploaded_file'|'web_scraping'|'unknown',
 *  sourceId?: string,
 *  score?: number,
 *  text?: string,
 *  excerpt?: string,
 *  chunkId?: string|null,
 *  hash?: string,
 * }} RagContextChunk
 */

/**
 * @typedef {{
 *  name: string,
 *  website: string|null,
 *  segment: string|null,
 *  whatItDoes: string|null,
 *  productsServices: string[],
 *  audience: string[],
 *  differentials: string[],
 *  proofPoints: Array<{label: string, value: string, source: string|null}>,
 *  contacts: {phone: string|null, whatsapp: string|null, email: string|null},
 *  channels: {instagram: string|null, facebook: string|null, maps: string|null},
 *  locations: string[],
 *  paymentMethods: string[],
 *  legal: {cnpj: string|null},
 *  operatingHours: string[],
 *  tone: 'profissional'|'moderno'|'acolhedor'|'premium'|'neutro',
 *  confidence: number
 * }} EntityProfile
 */

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function safeString(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  try {
    return String(v);
  } catch (_) {
    return fallback;
  }
}

function cleanOcrText(s) {
  let out = safeString(s);
  // remove control chars
  out = out.replace(/[\u0000-\u001F\u007F]/g, ' ');
  // join broken hyphenation from OCR/wrapped PDFs: "qualida- de" -> "qualidade"
  out = out.replace(/([A-Za-zÀ-ÿ]{2,})-\s+([a-zà-ÿ]{2,})/g, '$1$2');
  // collapse whitespace
  out = out.replace(/\s+/g, ' ').trim();
  // normalize spaced punctuation
  out = out.replace(/\s+([,.;:!?])/g, '$1');
  return out;
}

function normalizeForMatch(s) {
  return safeString(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(arr) ? arr : []) {
    const v = safeString(it).trim();
    if (!v) continue;
    const k = normalizeForMatch(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= 30) break;
  }
  return out;
}

function dedupeProofPoints(items) {
  const out = [];
  const seen = new Set();
  for (const pp of Array.isArray(items) ? items : []) {
    if (!pp || typeof pp !== 'object') continue;
    const label = safeString(pp.label).trim();
    const value = safeString(pp.value).trim();
    const source = pp.source === null || pp.source === undefined ? null : safeString(pp.source).trim() || null;
    if (!label || !value) continue;
    const k = normalizeForMatch(`${label}::${value}::${source || ''}`);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label, value, source });
    if (out.length >= 20) break;
  }
  return out;
}

function emptyProfile() {
  return {
    name: '',
    website: null,
    segment: null,
    whatItDoes: null,
    productsServices: [],
    audience: [],
    differentials: [],
    proofPoints: [],
    contacts: { phone: null, whatsapp: null, email: null },
    channels: { instagram: null, facebook: null, maps: null },
    locations: [],
    paymentMethods: [],
    legal: { cnpj: null },
    operatingHours: [],
    tone: 'neutro',
    confidence: 0,
  };
}

function coerceProfile(obj) {
  const base = emptyProfile();
  const o = (obj && typeof obj === 'object') ? obj : {};
  const tone = safeString(o.tone).trim();
  const allowedTone = new Set(['profissional', 'moderno', 'acolhedor', 'premium', 'neutro']);

  const proofPoints = Array.isArray(o.proofPoints) ? o.proofPoints : [];
  const coercedProofPoints = [];
  for (const pp of proofPoints) {
    if (!pp || typeof pp !== 'object') continue;
    const label = safeString(pp.label).trim();
    const value = safeString(pp.value).trim();
    const source = pp.source === null || pp.source === undefined ? null : safeString(pp.source).trim() || null;
    if (!label || !value) continue;
    coercedProofPoints.push({ label: label.slice(0, 60), value: value.slice(0, 220), source });
    if (coercedProofPoints.length >= 20) break;
  }

  return {
    ...base,
    name: safeString(o.name).trim().slice(0, 120) || '',
    website: safeString(o.website).trim().slice(0, 200) || null,
    segment: safeString(o.segment).trim().slice(0, 120) || null,
    whatItDoes: safeString(o.whatItDoes).trim().slice(0, 500) || null,
    productsServices: uniq(o.productsServices),
    audience: uniq(o.audience),
    differentials: uniq(o.differentials),
    proofPoints: coercedProofPoints,
    contacts: {
      phone: safeString(o.contacts?.phone).trim().slice(0, 80) || null,
      whatsapp: safeString(o.contacts?.whatsapp).trim().slice(0, 80) || null,
      email: safeString(o.contacts?.email).trim().slice(0, 120) || null,
    },
    channels: {
      instagram: safeString(o.channels?.instagram).trim().slice(0, 200) || null,
      facebook: safeString(o.channels?.facebook).trim().slice(0, 200) || null,
      maps: safeString(o.channels?.maps).trim().slice(0, 300) || null,
    },
    locations: uniq(o.locations),
    paymentMethods: uniq(o.paymentMethods),
    legal: {
      cnpj: safeString(o.legal?.cnpj).trim().slice(0, 40) || null,
    },
    operatingHours: uniq(o.operatingHours),
    tone: allowedTone.has(tone) ? tone : 'neutro',
    confidence: clamp01(o.confidence),
  };
}

function extractJsonFromAiText(text) {
  const s = safeString(text).trim();
  const jsonMatch = s.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : s;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    logger.warn('[EntityProfile] JSON inválido na resposta da IA', { error: err.message });
    throw new Error('Resposta da IA não contém JSON válido');
  }
}

function extractSignalsFromChunks(chunks) {
  const texts = (Array.isArray(chunks) ? chunks : [])
    .map(c => cleanOcrText(c?.text || c?.excerpt || ''))
    .filter(Boolean);
  const joined = texts.join('\n');

  const emails = Array.from(new Set((joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(s => s.trim()))).slice(0, 3);
  const cnpj = (joined.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/) || [])[0] || null;

  const phoneCandidates = joined.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}\b/g) || [];
  const phones = Array.from(new Set(phoneCandidates.map(p => p.replace(/\s+/g, ' ').trim()))).slice(0, 5);

  const hasWhatsappWord = /whats(?:app)?|wpp/i.test(joined);
  const whatsapp = hasWhatsappWord ? (phones[0] || null) : null;
  const phone = phones[0] || null;

  const instaUrl = (joined.match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+/i) || [])[0] || null;
  const instaHandle = !instaUrl ? ((joined.match(/instagram[^@\n]{0,40}(@[A-Za-z0-9._-]{3,})/i) || [])[1] || null) : null;
  const instagram = instaUrl || instaHandle;

  const facebook = (joined.match(/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._-]+/i) || [])[0] || null;
  const maps = (joined.match(/https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|goo\.gl\/maps)\/[^\s)]+/i) || [])[0] || null;

  const pm = [];
  const addPm = (label, re) => { if (re.test(joined)) pm.push(label); };
  addPm('PIX', /\bpix\b/i);
  addPm('Cartão', /\bcart[aã]o\b/i);
  addPm('Crédito', /\bcr[eé]dito\b/i);
  addPm('Débito', /\bd[eé]bito\b/i);
  addPm('Boleto', /\bboleto\b/i);
  addPm('Dinheiro', /\bdinheiro\b/i);
  addPm('Transferência', /\btransfer[eê]ncia\b/i);
  addPm('PayPal', /\bpaypal\b/i);

  const proofPoints = [];
  const moneyMatches = joined.match(/R\$\s?\d[\d.,]{0,12}/g) || [];
  for (const m of Array.from(new Set(moneyMatches)).slice(0, 5)) {
    proofPoints.push({ label: 'Valores', value: m, source: null });
  }
  const hourMatches = joined.match(/\b(?:seg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[aá]b(?:ado)?|dom(?:ingo)?)\b[^\n]{0,60}\b\d{1,2}[:h]\d{0,2}\s*(?:-|a|às)\s*\d{1,2}[:h]\d{0,2}\b/gi) || [];
  for (const h of Array.from(new Set(hourMatches.map(x => x.replace(/\s+/g, ' ').trim()))).slice(0, 5)) {
    proofPoints.push({ label: 'Horários', value: h, source: null });
  }

  // Heurística segura: extrair listas explícitas (ex.: "Modalidades: X, Y e Z") sem inferir segmento
  const productsServices = [];
  const listLineMatches = joined.match(/(?:modalidades|servi[cç]os|solu[cç][oõ]es|oferece|trabalha com)\s*[:\-]\s*[^\n]{8,180}/gi) || [];
  for (const line of listLineMatches.slice(0, 8)) {
    const parts = line.split(/[:\-]\s*/);
    const tail = parts.slice(1).join(':').trim();
    if (!tail) continue;
    // separa por vírgula, barra e " e "
    const items = tail
      .split(/,|\/|;|\s+e\s+/i)
      .map(x => x.trim())
      .filter(Boolean)
      .filter(x => x.length >= 3 && x.length <= 40)
      .filter(x => /^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s().+-]+$/.test(x));
    for (const it of items) {
      productsServices.push(it);
      if (productsServices.length >= 12) break;
    }
    if (productsServices.length >= 12) break;
  }

  return {
    contacts: {
      email: emails[0] || null,
      phone,
      whatsapp,
    },
    channels: { instagram: instagram || null, facebook: facebook || null, maps: maps || null },
    legal: { cnpj: cnpj || null },
    paymentMethods: uniq(pm),
    proofPoints,
    productsServices: uniq(productsServices),
  };
}

function evidenceContains(evidenceTexts, value) {
  const needle = normalizeForMatch(value);
  if (!needle) return false;
  for (const t of evidenceTexts) {
    if (normalizeForMatch(t).includes(needle)) return true;
  }
  return false;
}

function enforceNoInvention(profile, evidenceTexts, meta) {
  const p = coerceProfile(profile);
  const out = { ...p };

  // website: só se veio de metadado/tenant/urls ou estiver nos textos
  if (out.website) {
    const ok = Boolean(meta?.website) && normalizeForMatch(out.website) === normalizeForMatch(meta.website)
      || (Array.isArray(meta?.urls) && meta.urls.some(u => normalizeForMatch(u) === normalizeForMatch(out.website)))
      || evidenceContains(evidenceTexts, out.website);
    if (!ok) out.website = null;
  }

  // contatos: precisam aparecer no texto ou no metadado determinístico
  for (const k of ['email', 'phone', 'whatsapp']) {
    const v = out.contacts?.[k];
    if (!v) continue;
    if (!evidenceContains(evidenceTexts, v)) {
      // tolera se veio de extração determinística do próprio texto (que também depende de evidenceTexts)
      // aqui, se não bate, zera para evitar invenção.
      out.contacts[k] = null;
    }
  }

  // canais: idem
  for (const k of ['instagram', 'facebook', 'maps']) {
    const v = out.channels?.[k];
    if (!v) continue;
    if (!evidenceContains(evidenceTexts, v)) out.channels[k] = null;
  }

  // cnpj: idem
  if (out.legal?.cnpj && !evidenceContains(evidenceTexts, out.legal.cnpj)) {
    out.legal.cnpj = null;
  }

  // paymentMethods: só se palavra-chave existir no texto
  out.paymentMethods = (out.paymentMethods || []).filter(pm => evidenceContains(evidenceTexts, pm));

  // operatingHours: exige match textual (ou palavra-chave parcial pode falhar; então mantém só se achar substring)
  out.operatingHours = (out.operatingHours || []).filter(h => evidenceContains(evidenceTexts, h));

  // proofPoints: exige que value apareça no texto (para evitar “R$ 99” inventado)
  out.proofPoints = (out.proofPoints || []).filter(pp => pp?.value && evidenceContains(evidenceTexts, pp.value));

  return out;
}

function computeHeuristicConfidence({ chunks, profile }) {
  const sources = Array.isArray(chunks) ? chunks : [];
  const n = sources.length;
  const avgScore = n > 0
    ? sources.reduce((sum, c) => sum + (Number(c?.score) || 0), 0) / n
    : 0;

  let filled = 0;
  if (profile.name) filled += 1;
  if (profile.website) filled += 1;
  if (profile.whatItDoes) filled += 2;
  if ((profile.productsServices || []).length > 0) filled += 2;
  if ((profile.differentials || []).length > 0) filled += 1;
  if (profile.contacts?.email || profile.contacts?.phone || profile.contacts?.whatsapp) filled += 1;
  if (profile.legal?.cnpj) filled += 1;
  if ((profile.operatingHours || []).length > 0) filled += 1;
  if ((profile.locations || []).length > 0) filled += 1;
  if ((profile.proofPoints || []).length > 0) filled += 1;

  const richness = Math.min(1, filled / 12);
  const volume = Math.min(1, n / 10);
  const score = Math.min(1, avgScore); // score já tende a 0-1
  return clamp01(0.15 + 0.35 * richness + 0.25 * volume + 0.25 * score);
}

function buildProfilePrompt({ tenantName, website, urls, fileNames, chunks, prefilled }) {
  const evidence = (Array.isArray(chunks) ? chunks : []).slice(0, 12).map((c, i) => ({
    i: i + 1,
    sourceType: c.sourceType || 'unknown',
    sourceId: c.sourceId || null,
    score: Number.isFinite(c.score) ? Number(c.score) : null,
    text: cleanOcrText(c.text || c.excerpt || '').slice(0, 1400),
  }));

  return [
    'Você é um analista que consolida evidências em um PERFIL DE ENTIDADE genérico.',
    '',
    'TAREFA:',
    '- Ler as evidências (trechos) e preencher um JSON padronizado.',
    '',
    'REGRAS OBRIGATÓRIAS (SEM EXCEÇÃO):',
    '- Nunca invente dados. Se não houver evidência explícita, use null ou [] (array vazio).',
    '- Proibido “achismo”, inferência de ramo/segmento por nome, ou suposições.',
    '- Só preencha `segment`, `whatItDoes`, `productsServices`, `audience`, `differentials` se houver frase/trecho explícito.',
    '- `proofPoints` deve conter apenas valores/fatos que aparecem literalmente (ex.: preços, prazos, horários, endereços, planos).',
    '- `contacts` e `channels` somente se aparecerem literalmente (telefone, WhatsApp, e-mail, links/handles).',
    '- `tone` deve ser uma das opções dadas; se não houver evidência de tom, use "neutro".',
    '',
    'SAÍDA:',
    '- Retorne APENAS JSON válido (sem markdown, sem explicações).',
    '',
    'SCHEMA (preencha exatamente estas chaves):',
    JSON.stringify(emptyProfile(), null, 2),
    '',
    'METADADOS (podem ajudar, mas não invente):',
    JSON.stringify({
      name: tenantName || null,
      website: website || null,
      urls: Array.isArray(urls) ? urls.slice(0, 5) : [],
      fileNames: Array.isArray(fileNames) ? fileNames.slice(0, 10) : [],
      prefilled: prefilled || null,
    }, null, 2),
    '',
    'EVIDÊNCIAS (trechos com origem):',
    JSON.stringify(evidence, null, 2),
  ].join('\n');
}

/**
 * Consolida chunks do RAG + metadados em um EntityProfile padronizado, sem inventar dados.
 *
 * Observação: quando não há chunks, retorna um perfil “vazio” baseado apenas em metadados básicos,
 * sem chamar IA (para evitar custo e para manter sem “achismos”).
 *
 * @param {string} tenantId
 * @param {{
 *  name?: string|null,
 *  website?: string|null,
 *  urls?: string[],
 *  fileNames?: string[],
 *  chunks?: RagContextChunk[],
 * }} [input]
 * @returns {Promise<{ profile: EntityProfile, usedAi: boolean }>}
 */
async function buildEntityProfile(tenantId, input = {}) {
  const finalTenantId = safeString(tenantId).trim();
  if (!finalTenantId) throw new Error('tenantId é obrigatório');

  const chunks = Array.isArray(input.chunks) ? input.chunks : [];
  const evidenceTexts = chunks.map(c => cleanOcrText(c.text || c.excerpt || '')).filter(Boolean);

  let tenant = null;
  try {
    tenant = await getTenant(finalTenantId);
  } catch {
    tenant = null;
  }

  const tenantName = safeString(input.name || tenant?.name || '').trim();
  const website = safeString(input.website || tenant?.site || '').trim() || null;
  const urls = Array.isArray(input.urls) ? input.urls : [];
  const fileNames = Array.isArray(input.fileNames) ? input.fileNames : [];

  const deterministic = extractSignalsFromChunks(chunks);

  // Sem evidência: não chama IA, retorna perfil mínimo “vazio” (sem achismo)
  if (chunks.length === 0 || evidenceTexts.join('').trim().length < 40) {
    const p = emptyProfile();
    p.name = tenantName || '';
    p.website = website;
    p.contacts = { ...p.contacts, ...deterministic.contacts };
    p.channels = { ...p.channels, ...deterministic.channels };
    p.legal = { ...p.legal, ...deterministic.legal };
    p.paymentMethods = deterministic.paymentMethods || [];
    p.proofPoints = deterministic.proofPoints || [];
    p.productsServices = deterministic.productsServices || [];
    p.confidence = computeHeuristicConfidence({ chunks, profile: p });
    return { profile: p, usedAi: false };
  }

  const prompt = buildProfilePrompt({
    tenantName,
    website,
    urls,
    fileNames,
    chunks,
    prefilled: deterministic,
  });

  const aiResult = await generateAiResponse(prompt, finalTenantId, {});
  const raw = extractJsonFromAiText(aiResult.text);
  let profile = coerceProfile(raw);

  // Enriquecimento determinístico (somente se vazio e se evidenciado nos textos)
  profile.contacts = { ...profile.contacts, ...deterministic.contacts };
  profile.channels = { ...profile.channels, ...deterministic.channels };
  profile.legal = { ...profile.legal, ...deterministic.legal };
  profile.paymentMethods = uniq([...(profile.paymentMethods || []), ...(deterministic.paymentMethods || [])]);
  profile.proofPoints = dedupeProofPoints([...(profile.proofPoints || []), ...(deterministic.proofPoints || [])]);
  profile.productsServices = uniq([...(profile.productsServices || []), ...(deterministic.productsServices || [])]);

  // Enforce anti-invenção nas partes verificáveis
  profile = enforceNoInvention(profile, evidenceTexts, { website, urls });

  // Se a IA não definiu name/website mas temos metadados explícitos, ok preencher
  if (!profile.name && tenantName) profile.name = tenantName;
  if (!profile.website && website) profile.website = website;

  // Confiança final: heurística + (se IA retornou algo) pondera, mas sem passar de 1
  const heuristic = computeHeuristicConfidence({ chunks, profile });
  profile.confidence = clamp01(Math.max(profile.confidence || 0, heuristic));

  return { profile, usedAi: true };
}

module.exports = {
  buildEntityProfile,
  emptyProfile,
};

