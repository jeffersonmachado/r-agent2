#!/usr/bin/env node
'use strict';

/**
 * release-evidence-bundle.js — PRODUTOR que faltava para o verificador offline.
 *
 * GAP MEDIDO (TAREFA 91): `tools/system/release-evidence-verify.js` é offline por
 * construção (usa só fs/path/crypto), mas estava ÓRFÃO — exige um diretório com
 * `SHA256SUMS`, e `find . -name "SHA256SUMS*"` no repositório inteiro não
 * encontra nenhum; `RELEASE_EVIDENCE_DIR` só aparecia dentro do próprio
 * verificador. Sem produtor, "verificar offline" era impossível: o contrato de
 * entrada não existia.
 *
 * Este script materializa o bundle de verificação:
 *   1. descobre o release entregue (mais recente em `dist/release/`, ou --release);
 *   2. casa cada arquivo do envelope com o `sha256` DECLARADO no manifesto
 *      correspondente — os hashes NÃO são recalculados a partir do que se vai
 *      verificar (isso seria circular: passaria sempre);
 *   3. falha se algum arquivo declarado faltar ou se o conteúdo no disco divergir
 *      do declarado (divergência = envelope adulterado depois do selo);
 *   4. escreve `SHA256SUMS` + cópia dos arquivos em um diretório de bundle FORA do
 *      `dist/` (o `dist/` é validado por `validate:dist` e deve permanecer com
 *      apenas ZIPs/manifestos aprovados).
 *
 * Uso: node scripts/release/release-evidence-bundle.js [--release <nome>] [--out <dir>]
 * Saída: diretório de bundle (padrão: $TMPDIR/ragent2-evidence-<release>)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const RELEASE_DIR = path.join(ROOT, 'dist', 'release');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function discoverRelease() {
  const explicit = argValue('--release');
  if (explicit) return explicit;
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const manifests = fs.readdirSync(RELEASE_DIR)
    .filter((name) => name.endsWith('.manifest.json'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(RELEASE_DIR, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (manifests.length === 0) return null;
  return manifests[0].name.replace(/\.manifest\.json$/, '');
}

/**
 * Arquivos do envelope + hash DECLARADO em cada manifesto.
 * @returns {Array<{file: string, declared: string, source: string}>}
 */
function collectDeclaredEntries(release) {
  const entries = [];
  const manifestPath = path.join(RELEASE_DIR, `${release}.manifest.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifesto ausente: ${path.relative(ROOT, manifestPath)}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const artifact = manifest.artifact || `${release}.zip`;
  if (!manifest.sha256) {
    throw new Error('manifesto sem sha256 declarado do artefato');
  }
  entries.push({ file: artifact, declared: manifest.sha256, source: 'manifest.artifact' });

  // Artefatos secundários do mesmo release (payload/identidade) declaram o próprio
  // sha256 no arquivo companheiro, quando existe.
  for (const suffix of ['.payload.zip', '.delivered.identity.json', '.candidate.manifest.json']) {
    const candidate = `${release}${suffix}`;
    const candidatePath = path.join(RELEASE_DIR, candidate);
    if (!fs.existsSync(candidatePath)) continue;
    if (suffix === '.delivered.identity.json') {
      const identity = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      const declared = identity.finalPayloadHash || identity.payloadSha256 || null;
      if (declared && fs.existsSync(path.join(RELEASE_DIR, `${release}.payload.zip`))) {
        entries.push({
          file: `${release}.payload.zip`,
          declared,
          source: 'delivered.identity.finalPayloadHash',
        });
      }
      continue;
    }
    if (suffix === '.payload.zip') continue; // hash vem da identidade entregue
    const companion = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    if (companion.sha256 && companion.artifact) {
      const declaredFile = companion.artifact;
      if (fs.existsSync(path.join(RELEASE_DIR, declaredFile))) {
        entries.push({ file: declaredFile, declared: companion.sha256, source: `${suffix}.sha256` });
      }
    }
  }

  // Deduplica por arquivo mantendo a primeira declaração.
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.file)) return false;
    seen.add(entry.file);
    return true;
  });
}

function writeBundle(outDir, entries) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const lines = [];
  for (const entry of entries) {
    const source = path.join(RELEASE_DIR, entry.file);
    fs.copyFileSync(source, path.join(outDir, entry.file));
    lines.push(`${entry.declared}  ${entry.file}`);
  }
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${lines.join('\n')}\n`, 'utf8');
  return lines;
}

function main() {
  const release = discoverRelease();
  if (!release) {
    console.error('[release-evidence-bundle] FAIL: nenhum release entregue em dist/release');
    process.exitCode = 1;
    return;
  }

  const entries = collectDeclaredEntries(release);

  // Conferência de conteúdo contra o DECLARADO (não contra o recém-calculado).
  const divergences = [];
  for (const entry of entries) {
    const filePath = path.join(RELEASE_DIR, entry.file);
    const actual = sha256File(filePath);
    if (actual !== entry.declared) {
      divergences.push({ file: entry.file, source: entry.source, actual, declared: entry.declared });
    }
  }
  if (divergences.length > 0) {
    console.error(`[release-evidence-bundle] FAIL release=${release} divergencias=${divergences.length}`);
    for (const item of divergences) {
      console.error(`  ${item.file}: declarado=${item.declared.slice(0, 16)} real=${item.actual.slice(0, 16)} (${item.source})`);
    }
    process.exitCode = 1;
    return;
  }

  const outDir = argValue('--out')
    || path.join(os.tmpdir(), `ragent2-evidence-${release}`);
  const lines = writeBundle(outDir, entries);

  console.log(`[release-evidence-bundle] PASS release=${release} arquivos=${lines.length} dir=${outDir}`);
  console.log(`[release-evidence-bundle] verifique offline com: RELEASE_EVIDENCE_DIR=${outDir} npm run system:release-evidence-verify`);
}

main();
