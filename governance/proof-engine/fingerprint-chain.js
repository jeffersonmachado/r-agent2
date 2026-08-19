'use strict';

/**
 * Fingerprint Chain — INVARIANTE 6: CHANGED CODE → STALE PROOF (FASE 11).
 *
 * Fingerprints determinísticos (SHA-256) em cadeia sobre as fontes que a
 * prova cobre. Se qualquer componente divergir do registrado no proof
 * (evidence-manifest), o proof inteiro é STALE — nunca GO. A comparação é
 * exclusivamente por conteúdo; timestamps NUNCA participam do fingerprint.
 *
 * Componentes da cadeia:
 *   - sourceFingerprint           routes (api/app, api/modules), models e
 *                                 migrations (api/db, migrations/), tools
 *                                 (tools/system), engine determinística e
 *                                 contracts — o mesmo universo que o System
 *                                 Inventory fingerprinta (ver
 *                                 api/services/qa/inventory/).
 *   - inventoryFingerprint        config/system-inventory.json (pares
 *                                 id+fingerprint dos itens, ordenados).
 *   - scenarioRegistryFingerprint qa/qa-waves/scenario-store.json +
 *                                 qa-mesh/meshRegistry.json (hash de conteúdo).
 *   - policyFingerprint           contratos de jornada e políticas de gate
 *                                 versionadas em config/ e governance/.
 *   - chainFingerprint            fingerprint canônico dos quatro acima.
 *
 * Mecanismo canônico reutilizado: qa/coverage/fingerprints
 * (canonicalStringify + sha256) — o mesmo do Coverage Engine e do System
 * Inventory. Não existe mecanismo paralelo de hash aqui.
 */

const fs = require('fs');
const path = require('path');
const { fingerprintObject, sha256 } = require('../../qa/coverage/fingerprints');

/** Raízes-fonte cobertas pelo sourceFingerprint (relativas ao rootDir). */
const SOURCE_ROOTS = [
  'api/app',
  'api/modules',
  'api/db',
  'migrations',
  'tools/system',
  'engine',
  'contracts',
];

const SOURCE_FILE_PATTERN = /\.(js|cjs|json|sql)$/;

/** Diretórios/arquivos de teste não fazem parte da superfície provada. */
const SKIP_DIR_NAMES = new Set(['node_modules', '__tests__', '__snapshots__', '__mocks__']);
const SKIP_FILE_PATTERN = /\.(test|spec)\.js$/;

/** Políticas e contratos de jornada versionados (policyFingerprint). */
const POLICY_FILES = [
  'config/journey-contracts.json',
  'config/journey-criticality.json',
  'config/coverage-gate-thresholds.json',
  'config/coverage-gate-baseline.json',
  'config/api-surface-exemptions.json',
  'config/page-surface-exemptions.json',
  'config/technical-wave-map.json',
  'governance/visual-critical-journeys.json',
  'contracts/versions.json',
];

/** Registries de cenários (scenarioRegistryFingerprint). */
const SCENARIO_REGISTRY_FILES = [
  'qa/qa-waves/scenario-store.json',
  'qa-mesh/meshRegistry.json',
];

const INVENTORY_FILE = 'config/system-inventory.json';

function sha256FileContent(absPath) {
  return sha256(fs.readFileSync(absPath));
}

function walkSourceFiles(rootDir, collector = []) {
  for (const relRoot of SOURCE_ROOTS) {
    const absRoot = path.join(rootDir, relRoot);
    if (!fs.existsSync(absRoot)) continue;
    walkDir(rootDir, absRoot, collector);
  }
  return collector.sort();
}

function walkDir(rootDir, dir, collector) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walkDir(rootDir, path.join(dir, entry.name), collector);
      continue;
    }
    if (!SOURCE_FILE_PATTERN.test(entry.name) || SKIP_FILE_PATTERN.test(entry.name)) continue;
    collector.push(path.relative(rootDir, path.join(dir, entry.name)).replace(/\\/g, '/'));
  }
}

function readJsonMaybe(absPath) {
  try { return JSON.parse(fs.readFileSync(absPath, 'utf8')); } catch (_) { return null; }
}

