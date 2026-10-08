'use strict';

/**
 * sbomBuilder — geração e validação de SBOM no formato CycloneDX 1.5.
 *
 * Módulo PURO e DETERMINÍSTICO: o mesmo conjunto de componentes produz
 * exatamente o mesmo documento (serialNumber derivado do conteúdo, componentes
 * ordenados por `bom-ref`). SBOM reprodutível é pré-requisito para que o
 * artefato seja evidência auditável — dois builds do mesmo commit devem dar o
 * mesmo SBOM, e um SBOM diferente deve significar um inventário diferente.
 *
 * O `timestamp` é INJETADO (`now`); nada aqui lê relógio.
 *
 * Regra de honestidade: nenhum campo é inventado. Sem licença conhecida o
 * campo é omitido (não vira "NOASSERTION" silencioso); sem versão o valor é
 * `unknown` e o componente é marcado como não-versionado.
 */

const {
  buildPurl,
  parsePurl,
  bomRef,
  sortComponents,
  dedupeComponents,
  deterministicUuid,
  sha256,
} = require('./componentIdentity');

const SPEC_VERSION = '1.5';
const BOM_FORMAT = 'CycloneDX';

const COMPONENT_TYPES = Object.freeze(new Set([
  'application',
  'framework',
  'library',
  'container',
  'operating-system',
  'device',
  'firmware',
  'file',
  'machine-learning-model',
  'data',
]));

const SCOPE_VALUES = Object.freeze(new Set(['required', 'optional', 'excluded']));

const HASH_ALGS = Object.freeze({
  'SHA-256': 64,
  'SHA-384': 96,
  'SHA-512': 128,
  'SHA-1': 40,
  'MD5': 32,
});

/** Mapeia o tipo interno do RAP para o vocabulário CycloneDX. */
function resolveComponentType(component = {}) {
  if (COMPONENT_TYPES.has(component.type)) return component.type;
  const ecosystem = String(component.ecosystem || '').toLowerCase();
  if (ecosystem === 'docker' || ecosystem === 'oci') return 'container';
  if (ecosystem === 'os') return 'operating-system';
  if (component.kind === 'runtime') return 'framework';
  if (component.kind === 'service') return 'application';
  return 'library';
}

function resolveScope(component = {}) {
  if (SCOPE_VALUES.has(component.scope)) return component.scope;
  if (component.dev === true) return 'excluded';
  return 'required';
}

/** Constrói a lista de hashes declarados (somente se houver conteúdo real). */
function buildHashes(component = {}) {
  const hashes = [];
  if (component.integrity) {
    const match = /^sha(256|384|512)-([A-Za-z0-9+/=]+)$/.exec(String(component.integrity));
    if (match) {
      const alg = `SHA-${match[1]}`;
      const content = Buffer.from(match[2], 'base64').toString('hex');
      if (content.length === HASH_ALGS[alg]) hashes.push({ alg, content });
    }
  }
  if (component.sha256 && /^[a-f0-9]{64}$/i.test(component.sha256)) {
    hashes.push({ alg: 'SHA-256', content: String(component.sha256).toLowerCase() });
  }
  return hashes;
}

/** Licença só é declarada quando existe identificador/atribuição real. */
function buildLicenses(component = {}) {
  if (component.licenseSpdx) return [{ license: { id: String(component.licenseSpdx) } }];
  if (component.licenseName) return [{ license: { name: String(component.licenseName) } }];
  return undefined;
}

/**
 * Propriedades RAP carregadas no componente: classe da versão (DECLARED /
 * RESOLVED / BUILT / RUNNING), serviço consumidor, origem da evidência e
 * confiança da identificação. É o que permite ao SBOM carregar a distinção
 * entre "declarado" e "efetivamente executado".
 */
function buildProperties(component = {}) {
  const properties = [];
  const push = (name, value) => {
    if (value !== undefined && value !== null && value !== '') {
      properties.push({ name: `rap:${name}`, value: String(value) });
    }
  };
  push('ecosystem', component.ecosystem);
  push('versionClass', component.versionClass);
  push('service', component.service);
  push('source', component.source);
  push('confidence', component.confidence);
  push('evidenceOrigin', component.evidenceOrigin);
  push('direct', component.direct === undefined ? undefined : String(component.direct));
  push('dev', component.dev === undefined ? undefined : String(component.dev));
  push('declaredVersion', component.declaredVersion);
  push('runningVersion', component.runningVersion);
  push('dependsOn', Array.isArray(component.dependsOn) ? component.dependsOn.join(',') : undefined);
  if (component.drift === true) push('drift', 'true');
  return properties.length > 0 ? properties : undefined;
}

