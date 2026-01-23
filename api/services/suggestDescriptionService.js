const logger = require('../utils/logger');
const { buildDiverseRagContext } = require('./ragContextBuilder');
const { buildEntityProfile } = require('./entityProfileService');
const { generateAiResponse } = require('./aiProviderService');
const { getTenant } = require('./tenantService');
const { getEphemeralContext } = require('./ephemeralRagContextService');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeWs(s) {
  return safeString(s).replace(/\s+/g, ' ').trim();
}

function splitParagraphs(text) {
  return safeString(text)
    .split(/\n\s*\n/g)
    .map(p => p.trim())
    .filter(Boolean);
}

const PROHIBITED_IN_INSTITUTIONAL = [
  'com base no conteúdo',
  'aparente',
  'fontes',
  'ocr',
  'scraping',
  'rag',
];

function containsProhibitedInstitutional(text) {
  const t = safeString(text).toLowerCase();
  return PROHIBITED_IN_INSTITUTIONAL.some(w => t.includes(w));
}

function hasCta(text) {
  return /entre em contato|fale com|fale conosco|saiba mais|solicite|agende|conhe[çc]a|fa[çc]a um or[çc]amento/i.test(text);
}

function ensureThreeParagraphsAndCta(text) {
  const paras = splitParagraphs(text);
  if (paras.length === 3 && hasCta(text)) return text.trim();

  // Ajuste determinístico: 3 parágrafos + CTA no 3º
  const p1 = paras[0] || '';
  const p2 = paras[1] || '';
  const p3 = paras.slice(2).join(' ').trim();
  const cta = hasCta(text) ? '' : ' Entre em contato para tirar dúvidas e solicitar uma proposta.';

  const out = [
    normalizeWs(p1 || 'Uma organização focada em oferecer soluções e atendimento com clareza e consistência.'),
    normalizeWs(p2 || 'Com atuação orientada a necessidades reais, busca entregar qualidade, confiança e eficiência em cada etapa.'),
    normalizeWs((p3 || 'Para saber mais, fale com a equipe e conheça as opções disponíveis.') + cta),
  ].join('\n\n');

  return out.trim();
}

function institutionalPromptFromProfile(profile) {
  return [
    'Escreva uma descrição institucional, humana e objetiva para uma entidade/empresa.',
    '',
    'REGRAS OBRIGATÓRIAS:',
    '- Não use linguagem defensiva nem metalinguagem. É PROIBIDO mencionar: conteúdo disponível, fontes, OCR, scraping, RAG, auditoria, "aparente".',
    '- Não invente dados. Use SOMENTE o que estiver no JSON do perfil.',
    '- Se um dado estiver null/[] no perfil, não crie substitutos específicos; use texto genérico sem afirmar detalhes.',
    '',
    'ESTRUTURA (exatamente 3 parágrafos):',
    '(1) Quem é / o que faz (use whatItDoes quando houver).',
    '(2) Produtos/serviços + diferenciais (use productsServices + differentials quando houver).',
    '(3) Facilidades / contato / CTA (use contacts, channels, paymentMethods; inclua um CTA natural).',
    '',
    'Se houver valores/planos/horários em proofPoints, incorpore naturalmente no texto (sem parecer lista).',
    '',
    'PERFIL (JSON):',
    JSON.stringify(profile, null, 2),
    '',
    'Retorne APENAS o texto final.',
  ].join('\n');
}

function buildDeterministicInstitutional(profile) {
  const name = profile?.name ? profile.name.trim() : '';
  const subject = name ? name : 'Esta organização';

  const p1 = profile?.whatItDoes
    ? `${subject} ${profile.whatItDoes.replace(/^[a-z]/, c => c.toLowerCase())}`
    : `${subject} é uma organização que atua com foco em entregar soluções e atendimento de forma clara, consistente e responsável.`;

  const ps = Array.isArray(profile?.productsServices) ? profile.productsServices.filter(Boolean).slice(0, 4) : [];
  const diffs = Array.isArray(profile?.differentials) ? profile.differentials.filter(Boolean).slice(0, 3) : [];
  const pp = Array.isArray(profile?.proofPoints) ? profile.proofPoints : [];
  const hours = pp.find(x => x?.label === 'Horários')?.value;
  const values = pp.find(x => x?.label === 'Valores')?.value;

  const p2Parts = [];
  if (ps.length > 0) p2Parts.push(`Entre seus serviços/soluções, destacam-se ${ps.join(', ')}.`);
  if (diffs.length > 0) p2Parts.push(`O trabalho é guiado por diferenciais como ${diffs.join(', ')}.`);
  if (values) p2Parts.push(`Há informações de valores como ${values}.`);
  if (hours) p2Parts.push(`Também constam horários como ${hours}.`);
  const p2 = p2Parts.length > 0
    ? p2Parts.join(' ')
    : 'Seu posicionamento prioriza qualidade, transparência e uma experiência bem conduzida do início ao fim.';

  const contacts = profile?.contacts || {};
  const channels = profile?.channels || {};
  const pm = Array.isArray(profile?.paymentMethods) ? profile.paymentMethods : [];

  const c3 = [];
  if (contacts.whatsapp) c3.push(`WhatsApp: ${contacts.whatsapp}.`);
  else if (contacts.phone) c3.push(`Telefone: ${contacts.phone}.`);
  if (contacts.email) c3.push(`E-mail: ${contacts.email}.`);
  if (channels.instagram) c3.push('Instagram disponível.');
  if (channels.facebook) c3.push('Facebook disponível.');
  if (pm.length > 0) c3.push(`Formas de pagamento incluem ${pm.join(', ')}.`);
  c3.push('Entre em contato para saber mais e entender a melhor forma de atender sua necessidade.');

  return [normalizeWs(p1), normalizeWs(p2), normalizeWs(c3.join(' '))].join('\n\n');
}