/**
 * Fingerprint de conteúdo sobre os arquivos-fonte provados.
 * Entrada canônica: pares [pathRelativoOrdenado, sha256DoArquivo].
 */
function computeSourceFingerprint(rootDir) {
  const entries = walkSourceFiles(rootDir).map((relPath) => [
    relPath,
    sha256FileContent(path.join(rootDir, relPath)),
  ]);
  return fingerprintObject({ sourceFiles: entries });
}

/**
 * Fingerprint do System Inventory: pares [id, fingerprint] ordenados.
 * null quando o inventário não existe (inventário ausente é detectável).
 */
function computeInventoryFingerprint(rootDir, inventoryPath = null) {
  const absPath = inventoryPath || path.join(rootDir, INVENTORY_FILE);
  const inventory = readJsonMaybe(absPath);
  if (!inventory || !Array.isArray(inventory.items)) return null;
  const entries = inventory.items
    .map((item) => [item.id, item.fingerprint || null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return fingerprintObject({ inventoryItems: entries });
}

/**
 * Fingerprint de conteúdo sobre uma lista de arquivos. Arquivo ausente é
 * registrado como null — remoção de registro/política também invalida.
 */
function computeFileSetFingerprint(rootDir, relPaths, label) {
  const entries = relPaths.map((relPath) => {
    const absPath = path.join(rootDir, relPath);
    return [relPath, fs.existsSync(absPath) ? sha256FileContent(absPath) : null];
  });
  return fingerprintObject({ [label]: entries });
}

function computeScenarioRegistryFingerprint(rootDir) {
  return computeFileSetFingerprint(rootDir, SCENARIO_REGISTRY_FILES, 'scenarioRegistries');
}

function computePolicyFingerprint(rootDir) {
  return computeFileSetFingerprint(rootDir, POLICY_FILES, 'policyFiles');
}

/**
 * Computa a cadeia completa de fingerprints para um rootDir.
 * @param {string} rootDir
 * @param {{ inventoryPath?: string }} [options]
 */
function computeFingerprintChain(rootDir, options = {}) {
  if (!rootDir) throw new Error('computeFingerprintChain: rootDir é obrigatório');
  const chain = {
    sourceFingerprint: computeSourceFingerprint(rootDir),
    inventoryFingerprint: computeInventoryFingerprint(rootDir, options.inventoryPath || null),
    scenarioRegistryFingerprint: computeScenarioRegistryFingerprint(rootDir),
    policyFingerprint: computePolicyFingerprint(rootDir),
  };
  chain.chainFingerprint = fingerprintObject({
    sourceFingerprint: chain.sourceFingerprint,
    inventoryFingerprint: chain.inventoryFingerprint,
    scenarioRegistryFingerprint: chain.scenarioRegistryFingerprint,
    policyFingerprint: chain.policyFingerprint,
  });
  return chain;
}

/**
 * Compara a cadeia registrada no proof com a cadeia atual.
 * - Sem cadeia registrada: UNREGISTERED (primeiro registro — não é STALE).
 * - Qualquer divergência de componente: STALE (CHANGED CODE → STALE PROOF).
 *
 * @param {object|null} registered cadeia registrada no proof anterior
 * @param {object} current cadeia recém-computada
 * @returns {{ status: 'FRESH'|'STALE'|'UNREGISTERED', diverged: string[] }}
 */
function compareFingerprintChains(registered, current) {
  const components = [
    'sourceFingerprint',
    'inventoryFingerprint',
    'scenarioRegistryFingerprint',
    'policyFingerprint',
    'chainFingerprint',
  ];
  if (!registered || typeof registered !== 'object') {
    return { status: 'UNREGISTERED', diverged: [] };
  }
  const diverged = components.filter(
    (key) => registered[key] !== undefined && registered[key] !== current[key],
  );
  return { status: diverged.length > 0 ? 'STALE' : 'FRESH', diverged };
}

module.exports = {
  computeFingerprintChain,
  compareFingerprintChains,
  computeSourceFingerprint,
  computeInventoryFingerprint,
  computeScenarioRegistryFingerprint,
  computePolicyFingerprint,
  SOURCE_ROOTS,
  POLICY_FILES,
  SCENARIO_REGISTRY_FILES,
  INVENTORY_FILE,
};
