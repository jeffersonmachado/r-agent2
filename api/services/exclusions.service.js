const logger = require('../utils/logger');
const { generateAiResponse } = require('./aiProviderService');
const { getSequelize } = require('../db/sequelize');
const { TenantExclusion: TenantExclusionGetter } = require('../db/models');

function safeString(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  try {
    return String(v);
  } catch (_) {
    return fallback;
  }
}

function normalizeKey(s) {
  return safeString(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function uniqMergeTerms(a, b) {
  const out = [];
  const seen = new Set();
  for (const term of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const t = safeString(term).trim();
    if (!t) continue;
    const k = normalizeKey(t);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t.slice(0, 120));
  }
  return out;
}

const GENERIC_TERMS = new Set([
  // exemplos do requisito
  'plano',
  'servico',
  'serviço',
  // outros muito genéricos (conservador)
  'produto',
  'empresa',
  'contato',
  'informacao',
  'informação',
  'site',
  // evitar excluir conceitos do negócio que são frequentemente relevantes
  'telefone',
  'whatsapp',
  'instagram',
  'sessao',
  'sessão',
  'sessoes',
  'sessões',
  'horario',
  'horários',
  'preco',
  'preços',
  'valor',
  'valores',
]);

function shouldPersistTerm(rawTerm) {
  const t = safeString(rawTerm).trim();
  if (!t) return false;
  if (t.length < 4) return false; // evita drift
  if (t.length > 120) return false;

  const key = normalizeKey(t);
  if (!key) return false;

  // Não persistir números/contatos/preços como "exclusão"
  if (/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}\b/.test(t)) return false; // telefone BR
  if (/\br\$\s*\d{1,3}/i.test(t)) return false;
  if (/\b\d{1,4},\d{2}\s*reais\b/i.test(t)) return false;

  // Evita termos muito genéricos (quando o termo inteiro é genérico)
  if (GENERIC_TERMS.has(key)) return false;

  // Se for uma única palavra e ela é genérica, não persistir.
  const tokens = key.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && GENERIC_TERMS.has(tokens[0])) return false;

  return true;
}

function dbAvailable() {
  return !!getSequelize();
}

function getTenantExclusionModel() {
  return typeof TenantExclusionGetter === 'function' ? TenantExclusionGetter() : TenantExclusionGetter;
}

async function loadTenantExclusions(tenantId, { limit = 100 } = {}) {
  const tid = safeString(tenantId).trim();
  if (!tid) return [];
  if (!dbAvailable()) return [];

  try {
    const TenantExclusion = getTenantExclusionModel();
    const rows = await TenantExclusion.findAll({
      where: { tenant_id: tid },
      order: [['created_at', 'DESC']],
      limit: Math.max(1, Math.min(200, Number(limit) || 100)),
    });
    return rows
      .map((r) => (r.toJSON ? r.toJSON() : (r.dataValues || r)))
      .map((x) => safeString(x?.term).trim())
      .filter(Boolean);
  } catch (err) {
    logger.warn('[exclusions.service] Falha ao carregar exclusões persistidas (best-effort)', {
      tenantId: tid,
      error: err?.message || safeString(err),
    });
    return [];
  }
}

