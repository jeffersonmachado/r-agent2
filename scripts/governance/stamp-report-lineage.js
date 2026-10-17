#!/usr/bin/env node
'use strict';

/**
 * stamp-report-lineage.js — vincula reports técnicos gerados por validadores
 * reais ao GovernanceRun atual, SEM alterar status/dados reais.
 *
 * O banco é a fonte de runId/sourceFingerprint. Este script apenas adiciona
 * os campos de lineage exigidos pelo engine de certificação (runId,
 * sourceFingerprint, generatedAt, artifactType, artifactVersion) a reports
 * cujo conteúdo real foi produzido pelos geradores. Nenhum status é fabricado.
 */

const fs = require('fs');
const path = require('path');
const { connect, close } = require('../../api/db/sequelize');
const getRun = require('../../api/db/models/GovernanceRun');

/**
 * RUNTIME_EVIDENCE não pode receber lineage retroativo.
 *
 * DEFEITO CORRIGIDO (2026-09-19): este script estampava
 * `qa-mesh/go-no-go-report.json`, PRESERVANDO o `generatedAt` original e
 * anexando `runId`/`sourceFingerprint` do run mais recente. Um relatório
 * produzido às 10:46 passou a reivindicar o run criado às 20:18 — o engine de
 * certificação aceitava como prova daquele run algo que ele NUNCA executou.
 * É pior que não ter lineage, porque elimina a dúvida sem criar a prova.
 *
 * A lista canônica vive em `config/runtime-evidence-artifacts.json`, via o
 * módulo puro `scripts/governance/lib/runtime-evidence-artifacts.js` — a MESMA
 * fonte usada pelo validador `validate-qa-evidence-same-run.js`.
 */
const {
  REASONS,
  classifyArtifact,
  isRuntimeEvidenceArtifact,
  isAuthoritativeArtifact,
  listAuthoritativeArtifacts,
  getProducer,
  producerPhase,
  producerDueNow,
  runStartMs,
} = require('./lib/runtime-evidence-artifacts');

const CAMPOS_HASH_PROPRIO = ['reportHash', 'selfHash', 'contentHash', 'integrityHash'];
const CAMPOS_ASSINATURA_PROPRIA = ['governanceSignature', 'enterpriseGovernanceSignature'];

/**
 * Artefato que PROVA O PRÓPRIO CONTEÚDO (hash e/ou assinatura sobre si mesmo).
 * Reescrevê-lo (nem que seja só para acrescentar lineage) invalida a própria prova.
 * @param {object} report
 * @returns {boolean}
 */
function artefatoAutoReferencial(report) {
  if (!report || typeof report !== 'object') return false;
  const temHash = CAMPOS_HASH_PROPRIO.some((campo) => Boolean(report[campo]));
  const temAssinatura = CAMPOS_ASSINATURA_PROPRIA.some((campo) => Boolean(report[campo]));
  return temHash && temAssinatura;
}

