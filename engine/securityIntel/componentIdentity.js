'use strict';

/**
 * componentIdentity — identidade canônica de componentes de software.
 *
 * Módulo PURO. `crypto` é usado apenas para hashing determinístico (mesmo
 * critério de `engine/engineeringMission/*`); não há I/O, relógio ou aleatório.
 *
 * Contrato de identidade (o que faz dois componentes serem "o mesmo"):
 *   - `componentKey`  → `ecosystem:name@version` (ou `ecosystem:namespace/name@version`).
 *   - `bomRef`        → chave de identidade estável DENTRO de um SBOM; inclui o
 *                       serviço consumidor quando o mesmo pacote aparece em
 *                       serviços diferentes (o inventário precisa distinguir).
 *   - `fingerprint`   → SHA-256 dos campos ESTRUTURAIS apenas (nome, versão,
 *                       purl, origem). Campo derivado (vulnerabilidade, risco,
 *                       timestamp de varredura) NUNCA entra no fingerprint.
 */

const crypto = require('crypto');

const PURL_TYPES = Object.freeze({
  npm: 'npm',
  pypi: 'pypi',
  docker: 'docker',
  oci: 'oci',
  github: 'github',
  deb: 'deb',
  rpm: 'rpm',
  generic: 'generic',
});

/**
 * Campos que participam do fingerprint estrutural. `source` NÃO participa:
 * proveniência não é identidade — a mesma imagem declarada em dois compose
 * files, ou o mesmo pacote citado em lockfile e manifesto, é UM componente com
 * duas fontes, não um conflito.
 */
const STRUCTURAL_FIELDS = Object.freeze([
  'ecosystem',
  'name',
  'namespace',
  'version',
  'versionClass',
  'purl',
  'service',
  // `installPath` distingue cópias FISICAMENTE diferentes do mesmo pacote no
  // mesmo serviço (hoisted x aninhada, imagem A x imagem B). Sem ele, uma cópia
  // aninhada com integridade diferente seria colapsada em silêncio — perda de
  // achado, não economia de ruído.
  'installPath',
]);

/** Campos derivados: explicitamente fora do fingerprint. */
const NON_STRUCTURAL_FIELDS = Object.freeze([
  'vulnerabilities',
  'risk',
  'riskLevel',
  'status',
  'lastCheckedAt',
  'firstSeenAt',
  'confidence',
  'matchedBy',
]);

function normalizeEcosystemForPurl(ecosystem) {
  const value = String(ecosystem || '').toLowerCase();
  if (value === 'npm' || value === 'semver' || value === 'node') return PURL_TYPES.npm;
  if (value === 'pypi' || value === 'python' || value === 'pip') return PURL_TYPES.pypi;
  if (value === 'docker' || value === 'oci') return PURL_TYPES.docker;
  if (PURL_TYPES[value]) return PURL_TYPES[value];
  return PURL_TYPES.generic;
}

/**
 * Normaliza o nome conforme o ecossistema:
 *   - npm  → minúsculo (PURL exige), escopo preservado.
 *   - pypi → PEP 503 (minúsculo, `_`/`.` → `-`).
 *   - demais → preservado (docker precisa da caixa original do path).
 */
function normalizeName(name, ecosystem) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const eco = normalizeEcosystemForPurl(ecosystem);
  if (eco === PURL_TYPES.npm) return raw.toLowerCase();
  if (eco === PURL_TYPES.pypi) return raw.toLowerCase().replace(/[-_.]+/g, '-');
  return raw;
}

/** Escapa o namespace/nome segundo o PURL spec (percent-encoding do `@`). */
function encodePurlSegment(segment) {
  return String(segment).split('/').map((part) => part.replace(/@/g, '%40')).join('/');
}

/**
 * Constrói um Package URL (purl spec).
 * @returns {string|null} `null` se faltar nome — nunca uma purl inventada.
 */
function buildPurl({ ecosystem, name, namespace, version, qualifiers } = {}) {
  const eco = normalizeEcosystemForPurl(ecosystem);
  const normalizedName = normalizeName(name, ecosystem);
  if (!normalizedName) return null;
  const ns = namespace ? `${encodePurlSegment(namespace)}/` : '';
  const suffix = version ? `@${String(version)}` : '';
  const base = `pkg:${eco}/${ns}${encodePurlSegment(normalizedName)}${suffix}`;
  if (qualifiers && Object.keys(qualifiers).length > 0) {
    const query = Object.keys(qualifiers)
      .sort()
      .map((key) => `${key}=${qualifiers[key]}`)
      .join('&');
    return `${base}?${query}`;
  }
  return base;
}

