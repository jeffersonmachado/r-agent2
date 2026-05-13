#!/usr/bin/env node
'use strict';

/**
 * Governance Chain — motor de cadeia de imutabilidade criptográfica.
 *
 * Constrói uma cadeia ordenada de hashes SHA-256 sobre todos os artefatos
 * de governança. Qualquer adulteração em qualquer camada quebra o chainRoot
 * e invalida toda a governança.
 *
 * Estrutura da cadeia (ordem determinística):
 *   0. package (ZIP)
 *   1. manifest (sidecar .manifest.json)
 *   2. evidence-manifest
 *   3. final-proof-report
 *   4. final-readiness-report
 *   5. final-consistency-report
 *   6. cross-report-validation
 *   7. proof-signature
 *   8. blocker-engine
 *   9. package-validation-report
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { findLatestReleaseArtifact } = require('../tools/system/lib/release-artifact');

const ROOT        = path.join(__dirname, '..');
const CHAIN_PATH  = path.join(ROOT, 'governance', 'governance-chain.json');
const GENESIS_HASH = '0'.repeat(64);

// ─── Utilitários ──────────────────────────────────────────────────────────────
function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256String(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function resolveArtifact() {
  try {
    return findLatestReleaseArtifact({ requireAuditPassed: true });
  } catch (_) {
    return findLatestReleaseArtifact({ requireAuditPassed: false });
  }
}

// ─── Definição das camadas da cadeia (ordem fixa) ─────────────────────────────
function buildChainLayers(artifact) {
  const zipPath      = artifact.zipPath;
  const manifestPath = artifact.manifestPath || path.join(ROOT, 'dist',
    (artifact.zip || '').replace(/\.zip$/, '.manifest.json'));

  return [
    { id: 'package',              path: zipPath,                                                  label: 'Release ZIP'              },
    { id: 'sidecar_manifest',     path: manifestPath,                                             label: 'Release Manifest Sidecar' },
    { id: 'evidence_manifest',    path: path.join(ROOT, 'governance', 'evidence-manifest.json'), label: 'Evidence Manifest'        },
    { id: 'final_proof_report',   path: path.join(ROOT, 'governance', 'final-proof-report.json'),label: 'Final Proof Report'       },
    { id: 'final_readiness',      path: path.join(ROOT, 'governance', 'final-readiness-report.json'), label: 'Final Readiness Report' },
    { id: 'consistency_report',   path: path.join(ROOT, 'governance', 'final-consistency-report.json'), label: 'Consistency Report' },
    { id: 'cross_report',         path: path.join(ROOT, 'governance', 'cross-report-validation.json'), label: 'Cross-Report Validation' },
    { id: 'proof_signature',      path: path.join(ROOT, 'governance', 'proof-signature.json'),   label: 'Proof Signature'          },
    { id: 'blocker_engine',       path: path.join(ROOT, 'governance', 'blocker-engine.js'),      label: 'Blocker Engine'           },
    { id: 'package_validation',   path: path.join(ROOT, 'governance', 'package-validation-report.json'), label: 'Package Validation' },
  ];
}

// ─── Construção da cadeia ─────────────────────────────────────────────────────
function buildChain(artifact) {
  const layers     = buildChainLayers(artifact);
  const chainLinks = [];
  let prevHash     = GENESIS_HASH;
  let cumHash      = GENESIS_HASH;

  for (const layer of layers) {
    const hash = sha256File(layer.path);
    const exists = hash !== null;

    // cumulativeHash = SHA256(prevCumHash + ':' + currentHash)
    const newCumHash = exists
      ? sha256String(`${cumHash}:${hash}`)
      : sha256String(`${cumHash}:missing:${layer.id}`);

    chainLinks.push({
      index:          chainLinks.length,
      id:             layer.id,
      label:          layer.label,
      path:           path.relative(ROOT, layer.path),
      exists,
      hash:           hash || null,
      previousHash:   prevHash,
      cumulativeHash: newCumHash,
      timestamp:      new Date().toISOString(),
    });

    prevHash = hash || `missing:${layer.id}`;
    cumHash  = newCumHash;
  }

  const chainRoot     = cumHash;
  const completeChain = chainLinks.every((l) => l.exists);
  const missingLayers = chainLinks.filter((l) => !l.exists).map((l) => l.id);

  return {
    generatedAt: new Date().toISOString(),
    artifact:    artifact.zip,
    gitCommit:   artifact.manifest?.git_commit || 'unknown',
    chainLength: chainLinks.length,
    chainRoot,
    completeChain,
    missingLayers,
    valid:       completeChain,
    links:       chainLinks,
  };
}

// ─── Verificação da cadeia existente ──────────────────────────────────────────
function verifyChain(storedChain) {
  if (!storedChain || !Array.isArray(storedChain.links)) {
    return { valid: false, error: 'chain_missing_or_malformed' };
  }

  const failures = [];
  let prevHash = GENESIS_HASH;
  let cumHash  = GENESIS_HASH;

  for (const link of storedChain.links) {
    const abs          = path.join(ROOT, link.path);
    const currentHash  = sha256File(abs);
    const exists       = currentHash !== null;

    // Verificar hash individual
    if (link.exists && exists && currentHash !== link.hash) {
      failures.push({
        id:       link.id,
        reason:   'hash_mismatch',
        expected: link.hash,
        actual:   currentHash,
        path:     link.path,
      });
    } else if (link.exists && !exists) {
      failures.push({ id: link.id, reason: 'file_deleted', path: link.path });
    }

    // Verificar hash acumulativo
    const expectedCum = exists
      ? sha256String(`${cumHash}:${currentHash}`)
      : sha256String(`${cumHash}:missing:${link.id}`);

    if (expectedCum !== link.cumulativeHash) {
      if (!failures.find((f) => f.id === link.id)) {
        failures.push({
          id:       link.id,
          reason:   'cumulative_hash_broken',
          expected: link.cumulativeHash,
          actual:   expectedCum,
        });
      }
    }

    prevHash = currentHash || `missing:${link.id}`;
    cumHash  = exists
      ? sha256String(`${cumHash}:${currentHash}`)
      : sha256String(`${cumHash}:missing:${link.id}`);
  }

  // Verificar chainRoot
  const chainRootValid = cumHash === storedChain.chainRoot;
  if (!chainRootValid) {
    failures.push({
      id:       'chain_root',
      reason:   'chain_root_mismatch',
      expected: storedChain.chainRoot,
      actual:   cumHash,
    });
  }

  return {
    valid:           failures.length === 0,
    chainRootValid,
    tampered:        failures.length > 0,
    failures,
    checkedLinks:    storedChain.links.length,
    storedChainRoot: storedChain.chainRoot,
    computedRoot:    cumHash,
  };
}

function loadChain() {
  if (!fs.existsSync(CHAIN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHAIN_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeChain(chain) {
  fs.mkdirSync(path.dirname(CHAIN_PATH), { recursive: true });
  fs.writeFileSync(CHAIN_PATH, `${JSON.stringify(chain, null, 2)}\n`, 'utf8');
}

module.exports = {
  GENESIS_HASH,
  sha256File,
  sha256String,
  buildChain,
  verifyChain,
  loadChain,
  writeChain,
  resolveArtifact,
};

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const verify = process.argv.includes('--verify');

  if (verify) {
    const stored = loadChain();
    if (!stored) {
      // eslint-disable-next-line no-console
      console.error('[governance-chain] Cadeia não encontrada. Execute sem --verify primeiro.');
      process.exit(1);
    }
    const result = verifyChain(stored);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  const artifact = resolveArtifact();
  const chain    = buildChain(artifact);
  writeChain(chain);
  // eslint-disable-next-line no-console
  console.log(`[governance-chain] chainRoot=${chain.chainRoot.slice(0, 16)}… valid=${chain.valid} links=${chain.chainLength}`);
  process.exit(chain.valid ? 0 : 1);
}