function stamp(relativePath, run) {
  // Fail-closed: artefato de execução exige lineage NA ORIGEM (o produtor
  // recebe runId/sourceFingerprint ANTES de executar). Estampar aqui seria
  // adotar retroativamente a prova de um run no qual nada foi executado.
  if (isRuntimeEvidenceArtifact(relativePath)) {
    return {
      path: relativePath,
      stamped: false,
      reason: REASONS.RUNTIME_EVIDENCE_REQUIRES_ORIGIN_LINEAGE,
    };
  }

  const classification = classifyArtifact(relativePath);
  // Artefato histórico/transicional NÃO sustenta decisão: lineage nele é ruído
  // que sugere autoridade que ele não tem. Desconhecido nunca é "estampável
  // por não conhecido" — é NO_GO (classifique na taxonomia).
  if (!classification || !isAuthoritativeArtifact(relativePath)) {
    return {
      path: relativePath,
      stamped: false,
      classification,
      reason: REASONS.UNCLASSIFIED_AUTHORITATIVE_ARTIFACT,
    };
  }

  const abs = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(abs)) return { path: relativePath, stamped: false, reason: 'missing' };
  let report;
  try {
    report = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return { path: relativePath, stamped: false, reason: 'invalid_json' };
  }
  if (!report || typeof report !== 'object') return { path: relativePath, stamped: false, reason: 'invalid_object' };

  // ── ARTEFATO AUTO-REFERENCIAL (P0 medido 2026-10-17) ────────────────────────
  //
  // DEFEITO: `qa/qa-waves-enterprise-governance.json` embute `reportHash` (sha256
  // do próprio conteúdo) e `enterpriseGovernanceSignature` (HMAC sobre o próprio
  // conteúdo). O produtor
  // (`tools/system/qa-waves-enterprise-governance-bridge.js`) JÁ resolve o lineage
  // na origem (`report.runId = readCurrentRunLineage().runId`). Este estampador
  // injetava runId/sourceFingerprint/artifactType/artifactVersion DEPOIS da
  // assinatura, e o resultado media-se assim:
  //   [replay-integrity] pass=false issues=1
  //     enterprise_replay_governance_invalid: qa_waves_enterprise_report_hash_invalid,
  //     qa_waves_enterprise_signature_invalid
  //   ✗ BLOQUEADO: Replay integrity falhou   (npm run zip:release)
  //
  // Regra: quem embute o próprio hash/assinatura NÃO pode ser reescrito por
  // estampagem. Se o lineage já é o do run, preserva-se o arquivo intacto; se o
  // lineage é de outro run, RECUSA-se (estampar quebraria a prova — reexecute o
  // produtor). Estampar aqui fabricaria uma prova que o próprio arquivo refuta.
  const CAMPOS_HASH_PROPRIO = ['reportHash', 'selfHash', 'contentHash', 'integrityHash'];
  const CAMPOS_ASSINATURA_PROPRIA = ['governanceSignature', 'enterpriseGovernanceSignature'];
  // REGRA TEMPORAL (missão 2026-10-05): generatedAt >= run.startedAt.
  //
  // O defeito real: `governance/mutable-json-state-validation-report.json` e
  // `governance/json-persistence-audit.json` foram gerados às 01:20 (ANTES do
  // run criado às 02:30) e, ainda assim, receberam o runId/sourceFingerprint do
  // run. Todas as outras checagens passavam (runId certo, fingerprint certo,
  // artifactType presente), então a única barreira capaz de barrar é o tempo.
  //
  // Sem esta guarda o stamp FABRICA autoridade: o artefato passava a parecer
  // produzido pelo run sem que nada tivesse rodado nele. Reexecute o produtor —
  // o caminho está em `producers` na taxonomia. NUNCA ajuste generatedAt.
  const generatedAtMs = report.generatedAt ? Date.parse(report.generatedAt) : NaN;
  const startedAtMs = runStartMs(run);
  // DEFERIMENTO DE FASE (mesma autoridade do `ensure`). Um artefato cujo produtor
  // PERTENCE a uma fase posterior (ex.: cadeia FINAL/DELIVERED, produzida no
  // empacotamento) ainda não pode existir agora: NÃO é prova vencida, é
  // `PENDING_PHASE`. Ele não é estampado (jamais recebe lineage do run sem ter
  // sido produzido nele) e NÃO reprova este passo. Medido 2026-10-05: os 9
  // artefatos da cadeia FINAL deferidos pelo passo 8.7 eram recusados aqui e
  // abortavam a convergência logo depois de o 8.7 passar — o falso bloqueio só
  // tinha mudado de passo.
  const producer = getProducer(relativePath);
  const producerStage = producerPhase(producer);
  const deferredNow = producer ? !producerDueNow(producer) : false;
  const deferredEntry = (detail) => ({
    path: relativePath,
    stamped: false,
    deferred: true,
    classification,
    reason: `deferred_to_${producerStage}`,
    detail,
  });
  if (!Number.isFinite(generatedAtMs)) {
    if (deferredNow) {
      return deferredEntry('sem prova temporal e produtor de fase posterior: será produzido (e estampado) na fase da cadeia');
    }
    return {
      path: relativePath,
      stamped: false,
      classification,
      reason: REASONS.REJECTED_STALE_ARTIFACT,
      detail: 'sem generatedAt válido: não há prova temporal, então não há lineage',
    };
  }
  if (startedAtMs !== null && generatedAtMs < startedAtMs) {
    if (deferredNow) {
      return deferredEntry('produtor de fase posterior ainda não é devido: a evidência nasce no empacotamento (fase FINAL/DELIVERED)');
    }
    return {
      path: relativePath,
      stamped: false,
      classification,
      reason: REASONS.REJECTED_STALE_ARTIFACT,
      artifactGeneratedAt: report.generatedAt,
      runStartedAt: run.started_at,
      producer,
      detail: 'artefato produzido ANTES do início do run: reexecute o produtor (nunca estampe)',
    };
  }

  const artifactType = report.artifactType || path.basename(relativePath, '.json');
  const artifactVersion = report.artifactVersion || '1.0.0';

  // Detecta auto-referência ANTES de qualquer escrita (ver bloco acima).
  const autoReferencial = artefatoAutoReferencial(report);

  if (autoReferencial) {
    const lineageNoRun = report.runId === run.run_id
      && report.sourceFingerprint === run.source_fingerprint;
    if (lineageNoRun) {
      return {
        path: relativePath,
        stamped: false,
        preserved: true,
        classification,
        reason: 'SELF_REFERENTIAL_LINEAGE_ALREADY_AT_SOURCE',
        detail: 'artefato embute o proprio hash/assinatura e ja traz o lineage do run: preservado byte a byte (estampar quebraria reportHash/assinatura)',
      };
    }
    return {
      path: relativePath,
      stamped: false,
      classification,
      reason: REASONS.REJECTED_STALE_ARTIFACT,
      detail: 'artefato auto-referencial com lineage de OUTRO run: reexecute o produtor (estampar destruiria o hash/assinatura que ele mesmo prova)',
    };
  }

  const next = {
    ...report,
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    // DEFEITO MEDIDO (2026-10-16): o estampador gravava runId e fingerprint e
    // NUNCA o commit. Como a decisão canônica exige `sourceCommit` como campo
    // OBRIGATÓRIO de identidade (governance/canonical-release-decision.js,
    // CAMPOS_IDENTIDADE_OBRIGATORIOS), os três relatórios finais ficavam com
    // identidade INCOMPLETA para sempre:
    //   identidade insuficiente: final_governance:INCOMPLETA:faltantes=sourceCommit
    //   (idem final_readiness e final_proof)  =>  decisão nunca podia ser GO.
    // O commit vem do RUN (fonte única), nunca do HEAD do worktree — o worktree
    // pode ter avançado depois do congelamento.
    sourceCommit: run.git_commit,
    generatedAt: report.generatedAt,
    artifactType,
    artifactVersion,
  };
  fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`);
  return { path: relativePath, stamped: true, classification };
}

async function main() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');

  // FAIL-CLOSED: identidade canônica exige runId + sourceCommit + sourceFingerprint.
  // Um run sem `git_commit` (medido em 2026-10-16 na base real: null) produziria
  // relatórios com identidade INCOMPLETA — estampar aqui fabricaria uma
  // identidade que não existe. A correção é recriar o run pelo caminho oficial
  // (`scripts/governance/create-governed-run.js`, que agora grava o commit).
  if (!run.git_commit) {
    throw new Error(
      'RUN_SEM_SOURCE_COMMIT: o run ' + run.run_id + ' não tem git_commit; a identidade canônica ' +
      'exige sourceCommit (runId + sourceCommit + sourceFingerprint). Recrie o run com o caminho ' +
      'oficial para que a estampagem tenha commit a propagar.'
    );
  }

  // FONTE ÚNICA da lista: a taxonomia (config/runtime-evidence-artifacts.json).
  // Manter a lista aqui criava um segundo registry, que divergia do classificado —
  // e foi justamente por isso que artefatos fora da taxonomia podiam ser estampados.
  const reports = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : listAuthoritativeArtifacts();

  const results = reports.map((relPath) => stamp(relPath, run));
  const stamped = results.filter((entry) => entry.stamped);
  const rejected = results.filter((entry) => entry.reason === REASONS.REJECTED_STALE_ARTIFACT);
  const deferred = results.filter((entry) => entry.deferred);
  const unclassified = results.filter((entry) => entry.reason === REASONS.UNCLASSIFIED_AUTHORITATIVE_ARTIFACT);

  const report = {
    artifactType: 'lineage-stamp-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    sourceCommit: run.git_commit,
    runStartedAt: run.started_at,
    totals: {
      considered: results.length,
      stamped: stamped.length,
      rejectedStale: rejected.length,
      deferredPhase: deferred.length,
      unclassified: unclassified.length,
    },
    rejected,
    deferred,
    unclassified,
    results,
  };
  fs.writeFileSync(
    path.join(process.cwd(), 'governance', 'lineage-stamp-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({
    runId: run.run_id,
    stamped: stamped.length,
    rejectedStale: rejected.length,
    deferredPhase: deferred.length,
    unclassified: unclassified.length,
  }));

  // FAIL-CLOSED: rejeição = existe evidência autoritativa produzida FORA do run
  // (ou sem classificação). O pipeline NÃO segue: reexecute o produtor (mapa
  // `producers` na taxonomia) — estampar aqui fabricaria a prova.
  if (rejected.length > 0 || unclassified.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));
}

module.exports = { stamp, artefatoAutoReferencial };