/** Decompõe uma purl (usado para auditar round-trip). */
function parsePurl(purl) {
  if (typeof purl !== 'string') return null;
  const match = /^pkg:([^/]+)\/(.+?)(?:@([^?]+))?(?:\?(.*))?$/.exec(purl.trim());
  if (!match) return null;
  const [, type, pathAndNs, version, query] = match;
  const segments = pathAndNs.split('/');
  const name = segments.pop();
  return {
    type,
    namespace: segments.length > 0 ? segments.join('/') : null,
    name,
    version: version || null,
    qualifiers: query
      ? Object.fromEntries(query.split('&').map((pair) => {
        const [key, value] = pair.split('=');
        return [key, value];
      }))
      : {},
  };
}

/** Chave de identidade estável (nome + versão + ecossistema). */
function componentKey(component = {}) {
  const eco = normalizeEcosystemForPurl(component.ecosystem);
  const name = normalizeName(component.name, component.ecosystem);
  if (!name) return null;
  const ns = component.namespace ? `${component.namespace}/` : '';
  return `${eco}:${ns}${name}@${component.version || 'unknown'}`;
}

/**
 * Referência única DENTRO de um SBOM. O mesmo pacote instalado em serviços
 * diferentes — ou duas cópias do mesmo pacote no MESMO serviço (hoisted e
 * aninhada) — são componentes diferentes: o inventário precisa distinguir o
 * que está exposto em cada lugar.
 */
function bomRef(component = {}) {
  const key = componentKey(component);
  if (!key) return null;
  const versionClass = component.versionClass || 'RESOLVED';
  const service = component.service || 'unknown-service';
  const parts = [key, versionClass, service];
  if (component.installPath) {
    parts.push(String(component.installPath).replace(/^node_modules\//, ''));
  }
  return parts.join('#');
}

/** Hash SHA-256 de uma string. */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Projeta apenas os campos estruturais (ordem fixa → determinístico). */
function structuralFields(component = {}) {
  const projected = {};
  for (const field of STRUCTURAL_FIELDS) {
    projected[field] = component[field] === undefined ? null : component[field];
  }
  return projected;
}

function fingerprintComponent(component = {}) {
  return sha256(JSON.stringify(structuralFields(component)));
}

/**
 * Deduplica componentes por `bomRef` preservando a ordem estável e, quando o
 * MESMO bomRef aparece duas vezes com fingerprints diferentes, mantém os dois
 * (não esconde divergência — ela é a evidência de um drift).
 */
function dedupeComponents(components = []) {
  const seen = new Map();
  for (const component of components) {
    const ref = bomRef(component);
    if (!ref) continue;
    const fingerprint = fingerprintComponent(component);
    const existing = seen.get(ref);
    if (!existing) {
      seen.set(ref, { ...component, bomRef: ref, fingerprint });
      continue;
    }
    if (existing.fingerprint !== fingerprint) {
      throw new Error(`component_identity_conflict:${ref}`);
    }
  }
  return [...seen.values()];
}

/** Ordenação determinística (por bomRef) — exigida para SBOM reprodutível. */
function sortComponents(components = []) {
  return [...components].sort((a, b) => {
    const refA = a.bomRef || bomRef(a) || '';
    const refB = b.bomRef || bomRef(b) || '';
    return refA < refB ? -1 : refA > refB ? 1 : 0;
  });
}

/**
 * Deriva um UUID (v5-like) determinístico de um texto — usado para o
 * `serialNumber` do SBOM, que precisa ser estável para o mesmo conjunto de
 * componentes (SBOM reprodutível = evidência auditável).
 */
function deterministicUuid(seed) {
  const hex = sha256(seed);
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  const versioned = `5${hex.slice(13, 16)}`;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    versioned,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

module.exports = {
  PURL_TYPES,
  STRUCTURAL_FIELDS,
  NON_STRUCTURAL_FIELDS,
  normalizeEcosystemForPurl,
  normalizeName,
  buildPurl,
  parsePurl,
  componentKey,
  bomRef,
  sha256,
  structuralFields,
  fingerprintComponent,
  dedupeComponents,
  sortComponents,
  deterministicUuid,
};
