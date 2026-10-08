'use strict';

/**
 * componentDiscoveryService — descoberta de componentes e versões REAIS.
 *
 * Este é o único ponto que lê o mundo. Ele NÃO decide risco e NÃO fala com a
 * internet: produz o inventário bruto e as lacunas dele, sempre com a fonte
 * declarada.
 *
 * Classes de versão (a distinção é o núcleo da inteligência):
 *   DECLARED  → o que o manifesto PEDE (range). É requisito, não instalação.
 *   RESOLVED  → o que o lockfile/pin instalou.
 *   BUILT     → imagem/artefato construído localmente.
 *   RUNNING   → o que está efetivamente em execução (prevalece no risco).
 *
 * Probes são INJETADOS (DI) para que a descoberta seja testável sem rede, sem
 * Docker e sem banco. Probe ausente ⇒ entrada em `unavailable`, jamais um
 * componente inventado.
 */

const os = require('os');
const path = require('path');

const { satisfiesComparatorSet, compareVersions } = require('../../../engine/securityIntel/versionCore');
const {
  buildPurl,
  bomRef,
  fingerprintComponent,
} = require('../../../engine/securityIntel/componentIdentity');

const {
  readJson,
  readText,
  readNpmProject,
  buildNpmDependencyEdges,
  parseRequirementsTxt,
  parseComposeImages,
  parseOsRelease,
} = require('./manifestReaders');

/** Projetos npm inventariados (nome do serviço consumidor → diretório). */
const NPM_PROJECTS = Object.freeze([
  { service: 'api', dir: '' },
  { service: 'frontend', dir: 'frontend' },
]);

/** Arquivos compose inventariados. */
const COMPOSE_FILES = Object.freeze([
  'docker-compose.prod.yml',
  'docker-compose.test.yml',
  'docker-compose.localtest.yml',
  'docker-compose.mcp-research-e2e.yml',
]);

/** Fontes que sabemos existir mas NÃO são alcançáveis por este inventário. */
const DEFAULT_OUT_OF_SCOPE = Object.freeze([
  {
    id: 'hardware-firmware',
    reason: 'sem agente de inventário de firmware/hardware autorizado neste host',
  },
  {
    id: 'remote-hosts',
    reason: 'hosts remotos não são sondados por padrão (exigiria credencial dedicada)',
  },
  {
    id: 'container-installed-packages',
    reason: 'bibliotecas de sistema DENTRO das imagens só são conhecidas quando a imagem está construída/carregada localmente',
  },
  {
    id: 'saas-external-providers',
    reason: 'serviços SaaS de terceiros (provedores de IA, WhatsApp) não expõem versão instalada',
  },
]);

function safeProbe(probes, name) {
  const probe = probes[name];
  return typeof probe === 'function' ? probe : null;
}

/** Componente base com identidade canônica já calculada. */
function finalizeComponent(component) {
  const purl = component.purl || buildPurl({
    ecosystem: component.ecosystem,
    name: component.name,
    namespace: component.namespace,
    version: component.version,
  });
  const withPurl = { ...component, purl: purl || null };
  const ref = bomRef(withPurl);
  return {
    ...withPurl,
    bomRef: ref,
    fingerprint: fingerprintComponent(withPurl),
  };
}

/**
 * Descoberta completa.
 *
 * @param {object} input
 * @param {string} input.rootDir     raiz do projeto
 * @param {string} input.now         timestamp ISO (injetado)
 * @param {object} [input.probes]    `{ runtime, osRelease, ragService, postgres, redis, docker }`
 * @returns {Promise<object>} documento de descoberta
 */
