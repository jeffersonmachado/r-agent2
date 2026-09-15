'use strict';

/**
 * Snapshot Store — backend do modo OFFLINE (zero egress).
 *
 * Em OFFLINE o container NUNCA faz rede: `research_fetch` lê o documento do
 * snapshot local endereçado por URL e `research_search` busca no índice local.
 * Ausência no snapshot é erro TIPADO (`research_offline_snapshot_miss`),
 * nunca fallback para rede.
 *
 * Layout do diretório (MCP_RESEARCH_SNAPSHOT_DIR):
 *
 *   index.json                    índice de busca + catálogo de documentos
 *   documents/<sha256(url)>.json  um arquivo por documento
 *
 * index.json:
 *   {
 *     "version": 1,
 *     "documents": [{
 *       "url": "https://vendor.example/docs",      // chave de endereçamento
 *       "canonicalUrl": "https://vendor.example/docs",
 *       "title": "...", "snippet": "...",
 *       "contentType": "text/html; charset=utf-8",
 *       "retrievedAt": "2026-09-01T00:00:00.000Z",
 *       "domain": "vendor.example",
 *       "sourceType": "snapshot",
 *       "queryTerms": ["fitness", "billing"]        // termos de indexação
 *     }]
 *   }
 *
 * documents/<sha256(url)>.json:
 *   { "url", "contentType", "retrievedAt", "content" }
 *
 * O nome do arquivo é DERIVADO (sha256 da URL normalizada) — entrada externa
 * nunca vira caminho de arquivo (sem path traversal por construção).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function offlineError(code, message, detail = null) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function normalizeUrlKey(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return raw;
  }
}

function snapshotFileName(url) {
  return `${crypto.createHash('sha256').update(normalizeUrlKey(url), 'utf8').digest('hex')}.json`;
}

function createSnapshotStore({ snapshotDir, logger } = {}) {
  if (!snapshotDir) throw offlineError('research_offline_snapshot_invalid', 'snapshotDir ausente');
  const root = path.resolve(snapshotDir);
  const indexPath = path.join(root, 'index.json');
  const documentsDir = path.join(root, 'documents');

  let index = null;

  function loadIndex() {
    let raw;
    try {
      raw = fs.readFileSync(indexPath, 'utf8');
    } catch (error) {
      throw offlineError(
        'research_offline_snapshot_unavailable',
        `index.json ilegível em ${indexPath} (${error.code || error.message})`,
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw offlineError('research_offline_snapshot_invalid', `index.json malformado (${error.message})`);
    }
    const documents = Array.isArray(parsed?.documents) ? parsed.documents : [];
    index = documents
      .filter((entry) => entry && typeof entry.url === 'string' && entry.url.trim().length > 0)
      .map((entry) => Object.freeze({
        url: String(entry.url),
        canonicalUrl: typeof entry.canonicalUrl === 'string' ? entry.canonicalUrl : String(entry.url),
        title: typeof entry.title === 'string' ? entry.title : null,
        snippet: typeof entry.snippet === 'string' ? entry.snippet : null,
        contentType: typeof entry.contentType === 'string' ? entry.contentType : null,
        retrievedAt: typeof entry.retrievedAt === 'string' ? entry.retrievedAt : null,
        domain: typeof entry.domain === 'string' ? entry.domain : safeDomain(entry.url),
        sourceType: typeof entry.sourceType === 'string' ? entry.sourceType : 'snapshot',
        queryTerms: Array.isArray(entry.queryTerms) ? entry.queryTerms.map((t) => String(t).toLowerCase()) : [],
      }));
    return index;
  }

  function safeDomain(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_) {
      return null;
    }
  }

  function entries() {
    if (!index) loadIndex();
    return index;
  }

  /** Busca local: conjunção de termos sobre título/snippet/url/queryTerms. */
  function search({ query, maxResults = 10 } = {}) {
    const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const matches = [];
    for (const entry of entries()) {
      const haystack = [entry.title, entry.snippet, entry.url, ...entry.queryTerms]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) continue;
      matches.push({
        title: entry.title || entry.url,
        url: entry.url,
        snippet: entry.snippet,
        domain: entry.domain,
        sourceType: entry.sourceType,
        retrievedAt: entry.retrievedAt,
      });
      if (matches.length >= maxResults) break;
    }
    return matches;
  }

  /** Leitura de documento endereçado por URL; ausência é erro tipado. */
  function fetchDocument(url) {
    const file = path.join(documentsDir, snapshotFileName(url));
    // O nome é sha256 hex + '.json' gerado AQUI — `url` jamais compõe path.
    if (path.dirname(file) !== documentsDir) {
      throw offlineError('research_offline_snapshot_invalid', 'caminho de documento fora do snapshot');
    }
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      throw offlineError(
        'research_offline_snapshot_miss',
        `documento ausente no snapshot (${normalizeUrlKey(url)})`,
        { url: normalizeUrlKey(url), cause: error.code || error.message },
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw offlineError('research_offline_snapshot_invalid', `documento malformado (${file})`);
    }
    if (typeof parsed?.content !== 'string') {
      throw offlineError('research_offline_snapshot_invalid', `documento sem content string (${file})`);
    }
    return {
      url: typeof parsed.url === 'string' ? parsed.url : normalizeUrlKey(url),
      contentType: typeof parsed.contentType === 'string' ? parsed.contentType : null,
      retrievedAt: typeof parsed.retrievedAt === 'string' ? parsed.retrievedAt : null,
      content: parsed.content,
    };
  }

  logger?.debug?.('[mcp-research] snapshot store pronto', { snapshotDir: root });
  return Object.freeze({ search, fetchDocument, entries, normalizeUrlKey });
}

module.exports = { createSnapshotStore, normalizeUrlKey, snapshotFileName };
