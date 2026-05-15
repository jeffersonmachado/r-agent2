#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DIST_GOV = path.join(DIST, 'governance');
const DIST_VER = path.join(DIST, 'verifier');

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function findLatestPayloadName() {
  const relDir = path.join(DIST, 'release');
  if (!fs.existsSync(relDir)) return null;
  const files = fs.readdirSync(relDir).filter((f) => f.endsWith('.payload.zip')).sort().reverse();
  return files[0] || null;
}

function findLatestEnvelopeName() {
  const relDir = path.join(DIST, 'release');
  if (!fs.existsSync(relDir)) return null;
  const files = fs.readdirSync(relDir).filter((f) => f.endsWith('.zip') && !f.endsWith('.payload.zip')).sort().reverse();
  return files[0] || null;
}

function main() {
  fs.mkdirSync(DIST_GOV, { recursive: true });
  fs.mkdirSync(DIST_VER, { recursive: true });

  let verifierJson = null;
  try {
    const out = execSync('bash scripts/verify-enterprise-governance-v2.sh --json', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    verifierJson = JSON.parse(out);
  } catch (_) {
    verifierJson = readJsonSafe(path.join(DIST_VER, 'verify-result.json')) || { pass: false, decision: 'FAIL' };
  }

  const payload = findLatestPayloadName();
  const envelope = findLatestEnvelopeName();

  const pass = verifierJson && verifierJson.pass === true;

  const report = {
    generatedAt: new Date().toISOString(),
    schemaVersion: '2.1.0',
    architecture: 'envelope-payload-split',
    pass,
    verifierPassed: pass,
    selfProofStatus: pass ? 'PASS' : 'FAIL',
    envelopeValidated: pass,
    payloadValidated: pass,
    offlineAuditability: pass,
    packageValidationOk: pass,
    packageIntegrityPass: pass,
    governedArtifactType: 'payload',
    governedArtifact: payload,
    envelopeArtifact: envelope,
    decision: (verifierJson && verifierJson.decision) || (pass ? 'VERIFIED' : 'TAMPERED_OR_INCOMPLETE'),
    failReasons: (verifierJson && verifierJson.failReasons) || [],
    status: pass ? 'final' : 'failed',
    transitional: false,
    placeholder: false,
  };

  fs.writeFileSync(path.join(DIST_GOV, 'self-proving-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

  process.stdout.write(`[self-proving-v2] pass=${report.pass} status=${report.selfProofStatus}\n`);
  if (!report.pass) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
