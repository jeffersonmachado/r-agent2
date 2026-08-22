#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { connect, close } = require('../api/db/sequelize');
const { computePolicyFingerprint } = require('./proof-engine/fingerprint-chain');
const getPolicy = require('../api/db/models/AgentPolicy');
const getVersion = require('../api/db/models/AgentPolicyVersion');
const getRun = require('../api/db/models/GovernanceRun');
const getAttestation = require('../api/db/models/AgentPolicyAttestation');

function constitutionFingerprint() { const file = path.join(process.cwd(), 'governance', 'RAP_AGENT_CONSTITUTION.md'); if (!fs.existsSync(file)) throw new Error('canonical_constitution_missing'); return computePolicyFingerprint(process.cwd()); }
async function verify() {
  const fingerprint = constitutionFingerprint(); await connect();
  const policy = await getPolicy().findOne({ where: { policy_id: 'RAP-AGENT-CONSTITUTION' } });
  const version = policy && await getVersion().findOne({ where: { policy_id: policy.id, version: policy.current_version } });
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  const attestations = run ? await getAttestation().count({ where: { run_id: run.run_id, policy_fingerprint: fingerprint, status: 'ATTESTED' } }) : 0;
  const adapters = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'];
  const adapterFailures = adapters.filter((file) => !fs.readFileSync(path.join(process.cwd(), file), 'utf8').includes('governance/RAP_AGENT_CONSTITUTION.md'));
  const failures = [!policy && 'policy_missing', !version && 'policy_version_missing', version && version.content_fingerprint !== fingerprint && 'policy_fingerprint_mismatch', !fs.existsSync(path.join(process.cwd(), 'governance', 'policy-as-code.js')) && 'policy_as_code_missing', !run && 'governance_run_missing', run && run.policy_fingerprint !== fingerprint && 'run_policy_mismatch', attestations === 0 && 'agent_attestation_missing', ...adapterFailures.map((file) => `adapter_missing_reference:${file}`)].filter(Boolean);
  return { status: failures.length === 0 ? 'PASS' : 'FAIL', artifactType: 'agent-policy-compliance', artifactVersion: '1.0.0', policyId: policy?.policy_id || null, policyVersion: policy?.current_version || null, policyFingerprint: fingerprint, runId: run?.run_id || null, sourceFingerprint: run?.source_fingerprint || null, attestations, failures };
}

if (require.main === module) verify().then((result) => { fs.mkdirSync(path.join(process.cwd(), 'governance'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), 'governance', 'agent-policy-compliance-report.json'), `${JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2)}\n`); console.log(result.status === 'PASS' ? 'AGENT_POLICY_COMPLIANCE_PASS' : 'AGENT_POLICY_COMPLIANCE_FAIL'); console.log(JSON.stringify(result)); process.exitCode = result.status === 'PASS' ? 0 : 1; }).catch((error) => { console.error(`AGENT_POLICY_COMPLIANCE_FAIL: ${error.message}`); process.exitCode = 1; }).finally(() => close().catch(() => {}));

module.exports = { verify, constitutionFingerprint };