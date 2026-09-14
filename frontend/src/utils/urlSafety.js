/**
 * Sanitização de URL para fontes exibidas ao usuário (Ask AI e correlatos).
 *
 * Motivação (auditoria 2026-09-14): não existia NENHUM utilitário compartilhado de
 * sanitização de URL em `frontend/src` — o padrão era `window.open(url, '_blank',
 * 'noopener')` duplicado localmente, e `RagDocumentDetailsModal.jsx` montava
 * `<a href>` a partir de dado de documento ingerido sem allowlist de scheme. Quando
 * o Ask AI passou a linkar fontes, faltava a barreira contra `javascript:`,
 * `data:`, `file:` e caminhos internos de filesystem.
 *
 * Contrato: só passa (a) caminho INTERNO absoluto do RAP (`/rota`) que não pareça
 * filesystem/artefato técnico, e (b) URL absoluta `http(s)`. Qualquer outra coisa
 * devolve `null` — e uma fonte sem URL segura NÃO é renderizada como link.
 */

export const SOURCE_URL_MAX_LENGTH = 2048;
export const DEFAULT_SOURCE_LABEL = 'Fonte consultada';

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;
// Prefixos de filesystem que jamais devem virar link na interface.
const FILESYSTEM_PREFIX_PATTERN = /^\/(?:srv|var|opt|etc|home|root|usr|mnt|media|proc|sys)\//i;
// Extensões técnicas: indicam artefato de repositório, não documento navegável.
const TECHNICAL_FILE_PATTERN = /\.(?:md|markdown|json|jsonl|js|mjs|cjs|ts|tsx|jsx|py|sql|yml|yaml|log|env|txt)$/i;
const TECHNICAL_LABEL_PATTERN = /\.(?:md|markdown|json|html)$|^src-|^chunk\s+\d+/i;

/**
 * Valida uma URL de fonte.
 * @param {unknown} raw - valor candidato
 * @returns {string|null} URL segura ou null
 */
export function sanitizeSourceUrl(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > SOURCE_URL_MAX_LENGTH) return null;

  if (ABSOLUTE_URL_PATTERN.test(value)) {
    return HTTP_URL_PATTERN.test(value) ? value : null;
  }
  // Protocol-relative (`//evil`) e caminho relativo simples são rejeitados:
  // a interface só navega para rotas internas explícitas do RAP.
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (FILESYSTEM_PREFIX_PATTERN.test(value)) return null;
  if (TECHNICAL_FILE_PATTERN.test(value.split('?')[0])) return null;
  return value;
}

/**
 * Deriva um rótulo humano a partir do identificador presente na URL interna
 * (ex.: `/rag-documents?documentId=src-docs-manual-verticals-beauty-html` →
 * "Manual Verticals Beauty"). Retorna null se não houver identificador útil.
 * @param {string} url - URL já sanitizada
 * @returns {string|null} rótulo derivado
 */
function deriveLabelFromUrl(url) {
  if (typeof url !== 'string') return null;
  const query = url.split('?')[1];
  if (!query) return null;
  let identifier = null;
  try {
    const params = new URLSearchParams(query);
    identifier = params.get('documentId') || params.get('manualId') || params.get('runbookId') || params.get('id');
  } catch {
    return null;
  }
  if (!identifier) return null;
  const base = identifier
    .replace(/^src-/, '')
    // o id interno usa hífen como separador: `...-beauty-html`, `...-x-md`
    .replace(/-(?:md|markdown|json|html|txt)$/i, '')
    .replace(TECHNICAL_FILE_PATTERN, '')
    // segmento de diretório (`docs-`) não é parte do nome do documento
    .replace(/^(?:docs|doc)-/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!base) return null;
  const prettified = base
    .split(/\s+/)
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
  // Identificador puramente numérico/opaco (ex.: `3`) não é rótulo: "3" na
  // interface é pior que o fallback genérico.
  if (!/[a-zà-ú]{3,}/i.test(prettified)) return null;
  return prettified;
}

/**
 * Converte um rótulo técnico em rótulo humano.
 * Nunca devolve caminho de arquivo, id interno (`src-...`) ou "Chunk N".
 * @param {unknown} label - rótulo candidato
 * @param {{derived?: boolean, url?: string}} options
 * @returns {string} rótulo exibível
 */
export function friendlySourceLabel(label, { derived = false, url = null } = {}) {
  const raw = typeof label === 'string' ? label.trim() : '';
  const isTechnical = !raw || TECHNICAL_LABEL_PATTERN.test(raw) || /\bdocs\//i.test(raw);
  if (!isTechnical) return raw.slice(0, 120);

  // Rótulo técnico ("Chunk 15", `src-docs-...`, caminho): o identificador da URL
  // é a única fonte confiável de nome legível — derivar do rótulo repetiria o
  // texto técnico que se quer esconder.
  const fromUrl = deriveLabelFromUrl(url);
  if (fromUrl) return fromUrl.slice(0, 120);

  const base = raw
    .replace(/^src-/, '')
    .replace(TECHNICAL_FILE_PATTERN, '')
    .replace(/^chunk\s+\d+/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!base) return DEFAULT_SOURCE_LABEL;
  const prettified = base
    .split(/\s+/)
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
  return (derived ? prettified : prettified) || DEFAULT_SOURCE_LABEL;
}

/**
 * Normaliza a lista de fontes vinda da API: mantém apenas as que possuem URL
 * segura, deduplica por URL e garante rótulo humano.
 * @param {Array} sources - fontes cruas
 * @param {{max?: number}} options
 * @returns {Array<{label: string, url: string, sourceType: string}>}
 */
export function sanitizeSourceLinks(sources = [], { max = 6 } = {}) {
  if (!Array.isArray(sources)) return [];
  const seen = new Set();
  const links = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const url = sanitizeSourceUrl(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({
      label: friendlySourceLabel(source.label || source.title, { derived: true, url }),
      url,
      sourceType: typeof source.sourceType === 'string' && source.sourceType
        ? source.sourceType
        : 'KNOWLEDGE_DOCUMENT',
    });
    if (links.length >= max) break;
  }
  return links;
}
