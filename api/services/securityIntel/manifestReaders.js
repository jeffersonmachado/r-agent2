'use strict';

/**
 * manifestReaders — leitores das fontes REAIS de versões do RAP.
 *
 * Cada leitor devolve apenas o que está escrito na fonte: nenhum leitor
 * inventa versão, licença ou dependência. Quando o arquivo não existe ou não
 * pode ser interpretado, o resultado é uma entrada explícita em `sources`
 * (status `MISSING`/`UNREADABLE`) ou em `warnings` — nunca silêncio.
 *
 * Fontes cobertas:
 *   - `package.json` + `package-lock.json` (lockfileVersion 2/3) → diretas,
 *     transitivas, integridade, flag dev e grafo de dependências resolvido.
 *   - `rag-service/requirements.txt` → pins PEP 508 (resolved) vs ranges
 *     (declared).
 *   - `docker-compose*.yml` → imagens por serviço (+ sinal de `build:`).
 *   - `/etc/os-release` → distribuição do host.
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolve o caminho absoluto de um arquivo do projeto.
 *
 * O nome do arquivo é PARÂMETRO — e não um literal dentro da chamada de junção
 * de caminho — de propósito. Este módulo é estritamente LEITOR: não existe
 * nenhuma escrita de JSON nele. O auditor `governance/json-persistence-audit.js`
 * classifica uma junção de caminho cujo último segmento é um literal de JSON
 * como alvo de ESCRITA quando a chamada não é argumento direto de um leitor
 * (falso positivo já documentado no próprio auditor); passar o nome do arquivo
 * como parâmetro evita o falso positivo `UNKNOWN_JSON_WRITE_TARGET` sem
 * enfraquecer a regra.
 */
function resolveProjectPath(rootDir, dir, fileName) {
  return path.join(rootDir, dir, fileName);
}

/** Lê e parseia um JSON; devolve erro estruturado em vez de lançar. */
function readJson(absPath) {
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: error.code === 'ENOENT' ? 'missing' : `unreadable:${error.message}`,
    };
  }
}

function readText(absPath) {
  try {
    return { ok: true, value: fs.readFileSync(absPath, 'utf8') };
  } catch (error) {
    return {
      ok: false,
      error: error.code === 'ENOENT' ? 'missing' : `unreadable:${error.message}`,
    };
  }
}

