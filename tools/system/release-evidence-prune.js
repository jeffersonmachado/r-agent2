#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BASE_DIR = process.env.RELEASE_EVIDENCE_BASE_DIR || 'qa/release-evidence';
const KEEP = Math.max(1, Number(process.env.RELEASE_EVIDENCE_PRUNE_KEEP || 5));
const DRY_RUN = String(process.env.RELEASE_EVIDENCE_PRUNE_DRY_RUN || '1') !== '0';

function main() {
  const baseAbs = path.join(ROOT, BASE_DIR);
  if (!fs.existsSync(baseAbs)) {
    // eslint-disable-next-line no-console
    console.log(`[release-evidence-prune] no_dir base=${BASE_DIR}`);
    process.exit(0);
  }

  const dirs = fs.readdirSync(baseAbs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const toDelete = dirs.slice(0, Math.max(0, dirs.length - KEEP));
  // eslint-disable-next-line no-console
  console.log(`[release-evidence-prune] total=${dirs.length} keep=${KEEP} delete=${toDelete.length} dryRun=${DRY_RUN ? '1' : '0'}`);

  for (const name of toDelete) {
    const rel = path.join(BASE_DIR, name);
    const abs = path.join(baseAbs, name);
    if (DRY_RUN) {
      // eslint-disable-next-line no-console
      console.log(`[release-evidence-prune] would_delete ${rel}`);
      continue;
    }
    fs.rmSync(abs, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.log(`[release-evidence-prune] deleted ${rel}`);
  }

  process.exit(0);
}

main();
