#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const BASE_DIR = process.env.RELEASE_EVIDENCE_BASE_DIR || 'qa/release-evidence';
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const PACK_DIR = process.env.RELEASE_EVIDENCE_OUT_DIR || path.join(BASE_DIR, TS);
const DRY_RUN = String(process.env.RELEASE_EVIDENCE_DRY_RUN || '0') === '1';

const REQUIRED_FILES = [
  'qa/release-gate-report.json',
  'qa/rollback-drill-report.json',
  'qa/go-no-go-report.json',
  'qa/launch-plan-status.json',
  'qa/launch-plan-status.md',
  'qa/release-window-report.json',
  'qa/release-manifest.json',
  'qa/smoke-evidence.json',
  'qa/l01-physical-queue-evidence.json',
  'qa/l02-ura-publish-rollback-evidence.json',
  'qa/l03-pbx-voice-tts-asr-evidence.json',
  'qa/l04-pbx-call-events-runtime-evidence.json',
  'qa/l05-chatpro-omnichannel-evidence.json',
];

const OPTIONAL_FILES = [
  'qa/smoke/l01-physical-queue.log',
  'qa/smoke/l02-ura-publish-rollback.log',
  'qa/smoke/l03-pbx-voice-tts-asr.log',
  'qa/smoke/l04-pbx-call-events-runtime.log',
  'qa/smoke/l05-chatpro-omnichannel.log',
];

function abs(rel) {
  return path.join(ROOT, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function mkdirp(dirRel) {
  fs.mkdirSync(abs(dirRel), { recursive: true });
}

function copyFile(relSrc, relDst) {
  const src = abs(relSrc);
  const dst = abs(relDst);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function sha256File(absPath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

function buildManifest(foundRequired, missingRequired, foundOptional, missingOptional) {
  return {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    sourceRoot: ROOT,
    packDir: PACK_DIR,
    summary: {
      requiredFound: foundRequired.length,
      requiredMissing: missingRequired.length,
      optionalFound: foundOptional.length,
      optionalMissing: missingOptional.length,
      status: missingRequired.length === 0 ? 'ready' : 'incomplete',
    },
    required: {
      found: foundRequired,
      missing: missingRequired,
    },
    optional: {
      found: foundOptional,
      missing: missingOptional,
    },
  };
}

function renderReadme(manifest) {
  const lines = [];
  lines.push('# Release Evidence Pack');
  lines.push('');
  lines.push(`- Generated at: ${manifest.generatedAt}`);
  lines.push(`- Dry-run: ${manifest.dryRun ? 'yes' : 'no'}`);
  lines.push(`- Status: ${String(manifest.summary.status || '').toUpperCase()}`);
  lines.push(`- Required found/missing: ${manifest.summary.requiredFound}/${manifest.summary.requiredMissing}`);
  lines.push(`- Optional found/missing: ${manifest.summary.optionalFound}/${manifest.summary.optionalMissing}`);
  lines.push('');
  lines.push('## Required');
  for (const rel of manifest.required.found) lines.push(`- [x] ${rel}`);
  for (const rel of manifest.required.missing) lines.push(`- [ ] ${rel}`);
  lines.push('');
  lines.push('## Optional');
  for (const rel of manifest.optional.found) lines.push(`- [x] ${rel}`);
  for (const rel of manifest.optional.missing) lines.push(`- [ ] ${rel}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const foundRequired = REQUIRED_FILES.filter(exists);
  const missingRequired = REQUIRED_FILES.filter((f) => !exists(f));
  const foundOptional = OPTIONAL_FILES.filter(exists);
  const missingOptional = OPTIONAL_FILES.filter((f) => !exists(f));

  const manifest = buildManifest(foundRequired, missingRequired, foundOptional, missingOptional);

  if (!DRY_RUN) {
    mkdirp(PACK_DIR);
    for (const rel of [...foundRequired, ...foundOptional]) {
      copyFile(rel, path.join(PACK_DIR, rel));
    }
    fs.writeFileSync(abs(path.join(PACK_DIR, 'manifest.json')), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.writeFileSync(abs(path.join(PACK_DIR, 'README.md')), renderReadme(manifest), 'utf8');
    const checksums = [];
    for (const rel of [...foundRequired, ...foundOptional, 'manifest.json', 'README.md']) {
      const relInPack = rel === 'manifest.json' || rel === 'README.md' ? rel : path.join(PACK_DIR, rel).replace(`${PACK_DIR}/`, '');
      const absInPack = rel === 'manifest.json' || rel === 'README.md'
        ? abs(path.join(PACK_DIR, rel))
        : abs(path.join(PACK_DIR, rel));
      checksums.push(`${sha256File(absInPack)}  ${relInPack}`);
    }
    fs.writeFileSync(abs(path.join(PACK_DIR, 'SHA256SUMS')), `${checksums.join('\n')}\n`, 'utf8');
  }

  // eslint-disable-next-line no-console
  console.log(`[release-evidence-pack] status=${manifest.summary.status} dryRun=${DRY_RUN ? '1' : '0'} requiredMissing=${manifest.summary.requiredMissing}`);
  // eslint-disable-next-line no-console
  console.log(`[release-evidence-pack] outDir=${PACK_DIR}`);

  if (manifest.summary.requiredMissing > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
