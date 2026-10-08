'use strict';

/**
 * versionCore — comparação, ordenação e matching de faixas de versão para a
 * capacidade RAP Version & Security Intelligence.
 *
 * Módulo PURO: sem I/O, sem relógio, sem aleatório, sem logger, sem `process`.
 * Determinístico por contrato (o mesmo par de entradas devolve o mesmo veredito).
 *
 * Ecossistemas suportados:
 *   - `npm`    → SemVer 2.0.0 estrito (com tolerância a prefixo `v`).
 *   - `pypi`   → PEP 440 (epoch, pre/post/dev, local segment).
 *   - `docker` → comparação numérica COARSE de tags; sempre marcada como
 *                `coarse: true` porque tags de imagem não são versões.
 *
 * REGRA DE HONESTIDADE (inegociável): quando uma versão não é comparável, o
 * veredito é `null` (= DESCONHECIDO). Nunca `false`, nunca "não afetado".
 * Ausência de veredito não pode virar ausência de vulnerabilidade.
 */

const ECOSYSTEMS = Object.freeze({ NPM: 'npm', PYPI: 'pypi', DOCKER: 'docker' });

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

const PEP440_RE = new RegExp(
  '^v?' +
    '(?:(\\d+)!)?' + // epoch
    '(\\d+(?:\\.\\d+)*)' + // release
    '(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\\d+)?)?' + // pre
    '(?:[-_.]?(?:post|rev|r)[-_.]?(\\d+)?)?' + // post
    '(?:[-_.]?dev[-_.]?(\\d+)?)?' + // dev
    '(?:\\+([0-9a-z]+(?:[._-][0-9a-z]+)*))?' + // local
    '$'
);

const PRE_RANK = Object.freeze({ a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 });

/** Versões-especiais que significam "desde o início" nos eventos OSV. */
const ZERO_MARKERS = Object.freeze(new Set(['0', '0.0.0', '0.0.0-0', '-0']));

// ────────────────────────────────────────────────────────────────────────────
// SemVer 2.0.0
// ────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} value
 * @returns {{major:number,minor:number,patch:number,prerelease:string[],build:string[],raw:string}|null}
 */
function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
    raw: value.trim(),
  };
}

/** Compara dois identificadores de pré-release do SemVer. */
function comparePrereleaseIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1; // numérico < alfanumérico
  if (bNum) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Compara pré-releases (vazio = maior). */
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const cmp = comparePrereleaseIdentifiers(a[i], b[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function compareSemver(a, b) {
  const pa = typeof a === 'string' ? parseSemver(a) : a;
  const pb = typeof b === 'string' ? parseSemver(b) : b;
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return Math.sign(pa.major - pb.major);
  if (pa.minor !== pb.minor) return Math.sign(pa.minor - pb.minor);
  if (pa.patch !== pb.patch) return Math.sign(pa.patch - pb.patch);
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

// ────────────────────────────────────────────────────────────────────────────
// PEP 440
// ────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} value
 * @returns {{epoch:number,release:number[],pre:object|null,post:object|null,dev:object|null,local:string[]|null,raw:string}|null}
 */
function parsePep440(value) {
  if (typeof value !== 'string') return null;
  const match = PEP440_RE.exec(value.trim());
  if (!match) return null;
  const preKind = match[3] ? match[3].toLowerCase() : null;
  return {
    epoch: match[1] ? Number(match[1]) : 0,
    release: match[2].split('.').map(Number),
    pre: preKind ? { kind: PRE_RANK[preKind] ?? 2, num: match[4] ? Number(match[4]) : 0 } : null,
    post: match[5] !== undefined ? { num: match[5] === '' ? 0 : Number(match[5]) } : null,
    dev: match[6] !== undefined ? { num: match[6] === '' ? 0 : Number(match[6]) } : null,
    local: match[7] ? match[7].split(/[._-]/) : null,
    raw: value.trim(),
  };
}

/** Compara duas listas de release com padding de zeros. */
function compareRelease(a, b) {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return Math.sign(av - bv);
  }
  return 0;
}

/**
 * Chave de ordenação PEP 440. `dev` presente ordena ANTES de pre/final;
 * `post` presente ordena DEPOIS de final.
 */
function pep440SortKey(parsed) {
  const release = parsed.release.slice();
  let preKey;
  if (parsed.pre) preKey = [parsed.pre.kind, parsed.pre.num];
  else if (parsed.dev) preKey = [-1, parsed.dev.num];
  else preKey = [3, 0];
  const postKey = parsed.post ? [0, parsed.post.num] : [-1, 0];
  const devKey = parsed.dev ? [0, parsed.dev.num] : [1, 0];
  return { epoch: parsed.epoch, release, preKey, postKey, devKey, local: parsed.local };
}

function compareNumberArrays(a, b) {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return Math.sign(av - bv);
  }
  return 0;
}

function compareLocalSegments(a, b) {
  // PEP 440: o segmento local só desempata quando AMBOS o possuem.
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const aNum = /^\d+$/.test(av);
    const bNum = /^\d+$/.test(bv);
    if (aNum && bNum) {
      const cmp = Math.sign(Number(av) - Number(bv));
      if (cmp !== 0) return cmp;
    } else if (aNum !== bNum) {
      return aNum ? 1 : -1; // numérico ordena depois de alfabético
    } else if (av !== bv) {
      return av < bv ? -1 : 1;
    }
  }
  return 0;
}