async function generateInstitutionalFromProfile({ tenantId, profile }) {
  const prompt = institutionalPromptFromProfile(profile);

  // tentativa 1
  const r1 = await generateAiResponse(prompt, tenantId, {});
  let text = safeString(r1.text).trim();

  const ok1 = text && !containsProhibitedInstitutional(text) && splitParagraphs(text).length === 3 && hasCta(text);
  if (ok1) return ensureThreeParagraphsAndCta(text);

  // tentativa 2 (correção)
  const fixPrompt = [
    'Reescreva o texto abaixo seguindo estritamente:',
    '- Exatamente 3 parágrafos.',
    '- Incluir CTA no 3º parágrafo.',
    '- Proibido mencionar: conteúdo disponível, fontes, OCR, scraping, RAG, auditoria, "aparente", "com base no conteúdo".',
    '- Não inventar dados; use apenas o que está no perfil (já aplicado no texto).',
    '',
    'TEXTO PARA CORRIGIR:',
    text,
  ].join('\n');

  const r2 = await generateAiResponse(fixPrompt, tenantId, {});
  text = safeString(r2.text).trim();

  const ok2 = text && !containsProhibitedInstitutional(text) && splitParagraphs(text).length === 3 && hasCta(text);
  if (ok2) return ensureThreeParagraphsAndCta(text);

  // fallback determinístico (garante regras)
  return ensureThreeParagraphsAndCta(buildDeterministicInstitutional(profile));
}

function buildTechnicalReport({ profile, contextSources }) {
  const lines = [];
  lines.push('MODO TÉCNICO (AUDITORIA)');
  lines.push('');
  lines.push('Perfil consolidado (campos preenchidos somente quando há evidência explícita):');
  lines.push(JSON.stringify(profile, null, 2));
  lines.push('');
  lines.push('Evidências (chunks) usadas:');
  const sources = Array.isArray(contextSources) ? contextSources : [];
  sources.forEach((s, idx) => {
    lines.push(`- #${idx + 1} type=${s.sourceType || 'unknown'} score=${Number(s.score || 0).toFixed(3)} source=${s.sourceId || 'N/A'}`);
    lines.push(`  ${safeString(s.text || s.excerpt || '').slice(0, 420)}`);
  });
  return lines.join('\n');
}

/**
 * Pipeline do /system/suggest-description.
 *
 * @param {{
 *  tenantId: string,
 *  name?: string|null,
 *  urls?: string[],
 *  fileNames?: string[],
 *  executionId?: string|null,
 *  contextMode?: 'auto'|'persisted'|'ephemeral',
 *  mode?: 'institutional'|'technical',
 *  debug?: boolean,
 * }} input
 */
