'use strict';

const { failIfNeeded, readJson, statusFromIssues, writeReport } = require('./common');
const { exigirGoFinal } = require('../../governance/canonical-release-decision');

const issues = [];
const governanceChain = readJson('governance/governance-chain.json', {});
const replay = readJson('governance/replay-integrity-report.json', {});
const readiness = readJson('governance/final-readiness-report.json', {});
const packageIntegrity = readJson('governance/package-integrity-report.json', {});
const runtime = readJson('reports/runtime-routes-validation-report.json', {});
const qa = readJson('reports/qa-governance-validation-report.json', readJson('qa-mesh/go-no-go-report.json', {}));

if (!(governanceChain.valid === true || governanceChain.chainValid === true)) {
  issues.push({ code: 'governance_chain_invalid', message: 'Governance chain is not valid.' });
}
if (replay.pass !== true || replay.replaySigValid !== true) {
  issues.push({ code: 'replay_chain_invalid', message: 'Replay chain/signature is not valid.' });
}
if (!(packageIntegrity.pass === true || packageIntegrity.status === 'PACKAGE_INTEGRITY_GO')) {
  issues.push({ code: 'release_chain_invalid', message: 'Package integrity is not GO/PASS.' });
}
if (runtime.status !== 'PASS') {
  issues.push({ code: 'runtime_chain_invalid', message: 'Runtime validation chain is missing or failing.' });
}
if (qa.status !== 'PASS' && qa.status !== 'GO') {
  issues.push({ code: 'qa_chain_invalid', message: 'QA chain is missing or not GO.' });
}
// AUTORIDADE ÚNICA (P0-4): antes este gate rejeitava apenas `/NO_GO/i`. Passavam
// como aprovados, portanto, `PASS_WITH_DEFERRED_PACKAGE_GATE` (estado PRÉ-pacote),
// `DELIVERED_PENDING_SCORECARD` e `CONTROLLED_PILOT` — um gate de self-proving
// aceitando o que ainda NÃO é GO definitivo. Agora o predicado é o vocabulário
// canônico: só `CERTIFIED_GO`/`PUBLISHED_VERIFIED` (ou os literais finais
// declarados) passam; qualquer outra coisa reprova, inclusive literal desconhecido.
const decisaoReadiness = exigirGoFinal(readiness.finalDecision || readiness.status, {
  consumidor: 'validate-self-proving',
});
if (!decisaoReadiness.ok) {
  issues.push({
    code: 'final_readiness_nao_final',
    message: `Final readiness is ${readiness.finalDecision || readiness.status} (estado canônico ${decisaoReadiness.state}; exigido GO definitivo ${decisaoReadiness.version}).`,
  });
}

const report = {
  name: 'validate-self-proving',
  status: statusFromIssues(issues),
  chains: {
    governance: governanceChain.valid === true || governanceChain.chainValid === true,
    replay: replay.pass === true && replay.replaySigValid === true,
    release: packageIntegrity.pass === true || packageIntegrity.status === 'PACKAGE_INTEGRITY_GO',
    runtime: runtime.status === 'PASS',
    qa: qa.status === 'PASS' || qa.status === 'GO',
  },
  finalDecision: readiness.finalDecision || readiness.status || null,
  issues,
  suggestions: issues.map((issue) => issue.message),
};

writeReport('self-proving-report.json', report);
failIfNeeded(report);
