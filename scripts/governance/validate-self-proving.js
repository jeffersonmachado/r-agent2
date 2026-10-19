'use strict';

const { failIfNeeded, readJson, statusFromIssues, writeReport } = require('./common');
const { exigirGoFinal } = require('../../governance/canonical-release-decision');
const { loadChain, avaliarEstadoDaCadeia } = require('../../governance/governance-chain');

const issues = [];
// ─── CADEIA DE GOVERNANÇA: RECALCULADA, NUNCA LIDA (P0 FASE 6 / 2026-10-16) ────
//
// DEFEITO MEDIDO: este gate aprovava lendo o campo PERSISTIDO
// (`governanceChain.valid === true`), que o construtor gravava a partir da mera
// EXISTÊNCIA dos arquivos. Prova: com `valid: true` gravado e 9 divergências reais
// de hash (6 elos reescritos até 9869 s depois da certificação), o agregado
// (`npm run validate:governance-enforcement`, passo 15) dava PASS — um gate de
// "self-proving" declarando válida uma cadeia criptográfica quebrada.
//
// Agora o veredito vem de `avaliarEstadoDaCadeia()`, que recalcula os hashes e
// compara DECLARAÇÃO com REALIDADE (incluindo escrito-depois-da-certificação).
const storedChain = loadChain();
const estadoCadeia = storedChain ? avaliarEstadoDaCadeia(storedChain) : null;
const cadeiaIntegra = !!(estadoCadeia && estadoCadeia.recalculadaIntegra === true);

if (!cadeiaIntegra) {
  issues.push({
    code: 'governance_chain_invalid',
    message: storedChain
      ? `Governance chain is not valid: ${estadoCadeia.motivos.map((m) => m.code).join(', ')}`
      : 'Governance chain is not valid: governance/governance-chain.json ausente ou ilegível.',
  });
}
if (estadoCadeia && estadoCadeia.autoDeclaracao === 'FALSA') {
  issues.push({
    code: 'governance_chain_auto_declaracao_falsa',
    message: 'A cadeia se DECLARA válida mas a recalculação a contradiz — aparência de válida sobre conteúdo alterado.',
  });
}
if (estadoCadeia && estadoCadeia.escritasPosteriores.ids.length > 0) {
  issues.push({
    code: 'governance_chain_certificacao_ultrapassada',
    message: `Elo(s) gravado(s) depois da certificação: ${estadoCadeia.escritasPosteriores.ids.join(', ')} — a certificação não cobre o conteúdo atual.`,
  });
}

const replay = readJson('governance/replay-integrity-report.json', {});
const readiness = readJson('governance/final-readiness-report.json', {});
const packageIntegrity = readJson('governance/package-integrity-report.json', {});
const runtime = readJson('reports/runtime-routes-validation-report.json', {});
const qa = readJson('reports/qa-governance-validation-report.json', readJson('qa-mesh/go-no-go-report.json', {}));

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
    governance: cadeiaIntegra,
    governanceDeclaracao: estadoCadeia ? estadoCadeia.autoDeclaracao : 'AUSENTE',
    governanceDivergencias: estadoCadeia ? estadoCadeia.recalc.failures.length : null,
    governanceEscritasPosteriores: estadoCadeia ? estadoCadeia.escritasPosteriores.ids : null,
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
