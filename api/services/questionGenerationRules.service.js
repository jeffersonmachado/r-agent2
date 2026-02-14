const { getDefaultQuestionGenerationRules } = require('../utils/ragQuestionGenerator');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeForMatch(s) {
  return safeString(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function uniqByKey(items, keyFn) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const k = keyFn(it);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function tokenizeCandidateList(rawList) {
  // Split conservador: listas comuns em PDFs/sites
  return safeString(rawList)
    .split(/[,;|/·•\u2022]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractLabeledList(text, labelRegex) {
  const lines = safeString(text).split('\n');
  for (const line of lines) {
    const m = line.match(labelRegex);
    if (m && m[1]) {
      return tokenizeCandidateList(m[1]);
    }
  }
  return [];
}

function stripListLabelPrefix(s) {
  // Remove prefixos que acabam “vazando” para um item da lista (ex.: "Modalidades: Crossfit")
  return safeString(s)
    .replace(/^(modalidades?|servi[cç]os?|aulas?)\s*:\s*/i, '')
    .trim();
}

function isPlausibleEntityLabel(label) {
  const s = safeString(label).trim();
  if (!s) return false;
  if (s.length < 3) return false;
  if (s.length > 50) return false;
  // evita lixo técnico comum
  if (/\bhttps?:\/\//i.test(s)) return false;
  if (/\.(pdf|jpe?g|png|gif|webp)\b/i.test(s)) return false;
  if (/^[0-9a-f\-]{20,}$/i.test(s)) return false;
  // muitos símbolos
  const alnum = (s.match(/[a-z0-9áàâãéêíóôõúç]/gi) || []).length;
  const total = s.replace(/\s/g, '').length || 1;
  if (alnum / total < 0.6) return false;
  return true;
}

function buildModalityPattern(label) {
  // Patterns simples e robustos (sem regex avançado):
  // usa tokens normalizados mais informativos para casar no texto
  const n = normalizeForMatch(label);
  const tokens = n
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 4)
    .filter((t) => !['para', 'com', 'sem', 'uma', 'um', 'dos', 'das', 'de', 'do', 'da', 'e'].includes(t));
  if (tokens.length === 0) return null;
  // pega os 2 tokens mais longos (mais específicos)
  tokens.sort((a, b) => b.length - a.length);
  return tokens.slice(0, 2);
}

function detectModalitiesFromContext(text) {
  const raw = safeString(text);
  if (!raw.trim()) return [];

  // 1) Se houver um bloco explícito "Modalidades:"/ "Serviços:" etc., usamos primeiro.
  const list =
    extractLabeledList(raw, /modalidades?\s*:\s*(.+)$/i)
      .concat(extractLabeledList(raw, /servi[cç]os?\s*:\s*(.+)$/i))
      .concat(extractLabeledList(raw, /aulas?\s*:\s*(.+)$/i));

  // 2) Fallback: varre por termos “tipo lista” quando aparecem juntos (conservador).
  // Ex.: "Crossfit, Funcional, Balé, Pilates"
  const inlineLists = [];
  const m = raw.match(/([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^.\n]{0,80}(?:,\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^.\n]{0,80}){2,})/g);
  if (m) inlineLists.push(...m.flatMap(tokenizeCandidateList));

  const candidates = [...list, ...inlineLists]
    .map((s) => stripListLabelPrefix(s).replace(/\s{2,}/g, ' ').trim())
    .filter(isPlausibleEntityLabel);

  const normalizedBan = new Set([
    'horario', 'horarios', 'funcionamento', 'planos', 'plano', 'valores', 'valor', 'preco', 'precos', 'promocao', 'black friday',
    'pagamento', 'pix', 'contato', 'whatsapp', 'telefone', 'site',
  ]);

  const cleaned = candidates.filter((c) => {
    const n = normalizeForMatch(c);
    if (normalizedBan.has(n)) return false;
    // evita “segunda a sexta”, “06:00”, etc.
    if (/\b\d{1,2}:\d{2}\b/.test(n)) return false;
    if (/\bsegunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo\b/i.test(n) && n.length < 20) return false;
    return true;
  });

  // De-dupe por forma normalizada
  const uniq = uniqByKey(cleaned, (x) => normalizeForMatch(x));
  return uniq.slice(0, 12);
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  if (!base || typeof base !== 'object') return override;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Gera regras *derivadas do contexto do tenant*.
 * Não depende de um JSON fixo de domínio; extrai entidades e liga “gatilhos” do conteúdo real.
 */
function deriveQuestionGenerationRulesFromContext({ tenantName, contextText, baseRules } = {}) {
  const base = (baseRules && typeof baseRules === 'object') ? baseRules : getDefaultQuestionGenerationRules();
  const text = safeString(contextText);

  const modalities = detectModalitiesFromContext(text);
  const modalityEntities = modalities
    .map((label) => {
      const patterns = buildModalityPattern(label);
      if (!patterns) return null;
      return { label, patterns };
    })
    .filter(Boolean);

  // Se não detectou nada, devolve base (sem “inventar” domínio)
  if (modalityEntities.length === 0 && !safeString(tenantName).trim()) {
    return base;
  }

  const derived = {
    domainCoverage: {
      enabled: true,
      entities: {
        modalities: modalityEntities,
      },
    },
  };

  // Se o nome do tenant veio, reforça templates “business” sem precisar hardcode por domínio.
  if (safeString(tenantName).trim()) {
    derived.domainCoverage.templates = {
      ...(base?.domainCoverage?.templates || {}),
      business: [
        `O que é ${safeString(tenantName).trim()}?`,
        `Quais serviços ${safeString(tenantName).trim()} oferece?`,
        'Quais modalidades estão disponíveis?',
      ],
    };
  }

  // Mantém triggers/templates genéricos do base; só injeta entidades extraídas.
  return deepMerge(base, derived);
}

module.exports = {
  deriveQuestionGenerationRulesFromContext,
  _internal: {
    detectModalitiesFromContext,
    buildModalityPattern,
    normalizeForMatch,
  },
};