async function persistNewTenantExclusions(tenantId, storedExclusions, inferredExclusions, { dryRun = false, maxPerTenant = 100 } = {}) {
  const tid = safeString(tenantId).trim();
  if (!tid) return { persisted: 0, skipped: 0 };
  if (dryRun) return { persisted: 0, skipped: 0 };
  if (!dbAvailable()) return { persisted: 0, skipped: 0 };

  const max = Math.max(0, Math.min(1000, Number(maxPerTenant) || 100));

  const storedKeys = new Set((Array.isArray(storedExclusions) ? storedExclusions : []).map(normalizeKey));
  const candidates = (Array.isArray(inferredExclusions) ? inferredExclusions : [])
    .map((t) => safeString(t).trim())
    .filter(Boolean)
    .filter(shouldPersistTerm);

  const toInsert = [];
  const seen = new Set(); // evita duplicar no mesmo batch
  for (const t of candidates) {
    const k = normalizeKey(t);
    if (!k) continue;
    if (storedKeys.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    toInsert.push({ tenant_id: tid, term: t.toLowerCase().slice(0, 120), created_at: new Date() });
  }
  if (toInsert.length === 0) return { persisted: 0, skipped: 0 };

  try {
    const TenantExclusion = getTenantExclusionModel();
    const currentCount = await TenantExclusion.count({ where: { tenant_id: tid } });
    const availableSlots = Math.max(0, max - (Number(currentCount) || 0));
    if (availableSlots <= 0) return { persisted: 0, skipped: toInsert.length };

    const finalBatch = toInsert.slice(0, availableSlots);

    // Inserção best-effort: ignora conflitos de unique (tenant_id, term)
    // Em versões diferentes do Sequelize, ignoreDuplicates pode não existir; fallback para create por linha.
    if (finalBatch.length === 1) {
      await TenantExclusion.create(finalBatch[0]).catch(() => null);
    } else {
      await TenantExclusion.bulkCreate(finalBatch, { ignoreDuplicates: true }).catch(async () => {
        for (const row of finalBatch) {
          // eslint-disable-next-line no-await-in-loop
          await TenantExclusion.create(row).catch(() => null);
        }
      });
    }

    return { persisted: finalBatch.length, skipped: Math.max(0, toInsert.length - finalBatch.length) };
  } catch (err) {
    logger.warn('[exclusions.service] Falha ao persistir exclusões (best-effort)', {
      tenantId: tid,
      error: err?.message || safeString(err),
    });
    return { persisted: 0, skipped: toInsert.length };
  }
}

function sanitizeContext(raw) {
  let s = safeString(raw);
  if (!s.trim()) return '';

  // 1) Remove URLs
  s = s.replace(/https?:\/\/\S+/gi, ' ');

  // 1b) Remove domínios soltos (ex.: www.site.com.br) e e-mails
  s = s.replace(/\b\S+@\S+\b/gi, ' ');
  s = s.replace(/\b(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\.[a-z]{2,})?\b/gi, ' ');

  // 2) Remove tokens de imagem do OCR/pipeline
  s = s.replace(/\[Imagem:[^\]]*\]/gi, ' ');

  // 3) Remove nomes tipo UUID + extensão (ex.: 123e4567-e89b-12d3-a456-426614174000.pdf)
  s = s.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,6}\b/gi,
    ' '
  );

  // 4) Remove linhas "Fonte:" (metadado comum em extração)
  const lines = s.split('\n');
  const isUiNoiseLine = (line) => {
    const l = safeString(line).trim();
    if (!l) return true;

    // Exemplo explícito do requisito
    if (/^skip to content$/i.test(l)) return true;

    // Fragmentos muito comuns de UI (conservador: linha curta e "genérica")
    if (l.length <= 40) {
      if (/^(menu|in[ií]cio|home|buscar|pesquisar|search|voltar|pr[oó]ximo|anterior|fechar|abrir|carregando|loading)$/i.test(l)) {
        return true;
      }
      if (/^(entrar|login|cadastro|registrar|registre-se|sign in|sign up|logout|sair)$/i.test(l)) return true;
      if (/^(pol[ií]tica de privacidade|termos de uso|cookies?)$/i.test(l)) return true;
    }

    // Labels bancários / pagamentos (evita drift: foca nos termos de ruído mais típicos)
    if (/pix\s*copia\s*(e|&)\s*cola/i.test(l)) return true;
    if (/meus\s+limites\s+pix/i.test(l)) return true;
    if (/(c[oó]digo|c[oó]d)\s+qr/i.test(l)) return true;
    if (/qr\s*code/i.test(l)) return true;

    // Fragmentos OCR: muitos caracteres soltos (ex.: "P i x" / "A B C D ...")
    if (/(?:\b[0-9a-z]\b\s*){8,}/i.test(l)) return true;
    // Caracter de substituição (muito comum em OCR quebrado)
    if (l.includes('\uFFFD') || l.includes('�')) return true;

    return false;
  };

  s = lines
    .filter((line) => !/^\s*fonte\s*:/i.test(line))
    .filter((line) => !isUiNoiseLine(line))
    .join('\n');

  // Normaliza whitespace sem destruir completamente quebras de linha
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s;
}

function parseExclusionsFromText(text) {
  const raw = safeString(text);
  const lines = raw
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/g, '').trim())
    .filter(Boolean);

  // De-dupe case-insensitive e limita a 30 termos (segurança)
  const out = [];
  const seen = new Set();
  const weekdayKeys = new Set([
    'segunda', 'segunda-feira',
    'terca', 'terca-feira',
    'terça', 'terça-feira',
    'quarta', 'quarta-feira',
    'quinta', 'quinta-feira',
    'sexta', 'sexta-feira',
    'sabado', 'sábado',
    'domingo',
  ].map(normalizeKey));

  for (const term of lines) {
    const t = term.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    // Não excluir dias da semana: podem ser conceitos reais (horários/agendamento).
    if (weekdayKeys.has(normalizeKey(t))) continue;
    seen.add(key);
    out.push(t.slice(0, 120));
    if (out.length >= 30) break;
  }
  return out;
}