async function suggestDescription(input) {
  const tenantId = safeString(input?.tenantId).trim();
  if (!tenantId) throw new Error('tenantId é obrigatório');

  const mode = input?.mode === 'technical' ? 'technical' : 'institutional';
  const urls = Array.isArray(input?.urls) ? input.urls : [];
  const fileNames = Array.isArray(input?.fileNames) ? input.fileNames : [];
  const debugRequested = input?.debug === true;
  const executionId = safeString(input?.executionId).trim() || null;
  const contextMode = (input?.contextMode === 'ephemeral' || input?.contextMode === 'persisted') ? input.contextMode : 'auto';

  let tenant = null;
  try { tenant = await getTenant(tenantId); } catch { tenant = null; }
  const tenantName = safeString(input?.name || tenant?.name || '').trim();
  const tenantWebsite = safeString(tenant?.site || '').trim() || null;

  // Passo A: recuperar chunks (ephemeral via Redis+TTL ou persistidos via RAG)
  /** @type {any[]} */
  let contextSources = [];
  let contextSummary = null;

  if (executionId && (contextMode === 'auto' || contextMode === 'ephemeral')) {
    const eph = await getEphemeralContext({ tenantId, executionId });
    if (eph.found && Array.isArray(eph.chunks) && eph.chunks.length > 0) {
      contextSources = eph.chunks;
      contextSummary = {
        total: contextSources.length,
        uploaded: contextSources.filter(s => s.sourceType === 'uploaded_file').length,
        web: contextSources.filter(s => s.sourceType === 'web_scraping').length,
        uploadedSources: [],
        webSources: [],
        topScores: { uploaded: [], web: [] },
      };
      logger.info('[SuggestDescription] Usando contexto efêmero (dry-run)', {
        tenantId,
        executionId,
        used: eph.used,
        chunks: contextSources.length,
      });
    } else if (contextMode === 'ephemeral') {
      logger.info('[SuggestDescription] Contexto efêmero não encontrado; tratando como vazio', { tenantId, executionId });
      contextSources = [];
      contextSummary = { total: 0, uploaded: 0, web: 0, uploadedSources: [], webSources: [], topScores: { uploaded: [], web: [] } };
    }
  }

  if (!contextSources.length && (contextMode === 'auto' || contextMode === 'persisted')) {
  const urlDomains = urls
    .map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./i, '');
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .slice(0, 4);

  const safeFileNames = fileNames
    .map(f => safeString(f).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8);

  let ragQuery = '';
  if (tenantName && urlDomains.length > 0) {
    ragQuery = `${tenantName} ${urlDomains.join(' ')} informações sobre serviços produtos`;
  } else if (tenantName) {
    ragQuery = `Informações sobre ${tenantName} serviços produtos empresa negócio`;
  } else if (urlDomains.length > 0) {
    ragQuery = `${urlDomains.join(' ')} informações conteúdo site`;
  } else {
    ragQuery = 'Informações sobre o tenant';
  }
  if (safeFileNames.length > 0) {
    ragQuery = `${ragQuery} documentos arquivos ${safeFileNames.join(' ')}`;
  }

  const diverse = await buildDiverseRagContext({
    query: ragQuery,
    tenantId,
    totalK: 10,
    minUploaded: 3,
    minWeb: 3,
    minScore: 0.25,
    maxTokens: 3000,
  });

    contextSources = Array.isArray(diverse.contextSources) ? diverse.contextSources : [];
    contextSummary = diverse.contextSummary || null;
  }

  // Sem contexto indexado relevante
  if (!contextSources.length) {
    const { profile } = await buildEntityProfile(tenantId, {
      name: tenantName || null,
      website: tenantWebsite,
      urls,
      fileNames,
      chunks: [],
    });

    const suggestion = ensureThreeParagraphsAndCta(buildDeterministicInstitutional(profile));
    const warnings = [
      { code: 'NO_INDEXED_CONTEXT_FALLBACK', message: 'Poucas evidências indexadas; gerado texto genérico com base em metadados mínimos.' },
    ];
    if (profile.confidence < 0.5) warnings.push({ code: 'LOW_CONFIDENCE', message: 'Baixa confiança: poucas evidências para enriquecer a descrição.' });

    const payload = {
      mode,
      suggestion,
      entityProfile: profile,
      confidence: profile.confidence,
    };
    if (debugRequested) {
      payload.contextSourcesSummary = contextSummary || { total: 0, uploaded: 0, web: 0 };
      payload.contextSources = contextSources;
    }
    return { payload, warnings };
  }

  // Passo B: gerar entity_profile JSON
  const { profile } = await buildEntityProfile(tenantId, {
    name: tenantName || null,
    website: tenantWebsite,
    urls,
    fileNames,
    chunks: contextSources,
  });

  // Passo C: gerar saída conforme modo
  const warnings = [];
  if (profile.confidence < 0.5) warnings.push({ code: 'LOW_CONFIDENCE', message: 'Baixa confiança: poucas evidências para enriquecer a descrição.' });

  let suggestion = '';
  if (mode === 'technical') {
    suggestion = buildTechnicalReport({ profile, contextSources });
  } else {
    suggestion = await generateInstitutionalFromProfile({ tenantId, profile });
  }

  const payload = {
    mode,
    suggestion: suggestion.trim(),
    entityProfile: profile,
    confidence: profile.confidence,
  };

  if (debugRequested) {
    payload.contextSourcesSummary = {
      total: contextSummary?.total ?? contextSources.length,
      uploaded: contextSummary?.uploaded ?? contextSources.filter(s => s.sourceType === 'uploaded_file').length,
      web: contextSummary?.web ?? contextSources.filter(s => s.sourceType === 'web_scraping').length,
      uploadedSources: contextSummary?.uploadedSources ?? [],
      webSources: contextSummary?.webSources ?? [],
      topScores: contextSummary?.topScores ?? undefined,
    };
    payload.contextSources = contextSources;
  }

  return { payload, warnings };
}

module.exports = {
  suggestDescription,
  PROHIBITED_IN_INSTITUTIONAL,
};