function toCycloneDxComponent(component) {
  const ref = component.bomRef || bomRef(component);
  const version = component.version || 'unknown';
  const purl = component.purl || buildPurl({
    ecosystem: component.ecosystem,
    name: component.name,
    namespace: component.namespace,
    version: component.version,
  });
  const dcComponent = {
    type: resolveComponentType(component),
    'bom-ref': ref,
    name: component.name,
    version,
    scope: resolveScope(component),
  };
  if (purl) dcComponent.purl = purl;
  const hashes = buildHashes(component);
  if (hashes.length > 0) dcComponent.hashes = hashes;
  const licenses = buildLicenses(component);
  if (licenses) dcComponent.licenses = licenses;
  if (component.supplier) dcComponent.supplier = { name: String(component.supplier) };
  const properties = buildProperties(component);
  if (properties) dcComponent.properties = properties;
  return dcComponent;
}

/**
 * Constrói o SBOM CycloneDX.
 *
 * @param {object} input
 * @param {Array<object>} input.components  componentes descobertos
 * @param {object} input.root               componente raiz (a plataforma)
 * @param {string} input.now                timestamp ISO (INJETADO)
 * @param {object} [input.tool]             `{ vendor, name, version }`
 * @param {Array<{ref:string,dependsOn:string[]}>} [input.dependencies]
 * @param {'required'|'optional'|'excluded'} [input.defaultScope]
 * @param {Array<{name:string,value:string}>} [input.properties] propriedades RAP do documento
 */
function buildSbom(input = {}) {
  const { components = [], root, now, tool, dependencies, defaultScope, properties } = input;
  if (!now) throw new Error('sbom_builder_now_required');
  if (!root || !root.name) throw new Error('sbom_builder_root_required');

  const defaulted = components.map((component) => (
    defaultScope ? { scope: defaultScope, ...component } : component
  ));
  const normalized = dedupeComponents(defaulted);
  const sorted = sortComponents(normalized);

  const rootRef = root.bomRef || `pkg:generic/${root.name}@${root.version || 'unknown'}`;
  const dcComponents = sorted.map(toCycloneDxComponent);

  const contentSeed = [
    rootRef,
    ...dcComponents.map((component) => `${component['bom-ref']}|${sha256(JSON.stringify(component))}`),
  ].join('\n');

  const sbom = {
    bomFormat: BOM_FORMAT,
    specVersion: SPEC_VERSION,
    serialNumber: `urn:uuid:${deterministicUuid(contentSeed)}`,
    version: 1,
    metadata: {
      timestamp: now,
      tools: [
        tool || {
          vendor: 'Results',
          name: 'rap-version-security-intelligence',
          version: 'unknown',
        },
      ],
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: root.name,
        version: root.version || 'unknown',
      },
    },
    components: dcComponents,
  };

  if (Array.isArray(properties) && properties.length > 0) {
    sbom.metadata.properties = properties.map((property) => ({
      name: `rap:${property.name}`,
      value: String(property.value),
    }));
  }

  const deps = buildDependencies({ dependencies, components: dcComponents, rootRef });
  if (deps.length > 0) sbom.dependencies = deps;

  return sbom;
}

/**
 * Monta a seção `dependencies`. Quando o chamador não informa dependências
 * explícitas, deriva das relações `dependsOn` declaradas nos próprios
 * componentes — e, na ausência de qualquer relação, gera a raiz com a lista
 * completa (o SBOM nunca fica sem a seção de dependências, mas também nunca
 * inventa arestas que ninguém mediu).
 */