function findTechnicalArtifact(text) {
  const s = safeString(text).trim();
  if (!s) return null;

  // URL explícita
  const urlMatch = s.match(/https?:\/\/\S+/i);
  if (urlMatch) return { type: 'url', match: urlMatch[0] };

  // Nome de arquivo (UUID + extensão)
  const uuidFileMatch = s.match(
    /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:pdf|jpe?g|png|gif|webp|bmp|tiff|svg|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/i
  );
  if (uuidFileMatch) return { type: 'filename', match: uuidFileMatch[0] };

  // Nome de arquivo genérico (com extensão comum)
  const fileMatch = s.match(
    /\b[\w.-]{3,}\.(?:pdf|jpe?g|png|gif|webp|bmp|tiff|svg|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/i
  );
  if (fileMatch) return { type: 'filename', match: fileMatch[0] };

  return null;
}

function filterQuestions(questions, exclusions) {
  const qs = Array.isArray(questions) ? questions : [];
  const ex = Array.isArray(exclusions) ? exclusions : [];
  if (qs.length === 0) return [];

  const loweredTerms = ex
    .map((t) => safeString(t).trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  const out = [];
  for (const q of qs) {
    // Bloqueia artefatos comuns do pipeline de extração (OCR/PDF/scraping),
    // que às vezes viram "conceitos" indevidos durante a geração.
    const rawQ = safeString(q).trim();
    if (!rawQ) continue;
    if (/texto\s+extra[ií]do/i.test(rawQ)) continue;
    if (/sem\s+texto\s+extra[ií]do/i.test(rawQ)) continue;

    const artifact = findTechnicalArtifact(q);
    if (artifact) continue;

    if (loweredTerms.length === 0) {
      out.push(rawQ);
      continue;
    }

    const qq = rawQ.toLowerCase();
    let excluded = false;
    for (const term of loweredTerms) {
      if (term && qq.includes(term)) {
        excluded = true;
        break;
      }
    }
    if (!excluded) out.push(rawQ);
  }
  return out;
}

function extractArtifactsFromFileNames(fileNames) {
  const files = Array.isArray(fileNames) ? fileNames : [];
  const out = [];
  for (const raw of files) {
    const f = safeString(raw).trim();
    if (!f) continue;
    const base = f.split(/[\\/]/).pop().trim();
    if (!base) continue;
    out.push(base);

    // ext (inclui o ponto para facilitar "contains")
    const m = base.match(/\.([a-z0-9]{2,6})$/i);
    if (m && m[1]) out.push(`.${m[1].toLowerCase()}`);

    // uuid sem extensão (ajuda a filtrar quando aparece sem ".jpeg")
    const uuidMatch = base.match(/\b([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/i);
    if (uuidMatch && uuidMatch[1]) out.push(uuidMatch[1].toLowerCase());
  }
  return out;
}

function augmentExclusions(inferredExclusions, { fileNames } = {}) {
  // Queremos que nomes de arquivo/extensões apareçam em "Exclusões dinâmicas" (UI),
  // sem depender do LLM (que pode não ver esses tokens após sanitize).
  const artifacts = extractArtifactsFromFileNames(fileNames);
  // Prioriza artefatos e completa com o que veio do LLM, limitado a 30.
  return uniqMergeTerms(artifacts, inferredExclusions).slice(0, 30);
}

async function inferExclusions(ragContext, tenantId) {
  const ctx = sanitizeContext(ragContext);
  const tid = safeString(tenantId).trim();
  if (!ctx) return [];
  if (!tid) throw new Error('tenantId é obrigatório para inferir exclusões');

  const prompt = [
    'Abaixo está um contexto extraído de documentos, imagens e web scraping.',
    '',
    'Identifique termos, padrões ou palavras que NÃO representam conceitos reais do negócio ou entidade,',
    'mas sim artefatos técnicos, nomes de arquivos, resíduos de OCR, rótulos gráficos ou ruído.',
    '',
    'Retorne uma lista simples de termos a serem excluídos de perguntas.',
    '',
    '<contexto>',
    ctx.slice(0, 18000),
    '</contexto>',
    '',
    'Formato de saída:',
    '- termo1',
    '- termo2',
    '- termo3',
    '',
    'Regras:',
    '- Não incluir conceitos reais.',
    '- Focar apenas em ruído.',
    '- Incluir nomes de arquivos, palavras truncadas, tokens estranhos, siglas sem significado aparente.',
  ].join('\n');

  try {
    const ai = await generateAiResponse(prompt, tid, {});
    const exclusions = parseExclusionsFromText(ai?.text || '');
    return exclusions.slice(0, 30);
  } catch (err) {
    logger.warn('[exclusions.service] Falha ao inferir exclusões (best-effort)', {
      tenantId: tid,
      error: err?.message || safeString(err),
    });
    return [];
  }
}

module.exports = {
  inferExclusions,
  augmentExclusions,
  loadTenantExclusions,
  persistNewTenantExclusions,
  /**
   * Fluxo completo: load do tenant + inferência + merge unique + persistência incremental (se não for dry-run)
   */
  async getFinalExclusions(ragContext, tenantId, { dryRun = false } = {}) {
    const storedExclusions = await loadTenantExclusions(tenantId);
    logger.info('Tenant exclusions loaded:', storedExclusions.length);

    const inferredExclusions = await inferExclusions(ragContext, tenantId);
    logger.info('New exclusions inferred:', inferredExclusions.length);

    const finalExclusions = uniqMergeTerms(storedExclusions, inferredExclusions);

    // Persistência incremental (best-effort)
    await persistNewTenantExclusions(tenantId, storedExclusions, inferredExclusions, { dryRun, maxPerTenant: 100 });

    return {
      storedExclusions,
      inferredExclusions,
      finalExclusions,
    };
  },
  filterQuestions,
  sanitizeContext,
  _internal: { parseExclusionsFromText },
};

