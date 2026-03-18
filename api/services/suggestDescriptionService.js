const logger = require('../utils/logger');
const { buildDiverseRagContext } = require('./ragContextBuilder');
const { buildEntityProfile } = require('./entityProfileService');
const { generateAiResponse } = require('./aiProviderService');
const { getTenant } = require('./tenantService');
const { getEphemeralContext } = require('./ephemeralRagContextService');

function safeString(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  try {
    return String(v);
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }
  if (message !== null && message !== undefined) return safeString(message, fallback);
  return safeString(err, fallback);
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

function mergeContextSources(a, b) {
  const out = [];
  const seenHashes = new Set();
  const seenChunkIds = new Set();

  const push = (s) => {
    if (!s || typeof s !== 'object') return;
    const h = s.hash ? safeString(s.hash) : null;
    const c = s.chunkId ? safeString(s.chunkId) : null;
    if (h && seenHashes.has(h)) return;
    if (c && seenChunkIds.has(c)) return;
    if (h) seenHashes.add(h);
    if (c) seenChunkIds.add(c);
    out.push(s);
  };

  (Array.isArray(a) ? a : []).forEach(push);
  (Array.isArray(b) ? b : []).forEach(push);
  return out;
}

function analyzeSignalsFromSources(sources) {
  const joined = (Array.isArray(sources) ? sources : [])
    .map(s => safeString(s?.text || s?.excerpt || ''))
    .join('\n')
    .toLowerCase();

  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(joined);
  const hasPhone = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}\b/i.test(joined);
  const hasPrice = /r\$\s?\d/i.test(joined);
  const hasHours = /\bseg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[aá]b(?:ado)?|dom(?:ingo)?\b/i.test(joined)
    && /\b\d{1,2}[:h]\d{0,2}\b/.test(joined);
  const hasPlans = /\bplano(?:s)?\b|\bpacote(?:s)?\b|\bmensal\b|\banual\b|\bsemestral\b/i.test(joined);

  return { hasEmail, hasPhone, hasPrice, hasHours, hasPlans };
}

function uniqNotes(arr) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(arr) ? arr : []) {
    const v = safeString(it).trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= 30) break;
  }
  return out;
}

const PROHIBITED_IN_INSTITUTIONAL = [
  // metalinguagem / defensividade
  'com base no conteúdo',
  'conteúdo disponível',
  'conteudo disponivel',
  'trechos de contexto',
  'trecho de contexto',
  'não foi possível',
  'nao foi possivel',
  'não foi possível encontrar',
  'nao foi possivel encontrar',
  'não encontramos',
  'nao encontramos',
  'aparente',

  // termos técnicos proibidos no modo institucional
  'fontes',
  'ocr',
  'scraping',
  'rag',
  'chunk',
  'chunks',
  'score=',
  'auditoria',
  'relatório',
  'relatorio',
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
  if (contacts.whatsapp) c3.push(`Você pode falar com a equipe pelo WhatsApp ${contacts.whatsapp}.`);
  else if (contacts.phone) c3.push(`Você pode entrar em contato pelo telefone ${contacts.phone}.`);
  if (contacts.email) c3.push(`Se preferir, envie um e-mail para ${contacts.email}.`);
  if (channels.instagram) c3.push('Também mantém presença no Instagram para novidades e comunicação.');
  if (channels.facebook) c3.push('E está disponível no Facebook para acompanhar atualizações.');
  if (pm.length > 0) c3.push(`Formas de pagamento incluem ${pm.join(', ')}.`);
  c3.push('Entre em contato para saber mais e entender a melhor forma de atender sua necessidade.');

  return [normalizeWs(p1), normalizeWs(p2), normalizeWs(c3.join(' '))].join('\n\n');
}