function comparePep440(a, b) {
  const pa = typeof a === 'string' ? parsePep440(a) : a;
  const pb = typeof b === 'string' ? parsePep440(b) : b;
  if (!pa || !pb) return null;
  if (pa.epoch !== pb.epoch) return Math.sign(pa.epoch - pb.epoch);
  const ka = pep440SortKey(pa);
  const kb = pep440SortKey(pb);
  const releaseCmp = compareRelease(ka.release, kb.release);
  if (releaseCmp !== 0) return releaseCmp;
  const preCmp = compareNumberArrays(ka.preKey, kb.preKey);
  if (preCmp !== 0) return preCmp;
  const postCmp = compareNumberArrays(ka.postKey, kb.postKey);
  if (postCmp !== 0) return postCmp;
  const devCmp = compareNumberArrays(ka.devKey, kb.devKey);
  if (devCmp !== 0) return devCmp;
  return compareLocalSegments(ka.local, kb.local);
}

// ────────────────────────────────────────────────────────────────────────────
// Docker / tags não-versionadas (COARSE)
// ────────────────────────────────────────────────────────────────────────────

/** Extrai tupla numérica de uma tag (`pg16-alpine3.20` → [16, 3, 20]). */
function parseCoarseTuple(value) {
  if (typeof value !== 'string') return null;
  const numbers = value.match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;
  return numbers.map(Number);
}

// ────────────────────────────────────────────────────────────────────────────
// API canônica
// ────────────────────────────────────────────────────────────────────────────

/** Normaliza o ecossistema aceito (`semver` do OSV → npm, etc.). */
function normalizeEcosystem(ecosystem) {
  if (!ecosystem) return null;
  const value = String(ecosystem).toLowerCase();
  if (value === 'npm' || value === 'semver' || value === 'node') return ECOSYSTEMS.NPM;
  if (value === 'pypi' || value === 'python' || value === 'pip') return ECOSYSTEMS.PYPI;
  if (value === 'docker' || value === 'oci') return ECOSYSTEMS.DOCKER;
  return value;
}

/**
 * Compara duas versões do mesmo ecossistema.
 * @returns {-1|0|1|null} `null` = não comparável (DESCONHECIDO).
 */