async function discoverComponents({ rootDir, now, probes = {} } = {}) {
  if (!rootDir) throw new Error('discovery_root_dir_required');
  if (!now) throw new Error('discovery_now_required');

  const components = [];
  const requirements = [];
  const sources = [];
  const warnings = [];
  const unavailable = [];
  const dependencyEdges = [];

  // ── 1. npm (raiz + frontend): diretas, transitivas e grafo ────────────────
  for (const project of NPM_PROJECTS) {
    const result = readNpmProject({ rootDir, dir: project.dir, service: project.service });
    components.push(...result.components);
    requirements.push(...result.requirements);
    sources.push(...result.sources);
    warnings.push(...result.warnings);

    const edges = buildNpmDependencyEdges({
      dependencyEdges: result.dependencyEdges,
      components: result.components,
    });
    for (const edge of edges) {
      dependencyEdges.push({
        from: edge.from.bomRef || bomRef(edge.from),
        targets: edge.targets.map((target) => target.bomRef || bomRef(target)),
        service: project.service,
      });
    }

    const reachability = result.reachability || { missingDeclared: [], extraneous: [] };
    if (reachability.missingDeclared.length > 0) {
      warnings.push({
        code: 'npm_declared_not_installed',
        service: project.service,
        message: `${reachability.missingDeclared.length} dependência(s) declarada(s) no manifesto sem versão resolvida no lockfile`,
        items: reachability.missingDeclared,
      });
    }
    if (reachability.extraneous.length > 0) {
      warnings.push({
        code: 'npm_installed_not_declared',
        service: project.service,
        message: `${reachability.extraneous.length} pacote(s) instalado(s) fora do alcance do manifesto (extraneous)`,
        items: reachability.extraneous.slice(0, 50),
      });
    }
  }

  // ── 2. pypi (rag-service/requirements.txt) ───────────────────────────────
  const requirementsRel = 'rag-service/requirements.txt';
  const requirementsRead = readText(path.join(rootDir, requirementsRel));
  if (!requirementsRead.ok) {
    sources.push({
      id: `pypi-requirements:${requirementsRel}`,
      kind: 'pypi-requirements',
      path: requirementsRel,
      status: requirementsRead.error === 'missing' ? 'MISSING' : 'UNREADABLE',
      itemCount: 0,
      detail: requirementsRead.error,
    });
  } else {
    const parsed = parseRequirementsTxt(requirementsRead.value, {
      service: 'rag-service',
      source: requirementsRel,
    });
    components.push(...parsed.components);
    requirements.push(...parsed.requirements);
    warnings.push(...parsed.warnings);
    sources.push({
      id: `pypi-requirements:${requirementsRel}`,
      kind: 'pypi-requirements',
      path: requirementsRel,
      status: 'READ',
      itemCount: parsed.components.length + parsed.requirements.length,
      detail: `${parsed.components.length} pinada(s), ${parsed.requirements.length} com range`,
    });
  }

  // ── 3. imagens docker por compose ────────────────────────────────────────
  for (const composeRel of COMPOSE_FILES) {
    const composeRead = readText(path.join(rootDir, composeRel));
    if (!composeRead.ok) {
      sources.push({
        id: `compose:${composeRel}`,
        kind: 'compose',
        path: composeRel,
        status: composeRead.error === 'missing' ? 'MISSING' : 'UNREADABLE',
        itemCount: 0,
        detail: composeRead.error,
      });
      continue;
    }
    const parsed = parseComposeImages(composeRead.value, { service: composeRel, source: composeRel });
    warnings.push(...parsed.warnings);
    for (const image of parsed.images) {
      const versionClass = image.builtLocally ? 'BUILT' : 'DECLARED';
      components.push({
        ecosystem: 'docker',
        name: image.name,
        version: image.digest || image.tag || 'unknown',
        versionClass,
        service: image.service,
        source: composeRel,
        evidenceOrigin: 'compose-image',
        imageReference: image.reference,
        installPath: image.reference,
        imageTag: image.tag,
        imageDigest: image.digest || undefined,
        builtLocally: image.builtLocally,
        pinnedByDigest: Boolean(image.digest),
      });
    }
    sources.push({
      id: `compose:${composeRel}`,
      kind: 'compose',
      path: composeRel,
      status: 'READ',
      itemCount: parsed.images.length,
      detail: `${parsed.servicesSeen} serviço(s), ${parsed.images.length} imagem(ns)`,
    });
  }

  // ── 4. runtime do host (node, openssl do runtime, kernel, distro) ────────
  const runtimeProbe = safeProbe(probes, 'runtime') || (() => ({
    version: process.version,
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    kernel: os.release(),
  }));
  const runtime = runtimeProbe() || {};
  if (runtime.version) {
    components.push({
      ecosystem: 'generic',
      name: 'node',
      version: String(runtime.version).replace(/^v/, ''),
      versionClass: 'RUNNING',
      service: 'api-host',
      source: 'process.version',
      evidenceOrigin: 'runtime-probe',
      kind: 'runtime',
    });
  }
  for (const [name, key] of [['openssl', 'openssl'], ['v8', 'v8'], ['libuv', 'uv'], ['zlib', 'zlib'], ['nghttp2', 'nghttp2']]) {
    const version = runtime.versions && runtime.versions[key];
    if (version) {
      components.push({
        ecosystem: 'generic',
        name,
        version: String(version),
        versionClass: 'RUNNING',
        service: 'api-host',
        source: `process.versions.${key}`,
        evidenceOrigin: 'runtime-probe',
        kind: 'runtime-library',
      });
    }
  }
  const osReleaseProbe = safeProbe(probes, 'osRelease') || (() => {
    const read = readText('/etc/os-release');
    return read.ok ? read.value : null;
  });
  const osReleaseRaw = osReleaseProbe();
  if (osReleaseRaw) {
    const parsedOs = parseOsRelease(osReleaseRaw);
    if (parsedOs.prettyName) {
      components.push({
        ecosystem: 'generic',
        name: parsedOs.id || 'linux',
        version: parsedOs.versionId || 'unknown',
        versionClass: 'RUNNING',
        service: 'api-host',
        source: '/etc/os-release',
        evidenceOrigin: 'host-file',
        kind: 'operating-system',
      });
    }
    sources.push({ id: 'host:os-release', kind: 'host', path: '/etc/os-release', status: 'READ', itemCount: 1 });
  } else {
    unavailable.push({ source: 'host:os-release', reason: 'not_readable' });
  }
  if (runtime.kernel) {
    components.push({
      ecosystem: 'generic',
      name: 'linux-kernel',
      version: String(runtime.kernel),
      versionClass: 'RUNNING',
      service: 'api-host',
      source: 'os.release()',
      evidenceOrigin: 'runtime-probe',
      kind: 'operating-system',
    });
  }

  // ── 5. probes de serviços (RUNNING) — ausentes ⇒ indisponibilidade ──────
  const serviceProbes = [
    {
      name: 'ragService',
      source: 'rag:/health',
      build: (value) => {
        const out = [];
        if (value.version) {
          out.push({ name: 'rag-service', version: String(value.version), kind: 'service', service: 'rag-service' });
        }
        if (value.pythonVersion) {
          out.push({ name: 'python', version: String(value.pythonVersion), kind: 'runtime', service: 'rag-service' });
        }
        if (value.embeddingModel) {
          out.push({
            name: String(value.embeddingModel),
            version: 'unknown',
            kind: 'machine-learning-model',
            service: 'rag-service',
          });
        }
        if (value.vectorStore) {
          out.push({
            name: String(value.vectorStore),
            version: 'unknown',
            kind: 'vector-store',
            service: 'rag-service',
          });
        }
        return out;
      },
    },
    {
      name: 'postgres',
      source: 'pg:SELECT version()',
      build: (value) => {
        const out = [];
        if (value.version) {
          out.push({ name: 'postgresql', version: String(value.version), kind: 'database', service: 'postgres' });
        }
        for (const [extName, extVersion] of Object.entries(value.extensions || {})) {
          out.push({
            name: extName,
            version: extVersion ? String(extVersion) : 'unknown',
            kind: 'database-extension',
            service: 'postgres',
            ecosystem: 'generic',
          });
        }
        return out;
      },
    },
    {
      name: 'redis',
      source: 'redis:INFO server',
      build: (value) => (value.version
        ? [{ name: 'redis', version: String(value.version), kind: 'database', service: 'redis' }]
        : []),
    },
    {
      name: 'docker',
      source: 'docker:image inspect',
      build: (value) => (Array.isArray(value.images) ? value.images : []),
    },
  ];

  for (const probeSpec of serviceProbes) {
    const probe = safeProbe(probes, probeSpec.name);
    if (!probe) {
      unavailable.push({ source: probeSpec.source, reason: 'probe_not_provided' });
      continue;
    }
    let value;
    try {
      value = await probe();
    } catch (error) {
      unavailable.push({ source: probeSpec.source, reason: `probe_failed:${error.message}` });
      continue;
    }
    if (!value) {
      unavailable.push({ source: probeSpec.source, reason: 'probe_returned_empty' });
      continue;
    }
    const built = probeSpec.build(value) || [];
    for (const item of built) {
      const isDockerImage = probeSpec.name === 'docker';
      components.push({
        ecosystem: item.ecosystem || (isDockerImage ? 'docker' : 'generic'),
        name: item.name,
        version: item.version || 'unknown',
        versionClass: 'RUNNING',
        service: item.service || probeSpec.name,
        source: probeSpec.source,
        evidenceOrigin: 'service-probe',
        kind: item.kind,
        imageId: item.imageId,
        imageDigest: item.imageDigest,
      });
    }
    sources.push({
      id: `probe:${probeSpec.name}`,
      kind: 'service-probe',
      path: probeSpec.source,
      status: 'READ',
      itemCount: built.length,
    });
  }

  // ── 6. identidade canônica + dedup determinístico ───────────────────────
  const seen = new Map();
  const identityConflicts = [];
  for (const component of components) {
    const finalized = finalizeComponent(component);
    if (!finalized.bomRef) continue;
    const existing = seen.get(finalized.bomRef);
    if (!existing) {
      seen.set(finalized.bomRef, finalized);
      continue;
    }
    if (existing.fingerprint !== finalized.fingerprint) {
      // Mesma identidade, conteúdo diferente: é DRIFT/evidência, não lixo.
      identityConflicts.push({
        bomRef: finalized.bomRef,
        existing: { source: existing.source, version: existing.version },
        incoming: { source: finalized.source, version: finalized.version },
      });
      continue;
    }
    // Idêntico: acumula proveniência (o mesmo fato visto em N fontes).
    const merged = new Set([
      ...(existing.sources || [existing.source].filter(Boolean)),
      finalized.source,
    ].filter(Boolean));
    existing.sources = [...merged].sort();
  }
  const dedupedComponents = [...seen.values()].sort((a, b) => (a.bomRef < b.bomRef ? -1 : 1));

  // ── 7. drift DECLARED→RESOLVED e RESOLVED vs RUNNING ────────────────────
  const drift = computeDrift({ requirements, components: dedupedComponents });

  const byClass = { DECLARED: 0, RESOLVED: 0, BUILT: 0, RUNNING: 0 };
  for (const component of dedupedComponents) {
    if (byClass[component.versionClass] !== undefined) byClass[component.versionClass] += 1;
  }

  return {
    generatedAt: now,
    rootDir,
    components: dedupedComponents,
    requirements,
    dependencyEdges,
    drift,
    identityConflicts,
    sources,
    warnings,
    unavailable,
    counts: {
      components: dedupedComponents.length,
      requirements: requirements.length,
      dependencyEdges: dependencyEdges.length,
      byVersionClass: byClass,
      direct: dedupedComponents.filter((component) => component.direct === true).length,
      transitive: dedupedComponents.filter((component) => component.direct === false).length,
      sourcesRead: sources.filter((source) => source.status === 'READ').length,
      sourcesMissing: sources.filter((source) => source.status !== 'READ').length,
    },
    coverage: buildCoverage({ sources, unavailable, outOfScope: DEFAULT_OUT_OF_SCOPE }),
  };
}

