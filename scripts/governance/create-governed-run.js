#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connect, close } = require('../../api/db/sequelize');
const { createRun } = require('../../api/services/governance/certificationService');
const { bootstrapAgentPolicy } = require('../../api/services/governance/agentPolicyBootstrap');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { resolveGitIdentity } = require('./lib/resolve-run-lineage');

async function main() {
  const sourceFingerprint = computeSourceFingerprint(process.cwd());
  const runId = `rap-governed-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;

  // DEFEITO MEDIDO (2026-10-16): este script gravava `sourceCommit`/`sourceTree`
  // APENAS em `governance/.current-run.json` e chamava `createRun` sem
  // `gitCommit`/`branch`. Resultado: a linha de `governance_run` ficava com
  // `git_commit = null` (medido em 2026-10-16: git_commit null, branch null), o
  // estampador de lineage não tinha commit para propagar e os três relatórios
  // finais ficavam com identidade INCOMPLETA (`faltantes=sourceCommit`) para
  // sempre — isto é, a decisão canônica de release NUNCA podia ser GO.
  // `createRun` já aceitava `gitCommit`/`branch`; faltava passar.
  const git = resolveGitIdentity(process.cwd());

  await connect();
  await createRun({
    runId,
    sourceFingerprint,
    scopeType: 'PLATFORM',
    principalType: 'PLATFORM_SYSTEM',
    principalId: 'governance-certification',
    gitCommit: git.sourceCommit,
    branch: git.sourceBranch || null,
  });
  const policy = await bootstrapAgentPolicy({ runId, agentId: 'governance-certification', agentType: 'CERTIFICATION', scope: 'PLATFORM' });
  const timestamp = new Date().toISOString();
  // sourceCommit/sourceTree ficam gravados no contexto do run para que o
  // lineage na origem (resolve-run-lineage.js) seja completo mesmo quando o
  // worktree avançar depois da criação do run.
  const runContext = { runId, sourceFingerprint, sourceCommit: git.sourceCommit, sourceTree: git.sourceTree, startedAt: timestamp, generatedAt: timestamp, status: 'CREATED', artifactType: 'run-context', artifactVersion: '1.0.0', policyId: policy.policyId, policyVersion: policy.policyVersion, policyFingerprint: policy.policyFingerprint };
  const target = path.join(process.cwd(), 'governance', '.current-run.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(runContext, null, 2)}\n`);
  console.log(JSON.stringify({ runId, sourceFingerprint, sourceCommit: git.sourceCommit, sourceBranch: git.sourceBranch || null, policy }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));