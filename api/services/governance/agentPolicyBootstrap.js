'use strict';

const fs = require('fs');
const path = require('path');
const { getSequelize } = require('../../db/sequelize');
const getPolicy = require('../../db/models/AgentPolicy');
const getVersion = require('../../db/models/AgentPolicyVersion');
const getAssignment = require('../../db/models/AgentPolicyAssignment');
const getAttestation = require('../../db/models/AgentPolicyAttestation');
const getRun = require('../../db/models/GovernanceRun');
const { computePolicyFingerprint } = require('../../../governance/proof-engine/fingerprint-chain');

const POLICY_ID = 'RAP-AGENT-CONSTITUTION';
// 1.0.4 (2026-09-18) — o VALOR do fingerprint de política mudou de algoritmo:
// `config/journey-contracts.json` passou a ser projetado (só política declarada)
// para não tornar o fingerprint instável quando o gerador recalcula a cache
// derivada (`confidence`) e reescreve `version`/`generatedAt`. A versão sobe
// porque a identidade do artefato de política mudou — o mecanismo para aceitar
// uma mudança de política é exatamente este bump, revisado em código.
const POLICY_VERSION = '1.0.4';
const CONSTITUTION_PATH = path.resolve(__dirname, '../../../governance/RAP_AGENT_CONSTITUTION.md');

function policyError(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; return error; }
function readConstitution() { if (!fs.existsSync(CONSTITUTION_PATH)) throw policyError('AGENT_POLICY_NOT_LOADED', CONSTITUTION_PATH); const content = fs.readFileSync(CONSTITUTION_PATH, 'utf8'); return { content, fingerprint: computePolicyFingerprint(path.resolve(__dirname, '../../..')) }; }

async function bootstrapAgentPolicy({ runId, agentId, agentType = 'GENERIC', scope = 'PLATFORM', now = new Date() }) {
  const sequelize = getSequelize(); if (!sequelize) throw policyError('governance_db_required', 'Sequelize não inicializado');
  const constitution = readConstitution();
  return sequelize.transaction(async (transaction) => {
    const run = await getRun().findOne({ where: { run_id: runId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!run) throw policyError('governance_run_not_found', runId);
    if (run.status === 'INVALIDATED') throw policyError('RUN_INVALIDATED', runId);
    const [policy] = await getPolicy().findOrCreate({ where: { policy_id: POLICY_ID }, defaults: { name: 'RAP Agent Constitution', status: 'ACTIVE', current_version: POLICY_VERSION, metadata: { sourcePath: 'governance/RAP_AGENT_CONSTITUTION.md' } }, transaction });
    if (policy.current_version && policy.current_version !== POLICY_VERSION && policy.update) await policy.update({ current_version: POLICY_VERSION, status: 'ACTIVE' }, { transaction });
    const [version] = await getVersion().findOrCreate({ where: { policy_id: policy.id, version: POLICY_VERSION }, defaults: { content_fingerprint: constitution.fingerprint, effective_from: now }, transaction });
    if (version.content_fingerprint !== constitution.fingerprint) throw policyError('AGENT_POLICY_STALE', 'persisted policy fingerprint differs from constitution');
    await getAssignment().findOrCreate({ where: { policy_version_id: version.id, agent_type: agentType, agent_id: agentId || null, scope }, defaults: { mandatory: true, metadata: {} }, transaction });
    if (run.policy_fingerprint && run.policy_fingerprint !== constitution.fingerprint) { await run.update({ status: 'INVALIDATED', invalidated_at: now, invalidated_reason: 'RUN_POLICY_DRIFT' }, { transaction }); throw policyError('RUN_POLICY_DRIFT', runId); }
    await run.update({ policy_id: POLICY_ID, policy_version: POLICY_VERSION, policy_fingerprint: constitution.fingerprint }, { transaction });
    const attestation = await getAttestation().create({ run_id: runId, agent_id: agentId || `default:${agentType}`, agent_type: agentType, policy_id: POLICY_ID, policy_version: POLICY_VERSION, policy_fingerprint: constitution.fingerprint, loaded_at: now, attested_at: now, status: 'ATTESTED' }, { transaction });
    return { policyId: POLICY_ID, policyVersion: POLICY_VERSION, policyFingerprint: constitution.fingerprint, attestationId: attestation.id, status: 'PASS' };
  });
}

module.exports = { bootstrapAgentPolicy, readConstitution, POLICY_ID, POLICY_VERSION, CONSTITUTION_PATH, policyError };