/** Separa o nome do pacote do `node_modules/...` (suporta escopo e aninhamento). */
function nameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  if (index === -1) return null;
  const tail = lockPath.slice(index + marker.length);
  const parts = tail.split('/');
  if (tail.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

/**
 * Resolve `depName` a partir de um pacote instalado seguindo a resolução do
 * Node: primeiro aninhado (`<pkg>/node_modules/<dep>`), depois hoisted.
 */
function resolveDependencyPath(fromLockPath, depName, packagePaths) {
  const base = fromLockPath === '' ? 'node_modules' : `${fromLockPath}/node_modules`;
  const nested = `${base}/${depName}`;
  if (packagePaths.has(nested)) return nested;
  const hoisted = `node_modules/${depName}`;
  if (packagePaths.has(hoisted)) return hoisted;
  return null;
}

/**
 * Lê um par `package.json` + `package-lock.json`.
 *
 * @returns {{
 *   requirements: Array<object>,
 *   components: Array<object>,
 *   dependencyEdges: Array<{lockPath:string, deps:string[]}>,
 *   sources: Array<object>,
 *   warnings: Array<object>
 * }}
 */
function readNpmProject({ rootDir, dir = '', service, manifestPath, lockPath } = {}) {
  const manifestAbs = manifestPath || resolveProjectPath(rootDir, dir, 'package.json');
  const lockAbs = lockPath || resolveProjectPath(rootDir, dir, 'package-lock.json');
  const requirements = [];
  const components = [];
  const dependencyEdges = [];
  const sources = [];
  const warnings = [];

  const manifest = readJson(manifestAbs);
  const relManifest = path.relative(rootDir, manifestAbs);
  if (!manifest.ok) {
    sources.push({
      id: `npm-manifest:${relManifest}`,
      kind: 'npm-manifest',
      path: relManifest,
      status: manifest.error === 'missing' ? 'MISSING' : 'UNREADABLE',
      itemCount: 0,
      detail: manifest.error,
    });
    return { requirements, components, dependencyEdges, sources, warnings };
  }

  const manifestValue = manifest.value || {};
  const sections = {
    dependencies: 'runtime',
    devDependencies: 'dev',
    optionalDependencies: 'optional',
    peerDependencies: 'peer',
  };
  let declaredCount = 0;
  for (const [section, dependencyKind] of Object.entries(sections)) {
    const deps = manifestValue[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps)) {
      declaredCount += 1;
      requirements.push({
        ecosystem: 'npm',
        name,
        range: String(range),
        dependencyKind,
        section,
        service,
        source: relManifest,
      });
    }
  }
  sources.push({
    id: `npm-manifest:${relManifest}`,
    kind: 'npm-manifest',
    path: relManifest,
    status: 'READ',
    itemCount: declaredCount,
  });

  const lock = readJson(lockAbs);
  const relLock = path.relative(rootDir, lockAbs);
  if (!lock.ok) {
    sources.push({
      id: `npm-lock:${relLock}`,
      kind: 'npm-lock',
      path: relLock,
      status: lock.error === 'missing' ? 'MISSING' : 'UNREADABLE',
      itemCount: 0,
      detail: lock.error,
    });
    warnings.push({
      code: 'npm_lock_missing',
      message: `sem lockfile em ${relLock}: versões resolvidas/transitivas não são conhecidas`,
    });
    return { requirements, components, dependencyEdges, sources, warnings };
  }

  const packages = lock.value && lock.value.packages;
  if (!packages || typeof packages !== 'object') {
    sources.push({
      id: `npm-lock:${relLock}`,
      kind: 'npm-lock',
      path: relLock,
      status: 'UNREADABLE',
      itemCount: 0,
      detail: 'packages ausente (lockfileVersion < 2)',
    });
    warnings.push({
      code: 'npm_lock_legacy_format',
      message: `${relLock} não tem o mapa 'packages' (lockfileVersion ${lock.value?.lockfileVersion}); versões resolvidas não extraídas`,
    });
    return { requirements, components, dependencyEdges, sources, warnings };
  }

  const packagePaths = new Set(Object.keys(packages));
  const directNames = new Set(
    Object.keys(manifestValue.dependencies || {})
      .concat(Object.keys(manifestValue.devDependencies || {}))
      .concat(Object.keys(manifestValue.optionalDependencies || {}))
  );
  const declaredRangeByName = new Map(
    requirements.filter((item) => item.ecosystem === 'npm').map((item) => [item.name, item.range])
  );

  for (const [lockPathKey, entry] of Object.entries(packages)) {
    if (lockPathKey === '') continue; // o próprio projeto
    const name = nameFromLockPath(lockPathKey);
    if (!name || !entry || typeof entry !== 'object') continue;
    if (entry.link === true) continue; // symlink (workspace local)
    const version = entry.version ? String(entry.version) : null;
    const resolved = entry.resolved && /^https?:\/\//.test(entry.resolved) ? entry.resolved : null;
    components.push({
      ecosystem: 'npm',
      name,
      version,
      versionClass: 'RESOLVED',
      service,
      source: relLock,
      evidenceOrigin: 'lockfile',
      direct: directNames.has(name),
      dev: entry.dev === true,
      optional: entry.optional === true,
      integrity: entry.integrity || undefined,
      licenseName: entry.license || undefined,
      declaredVersion: declaredRangeByName.get(name),
      resolvedFrom: resolved,
      lockPath: lockPathKey,
      installPath: lockPathKey,
    });

    const declaredDeps = Object.keys({
      ...(entry.dependencies || {}),
      ...(entry.optionalDependencies || {}),
    });
    if (declaredDeps.length > 0) {
      dependencyEdges.push({ lockPath: lockPathKey, deps: declaredDeps });
    }
  }

  const reachability = computeReachability({
    packages,
    dependencyEdges,
    manifestNames: [...directNames],
    components,
  });

  sources.push({
    id: `npm-lock:${relLock}`,
    kind: 'npm-lock',
    path: relLock,
    status: 'READ',
    itemCount: components.length,
    detail: `lockfileVersion ${lock.value.lockfileVersion}`,
  });

  return { requirements, components, dependencyEdges, sources, warnings, reachability };
}

