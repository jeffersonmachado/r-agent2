#!/usr/bin/env node
'use strict';

/**
 * assert-canonical-release-decision.js — o artefato selado está em GO DEFINITIVO?
 *
 * POR QUE ISTO EXISTE (P0-4): os gates do pipeline checavam "GO" cada um com o seu
 * próprio vocabulário, e nenhum deles respondia à pergunta que a PUBLICAÇÃO exige —
 * "este artefato está certificado o bastante para virar uma tag pública?". Este
 * script usa a AUTORIDADE ÚNICA (`governance/canonical-release-decision.js`) sobre
 * os artefatos REAIS do release selado e só sai 0 quando:
 *
 *   1. os três relatórios de decisão (final-governance, final-readiness, final-proof)
 *      estão em estado FINAL (não em pré-pacote como `PASS_WITH_DEFERRED_PACKAGE_GATE`);
 *   2. a cadeia criptográfica persistida está íntegra (`valid === true`);
 *   3. as IDENTIDADES coincidem com o run governado corrente (runId/sourceFingerprint)
 *      — GO de outro candidato não vale para este;
 *   4. a composição canônica resulta em GO definitivo (CERTIFIED_GO ou
 *      PUBLISHED_VERIFIED), nunca PRE_PACKAGE_PASS/RUNNING/BLOCKED/NO_GO.
 *
 * Exit: 0 = GO definitivo | 1 = não é GO definitivo (imprime o estado e o motivo)
 *
 * Uso: node --env-file-if-exists=.env scripts/governance/assert-canonical-release-decision.js [--json]
 */

const fs = require('fs');
const path = require('path');

const {
  STATES,
  clasificar,
  exigirGoFinal,
  identidadeCoerente,
  isFinalGo,
  DECISION_VERSION,
} = require('../../governance/canonical-release-decision');

const ROOT = path.resolve(__dirname, '..', '..');

function ler(rel, rootDir = ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
  } catch (_) {
    return null;
  }
}

function avaliar(rootDir = ROOT) {
  const gov = ler('governance/final-governance-report.json', rootDir);
  const readiness = ler('governance/final-readiness-report.json', rootDir);
  const proof = ler('governance/final-proof-report.json', rootDir);
  const chain = ler('governance/governance-chain.json', rootDir);
  const run = ler('governance/.current-run.json', rootDir);

  const relatorios = [
    { id: 'final_governance', valor: gov && gov.finalDecision, artefato: gov },
    { id: 'final_readiness', valor: readiness && readiness.finalDecision, artefato: readiness },
    { id: 'final_proof', valor: proof && proof.finalDecision, artefato: proof },
  ].map((item) => ({ ...item, avaliacao: exigirGoFinal(item.valor, { consumidor: item.id }) }));

  const gates = relatorios.map((item) => ({
    id: item.id,
    status: item.avaliacao.ok ? 'PASS' : 'FAIL',
  }));
  gates.push({ id: 'governance_chain', status: chain && chain.valid === true ? 'PASS' : 'FAIL' });

  const decisao = clasificar({ gates, selado: true, certificado: true, identidade: run || null });

  // Identidade: cada relatório de decisão precisa ser do MESMO candidato do run corrente.
  const identidadeAtual = run
    ? { runId: run.runId, sourceCommit: run.sourceCommit, sourceFingerprint: run.sourceFingerprint }
    : {};
  const divergencias = [];
  for (const item of relatorios) {
    if (!item.artefato) {
      divergencias.push(`${item.id}:artefato_ausente`);
      continue;
    }
    const check = identidadeCoerente({ identity: item.artefato }, identidadeAtual);
    if (!check.ok) divergencias.push(`${item.id}:${check.divergentes.join('|')}`);
  }

  const naoFinal = relatorios
    .filter((item) => !item.avaliacao.ok)
    .map((item) => `${item.id}=${item.valor || '(ausente)'}→${item.avaliacao.state}`);

  const ok = isFinalGo(decisao.state) && divergencias.length === 0;

  return {
    ok,
    state: decisao.state,
    version: DECISION_VERSION,
    reason: decisao.reason,
    gates: gates.map((g) => `${g.id}:${g.status}`),
    decisoesNaoFinais: naoFinal,
    divergenciasDeIdentidade: divergencias,
    chainRoot: chain ? String(chain.chainRoot || '').slice(0, 16) : null,
  };
}

if (require.main === module) {
  const r = avaliar(ROOT);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } else if (r.ok) {
    process.stdout.write(
      `[canonical-decision] state=${r.state} version=${r.version} gates=${r.gates.join(',')} chain=${r.chainRoot}\n`,
    );
  } else {
    process.stderr.write(`[canonical-decision] NAO E GO DEFINITIVO: state=${r.state} motivo=${r.reason}\n`);
    if (r.decisoesNaoFinais.length) {
      process.stderr.write(`  decisões não finais: ${r.decisoesNaoFinais.join(', ')}\n`);
    }
    if (r.divergenciasDeIdentidade.length) {
      process.stderr.write(`  identidade divergente: ${r.divergenciasDeIdentidade.join(', ')}\n`);
    }
    process.stderr.write('  a publicação exige GO definitivo dos três relatórios + cadeia íntegra + mesma identidade\n');
  }
  process.exit(r.ok ? 0 : 1);
}

module.exports = { avaliar };