function compareVersions(a, b, options = {}) {
  const ecosystem = normalizeEcosystem(options.ecosystem);
  if (ecosystem === ECOSYSTEMS.NPM) return compareSemver(a, b);
  if (ecosystem === ECOSYSTEMS.PYPI) return comparePep440(a, b);
  if (ecosystem === ECOSYSTEMS.DOCKER) {
    const ta = parseCoarseTuple(a);
    const tb = parseCoarseTuple(b);
    if (!ta || !tb) return null;
    const max = Math.max(ta.length, tb.length);
    for (let i = 0; i < max; i += 1) {
      const av = ta[i] ?? 0;
      const bv = tb[i] ?? 0;
      if (av !== bv) return Math.sign(av - bv);
    }
    return 0;
  }
  // Desconhecido: tenta SemVer, depois PEP 440, depois coarse. Nunca inventa.
  const semverCmp = compareSemver(a, b);
  if (semverCmp !== null) return semverCmp;
  const pepCmp = comparePep440(a, b);
  if (pepCmp !== null) return pepCmp;
  const ta = parseCoarseTuple(a);
  const tb = parseCoarseTuple(b);
  if (!ta || !tb) return null;
  return compareNumberArrays(ta, tb);
}

/** `true`/`false`/`null` (desconhecido) para `a < b`. */
function isVersionLessThan(a, b, options) {
  const cmp = compareVersions(a, b, options);
  return cmp === null ? null : cmp < 0;
}

/**
 * Matching de faixas no formato OSV: `{ type, events: [{introduced}|{fixed}|
 * {last_affected}|{limit}] }`. Percorre os eventos em ordem; um evento sem
 * par comparável devolve `null` (DESCONHECIDO) — nunca "não afetado".
 *
 * @returns {boolean|null}
 */
function isVersionInOsvRange(version, range, options = {}) {
  if (!range || !Array.isArray(range.events)) return null;
  const ecosystem = normalizeEcosystem(options.ecosystem || range.type);
  let affected = false;
  let compared = false;
  for (const event of range.events) {
    if (!event || typeof event !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(event, 'introduced')) {
      const introduced = String(event.introduced);
      if (ZERO_MARKERS.has(introduced)) {
        affected = true;
        compared = true;
        continue;
      }
      const cmp = compareVersions(version, introduced, { ecosystem });
      if (cmp === null) return null;
      if (cmp >= 0) affected = true;
      compared = true;
    } else if (Object.prototype.hasOwnProperty.call(event, 'fixed')) {
      const fixed = String(event.fixed);
      if (ZERO_MARKERS.has(fixed)) {
        affected = false;
        compared = true;
        continue;
      }
      const cmp = compareVersions(version, fixed, { ecosystem });
      if (cmp === null) return null;
      if (cmp >= 0) affected = false;
      compared = true;
    } else if (Object.prototype.hasOwnProperty.call(event, 'last_affected')) {
      const cmp = compareVersions(version, String(event.last_affected), { ecosystem });
      if (cmp === null) return null;
      if (cmp > 0) affected = false;
      compared = true;
    } else if (Object.prototype.hasOwnProperty.call(event, 'limit')) {
      const cmp = compareVersions(version, String(event.limit), { ecosystem });
      if (cmp === null) return null;
      if (cmp >= 0) affected = false;
      compared = true;
    }
  }
  if (!compared) return null;
  return affected;
}

/** Expande `^`/`~` para comparadores explícitos. */
function expandShorthand(operator, version) {
  const parsed = parseSemver(version);
  if (!parsed) return null;
  const { major, minor, patch } = parsed;
  if (operator === '^') {
    if (major > 0) return [`>=${version}`, `<${major + 1}.0.0`];
    if (minor > 0) return [`>=${version}`, `<0.${minor + 1}.0`];
    return [`>=${version}`, `<0.0.${patch + 1}`];
  }
  // `~`
  return [`>=${version}`, `<${major}.${minor + 1}.0`];
}

/**
 * Avalia um comparator set (`">=1.2.3 <2.0.0 || >=3.0.0"`).
 * Suporta `>=`, `>`, `<=`, `<`, `=`, `==`, `^`, `~` e `*`.
 * @returns {boolean|null} `null` = não avaliável (nunca tratar como "não afetado").
 */
