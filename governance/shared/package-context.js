'use strict';

/**
 * Package Context — contexto canônico do pacote compartilhado por TODOS os engines.
 *
 * Todos os engines que precisam do ZIP, seu hash, manifest ou nome
 * DEVEM usar este módulo. Nenhum engine pode localizar ou calcular o ZIP de forma independente.
 *
 * Garante:
 *   - mesmo ZIP usado por todos os engines
 *   - mesmo hash calculado uma única vez (cacheado em memória)
 *   - mesmo manifest lido de forma consistente
 *   - mesmo contexto congelado durante uma execução de pipeline
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Cache em memória para não recalcular hash múltiplas vezes na mesma execução
let _cachedContext = null;

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJsonSafe(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try { return JSON.parse(fs.readFileSync(absPath, 'utf8')); } catch (_) { return null; }
}

// ─── Localizar o ZIP mais recente em dist/ ou dist/release/ ──────────────────
function findLatestZip(ROOT) {
  const distDir     = path.join(ROOT, 'dist');
  const releaseDir  = path.join(ROOT, 'dist', 'release');

  // Primeiro: verificar se package-validation-report aponta para um ZIP específico
  const pkgReport = readJsonSafe(path.join(ROOT, 'governance', 'package-validation-report.json'));
  if (pkgReport && pkgReport.zipName) {
    const candidates = [
      path.join(releaseDir, pkgReport.zipName),
      path.join(distDir,    pkgReport.zipName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return { zipName: pkgReport.zipName, zipPath: c };
      }
    }
  }

  // Fallback: último ZIP em dist/release/ ou dist/ raiz
  const searchDirs = [releaseDir, distDir].filter((d) => fs.existsSync(d));
  const allZips = [];
  for (const dir of searchDirs) {
    fs.readdirSync(dir)
      .filter((f) => /^r-agent2-\d{8}-\d{6}(\.payload)?\.zip$/.test(f))
      .forEach((f) => allZips.push({ zipName: f, zipPath: path.join(dir, f) }));
  }
  if (allZips.length === 0) return null;
  // Ordena: prefere .payload.zip, depois mais recente por nome
  allZips.sort((a, b) => {
    const pa = a.zipName.includes('.payload') ? 1 : 0;
    const pb = b.zipName.includes('.payload') ? 1 : 0;
    if (pb !== pa) return pb - pa;
    return b.zipName.localeCompare(a.zipName);
  });
  return allZips[0];
}

// ─── Ler sidecar manifest do ZIP ─────────────────────────────────────────────
function readSidecarManifest(zipPath) {
  const manifestPath = zipPath.replace(/\.zip$/, '.manifest.json');
  return readJsonSafe(manifestPath);
}

// ─── Ler hash registrado nos relatórios internos ──────────────────────────────
function readRecordedHash(ROOT) {
  const pkgReport = readJsonSafe(path.join(ROOT, 'governance', 'package-validation-report.json'));
  if (pkgReport) {
    const h = pkgReport.zipSha256 || pkgReport.packageBinding?.sha256;
    if (h) return { hash: h, source: 'governance/package-validation-report.json' };
  }
  return { hash: null, source: null };
}

// ─── Construir contexto canônico do pacote ────────────────────────────────────
/**
 * @param {string} ROOT — raiz do projeto
 * @param {{ forceRefresh?: boolean }} opts
 * @returns {{
 *   zipFound:       boolean,
 *   zipName:        string|null,
 *   zipPath:        string|null,
 *   computedHash:   string|null,
 *   recordedHash:   string|null,
 *   hashSource:     string|null,
 *   hashMatch:      boolean,
 *   sizeBytes:      number|null,
 *   manifest:       object|null,
 *   evidenceManifestHash: string|null,
 *   governanceHash: string|null,
 * }}
 */
function getPackageContext(ROOT, opts) {
  if (_cachedContext && !opts?.forceRefresh) return _cachedContext;

  const latest = findLatestZip(ROOT);

  if (!latest) {
    _cachedContext = {
      zipFound:             false,
      zipName:              null,
      zipPath:              null,
      computedHash:         null,
      recordedHash:         null,
      hashSource:           null,
      hashMatch:            false,
      sizeBytes:            null,
      manifest:             null,
      evidenceManifestHash: null,
      governanceHash:       null,
    };
    return _cachedContext;
  }

  const { zipName, zipPath } = latest;
  const computedHash = sha256File(zipPath);
  const manifest     = readSidecarManifest(zipPath);
  const sizeBytes    = fs.existsSync(zipPath) ? fs.statSync(zipPath).size : null;

  // Hash registrado: sidecar manifest → package-validation-report
  let recordedHash = manifest?.sha256 || null;
  let hashSource   = recordedHash ? 'sidecar-manifest' : null;
  if (!recordedHash) {
    const rec = readRecordedHash(ROOT);
    recordedHash = rec.hash;
    hashSource   = rec.source;
  }

  const hashMatch = !!(recordedHash && computedHash && computedHash === recordedHash);

  // Hash do evidence manifest
  const evidencePath           = path.join(ROOT, 'governance', 'evidence-manifest.json');
  const evidenceManifestHash   = sha256File(evidencePath);

  // Hash do relatório final de governança
  const govReportPath  = path.join(ROOT, 'governance', 'final-governance-report.json');
  const governanceHash = sha256File(govReportPath);

  _cachedContext = {
    zipFound: true,
    zipName,
    zipPath,
    computedHash,
    recordedHash,
    hashSource,
    hashMatch,
    sizeBytes,
    manifest,
    evidenceManifestHash,
    governanceHash,
  };

  return _cachedContext;
}

// Limpar cache (usado em testes ou ao trocar de contexto)
function clearPackageContextCache() {
  _cachedContext = null;
}

module.exports = { getPackageContext, findLatestZip, clearPackageContextCache };
