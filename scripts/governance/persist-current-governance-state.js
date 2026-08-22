'use strict';

const crypto = require('crypto');
const { connect, close } = require('../../api/db/sequelize');
const { createRun } = require('../../api/services/governance/certificationService');
const { persistDefinitions } = require('../../api/services/governance/scorecardService');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

async function main() {
  const rootDir = process.cwd();
  const sourceFingerprint = computeSourceFingerprint(rootDir);
  const runId = `rap-governance-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
  await connect();
  const run = await createRun({ runId, sourceFingerprint, scopeType: 'PLATFORM', principalType: 'SERVICE', principalId: 'governance-bootstrap', branch: process.env.GIT_BRANCH || null, gitCommit: process.env.GIT_COMMIT || null, metadata: { origin: 'governance-bootstrap', legacyRunMigrated: false } });
  const definitions = await persistDefinitions();
  process.stdout.write(`${JSON.stringify({ runId: run.run_id, sourceFingerprint, definitions: definitions.dimensions, status: run.status })}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));