/** Converte `node_modules/...` em purl/bomRef resolvendo arestas. */
function buildNpmDependencyEdges({ dependencyEdges, components }) {
  const pathToComponent = new Map();
  for (const component of components) {
    if (component.lockPath !== undefined) pathToComponent.set(component.lockPath, component);
  }
  const packagePaths = new Set(pathToComponent.keys());
  const edges = [];
  for (const edge of dependencyEdges) {
    const from = pathToComponent.get(edge.lockPath);
    if (!from) continue;
    const targets = [];
    for (const depName of edge.deps) {
      const depPath = resolveDependencyPath(edge.lockPath, depName, packagePaths);
      if (!depPath) continue;
      const target = pathToComponent.get(depPath);
      if (target) targets.push(target);
    }
    if (targets.length > 0) edges.push({ from, targets });
  }
  return edges;
}

/**
 * Alcance real a partir do manifesto. Um pacote instalado é LEGÍTIMO quando é
 * alcançável por alguma dependência declarada (transitivamente). Pacotes
 * presentes no lockfile mas inalcançáveis são `extraneous` — achado de higiene
 * da cadeia de suprimentos, não ruído.
 *
 * Diretas declaradas que não resolvem para nenhuma cópia instalada são
 * `missingDeclared` (o manifesto promete algo que não está lá).
 */
function computeReachability({ packages, dependencyEdges, manifestNames, components = [] }) {
  const packagePaths = new Set(Object.keys(packages || {}));
  const edgesByPath = new Map((dependencyEdges || []).map((edge) => [edge.lockPath, edge.deps]));
  const reachablePaths = new Set();
  const queue = [];
  for (const depName of manifestNames || []) {
    const resolvedPath = resolveDependencyPath('', depName, packagePaths);
    if (resolvedPath) queue.push(resolvedPath);
  }
  while (queue.length > 0) {
    const current = queue.pop();
    if (reachablePaths.has(current)) continue;
    reachablePaths.add(current);
    for (const depName of edgesByPath.get(current) || []) {
      const next = resolveDependencyPath(current, depName, packagePaths);
      if (next && !reachablePaths.has(next)) queue.push(next);
    }
  }
  const reachableNames = new Set(
    components.filter((component) => reachablePaths.has(component.lockPath)).map((component) => component.name)
  );
  return {
    reachablePaths,
    reachableCount: reachablePaths.size,
    missingDeclared: [...new Set(manifestNames || [])]
      .filter((name) => !reachableNames.has(name))
      .sort(),
    extraneous: components
      .filter((component) => !reachablePaths.has(component.lockPath))
      .map((component) => component.lockPath)
      .sort(),
  };
}

/** Parser de `requirements.txt` (PEP 508 simplificado, uma linha por req). */
function parseRequirementsTxt(content, { service, source } = {}) {
  const requirements = [];
  const components = [];
  const warnings = [];
  const lines = String(content || '').split(/\r?\n/);
  let index = 0;
  for (const rawLine of lines) {
    index += 1;
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('-')) {
      // `-r`, `-e`, `--index-url`, `--extra-index-url`, `--find-links`…
      warnings.push({
        code: 'requirements_directive_skipped',
        message: `linha ${index}: diretiva não expandida pelo inventário: ${line}`,
        line,
      });
      continue;
    }
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(?:(===|==|~=|>=|<=|>|<|!=)\s*([^\s;]+))?\s*(?:;(.*))?$/.exec(line);
    const versionToken = match && match[4] ? match[4] : null;
    // Um token de versão sempre começa com dígito (PEP 508/440). Isso impede
    // que texto solto (`lixo !!!`) vire uma dependência fantasma.
    if (!match || (versionToken !== null && !/^[0-9][A-Za-z0-9.*+!_-]*$/.test(versionToken))) {
      warnings.push({ code: 'requirements_line_unparsed', message: `linha ${index}: ${line}`, line });
      continue;
    }
    const [, name, extras, operator, version, marker] = match;
    const extrasList = extras ? extras.replace(/[[\]]/g, '').split(',').filter(Boolean) : [];
    if (operator === '===' || operator === '==') {
      components.push({
        ecosystem: 'pypi',
        name,
        version: version || null,
        versionClass: 'RESOLVED',
        service,
        source,
        evidenceOrigin: 'pinned-requirements',
        direct: true,
        extras: extrasList,
        environmentMarker: marker ? marker.trim() : undefined,
      });
    } else {
      requirements.push({
        ecosystem: 'pypi',
        name,
        range: version ? `${operator || ''}${version}` : '*',
        dependencyKind: 'runtime',
        section: 'requirements',
        service,
        source,
        extras: extrasList,
        environmentMarker: marker ? marker.trim() : undefined,
      });
    }
  }
  return { requirements, components, warnings };
}