/**
 * Drift entre o que é pedido e o que está instalado/rodando.
 * Regra: comparação não avaliável NÃO é drift — é `unverifiable`. Nunca
 * transformar "não sei comparar" em "está tudo certo".
 */
function computeDrift({ requirements, components }) {
  const drift = [];
  const resolvedByKey = new Map();
  for (const component of components) {
    if (component.versionClass === 'RESOLVED') {
      resolvedByKey.set(`${component.ecosystem}:${component.name}`, component);
    }
  }

  for (const requirement of requirements) {
    const key = `${requirement.ecosystem}:${requirement.name}`;
    const resolved = resolvedByKey.get(key);
    if (!resolved) continue;
    const satisfied = satisfiesComparatorSet(resolved.version, requirement.range, {
      ecosystem: requirement.ecosystem,
    });
    if (satisfied === null) {
      drift.push({
        kind: 'declared_vs_resolved',
        verdict: 'unverifiable',
        key,
        declared: requirement.range,
        resolved: resolved.version,
        service: requirement.service,
        source: requirement.source,
      });
    } else if (satisfied === false) {
      drift.push({
        kind: 'declared_vs_resolved',
        verdict: 'drift',
        key,
        declared: requirement.range,
        resolved: resolved.version,
        service: requirement.service,
        source: requirement.source,
      });
    }
  }

  // Mesmo nome lógico em classes diferentes (RESOLVED vs RUNNING) → divergência.
  const byEcosystemName = new Map();
  for (const component of components) {
    if (component.versionClass !== 'RESOLVED' && component.versionClass !== 'RUNNING') continue;
    const key = `${component.ecosystem}:${component.name}`;
    if (!byEcosystemName.has(key)) byEcosystemName.set(key, []);
    byEcosystemName.get(key).push(component);
  }
  for (const [key, entries] of byEcosystemName) {
    const resolved = entries.find((entry) => entry.versionClass === 'RESOLVED');
    const running = entries.find((entry) => entry.versionClass === 'RUNNING');
    if (!resolved || !running) continue;
    const comparison = compareVersions(running.version, resolved.version, { ecosystem: resolved.ecosystem });
    if (comparison === null) {
      drift.push({
        kind: 'resolved_vs_running',
        verdict: 'unverifiable',
        key,
        resolved: resolved.version,
        running: running.version,
        service: running.service,
      });
    } else if (comparison !== 0) {
      drift.push({
        kind: 'resolved_vs_running',
        verdict: 'drift',
        key,
        resolved: resolved.version,
        running: running.version,
        service: running.service,
      });
    }
  }

  return drift.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Cobertura explícita: o que foi inventariado e o que ficou fora, com motivo. */
function buildCoverage({ sources, unavailable, outOfScope }) {
  const read = sources.filter((source) => source.status === 'READ');
  const failed = sources.filter((source) => source.status !== 'READ');
  return {
    inventoried: read.map((source) => ({ id: source.id, kind: source.kind, path: source.path, itemCount: source.itemCount })),
    failed: failed.map((source) => ({ id: source.id, path: source.path, status: source.status, detail: source.detail || null })),
    unavailable: unavailable.map((entry) => ({ source: entry.source, reason: entry.reason })),
    outOfScope: [...outOfScope],
    coveragePercent: sources.length === 0 ? 0 : Math.round((read.length / sources.length) * 100),
  };
}

module.exports = {
  NPM_PROJECTS,
  COMPOSE_FILES,
  DEFAULT_OUT_OF_SCOPE,
  discoverComponents,
  computeDrift,
  buildCoverage,
};
