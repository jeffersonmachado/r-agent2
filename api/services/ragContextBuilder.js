const crypto = require('crypto');
const logger = require('../utils/logger');
const ragService = require('./ragService');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeWhitespace(text) {
  return safeString(text).replace(/\s+/g, ' ').trim();
}

function normalizeForHash(text) {
  return normalizeWhitespace(text).toLowerCase();
}

function sha256(text) {
  return crypto.createHash('sha256').update(safeString(text), 'utf8').digest('hex');
}

function getScore(s) {
  const v = s?.score ?? s?.relevance_score ?? s?.relevanceScore ?? s?.similarity ?? 0;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function getChunkId(s) {
  return (
    s?.chunkId ||
    s?.chunk_id ||
    s?.id ||
    s?.chunk ||
    null
  );
}

function getRawText(s) {
  return (
    s?.excerpt ||
    s?.content ||
    s?.text ||
    s?.chunkText ||
    s?.chunk ||
    s?.snippet ||
    ''
  );
}

function getMetadata(s) {
  const m = s?.metadata || s?.meta || {};
  return (m && typeof m === 'object') ? m : {};
}

function inferSourceType(s) {
  const m = getMetadata(s);
  const metaSource = safeString(m.source).toLowerCase();
  const sourceId = safeString(m.source_id || s?.source_id || s?.sourceId);

  if (metaSource === 'web_scraping' || m.url || /^https?:\/\//i.test(sourceId)) return 'web_scraping';
  if (metaSource === 'chat_upload' || m.fileName || m.filename || sourceId.startsWith('file:')) return 'uploaded_file';

  // Fallbacks pragmáticos (melhor do que misturar tudo como uma única fonte)
  if (m.url) return 'web_scraping';
  if (m.fileName || m.filename) return 'uploaded_file';

  return 'unknown';
}

function inferSourceId(s, sourceType) {
  const m = getMetadata(s);
  const sourceId = safeString(m.source_id || s?.source_id || s?.sourceId);

  if (sourceType === 'uploaded_file') {
    const fileName = safeString(m.fileName || m.filename);
    if (fileName) return fileName;
    if (sourceId.startsWith('file:')) return sourceId.slice('file:'.length);
    return sourceId || safeString(s?.documentId || s?.document_id || s?.title || 'uploaded_file');
  }

  if (sourceType === 'web_scraping') {
    const url = safeString(m.url);
    if (url) return url;
    return sourceId || safeString(s?.documentId || s?.document_id || s?.title || 'web_scraping');
  }

  return sourceId || safeString(s?.documentId || s?.document_id || s?.title || 'unknown');
}

function buildContextSource(s) {
  const score = getScore(s);
  const rawText = normalizeWhitespace(getRawText(s));
  const sourceType = inferSourceType(s);
  const sourceId = inferSourceId(s, sourceType);
  const chunkId = getChunkId(s);
  const hash = sha256(normalizeForHash(rawText));

  // Texto completo (limitado) para extração estruturada; `excerpt` é apenas para UI/debug leve.
  // Aumentado para melhorar extração (modalidades/planos/horários às vezes ficam “depois do corte”).
  const text = rawText.length > 2400 ? `${rawText.slice(0, 2400)}...` : rawText;
  const excerpt = rawText.length > 520 ? `${rawText.slice(0, 520)}...` : rawText;

  return {
    sourceType,
    sourceId,
    score,
    text,
    excerpt,
    chunkId: chunkId || null,
    hash,
    _raw: s, // apenas para debug interno (não retornar ao cliente)
  };
}

function getDocumentIdFromSource(s) {
  return s?.documentId || s?.document_id || null;
}

function enrichFromDocumentStore(candidate, tenantId) {
  if (!candidate || candidate.sourceType !== 'unknown') return candidate;

  const docId = getDocumentIdFromSource(candidate._raw);
  if (!docId) return candidate;

  try {
    // Lazy require para evitar dependência circular na inicialização
    // eslint-disable-next-line global-require
    const ragDocumentsService = require('./ragDocumentsService');
    const doc = ragDocumentsService.getDocument(docId);
    if (!doc) return candidate;
    if (tenantId && doc.tenantId && doc.tenantId !== tenantId) return candidate;

    const docSource = safeString(doc.metadata?.source).toLowerCase();
    const isWeb = docSource === 'web_scraping' || !!doc.metadata?.url;
    const isUploaded = docSource === 'chat_upload' || !!doc.metadata?.fileName;

    if (isWeb) {
      return {
        ...candidate,
        sourceType: 'web_scraping',
        sourceId: safeString(doc.metadata?.url) || candidate.sourceId || safeString(docId),
      };
    }

    if (isUploaded) {
      return {
        ...candidate,
        sourceType: 'uploaded_file',
        sourceId: safeString(doc.metadata?.fileName) || candidate.sourceId || safeString(docId),
      };
    }

    return candidate;
  } catch (err) {
    logger.debug('[RAGContextBuilder] Falha ao enriquecer source via ragDocumentsService', {
      tenantId,
      documentId: docId,
      error: err.message,
    });
    return candidate;
  }
}

function dedupeByKey(items) {
  const seenChunkIds = new Set();
  const seenHashes = new Set();
  const out = [];
  for (const it of items) {
    const chunkKey = it.chunkId ? String(it.chunkId) : null;
    const hashKey = it.hash ? String(it.hash) : null;

    // Dedup forte: se o texto é igual (hash igual), remove mesmo que chunkId seja diferente
    if (hashKey && seenHashes.has(hashKey)) continue;
    if (chunkKey && seenChunkIds.has(chunkKey)) continue;

    if (hashKey) seenHashes.add(hashKey);
    if (chunkKey) seenChunkIds.add(chunkKey);
    out.push(it);
  }
  return out;
}

function summarize(contextSources) {
  const uploaded = contextSources.filter(s => s.sourceType === 'uploaded_file');
  const web = contextSources.filter(s => s.sourceType === 'web_scraping');

  const unique = (arr) => Array.from(new Set(arr)).slice(0, 20);
  const topScores = (arr) => arr.map(s => s.score).sort((a, b) => b - a).slice(0, 3);

  return {
    total: contextSources.length,
    uploaded: uploaded.length,
    web: web.length,
    uploadedSources: unique(uploaded.map(s => s.sourceId)),
    webSources: unique(web.map(s => s.sourceId)),
    topScores: {
      uploaded: topScores(uploaded),
      web: topScores(web),
    },
  };
}

function formatContext({ uploaded, web, notes }) {
  const lines = [];
  lines.push('[FONTES: ARQUIVOS ENVIADOS]');
  if (uploaded.length === 0) {
    lines.push('- (nenhum trecho relevante encontrado nos arquivos enviados)');
  } else {
    for (const s of uploaded) {
      lines.push(`- (${s.sourceId}) score=${s.score.toFixed(3)} id=${s.chunkId || s.hash.slice(0, 12)}`);
      lines.push(`  ${s.excerpt}`);
    }
  }
  lines.push('');
  lines.push('[FONTES: WEB SCRAPING]');
  if (web.length === 0) {
    lines.push('- (nenhum trecho relevante encontrado no web scraping)');
  } else {
    for (const s of web) {
      lines.push(`- (${s.sourceId}) score=${s.score.toFixed(3)} id=${s.chunkId || s.hash.slice(0, 12)}`);
      lines.push(`  ${s.excerpt}`);
    }
  }

  if (Array.isArray(notes) && notes.length > 0) {
    lines.push('');
    lines.push('[OBSERVAÇÕES DO SISTEMA]');
    for (const n of notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}

/**
 * Constrói contexto de RAG com diversidade por fonte (arquivos enviados + web scraping).
 * Retorna texto do contexto (já estruturado por blocos) e `contextSources` com rastreabilidade.
 *
 * Observação: usamos dois queries com "sugestão de filtro" (source/sources/sourceType). Se o RAG Python ignorar,
 * ainda assim aplicamos classificação/dedupe no Node e garantimos mínimos por seleção.
 */
async function buildDiverseRagContext({
  query,
  tenantId,
  totalK = 10,
  minUploaded = 3,
  minWeb = 3,
  perGroupK = null,
  minScore = 0.25,
  maxTokens = 3000,
  ragQueryFn = null,
}) {
  if (!query || !safeString(query).trim()) throw new Error('query é obrigatória');
  if (!tenantId) throw new Error('tenantId é obrigatório');

  const queryFn = ragQueryFn || ((q, t, ctx, filters) => ragService.queryRag(q, t, ctx, filters));
  const topK = perGroupK || Math.max(totalK * 3, 24); // busca mais ampla para permitir diversidade pós-ranking

  const ragRes = await queryFn(query, tenantId, {}, {
    topK,
    minScore,
    maxTokens,
  });

  if (ragRes && ragRes.success === false && ragRes.error) {
    const msg = safeString(ragRes.error);
    // “Sem chunks” não é falha do serviço: deve ser tratado como falta de contexto.
    const noChunks = /nenhum\s+chunk|no\s+chunk|0\s+chunk|chunks?\s+found\s*:\s*0|score\s+suficiente/i.test(msg);
    if (!noChunks) {
      // Falha real do RAG (ex.: crash no serviço Python) deve virar 500 no endpoint, não 422.
      throw new Error(`RAG_QUERY_FAILED: ${ragRes.error}`);
    }
    logger.debug('[RAGContextBuilder] RAG retornou sem chunks (tratado como contexto vazio)', { tenantId, query });
    return {
      ragContext: '',
      contextSources: [],
      contextSummary: summarize([]),
      notes: ['Nenhum contexto indexado relevante foi encontrado para esta consulta.'],
    };
  }

  const raw = Array.isArray(ragRes?.sources) ? ragRes.sources : [];
  const allCandidates = dedupeByKey(
    raw
      .map(buildContextSource)
      .map(c => enrichFromDocumentStore(c, tenantId))
      .filter(s => s.excerpt && s.excerpt.length >= 20)
      .filter(s => s.score >= minScore)
  );

  const uploadedAll = allCandidates.filter(s => s.sourceType === 'uploaded_file').sort((a, b) => b.score - a.score);
  const webAll = allCandidates.filter(s => s.sourceType === 'web_scraping').sort((a, b) => b.score - a.score);
  const unknownAll = allCandidates.filter(s => s.sourceType === 'unknown').sort((a, b) => b.score - a.score);

  // Sem nenhum chunk indexado relevante: devolve vazio para o chamador decidir (ex.: 422 NO_INDEXED_CONTEXT)
  if (uploadedAll.length === 0 && webAll.length === 0 && unknownAll.length === 0) {
    const contextSources = [];
    const contextSummary = summarize(contextSources);
    logger.debug('[RAGContextBuilder] No indexed context for query', {
      tenantId,
      summary: contextSummary,
    });
    return {
      ragContext: '',
      contextSources,
      contextSummary,
      notes: ['Nenhum contexto indexado relevante foi encontrado para esta consulta.'],
    };
  }

  const selected = [];
  const seenChunkIds = new Set();
  const seenHashes = new Set();
  const add = (s) => {
    const chunkKey = s.chunkId ? String(s.chunkId) : null;
    const hashKey = s.hash ? String(s.hash) : null;
    if (hashKey && seenHashes.has(hashKey)) return false;
    if (chunkKey && seenChunkIds.has(chunkKey)) return false;
    if (hashKey) seenHashes.add(hashKey);
    if (chunkKey) seenChunkIds.add(chunkKey);
    selected.push(s);
    return true;
  };

  let usedUploaded = 0;
  for (const s of uploadedAll) {
    if (usedUploaded >= minUploaded) break;
    if (add(s)) usedUploaded += 1;
  }

  let usedWeb = 0;
  for (const s of webAll) {
    if (usedWeb >= minWeb) break;
    if (add(s)) usedWeb += 1;
  }

  // Preenche com o restante (inclui unknown como fallback, mas sem contar como fonte "web/uploaded")
  const remaining = [...uploadedAll, ...webAll, ...unknownAll].sort((a, b) => b.score - a.score);
  for (const s of remaining) {
    if (selected.length >= totalK) break;
    add(s);
  }

  const finalSelected = selected.slice(0, totalK);
  const uploadedSelected = finalSelected.filter(s => s.sourceType === 'uploaded_file');
  const webSelected = finalSelected.filter(s => s.sourceType === 'web_scraping');
  const unknownSelected = finalSelected.filter(s => s.sourceType === 'unknown');

  const notes = [];
  if (uploadedAll.length === 0) {
    notes.push('Não foi encontrado conteúdo relevante nos arquivos enviados para complementar a descrição.');
  } else if (uploadedSelected.length < minUploaded) {
    notes.push(`Os arquivos enviados tinham poucos trechos relevantes (usados ${uploadedSelected.length}/${minUploaded}).`);
  }
  if (webAll.length === 0) {
    notes.push('Não foi encontrado conteúdo relevante no web scraping.');
  } else if (webSelected.length < minWeb) {
    notes.push(`O web scraping tinha poucos trechos relevantes (usados ${webSelected.length}/${minWeb}).`);
  }
  if (unknownSelected.length > 0) {
    notes.push('Alguns trechos não puderam ser classificados por fonte (metadados insuficientes).');
  }

  const ragContext = formatContext({ uploaded: uploadedSelected, web: webSelected, notes });
  const contextSources = finalSelected.map(({ _raw, ...safe }) => safe);
  const contextSummary = summarize(contextSources);

  // Debug interno útil para rastrear enviesamento (sem vazar conteúdo completo)
  logger.debug('[RAGContextBuilder] Diverse context built', {
    tenantId,
    totalK,
    minUploaded,
    minWeb,
    topK,
    summary: contextSummary,
  });

  return {
    ragContext,
    contextSources,
    contextSummary,
    notes,
  };
}

module.exports = {
  buildDiverseRagContext,
};