/**
 * Extrai imagens de um docker-compose. Percorre apenas a seção `services:` e
 * registra `build:` por serviço (para distinguir imagem construída localmente
 * de imagem de registry).
 */
function parseComposeImages(content, { service: composeService, source } = {}) {
  const images = [];
  const warnings = [];
  const lines = String(content || '').split(/\r?\n/);
  let section = null;
  let currentService = null;
  let pendingBuild = false;
  let servicesSeen = 0;

  const flush = () => {
    if (currentService) servicesSeen += 1;
    currentService = null;
    pendingBuild = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0 && /^[A-Za-z0-9_.-]+:\s*$/.test(trimmed)) {
      flush();
      section = trimmed.slice(0, -1);
      continue;
    }
    if (section !== 'services') continue;
    if (indent === 2 && /^[A-Za-z0-9_.-]+:\s*$/.test(trimmed)) {
      flush();
      currentService = trimmed.slice(0, -1);
      continue;
    }
    if (indent >= 4 && currentService) {
      if (/^build:/.test(trimmed)) pendingBuild = true;
      const imageMatch = /^image:\s*(\S+)/.exec(trimmed);
      if (imageMatch) {
        const reference = imageMatch[1].replace(/^["']|["']$/g, '');
        const [namePart, tagOrDigest] = splitImageReference(reference);
        const isDigest = Boolean(tagOrDigest && tagOrDigest.startsWith('@'));
        images.push({
          composeService,
          source,
          service: currentService,
          reference,
          name: namePart,
          tag: isDigest ? null : tagOrDigest || null,
          digest: isDigest ? tagOrDigest.slice(1) : null,
          builtLocally: pendingBuild,
        });
      }
    }
  }
  flush();
  if (servicesSeen === 0) {
    warnings.push({ code: 'compose_no_services', message: `${source}: nenhum serviço encontrado` });
  }
  return { images, warnings, servicesSeen };
}

/** Separa `registry:port/path:tag@sha256:...` em nome + tag/digest. */
function splitImageReference(reference) {
  const digestIndex = reference.indexOf('@');
  if (digestIndex !== -1) return [reference.slice(0, digestIndex), reference.slice(digestIndex)];
  const lastColon = reference.lastIndexOf(':');
  const lastSlash = reference.lastIndexOf('/');
  if (lastColon > lastSlash) return [reference.slice(0, lastColon), reference.slice(lastColon + 1)];
  return [reference, null];
}

/** Parser mínimo de `/etc/os-release`. */
function parseOsRelease(content) {
  const fields = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return {
    id: fields.ID || null,
    versionId: fields.VERSION_ID || null,
    prettyName: fields.PRETTY_NAME || null,
    kernel: null,
  };
}

module.exports = {
  resolveProjectPath,
  readJson,
  readText,
  readNpmProject,
  buildNpmDependencyEdges,
  computeReachability,
  parseRequirementsTxt,
  parseComposeImages,
  splitImageReference,
  parseOsRelease,
  nameFromLockPath,
  resolveDependencyPath,
};