function buildDependencies({ dependencies, components, rootRef }) {
  if (Array.isArray(dependencies) && dependencies.length > 0) {
    return dependencies
      .map((entry) => ({
        ref: entry.ref,
        dependsOn: [...new Set(entry.dependsOn || [])].sort(),
      }))
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  }
  const known = new Set(components.map((component) => component['bom-ref']));
  const edges = new Map();
  for (const component of components) {
    const ref = component['bom-ref'];
    const declared = component.properties?.find((property) => property.name === 'rap:dependsOn');
    if (!declared) continue;
    const targets = declared.value.split(',').filter((target) => known.has(target));
    if (targets.length > 0) edges.set(ref, targets.sort());
  }
  if (edges.size === 0) {
    if (components.length === 0) return [];
    return [{ ref: rootRef, dependsOn: components.map((component) => component['bom-ref']).sort() }];
  }
  return [...edges.entries()]
    .map(([ref, dependsOn]) => ({ ref, dependsOn }))
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/**
 * Validação estrutural do SBOM (o artefato precisa ser verificável por si só).
 * @returns {{valid:boolean, issues:Array<{code:string,message:string}>}}
 */
function validateSbom(sbom) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });

  if (!sbom || typeof sbom !== 'object') {
    return { valid: false, issues: [{ code: 'sbom_missing', message: 'SBOM ausente ou não é objeto' }] };
  }
  if (sbom.bomFormat !== BOM_FORMAT) add('sbom_bomformat_invalid', `bomFormat deve ser ${BOM_FORMAT}`);
  if (sbom.specVersion !== SPEC_VERSION) add('sbom_spec_version_invalid', `specVersion deve ser ${SPEC_VERSION}`);
  if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(String(sbom.serialNumber))) {
    add('sbom_serial_number_invalid', 'serialNumber deve ser urn:uuid:<uuid>');
  }
  if (!sbom.metadata || typeof sbom.metadata !== 'object') {
    add('sbom_metadata_missing', 'metadata ausente');
  } else {
    if (!sbom.metadata.timestamp) add('sbom_metadata_timestamp_missing', 'metadata.timestamp ausente');
    if (!Array.isArray(sbom.metadata.tools) || sbom.metadata.tools.length === 0) {
      add('sbom_metadata_tools_missing', 'metadata.tools ausente');
    }
    if (!sbom.metadata.component || !sbom.metadata.component['bom-ref']) {
      add('sbom_metadata_component_missing', 'metadata.component sem bom-ref');
    }
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    add('sbom_components_missing', 'components ausente ou vazio');
    return { valid: issues.length === 0, issues };
  }

  const seenRefs = new Set();
  const rootRef = sbom.metadata?.component?.['bom-ref'];
  for (const component of sbom.components) {
    const ref = component['bom-ref'];
    if (!ref) {
      add('sbom_component_ref_missing', `componente ${component.name || '?'} sem bom-ref`);
      continue;
    }
    if (seenRefs.has(ref)) add('sbom_component_ref_duplicate', `bom-ref duplicado: ${ref}`);
    seenRefs.add(ref);
    if (!component.name) add('sbom_component_name_missing', `componente ${ref} sem name`);
    if (!component.version) add('sbom_component_version_missing', `componente ${ref} sem version`);
    if (!COMPONENT_TYPES.has(component.type)) {
      add('sbom_component_type_invalid', `componente ${ref} com type inválido: ${component.type}`);
    }
    if (!SCOPE_VALUES.has(component.scope)) {
      add('sbom_component_scope_invalid', `componente ${ref} com scope inválido: ${component.scope}`);
    }
    if (!component.purl) {
      add('sbom_component_purl_missing', `componente ${ref} sem purl`);
    } else if (!parsePurl(component.purl)) {
      add('sbom_component_purl_invalid', `componente ${ref} com purl não parseável: ${component.purl}`);
    }
    for (const hash of component.hashes || []) {
      const expected = HASH_ALGS[hash.alg];
      if (!expected || !new RegExp(`^[a-f0-9]{${expected}}$`, 'i').test(String(hash.content))) {
        add('sbom_component_hash_invalid', `componente ${ref} com hash inválido (${hash.alg})`);
      }
    }
    for (const license of component.licenses || []) {
      if (!license.license || (!license.license.id && !license.license.name)) {
        add('sbom_component_license_empty', `componente ${ref} com licença vazia (não declarar sem dado real)`);
      }
    }
  }

  const knownRefs = new Set([...seenRefs, rootRef]);
  const depSeen = new Set();
  for (const entry of sbom.dependencies || []) {
    if (!entry || !entry.ref) {
      add('sbom_dependency_ref_missing', 'entrada de dependencies sem ref');
      continue;
    }
    if (!knownRefs.has(entry.ref)) {
      add('sbom_dependency_ref_unresolved', `dependency ref não resolve: ${entry.ref}`);
    }
    if (depSeen.has(entry.ref)) add('sbom_dependency_ref_duplicate', `dependency ref duplicado: ${entry.ref}`);
    depSeen.add(entry.ref);
    for (const target of entry.dependsOn || []) {
      if (!knownRefs.has(target)) {
        add('sbom_dependency_target_unresolved', `dependsOn não resolve: ${target}`);
      }
      if (target === entry.ref) {
        add('sbom_dependency_self_reference', `dependência de si mesmo: ${target}`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Serialização canônica (2 espaços + newline final) — evidência estável. */
function serializeSbom(sbom) {
  return `${JSON.stringify(sbom, null, 2)}\n`;
}

module.exports = {
  SPEC_VERSION,
  BOM_FORMAT,
  COMPONENT_TYPES,
  SCOPE_VALUES,
  buildSbom,
  validateSbom,
  serializeSbom,
  toCycloneDxComponent,
};
