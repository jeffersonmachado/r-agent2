const exclusionsService = require('./exclusions.service');
const { resolveContextSources } = require('./contextSourceResolver');
const questionGenerationRulesService = require('./questionGenerationRules.service');
const { generateAiResponse } = require('./aiProviderService');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeForComparison(s) {
  return safeString(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function uniqStrings(arr, { max = 60, normalize = (x) => normalizeForComparison(x) } = {}) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const raw = safeString(v).trim();
    if (!raw) continue;
    const key = normalize(raw);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

function isOcrNoiseToken(token) {
  const t = safeString(token).trim();
  if (!t) return true;
  if (t.length < 3) return true;
  // muitos símbolos ou letras soltas
  const alnum = (t.match(/[a-zA-ZÀ-ÿ0-9]/g) || []).length;
  const total = t.replace(/\s/g, '').length || 1;
  if (alnum / total < 0.65) return true;

  // sem vogais (heurística típica para lixo OCR)
  const normalized = normalizeForComparison(t);
  if (!/[aeiou]/.test(normalized)) {
    // permite tokens 100% numéricos (podem ser preço/horário)
    if (/^\d+([.,:h]\d+)?$/.test(normalized)) return false;
    return true;
  }
  return false;
}

function stripHashesAndIds(text, excludedHashes) {
  const s = safeString(text);
  return s.replace(/\b[a-f0-9]{8,}\b/gi, (m) => {
    const key = m.toLowerCase();
    if (Array.isArray(excludedHashes)) excludedHashes.push(key);
    return ' ';
  });
}

function stripTechnicalTokens(text, excludedTechnicalTokens) {
  let s = safeString(text);
  const techTokens = ['file-', 'doc-', 'ctx:'];
  for (const tk of techTokens) {
    const re = new RegExp(tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(s)) {
      if (Array.isArray(excludedTechnicalTokens)) excludedTechnicalTokens.push(tk);
      s = s.replace(re, ' ');
    }
  }
  // extensões (mantém como termo de exclusão)
  const ext = ['.pdf', '.jpeg', '.jpg', '.png'];
  for (const e of ext) {
    const re = new RegExp(e.replace('.', '\\.'), 'gi');
    if (re.test(s)) {
      if (Array.isArray(excludedTechnicalTokens)) excludedTechnicalTokens.push(e.toLowerCase());
      s = s.replace(re, ' ');
    }
  }
  return s;
}

function stripUiScrapingNoiseLines(text, excludedUiTokens) {
  const lines = safeString(text).split('\n');
  const uiNeedles = [
    'skip to content',
    'encaminhe',
    'meus limites',
    'app',
  ];

  const kept = [];
  for (const line of lines) {
    const l = safeString(line).trim();
    if (!l) continue;
    const n = normalizeForComparison(l);
    let isUi = false;
    for (const needle of uiNeedles) {
      if (n.includes(normalizeForComparison(needle))) {
        isUi = true;
        if (Array.isArray(excludedUiTokens)) excludedUiTokens.push(needle);
        break;
      }
    }
    if (!isUi) kept.push(l);
  }
  return kept.join('\n');
}

function extractEmails(text) {
  const s = safeString(text);
  const matches = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  return uniqStrings(matches, { max: 30 });
}

function extractPhones(text) {
  const s = safeString(text);
  const re = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}\b/g;
  const matches = s.match(re) || [];
  return uniqStrings(matches.map((m) => m.replace(/\s+/g, ' ').trim()), { max: 30 });
}

function extractMoney(text) {
  const s = safeString(text);
  const out = [];
  const re1 = /r\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/gi;
  const re2 = /\b\d{1,4}(?:,\d{2})\s*reais\b/gi;
  const m1 = s.match(re1) || [];
  const m2 = s.match(re2) || [];
  out.push(...m1, ...m2);
  return uniqStrings(out, { max: 40 });
}

function extractSchedules(text) {
  const s = safeString(text);
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  const hasTime = (line) => /\b\d{1,2}:\d{2}\b/.test(line) || /\b\d{1,2}h\d{0,2}\b/i.test(line);
  const hasDow = (line) => /\b(segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i.test(line);
  for (const line of lines) {
    if (hasTime(line) || (hasDow(line) && line.length <= 140)) out.push(line);
    if (out.length >= 40) break;
  }
  return uniqStrings(out, { max: 40 });
}

function extractPaymentMethods(text) {
  const n = normalizeForComparison(text);
  const out = [];
  const addIf = (needle, label) => {
    if (n.includes(needle)) out.push(label);
  };
  addIf('pix', 'PIX');
  addIf('cartao de credito', 'Cartão de crédito');
  addIf('cartao de debito', 'Cartão de débito');
  addIf('credito', 'Cartão de crédito');
  addIf('debito', 'Cartão de débito');
  addIf('dinheiro', 'Dinheiro');
  addIf('boleto', 'Boleto');
  addIf('transferencia', 'Transferência');
  addIf('paypal', 'PayPal');
  return uniqStrings(out, { max: 12 });
}

function extractSocials(text) {
  const s = safeString(text);
  const out = [];
  const handles = s.match(/@([a-z0-9._]{3,30})/gi) || [];
  const urls = s.match(/https?:\/\/[^\s)]+/gi) || [];
  for (const h of handles) out.push(h);
  for (const u of urls) {
    const nu = normalizeForComparison(u);
    if (nu.includes('instagram.com')) out.push(u);
    if (nu.includes('wa.me') || nu.includes('whatsapp')) out.push(u);
  }
  return uniqStrings(out, { max: 30 });
}

function extractLocations(text) {
  const s = safeString(text);
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  const hasCep = (l) => /\b\d{5}-\d{3}\b/.test(l);
  const hasStreet = (l) => /\b(rua|av\.?|avenida|alameda|travessa|rodovia|estrada)\b/i.test(l);
  const hasAddressLike = (l) => hasCep(l) || (hasStreet(l) && /\b\d{1,5}\b/.test(l));
  for (const line of lines) {
    if (hasAddressLike(line)) out.push(line);
    if (out.length >= 20) break;
  }
  return uniqStrings(out, { max: 20 });
}

function extractProperNames(text) {
  const s = safeString(text);
  // captura sequências capitalizadas (antes de normalizar para minúsculas)
  const candidates = s.match(/\b(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)(?:\s+(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)){0,2}\b/g) || [];
  const ban = new Set([
    'Segunda', 'Terça', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Sabado', 'Domingo',
    'Janeiro', 'Fevereiro', 'Março', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ].map((x) => normalizeForComparison(x)));
  const filtered = candidates
    .map((c) => c.trim())
    .filter((c) => c.length >= 3 && c.length <= 60)
    .filter((c) => !ban.has(normalizeForComparison(c)));
  return uniqStrings(filtered, { max: 40 });
}

function extractKeyPhrases(normalizedText, { excludedTokens = [] } = {}) {
  const stop = new Set([
    'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'um', 'uma', 'e', 'ou', 'para', 'por', 'em', 'no', 'na', 'nos', 'nas',
    'com', 'sem', 'sobre', 'ao', 'aos', 'à', 'às', 'que', 'como', 'qual', 'quais', 'onde', 'quando', 'quanto', 'tem', 'é', 'sao', 'são',
    'mais', 'menos', 'entre', 'até', 'ate', 'se', 'sim', 'não', 'nao',
  ]);
  const excluded = new Set((Array.isArray(excludedTokens) ? excludedTokens : []).map((t) => normalizeForComparison(t)));

  const tokens = normalizeForComparison(normalizedText)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 4)
    .filter((t) => !stop.has(t))
    .filter((t) => !excluded.has(t));

  const weakTokens = new Set([
    // OCR/fragmentos que frequentemente viram "keyPhrases" ruins
    'cada', 'fica', 'semana', 'contexto',
    // verbos comuns que aparecem em frases (ex.: "oferece") e viram keyPhrase indevida
    'oferece', 'oferecem', 'ofertamos', 'oferta',
  ]);

  const hasRepeatedWord = (phrase) => /\b([\p{L}]{3,})\s+\1\b/iu.test(phrase);
  const looksTruncated = (phrase) => /\b[\p{L}]{1,2}$/iu.test(phrase);
  const shouldDropPhrase = (phrase) => {
    const p = safeString(phrase).trim();
    if (!p) return true;
    if (p.length < 6 || p.length > 80) return true;
    if (hasRepeatedWord(p)) return true;
    if (looksTruncated(p)) return true;
    const toks = normalizeForComparison(p).split(/\s+/).filter(Boolean);
    if (toks.length >= 2 && toks.some((t) => weakTokens.has(t))) return true;
    // evita frases tipo "studio oly oferece crossfit" entrarem como "tópico"
    if (/\b(oferece|oferecem)\b/i.test(p)) return true;
    return false;
  };

  const score = new Map();
  const bump = (phrase, w = 1) => {
    const p = phrase.trim();
    if (p.length < 6) return;
    if (excluded.has(p)) return;
    if (shouldDropPhrase(p)) return;
    score.set(p, (score.get(p) || 0) + w);
  };

  for (let i = 0; i < tokens.length; i++) {
    bump(tokens[i], 1);
    if (i + 1 < tokens.length) bump(`${tokens[i]} ${tokens[i + 1]}`, 3);
    if (i + 2 < tokens.length) bump(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`, 4);
  }

  const sorted = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
    .slice(0, 18);

  return uniqStrings(sorted.filter((p) => !shouldDropPhrase(p)), { max: 18, normalize: (x) => x });
}

function cleanSemanticList(list, { kind } = {}) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = safeString(raw).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.length < 3 || s.length > 80) continue;
    // evita frases/sentenças inteiras
    if (/[.!?]\s*$/.test(s) && !s.endsWith('?')) continue;
    if (/\b([\p{L}]{3,})\s+\1\b/iu.test(s)) continue;
    if (/\b(oferece|oferecem)\b/i.test(s)) continue;
    if (/\bcontexto\b/i.test(s) && s.split(/\s+/).length <= 2) continue;
    if (/\b(cada\s+fica|faca\s+plano|semana\s+semana)\b/i.test(s)) continue;
    // não confundir contato/preço com "tópico"
    if (kind === 'services' || kind === 'keyPhrases') {
      if (/\b(?:r\$\s*\d|\d{1,4},\d{2}\s*reais)\b/i.test(s)) continue;
      if (/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}\b/.test(s)) continue;
    }
    const k = normalizeForComparison(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function extractJsonObject(text) {
  const raw = safeString(text).trim();
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

async function inferSemanticFieldsWithAI({ tenantId, cleanText, heuristic, maxChars = 12000 } = {}) {
  const tid = safeString(tenantId).trim();
  if (!tid) return null;
  const ctx = safeString(cleanText).trim();
  if (!ctx || ctx.length < 120) return null;

  const prompt = [
    'Você vai extrair informações SEM inventar nada.',
    '',
    'Abaixo está um contexto limpo (derivado de PDF/OCR/site).',
    'Extraia APENAS o que estiver explícito e retorne JSON.',
    '',
    'Regras:',
    '- Não inventar serviços, preços, horários, contatos ou endereço.',
    '- Não retornar nomes de arquivo, hashes, UUIDs, tokens técnicos.',
    '- Prefira itens curtos (3 a 80 chars).',
    '- Arrays podem ficar vazios.',
    '',
    'JSON (exatamente estas chaves):',
    JSON.stringify({
      keyPhrases: [],
      services: [],
      prices: [],
      schedules: [],
      contacts: [],
      paymentMethods: [],
      locations: [],
      entities: [],
    }, null, 2),
    '',
    'Heurística já detectada (use apenas como dica; não copie se não houver evidência):',
    JSON.stringify(heuristic || {}, null, 2),
    '',
    '<contexto>',
    ctx.slice(0, Math.max(2000, Math.min(20000, Number(maxChars) || 12000))),
    '</contexto>',
  ].join('\n');

  try {
    const ai = await generateAiResponse(prompt, tid, {});
    const parsed = extractJsonObject(ai?.text || '');
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Extrai e limpa contexto semântico real a partir de chunks (inline/Redis/RAG).
 *
 * Regras:
 * - Não persiste nada (mesmo quando não for dry-run)
 * - Em dry-run, prefere Redis ctx quando executionId existir
 *
 * @param {{
 *  tenantId: string,
 *  executionId?: string|null,
 *  dryRun?: boolean,
 *  name?: string|null,
 *  urls?: string[],
 *  fileNames?: string[],
 *  chunks?: any[],
 *  contextMode?: 'auto'|'persisted'|'ephemeral',
 * }} input
 */
async function extractSemanticContext(input = {}) {
  const tenantId = safeString(input?.tenantId).trim();
  if (!tenantId) throw new Error('tenantId é obrigatório');
  const executionId = safeString(input?.executionId).trim() || null;
  const dryRun = input?.dryRun === true;
  const useLlm = input?.useLlm !== false; // default: usa LLM (requisito do usuário)

  // Em dry-run, preferimos Redis (quando houver executionId) para refletir exatamente a execução.
  const contextMode = (dryRun && executionId)
    ? 'ephemeral'
    : ((input?.contextMode === 'ephemeral' || input?.contextMode === 'persisted') ? input.contextMode : 'auto');

  const { contextSources, used } = await resolveContextSources({
    ...input,
    tenantId,
    executionId,
    contextMode,
  });
  const sources = Array.isArray(contextSources) ? contextSources : [];

  const rawAggregated = sources
    .map((s) => safeString(s?.text || s?.excerpt || '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 24000);

  const excludedTerms = {
    filenames: [],
    hashes: [],
    ocrNoise: [],
    uiTokens: [],
    technicalTokens: [],
  };

  // Limpeza base (já cobre URL, e-mail, UUID+arquivo, UI básico)
  const sanitizedRaw = exclusionsService.sanitizeContext(rawAggregated);

  // Exclusions:
  // - por padrão, usa fluxo completo (persistidas + inferidas via IA) inclusive em dry-run
  //   (sem persistir nada quando dryRun=true).
  let finalExclusions = [];
  if (useLlm) {
    const r = await exclusionsService.getFinalExclusions(sanitizedRaw, tenantId, { dryRun });
    finalExclusions = Array.isArray(r?.finalExclusions) ? r.finalExclusions : [];
  } else if (dryRun) {
    try {
      finalExclusions = await exclusionsService.loadTenantExclusions(tenantId);
    } catch {
      finalExclusions = [];
    }
  } else {
    // modo normal sem LLM: só persistidas
    try {
      finalExclusions = await exclusionsService.loadTenantExclusions(tenantId);
    } catch {
      finalExclusions = [];
    }
  }

  // Captura artefatos de nomes de arquivo para a categoria filenames (sem depender do LLM)
  try {
    const augmented = exclusionsService.augmentExclusions([], { fileNames: Array.isArray(input?.fileNames) ? input.fileNames : [] });
    excludedTerms.filenames = uniqStrings(augmented.filter((t) => /\.[a-z0-9]{2,6}$/i.test(t) || /^[0-9a-f-]{16,}$/i.test(t)), { max: 40 });
  } catch {
    excludedTerms.filenames = [];
  }

  let cleaned = sanitizedRaw;
  cleaned = stripUiScrapingNoiseLines(cleaned, excludedTerms.uiTokens);
  cleaned = stripTechnicalTokens(cleaned, excludedTerms.technicalTokens);
  cleaned = stripHashesAndIds(cleaned, excludedTerms.hashes);

  // Remove tokens claramente OCR-lixo (sem destruir números úteis)
  const keptTokens = [];
  const removedOcr = [];
  for (const tok of cleaned.split(/\s+/)) {
    if (!tok) continue;
    if (isOcrNoiseToken(tok)) {
      removedOcr.push(tok);
      continue;
    }
    keptTokens.push(tok);
  }
  excludedTerms.ocrNoise = uniqStrings(removedOcr, { max: 80 });
  cleaned = keptTokens.join(' ').replace(/\s{2,}/g, ' ').trim();

  // Normalização final (requisito): lowercase, remover acentos, trim
  const cleanText = normalizeForComparison(cleaned);

  // Extrações heurísticas (a partir do texto não-normalizado também, quando útil)
  const emails = extractEmails(sanitizedRaw);
  const phones = extractPhones(sanitizedRaw);
  const socials = extractSocials(sanitizedRaw);
  let contacts = uniqStrings([...emails, ...phones, ...socials], { max: 60 });
  let prices = extractMoney(sanitizedRaw);
  let schedules = extractSchedules(sanitizedRaw);
  let paymentMethods = extractPaymentMethods(sanitizedRaw);
  let locations = extractLocations(sanitizedRaw);
  let entities = extractProperNames(sanitizedRaw);

  // Serviços: reaproveita detector de modalidades do rules service como heurística determinística
  let services = [];
  try {
    const mods = questionGenerationRulesService?._internal?.detectModalitiesFromContext
      ? questionGenerationRulesService._internal.detectModalitiesFromContext(sanitizedRaw)
      : [];
    services = uniqStrings(mods, { max: 30 });
  } catch {
    services = [];
  }

  let keyPhrases = extractKeyPhrases(cleanText, {
    excludedTokens: [
      ...(Array.isArray(finalExclusions) ? finalExclusions : []),
      ...excludedTerms.filenames,
      ...excludedTerms.hashes,
      ...excludedTerms.technicalTokens,
      ...excludedTerms.uiTokens,
    ],
  });

  // Enriquecimento via LLM (best-effort): complementa o que heurísticas não capturam bem em OCR/PDF.
  if (useLlm) {
    const ai = await inferSemanticFieldsWithAI({
      tenantId,
      cleanText,
      heuristic: {
        keyPhrases,
        services,
        prices,
        schedules,
        contacts,
        paymentMethods,
        locations,
        entities,
      },
    });
    if (ai) {
      keyPhrases = uniqStrings(cleanSemanticList([...(keyPhrases || []), ...(ai.keyPhrases || [])], { kind: 'keyPhrases' }), { max: 30 });
      services = uniqStrings(cleanSemanticList([...(services || []), ...(ai.services || [])], { kind: 'services' }), { max: 40 });
      prices = uniqStrings(cleanSemanticList([...(prices || []), ...(ai.prices || [])], { kind: 'prices' }), { max: 60 });
      schedules = uniqStrings(cleanSemanticList([...(schedules || []), ...(ai.schedules || [])], { kind: 'schedules' }), { max: 60 });
      contacts = uniqStrings(cleanSemanticList([...(contacts || []), ...(ai.contacts || [])], { kind: 'contacts' }), { max: 60 });
      paymentMethods = uniqStrings(cleanSemanticList([...(paymentMethods || []), ...(ai.paymentMethods || [])], { kind: 'paymentMethods' }), { max: 20 });
      locations = uniqStrings(cleanSemanticList([...(locations || []), ...(ai.locations || [])], { kind: 'locations' }), { max: 30 });
      // entities: nomes próprios podem “alucinar”; manter bem conservador
      entities = uniqStrings(cleanSemanticList([...(entities || []), ...(ai.entities || [])], { kind: 'entities' }), { max: 60 });
    }
  }

  // Limpeza final (mesmo sem LLM), para evitar keyPhrases/serviços quebrados por OCR
  keyPhrases = uniqStrings(cleanSemanticList(keyPhrases, { kind: 'keyPhrases' }), { max: 30 });
  services = uniqStrings(cleanSemanticList(services, { kind: 'services' }), { max: 40 });
  schedules = uniqStrings(cleanSemanticList(schedules, { kind: 'schedules' }), { max: 60 });
  contacts = uniqStrings(cleanSemanticList(contacts, { kind: 'contacts' }), { max: 60 });
  paymentMethods = uniqStrings(cleanSemanticList(paymentMethods, { kind: 'paymentMethods' }), { max: 20 });
  locations = uniqStrings(cleanSemanticList(locations, { kind: 'locations' }), { max: 30 });
  entities = uniqStrings(cleanSemanticList(entities, { kind: 'entities' }), { max: 60 });

  return {
    cleanText,
    keyPhrases,
    services,
    prices,
    schedules,
    contacts,
    paymentMethods,
    locations,
    entities,
    excludedTerms: {
      filenames: uniqStrings(excludedTerms.filenames, { max: 60 }),
      hashes: uniqStrings(excludedTerms.hashes, { max: 60 }),
      ocrNoise: uniqStrings(excludedTerms.ocrNoise, { max: 60 }),
      uiTokens: uniqStrings(excludedTerms.uiTokens, { max: 30 }),
      technicalTokens: uniqStrings(excludedTerms.technicalTokens, { max: 30 }),
      inferred: uniqStrings(finalExclusions || [], { max: 60 }),
    },
    meta: {
      usedContext: used,
      chunks: sources.length,
      executionId,
      contextMode,
      dryRun,
      useLlm,
    },
  };
}

module.exports = {
  extractSemanticContext,
  /**
   * Classifica tipo de negócio a partir de sinais no contexto.
   *
   * @param {{ cleanText?: string, schedules?: string[], locations?: string[], services?: string[], keyPhrases?: string[] }} context
   * @returns {'physical'|'digital'|'hybrid'}
   */
  detectBusinessType(context) {
    const text = normalizeForComparison(context?.cleanText || '');
    const hasSchedules = Array.isArray(context?.schedules) && context.schedules.length > 0;
    const hasLocations = Array.isArray(context?.locations) && context.locations.length > 0;

    const physicalSignals =
      hasSchedules ||
      hasLocations ||
      /\b(aula|aulas|sessao|sessaoes|sessão|sessões|agendamento|agenda|presencial|unidade|endereco|endereço)\b/i.test(text);

    const digitalSignals =
      /\b(login|logar|cadastro|cadastrar|criar conta|minha conta|painel|dashboard|saas|api|assinatura|plano online|portal)\b/i
        .test(text);

    if (physicalSignals && digitalSignals) return 'hybrid';
    if (digitalSignals) return 'digital';
    return 'physical';
  },
  _internal: {
    normalizeForComparison,
    isOcrNoiseToken,
    extractKeyPhrases,
  },
};

