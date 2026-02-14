const { buildDiverseRagContext } = require('./ragContextBuilder');
const { getEphemeralContext } = require('./ephemeralRagContextService');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function coerceInlineChunk(c) {
  const sourceType = safeString(c?.sourceType || '').trim();
  const sourceId = safeString(c?.sourceId || '').trim();
  const text = safeString(c?.text || c?.excerpt || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 20) return null;
  return {
    sourceType: (sourceType === 'uploaded_file' || sourceType === 'web_scraping') ? sourceType : 'unknown',
    sourceId: sourceId || null,
    text: text.slice(0, 4000),
    excerpt: text.length > 520 ? `${text.slice(0, 520)}...` : text,
    score: 0,
    chunkId: null,
    hash: null,
  };
}

/**
 * Resolve a fonte de contexto/chunks para geração (preferindo inline → Redis → RAG).
 *
 * @param {{
 *  tenantId: string,
 *  executionId?: string|null,
 *  contextMode?: 'auto'|'persisted'|'ephemeral',
 *  name?: string|null,
 *  urls?: string[],
 *  fileNames?: string[],
 *  chunks?: Array<{sourceType?: string, sourceId?: string|null, text?: string, excerpt?: string}>
 * }} input
 * @returns {Promise<{ contextSources: any[], used: string }>}
 */
async function resolveContextSources(input) {
  const tenantId = safeString(input?.tenantId).trim();
  const executionId = safeString(input?.executionId).trim() || null;
  const contextMode = (input?.contextMode === 'ephemeral' || input?.contextMode === 'persisted')
    ? input.contextMode
    : 'auto';

  const urls = Array.isArray(input?.urls) ? input.urls : [];
  const fileNames = Array.isArray(input?.fileNames) ? input.fileNames : [];
  const inlineChunks = Array.isArray(input?.chunks) ? input.chunks : [];

  // 1) Inline (ex.: testes/dry-run sem Redis)
  const inlineSources = inlineChunks
    .map(coerceInlineChunk)
    .filter(Boolean)
    .slice(0, 30);
  if (inlineSources.length > 0) {
    return { contextSources: inlineSources, used: 'inline' };
  }

  // 2) Efêmero (Redis)
  if (executionId && (contextMode === 'auto' || contextMode === 'ephemeral')) {
    const eph = await getEphemeralContext({ tenantId, executionId });
    if (eph.found && Array.isArray(eph.chunks) && eph.chunks.length > 0) {
      return { contextSources: eph.chunks, used: `ephemeral:${eph.used}` };
    }
    if (contextMode === 'ephemeral') {
      return { contextSources: [], used: `ephemeral:${eph.used}` };
    }
  }

  // 3) Persistido (RAG)
  if (contextMode === 'auto' || contextMode === 'persisted') {
    const tenantName = safeString(input?.name || '').trim();
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
      ragQuery = `${tenantName} ${urlDomains.join(' ')} perguntas frequentes serviços produtos informações`;
    } else if (tenantName) {
      ragQuery = `Perguntas frequentes sobre ${tenantName} serviços produtos empresa informações`;
    } else if (urlDomains.length > 0) {
      ragQuery = `${urlDomains.join(' ')} perguntas frequentes informações conteúdo site`;
    } else {
      ragQuery = 'Perguntas frequentes e informações sobre o tenant';
    }
    if (safeFileNames.length > 0) {
      ragQuery = `${ragQuery} documentos arquivos ${safeFileNames.join(' ')}`;
    }

    const diverse = await buildDiverseRagContext({
      query: ragQuery,
      tenantId,
      totalK: 22,
      minUploaded: 6,
      minWeb: 6,
      minScore: 0.12,
      maxTokens: 4500,
    });

    return {
      contextSources: Array.isArray(diverse.contextSources) ? diverse.contextSources : [],
      used: 'rag',
    };
  }

  return { contextSources: [], used: 'none' };
}

module.exports = {
  resolveContextSources,
  _internal: { coerceInlineChunk },
};