function satisfiesComparatorSet(version, rangeText, options = {}) {
  if (typeof rangeText !== 'string' || rangeText.trim() === '') return null;
  const trimmed = rangeText.trim();
  if (trimmed === '*' || trimmed.toLowerCase() === 'latest') return true;
  const ecosystem = normalizeEcosystem(options.ecosystem);
  const orGroups = trimmed.split('||').map((part) => part.trim()).filter(Boolean);
  let anyKnown = false;
  for (const group of orGroups) {
    const tokens = group.split(/\s+/).filter(Boolean);
    let groupSatisfied = true;
    let groupKnown = true;
    for (const token of tokens) {
      const match = /^(\^|~|>=|<=|>|<|===|==|=)?\s*(.+)$/.exec(token);
      if (!match) {
        groupKnown = false;
        break;
      }
      const operator = match[1] || '=';
      const versionText = match[2].trim();
      let comparators;
      if (operator === '^' || operator === '~') {
        comparators = expandShorthand(operator, versionText);
        if (!comparators) {
          groupKnown = false;
          break;
        }
      } else {
        comparators = [`${operator}${versionText}`];
      }
      for (const comparator of comparators) {
        const cmpMatch = /^(>=|<=|>|<|===|==|=)?(.*)$/.exec(comparator);
        const cmpOp = cmpMatch[1] || '=';
        const cmpVersion = cmpMatch[2];
        if (cmpVersion.includes('*') || cmpVersion.toLowerCase() === 'x') return null; // wildcard: ambíguo
        const cmp = compareVersions(version, cmpVersion, { ecosystem });
        if (cmp === null) {
          groupKnown = false;
          break;
        }
        if (cmpOp === '>=' && !(cmp >= 0)) groupSatisfied = false;
        else if (cmpOp === '<=' && !(cmp <= 0)) groupSatisfied = false;
        else if (cmpOp === '>' && !(cmp > 0)) groupSatisfied = false;
        else if (cmpOp === '<' && !(cmp < 0)) groupSatisfied = false;
        else if ((cmpOp === '=' || cmpOp === '==' || cmpOp === '===') && cmp !== 0) groupSatisfied = false;
        if (!groupSatisfied) break;
      }
      if (!groupKnown || !groupSatisfied) break;
    }
    if (groupKnown && groupSatisfied) return true;
    if (groupKnown) anyKnown = true;
  }
  return anyKnown ? false : null;
}

/**
 * Verifica se `version` é afetada por uma faixa declarada — aceita tanto o
 * formato OSV (`events`) quanto comparadores livres.
 * @returns {boolean|null}
 */
function isVersionAffected(version, range, options = {}) {
  if (!range) return null;
  if (Array.isArray(range.events)) return isVersionInOsvRange(version, range, options);
  if (typeof range === 'string') return satisfiesComparatorSet(version, range, options);
  if (typeof range.comparator === 'string') return satisfiesComparatorSet(version, range.comparator, options);
  return null;
}

/** Classifica a precisão da comparação (auditoria da evidência). */
function comparability(version, options = {}) {
  const ecosystem = normalizeEcosystem(options.ecosystem);
  if (ecosystem === ECOSYSTEMS.NPM) return parseSemver(version) ? 'exact' : 'unknown';
  if (ecosystem === ECOSYSTEMS.PYPI) return parsePep440(version) ? 'exact' : 'unknown';
  if (ecosystem === ECOSYSTEMS.DOCKER) return parseCoarseTuple(version) ? 'coarse' : 'unknown';
  if (parseSemver(version) || parsePep440(version)) return 'exact';
  return parseCoarseTuple(version) ? 'coarse' : 'unknown';
}

module.exports = {
  ECOSYSTEMS,
  ZERO_MARKERS,
  parseSemver,
  compareSemver,
  parsePep440,
  comparePep440,
  compareVersions,
  isVersionLessThan,
  isVersionInOsvRange,
  satisfiesComparatorSet,
  isVersionAffected,
  normalizeEcosystem,
  comparability,
};
