#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connect, close } = require('../../api/db/sequelize');
const { createRun } = require('../../api/services/governance/certificationService');
const { bootstrapAgentPolicy } = require('../../api/services/governance/agentPolicyBootstrap');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

async function main() {
  const sourceFingerprint = computeSourceFingerprint(process.cwd());
  const runId = `rap-governed-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
  await connect();
  await createRun({ runId, sourceFingerprint, scopeType: 'PLATFORM', principalType: 'PLATFORM_SYSTEM', principalId: 'governance-certification' });
  const policy = await bootstrapAgentPolicy({ runId, agentId: 'governance-certification', agentType: 'CERTIFICATION', scope: 'PLATFORM' });
  const timestamp = new Date().toISOString();
  const runContext = { runId, sourceFingerprint, startedAt: timestamp, generatedAt: timestamp, status: 'CREATED', artifactType: 'run-context', artifactVersion: '1.0.0', policyId: policy.policyId, policyVersion: policy.policyVersion, policyFingerprint: policy.policyFingerprint };
  const target = path.join(process.cwd(), 'governance', '.current-run.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(runContext, null, 2)}\n`);
  console.log(JSON.stringify({ runId, sourceFingerprint, policy }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));