function buildRagContextDump({ contextSources, notes }) {
  const sources = Array.isArray(contextSources) ? contextSources : [];
  const uploaded = sources.filter(s => s.sourceType === 'uploaded_file');
  const web = sources.filter(s => s.sourceType === 'web_scraping');

  const lines = [];
  lines.push('[FONTES: ARQUIVOS ENVIADOS]');
  if (uploaded.length === 0) {
    lines.push('- (nenhum trecho relevante encontrado nos arquivos enviados)');
  } else {
    for (const s of uploaded) {
      lines.push(`- (${safeString(s.sourceId || 'N/A')}) score=${Number(s.score || 0).toFixed(3)} id=${safeString(s.chunkId || 'N/A')}`);
      lines.push(`  ${safeString(s.excerpt || s.text || '').trim()}`);
    }
  }
  lines.push('');
  lines.push('[FONTES: WEB SCRAPING]');
  if (web.length === 0) {
    lines.push('- (nenhum trecho relevante encontrado no web scraping)');
  } else {
    for (const s of web) {
      lines.push(`- (${safeString(s.sourceId || 'N/A')}) score=${Number(s.score || 0).toFixed(3)} id=${safeString(s.chunkId || 'N/A')}`);
      lines.push(`  ${safeString(s.excerpt || s.text || '').trim()}`);
    }
  }

  if (Array.isArray(notes) && notes.length > 0) {
    lines.push('');
    lines.push('[OBSERVAÇÕES DO SISTEMA]');
    for (const n of notes) lines.push(`- ${safeString(n).trim()}`);
  }

  return lines.join('\n');
}

