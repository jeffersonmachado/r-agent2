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
 *   2. a cadeia criptográfica é RECALCULADA a partir dos bytes atuais e fecha (nunca
 *      pelo campo `valid` gravado — ver `verificarCadeiaPadrao`);
 *   3. as IDENTIDADES estão PRESENTES, VÁLIDAS e coincidem com o run governado
 *      corrente — `.current-run.json` ausente ou incompleto BLOQUEIA (ausência de
 *      identidade não é identidade coerente);
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
  validarIdentidade,
  isFinalGo,
  DECISION_VERSION,
} = require('../../governance/canonical-release-decision');
const { verifyChain } = require('../../governance/governance-chain');

const ROOT = path.resolve(__dirname, '..', '..');

function ler(rel, rootDir = ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Verificação da cadeia: RECALCULA os bytes atuais.
 *
 * DEFEITO MEDIDO (2026-10-16): este avaliador fazia `chain.valid === true`, isto é,
 * confiava no campo GRAVADO no JSON — a mesma classe de falso verde que
 * `scripts/governance/validate-governance-chain.js` documenta no topo dele. Regravar
 * `governance-chain.json` com `valid: true` depois de alterar um artefato mantinha o
 * GO. Agora o veredito vem de `verifyChain` sobre o conteúdo persistido.
 */
function verificarCadeiaPadrao(chainPersistido) {
  if (!chainPersistido) {
    return { valid: false, motivo: 'CADEIA_AUSENTE', failures: [] };
  }
  const r = verifyChain(chainPersistido);
  return {
    valid: r && r.valid === true,
    motivo: r && r.valid === true ? 'CADEIA_RECOMPUTADA_INTEGRA' : 'CADEIA_RECOMPUTADA_INVALIDA',
    chainRootValid: !!(r && r.chainRootValid),
    tampered: !!(r && r.tampered),
    failures: (r && r.failures) || [],
  };
}

function avaliar(rootDir = ROOT, opcoes = {}) {
  const verificarCadeia = opcoes.verificarCadeia || verificarCadeiaPadrao;
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

  const vereditoCadeia = verificarCadeia(chain);

  // ── Identidade: TRÊS condições separadas, e só a primeira sustenta certificação ──
  // 1) presente e correspondente  2) presente e divergente  3) ausente/incompleta
  //
  // A condição entra como GATE na decisão canônica (abaixo). Antes ela só zerava
  // `ok`, deixando `state` em CERTIFIED_GO — e um consumidor que lê `state` (em vez de
  // `ok`) enxergava GO com identidade AUSENTE. Estado e veredito têm de concordar.
  const divergencias = [];
  let estadoDaIdentidade = 'AUSENTE';

  if (!run) {
    // Ausência de `.current-run.json` NÃO é identidade coerente — bloqueia.
    estadoDaIdentidade = 'AUSENTE';
    divergencias.push('run_corrente:artefato_ausente');
  } else {
    const avalRun = validarIdentidade(run);
    estadoDaIdentidade = avalRun.completa ? 'PRESENTE' : 'INCOMPLETA';
    if (!avalRun.completa) {
      divergencias.push(
        `run_corrente:incompleta${avalRun.faltantes.length ? `:faltantes=${avalRun.faltantes.join('|')}` : ''}` +
          `${avalRun.invalidos.length ? `:invalidos=${avalRun.invalidos.join('|')}` : ''}`
      );
    }
  }

  const identidadeAtual = run
    ? { runId: run.runId, sourceCommit: run.sourceCommit, sourceFingerprint: run.sourceFingerprint }
    : {};

  const identidadesDosRelatorios = [];
  for (const item of relatorios) {
    if (!item.artefato) {
      divergencias.push(`${item.id}:artefato_ausente`);
      identidadesDosRelatorios.push({ id: item.id, estado: 'AUSENTE' });
      continue;
    }
    const check = identidadeCoerente({ identity: item.artefato }, identidadeAtual);
    identidadesDosRelatorios.push({ id: item.id, estado: check.estado, faltantes: check.faltantes, invalidos: check.invalidos });
    if (!check.ok) {
      const detalhe = check.divergentes.length
        ? `divergentes=${check.divergentes.join('|')}`
        : `faltantes=${(check.faltantes || []).join('|')}`;
      divergencias.push(`${item.id}:${check.estado}:${detalhe}`);
    }
  }

  const gates = relatorios.map((item) => ({
    id: item.id,
    status: item.avaliacao.ok ? 'PASS' : 'FAIL',
  }));
  gates.push({ id: 'governance_chain', status: vereditoCadeia.valid ? 'PASS' : 'FAIL' });
  // Gate EXPLÍCITO de identidade: identidade ausente/incompleta/divergente bloqueia a
  // decisão (e o motivo nomeia o gate), em vez de apenas zerar um booleano paralelo.
  gates.push({ id: 'identidade', status: divergencias.length === 0 ? 'PASS' : 'FAIL' });

  const decisao = clasificar({ gates, selado: true, certificado: true, identidade: run || null });

  const naoFinal = relatorios
    .filter((item) => !item.avaliacao.ok)
    .map((item) => `${item.id}=${item.valor || '(ausente)'}→${item.avaliacao.state}`);

  // Invariantes: `ok` e `state` não podem discordar.
  const ok = isFinalGo(decisao.state) && divergencias.length === 0;
  const estadoConcordaComVeredito = isFinalGo(decisao.state) === ok;

  return {
    ok,
    estadoConcordaComVeredito,
    state: decisao.state,
    version: DECISION_VERSION,
    reason: decisao.reason,
    gates: gates.map((g) => `${g.id}:${g.status}`),
    decisoesNaoFinais: naoFinal,
    divergenciasDeIdentidade: divergencias,
    estadoDaIdentidadeDoRun: estadoDaIdentidade,
    identidadesDosRelatorios,
    cadeia: {
      veredito: vereditoCadeia.motivo,
      raizRecalculadaConfere: vereditoCadeia.chainRootValid === true,
      tampered: vereditoCadeia.tampered === true,
      divergencias: (vereditoCadeia.failures || []).length,
    },
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
    process.stderr.write(
      `  identidade do run: ${r.estadoDaIdentidadeDoRun} | relatórios: ${r.identidadesDosRelatorios
        .map((i) => `${i.id}=${i.estado}`)
        .join(', ')}\n`,
    );
    process.stderr.write(
      `  cadeia: ${r.cadeia.veredito} (divergências=${r.cadeia.divergencias}, raizConfere=${r.cadeia.raizRecalculadaConfere})\n`,
    );
    if (r.decisoesNaoFinais.length) {
      process.stderr.write(`  decisões não finais: ${r.decisoesNaoFinais.join(', ')}\n`);
    }
    if (r.divergenciasDeIdentidade.length) {
      process.stderr.write(`  identidade insuficiente/divergente: ${r.divergenciasDeIdentidade.join(', ')}\n`);
    }
    process.stderr.write(
      '  a publicação exige GO definitivo dos três relatórios + cadeia RECALCULADA íntegra + identidade PRESENTE e correspondente\n',
    );
  }
  process.exit(r.ok ? 0 : 1);
}

module.exports = { avaliar, verificarCadeiaPadrao };