function technicalPrompt({ tenantName, tenantWebsite, ragContext, contextSummary }) {
  const summary = contextSummary || {};
  const total = Number.isFinite(summary.total) ? summary.total : null;
  const uploaded = Number.isFinite(summary.uploaded) ? summary.uploaded : null;
  const web = Number.isFinite(summary.web) ? summary.web : null;
  const uploadedSources = Array.isArray(summary.uploadedSources) ? summary.uploadedSources : [];
  const webSources = Array.isArray(summary.webSources) ? summary.webSources : [];

  return [
    'Você é um redator técnico/auditor que produz uma descrição com rastreabilidade e limitações explícitas.',
    '',
    'INSTRUÇÕES IMPORTANTES (modo técnico):',
    '- Não invente informações. Use apenas o que está nas evidências.',
    '- Quando faltar algo, declare explicitamente o que não foi encontrado.',
    '- Você pode mencionar contagens e fontes (arquivos enviados vs web scraping).',
    '',
    'DADOS DO TENANT (se existirem):',
    `- name: ${tenantName || 'N/A'}`,
    `- site: ${tenantWebsite || 'N/A'}`,
    '',
    'CONTEXTO (resumo):',
    `- total_chunks: ${total === null ? 'N/A' : total}`,
    `- uploaded_chunks: ${uploaded === null ? 'N/A' : uploaded}`,
    `- web_chunks: ${web === null ? 'N/A' : web}`,
    `- uploaded_sources: ${uploadedSources.length ? uploadedSources.join(', ') : '(nenhuma)'}`,
    `- web_sources: ${webSources.length ? webSources.join(', ') : '(nenhuma)'}`,
    '',
    'TAREFA:',
    '- Escreva uma descrição (estilo relatório) do tenant com base nas evidências.',
    '- Se houver contatos, horários, valores, CNPJ, etc., traga-os e cite de qual fonte veio.',
    '',
    'EVIDÊNCIAS (dump):',
    ragContext || '(sem dump de evidências)',
  ].join('\n');
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
 *  chunks?: Array<{sourceType?: string, sourceId?: string|null, text?: string, excerpt?: string}>,
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
  const inlineChunks = Array.isArray(input?.chunks) ? input.chunks : [];
  const debugRequested = input?.debug === true;
  const executionId = safeString(input?.executionId).trim() || null;
  const contextMode = (input?.contextMode === 'ephemeral' || input?.contextMode === 'persisted') ? input.contextMode : 'auto';

  let tenant = null;
  try { tenant = await getTenant(tenantId); } catch { tenant = null; }
  const tenantName = safeString(input?.name || tenant?.name || '').trim();
  const tenantWebsite = safeString(tenant?.site || '').trim() || null;

  logger.info('[SuggestDescription] Início', {
    tenantId,
    mode,
    contextMode,
    hasExecutionId: !!executionId,
    inlineChunks: inlineChunks.length,
    urls: urls.length,
    fileNames: fileNames.length,
    hasTenantWebsite: !!tenantWebsite,
    debug: debugRequested,
  });

  // Passo A: recuperar chunks (ephemeral via Redis+TTL ou persistidos via RAG)
  /** @type {any[]} */
  let contextSources = [];
  let contextSummary = null;
  let ragContextDump = '';
  let ragNotes = [];

  // Se o frontend mandou chunks inline (ex.: dry-run sem Redis), usa direto e não depende do Redis/RAG.
  if (inlineChunks.length > 0) {
    contextSources = inlineChunks
      .filter(c => c && typeof c === 'object')
      .map(c => ({
        sourceType: (c.sourceType === 'uploaded_file' || c.sourceType === 'web_scraping') ? c.sourceType : 'unknown',
        sourceId: c.sourceId ? safeString(c.sourceId).trim() : null,
        score: Number.isFinite(Number(c.score)) ? Number(c.score) : 0,
        text: safeString(c.text || c.excerpt || '').trim(),
        excerpt: safeString(c.excerpt || c.text || '').trim(),
        chunkId: null,
        hash: null,
      }))
      .filter(c => c.text && c.text.length >= 20)
      .slice(0, 30);

    contextSummary = {
      total: contextSources.length,
      uploaded: contextSources.filter(s => s.sourceType === 'uploaded_file').length,
      web: contextSources.filter(s => s.sourceType === 'web_scraping').length,
      uploadedSources: [],
      webSources: [],
      topScores: { uploaded: [], web: [] },
    };
    ragNotes = ['Contexto inline: evidências enviadas diretamente pela execução (sem Redis).'];
    logger.info('[SuggestDescription] Contexto inline aplicado', {
      tenantId,
      total: contextSummary.total,
      uploaded: contextSummary.uploaded,
      web: contextSummary.web,
    });
  }

  if (executionId && (contextMode === 'auto' || contextMode === 'ephemeral')) {
    if (contextSources.length > 0) {
      // Já temos contexto inline; não precisa buscar no Redis.
    } else {
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
      ragNotes = ['Contexto efêmero (dry-run): chunks fornecidos pela execução, sem consulta ao RAG persistido.'];
      ragContextDump = buildRagContextDump({ contextSources, notes: ragNotes });
    } else if (contextMode === 'ephemeral') {
      logger.info('[SuggestDescription] Contexto efêmero não encontrado; tratando como vazio', { tenantId, executionId });
      contextSources = [];
      contextSummary = { total: 0, uploaded: 0, web: 0, uploadedSources: [], webSources: [], topScores: { uploaded: [], web: [] } };
      ragNotes = ['Contexto efêmero não encontrado para executionId informado.'];
      ragContextDump = '';
    } else {
      logger.info('[SuggestDescription] Contexto efêmero ausente (modo auto, pode cair para RAG persistido)', {
        tenantId,
        executionId,
        used: eph.used,
      });
    }
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

  // 1ª busca: visão geral (mais ampla para enriquecer o perfil)
  const diverse = await buildDiverseRagContext({
    query: ragQuery,
    tenantId,
    totalK: 18,
    minUploaded: 6,
    minWeb: 6,
    minScore: 0.15,
    maxTokens: 4500,
  });

    contextSources = Array.isArray(diverse.contextSources) ? diverse.contextSources : [];
    contextSummary = diverse.contextSummary || null;
    ragNotes = Array.isArray(diverse.notes) ? diverse.notes : [];
    ragContextDump = safeString(diverse.ragContext || '').trim();
    logger.info('[SuggestDescription] Contexto persistido (RAG) aplicado', {
      tenantId,
      total: contextSources.length,
      uploaded: contextSources.filter(s => s.sourceType === 'uploaded_file').length,
      web: contextSources.filter(s => s.sourceType === 'web_scraping').length,
    });

    // 2ª busca: focada em detalhes que “deixam o texto completo” (contato/horário/valores/planos)
    // Só roda se faltarem sinais típicos nesses trechos iniciais.
    const sig = analyzeSignalsFromSources(contextSources);
    const needsDetailQuery = !(sig.hasEmail || sig.hasPhone) || !sig.hasHours || !sig.hasPrice || !sig.hasPlans;
    if (needsDetailQuery) {
      const detailQuery = `${ragQuery} contato telefone whatsapp email instagram endereço localização horários funcionamento valores preço preços planos pacotes mensal anual semestral pix pagamento`;
      const diverse2 = await buildDiverseRagContext({
        query: detailQuery,
        tenantId,
        totalK: 18,
        minUploaded: 6,
        minWeb: 6,
        minScore: 0.12,
        maxTokens: 4500,
      });

      const merged = mergeContextSources(contextSources, diverse2.contextSources);
      // mantém um limite final para não explodir tokens no profile
      contextSources = merged.slice(0, 22);
      contextSummary = { ...(contextSummary || {}), total: contextSources.length };
      ragNotes = uniqNotes([...(ragNotes || []), ...(Array.isArray(diverse2.notes) ? diverse2.notes : []), 'Consulta extra executada para capturar detalhes (contato/horário/valores/planos).']);
      ragContextDump = ''; // não é usado no modo institucional; no técnico, refazemos via buildRagContextDump
      logger.info('[SuggestDescription] Contexto persistido (RAG) enriquecido com consulta extra', {
        tenantId,
        total: contextSources.length,
        uploaded: contextSources.filter(s => s.sourceType === 'uploaded_file').length,
        web: contextSources.filter(s => s.sourceType === 'web_scraping').length,
      });
    }
  }

  // Sem contexto indexado relevante
  if (!contextSources.length) {
    logger.warn('[SuggestDescription] Sem evidências (fallback)', {
      tenantId,
      mode,
      contextMode,
      hasExecutionId: !!executionId,
      urls: urls.length,
      fileNames: fileNames.length,
      inlineChunks: inlineChunks.length,
      hasTenantWebsite: !!tenantWebsite,
    });
    const { profile } = await buildEntityProfile(tenantId, {
      name: tenantName || null,
      website: tenantWebsite,
      urls,
      fileNames,
      chunks: [],
    });

    const suggestion = (mode === 'technical')
      ? buildTechnicalReport({ profile, contextSources: [] })
      : ensureThreeParagraphsAndCta(buildDeterministicInstitutional(profile));
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
    // Compatibilidade: modo técnico deve ser “auditável”, com dump de evidências e instruções defensivas.
    const dump = ragContextDump || buildRagContextDump({ contextSources, notes: ragNotes });
    const prompt = technicalPrompt({
      tenantName: tenantName || null,
      tenantWebsite,
      ragContext: dump,
      contextSummary: contextSummary || {
        total: contextSources.length,
        uploaded: contextSources.filter(s => s.sourceType === 'uploaded_file').length,
        web: contextSources.filter(s => s.sourceType === 'web_scraping').length,
        uploadedSources: [],
        webSources: [],
      },
    });

    try {
      const r = await generateAiResponse(prompt, tenantId, {});
      suggestion = safeString(r.text).trim();
    } catch (err) {
      logger.warn('[SuggestDescription] Falha ao gerar modo técnico via IA; retornando relatório determinístico', {
        tenantId,
        error: safeErrorMessage(err),
      });
      suggestion = buildTechnicalReport({ profile, contextSources });
    }
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

