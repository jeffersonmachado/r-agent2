#!/usr/bin/env node
'use strict';

/**
 * scorecard-evidence-proof.js — PROOF RECORDS das evidências que sustentam o
 * RAP Master Scorecard.
 *
 * DEFEITO MEDIDO (2026-10-05) no artefato ENTREGUE:
 *   evidências únicas referenciadas pelo Master Scorecard ....... 44
 *   presentes fisicamente no workspace .......................... 44
 *   com proof record no evidence-manifest do pacote .............  3
 *   sem NENHUMA prova offline ................................... 41
 * Ou seja: 78/78 era REPORTADO, mas 41 das 44 evidências que atribuem nota não
 * tinham como ser conferidas por quem recebeu o pacote — o leitor tinha de
 * confiar no número. E o verifier offline, ao não encontrar o artefato,
 * executava `if (!exists) continue` e seguia em silêncio.
 *
 * O QUE ESTE MÓDULO É. Um materializador de PROOF RECORDS — não um segundo
 * scorecard. O veredito NÃO é recalculado aqui: é LIDO do scorecard já avaliado
 * pelo engine canônico (`master-scorecard-engine.js`). Reimplementar o
 * julgamento criaria uma segunda autoridade que diverge — foi o que aconteceu na
 * primeira versão deste arquivo, que reprovou `status: true` (o engine normaliza
 * `true` → `PASS`) e tratou artefato de fase DELIVERED como reprovado em vez de
 * DEFERRED.
 *
 * Aqui só se ADICIONA o que faltava para a nota ser verificável offline: sha256,
 * classificação (taxonomia canônica), lineage e validade temporal.
 *
 * O MANIFEST CANÔNICO É A AUTORIDADE (não um arquivo paralelo): o resultado é
 * embutido em `governance/evidence-manifest.json` sob `scorecardEvidence`, o
 * mesmo artefato que o pacote já carrega e que o verifier já abre.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { MASTER_SCORECARD_REGISTRY } = require('../../../governance/master-scorecard-registry');
const { getModeForArtifact, AUTHORITATIVE_MODES } = require('./runtime-evidence-artifacts');

const ARTIFACT_TYPE = 'scorecard-evidence-proof';
const ARTIFACT_VERSION = '1.0.0';

/**
 * ARTEFATO PORTADOR. O proof set é embutido no `evidence-manifest.json` (uma só
 * autoridade — nada de arquivo paralelo), mas isso torna o manifest IMPOSSÍVEL de
 * ser prova de si mesmo por hash de bytes: o sha256 gravado dentro dele nunca
 * poderia igualar o sha256 do arquivo que o contém (medido em 2026-10-06: hash
 * antes do write ≠ hash depois, por construção).
 *
 * A saída NÃO é abrir exceção silenciosa nem declarar `embedsOwnHash: true` (que
 * `governance/release-dag.js` proíbe explicitamente como
 * RELEASE_SELF_REFERENTIAL_ARTIFACT). A saída é uma PROJEÇÃO AUTO-EXCLUDENTE,
 * declarada e reproduzível: para este único caminho, o que se vincula é o manifest
 * SEM a subárvore `scorecardEvidence` — serializado pelo MESMO escritor canônico.
 * O que sobra (runId, sourceFingerprint, fingerprints, artifacts[] com hash
 * físico) é exatamente o que a nota precisa que seja conferível, e continua
 * criptograficamente ligado aos bytes.
 *
 * A projeção é verificada pelo MESMO código nos dois lados (produtor e §10 do
 * verifier offline, que importa este módulo do payload): a autoridade é uma só.
 */
const SELF_CARRIER_PATH = 'governance/evidence-manifest.json';
const BINDING_FILE_BYTES = 'FILE_BYTES';
const BINDING_SELF_PROJECTION = 'SELF_PROJECTION_EXCLUDING_SCORECARD_EVIDENCE';

/** Serializador canônico: idêntico ao escritor canônico do manifest. */
function serializeManifest(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

/** O manifest sem o próprio proof set. */
function selfCarrierProjection(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const { scorecardEvidence: _excluded, ...rest } = manifest;
  return serializeManifest(rest);
}

/**
 * Liga uma evidência aos BYTES que a representam. Para o artefato portador,
 * projeta o manifest sem o proof set; para todos os demais, o arquivo físico.
 *
 * @returns {{sha256:string|null, bindingKind:string|null}}
 */
function evidenceBinding({ rootDir, relPath, manifestForCarrier = null } = {}) {
  if (relPath === SELF_CARRIER_PATH) {
    const projection = selfCarrierProjection(manifestForCarrier);
    if (!projection) return { sha256: null, bindingKind: null };
    return {
      sha256: crypto.createHash('sha256').update(projection).digest('hex'),
      bindingKind: BINDING_SELF_PROJECTION,
    };
  }
  const absPath = path.join(rootDir, relPath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return { sha256: null, bindingKind: null };
  return { sha256: sha256File(absPath), bindingKind: BINDING_FILE_BYTES };
}

/** Status de requisito do engine que contam como prova ACEITA para a nota. */
const ACCEPTED_REQUIREMENT_STATUSES = Object.freeze(['PASS', 'DEFERRED']);

/**
 * Evidências que são SAÍDA do próprio verifier — usá-las como prova do veredito
 * é auto-referência.
 *
 * DEFEITO MEDIDO (2026-10-06, ciclo do selo): uma execução do
 * `verify:delivered-release` falhou (por um motivo já corrigido) e gravou
 * `DELIVERED_RELEASE_NO_GO` em `governance/delivered-release-verification-report.json`.
 * Esse arquivo é evidência de RAP-055/RAP-056, então o proof set o marcava como
 * `SCORECARD_EVIDENCE_NOT_ACCEPTED`; o verifier reprovava **por causa do próprio
 * resultado anterior** e nunca mais conseguia passar — laço fechado, onde repetir
 * o ciclo reproduzia exatamente o mesmo estado.
 *
 * O que continua valendo (nada é afrouxado): o verifier segue validando o pacote
 * entregue de verdade (payload, hashes, assinatura, self-proving). O que deixa de
 * existir é usar o veredito do verifier como PROVA do veredito do verifier.
 * O registro permanece no proof set com o `result` original — nada é apagado,
 * só não veta —, marcado como `selfProduced` para ser auditável.
 */
const SELF_PRODUCED_EVIDENCE = Object.freeze([
  'governance/delivered-release-verification-report.json',
]);

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function sha256File(absPath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch (_) {
    return null;
  }
}

/** Indexa o veredito canônico do engine por `dimensionId|requirementId`. */
function indexScorecardVerdicts(scorecard) {
  const index = new Map();
  for (const dimension of scorecard?.dimensions || []) {
    for (const requirement of dimension.requirements || []) {
      index.set(`${dimension.id}|${requirement.id}`, {
        status: requirement.status,
        reason: requirement.reason,
        code: requirement.code || null,
        score: dimension.score,
        gaps: (dimension.gaps || []).length,
        blockers: (dimension.blockers || []).length,
      });
    }
  }
  return index;
}

/**
 * Enumera as evidências tipo-artefato usadas para decidir, a partir do registry
 * canônico (fonte única — nada é re-listado aqui).
 *
 * @returns {Array<{dimensionId:string, requirementId:string, category:string, path:string}>}
 */
function listScorecardEvidence(registry = MASTER_SCORECARD_REGISTRY) {
  const entries = new Map();
  for (const dimension of registry) {
    if (dimension.applicable === false) continue;
    for (const requirement of dimension.requirements || []) {
      for (const evidence of requirement.evidence || []) {
        if (evidence && evidence.type === 'current_artifact' && evidence.path) {
          const key = `${dimension.id}|${requirement.id}|${evidence.path}`;
          if (!entries.has(key)) {
            entries.set(key, {
              dimensionId: dimension.id,
              requirementId: requirement.id,
              category: requirement.category,
              path: evidence.path,
            });
          }
        }
      }
    }
  }
  return [...entries.values()];
}

/**
 * Constrói os proof records, casando cada evidência declarada com o veredito que
 * o engine ATRIBUIU ao requisito correspondente.
 *
 * @param {{rootDir:string, runContext?:object, scorecard?:object, registry?:Array, now?:() => Date}} input
 */
function buildScorecardEvidenceProof({ rootDir, runContext = null, scorecard = null, registry = MASTER_SCORECARD_REGISTRY, now = () => new Date(), manifestForCarrier = null } = {}) {
  const runStartedAt = runContext?.startedAt || runContext?.createdAt || null;
  const runId = runContext?.runId || null;
  const sourceFingerprint = runContext?.sourceFingerprint || null;
  const runStartedMs = runStartedAt ? Date.parse(runStartedAt) : NaN;
  const verdicts = indexScorecardVerdicts(scorecard);

  const records = listScorecardEvidence(registry).map((entry) => {
    const absPath = path.join(rootDir, entry.path);
    const exists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
    const artifact = exists ? readJsonSafe(absPath) : null;
    const binding = evidenceBinding({ rootDir, relPath: entry.path, manifestForCarrier });

    let classification = null;
    try {
      classification = getModeForArtifact(entry.path);
    } catch (_) {
      classification = null;
    }

    const verdict = verdicts.get(`${entry.dimensionId}|${entry.requirementId}`) || null;
    const generatedAt = artifact?.generatedAt || artifact?.generated_at || null;
    const generatedMs = generatedAt ? Date.parse(generatedAt) : NaN;
    // Meta-verificação não é prova de si mesma (ver SELF_PRODUCED_EVIDENCE): o
    // registro é mantido com o resultado REAL, mas não veta o veredito.
    const selfProduced = SELF_PRODUCED_EVIDENCE.includes(entry.path);

    return {
      dimensionId: entry.dimensionId,
      requirementId: entry.requirementId,
      category: entry.category,
      path: entry.path,
      classification,
      classificationAuthoritative: classification ? AUTHORITATIVE_MODES.includes(classification) : false,
      exists,
      sha256: binding.sha256,
      bindingKind: binding.bindingKind,
      result: verdict?.status || null,
      resultAccepted: selfProduced ? true : (verdict ? ACCEPTED_REQUIREMENT_STATUSES.includes(verdict.status) : false),
      selfProduced,
      reason: verdict?.reason || null,
      dimensionScore: verdict?.score ?? null,
      generatedAt,
      artifactRunId: artifact?.runId || null,
      artifactSourceFingerprint: artifact?.sourceFingerprint || null,
      temporalValidity: Number.isFinite(generatedMs) && Number.isFinite(runStartedMs)
        ? (generatedMs >= runStartedMs ? 'SAME_RUN' : 'PRE_RUN')
        : 'UNKNOWN',
    };
  });

  const summary = {
    total: records.length,
    missing: records.filter((r) => !r.exists).length,
    preRun: records.filter((r) => r.temporalValidity === 'PRE_RUN').length,
    unknownTemporal: records.filter((r) => r.temporalValidity === 'UNKNOWN').length,
    unclassified: records.filter((r) => !r.classificationAuthoritative).length,
    notAccepted: records.filter((r) => !r.resultAccepted).length,
    withoutVerdict: records.filter((r) => r.result === null).length,
    dimensionsCovered: new Set(records.map((r) => r.dimensionId)).size,
  };

  return {
    artifactType: ARTIFACT_TYPE,
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: now().toISOString(),
    runId,
    sourceFingerprint,
    runStartedAt,
    total: records.length,
    summary,
    records,
  };
}

/**
 * MATERIALIZADOR ÚNICO do proof set.
 *
 * DEFEITO MEDIDO (2026-10-06, ciclo do selo): o proof set era construído por
 * `platform-readiness` (dentro do converge) e o `evidence-manifest.json` era
 * reescrito DEPOIS por `export-governance-artifacts` — que, sendo projeção
 * DB→JSON, zerava o campo `scorecardEvidence`. Resultado: o verifier do artefato
 * entregue reprovava com `SCORECARD_EVIDENCE_PROOF_MISSING` (0 provas) e a nota
 * 78/78 voltava a ser um número a ser acreditado.
 *
 * Além do clobber, a ORDEM estava errada: o proof set era gerado antes de ~30
 * evidências declaradas serem reescritas (projeções/fixpoint do scorecard), então
 * os sha256 gravados não correspondiam aos bytes finais — o binding offline
 * (`scripts/verify-enterprise-governance-v2.sh` §10) reprovaria por
 * `SCORECARD_EVIDENCE_HASH_MISMATCH`. A materialização tem de acontecer quando os
 * bytes finais já existem.
 *
 * Este é o único ponto de materialização: quem escreve o manifest por último
 * chama esta função. Ela NÃO julga nada de novo — constrói os registros e anexa o
 * veredito da MESMA autoridade (`assessScorecardEvidenceProof`).
 *
 * @param {{rootDir:string, runContext?:object, scorecard?:object, registry?:Array, now?:() => Date}} input
 * @returns {object} proof set pronto para `manifest.scorecardEvidence`
 */
function materializeScorecardEvidence({ rootDir, runContext = null, scorecard = null, registry = MASTER_SCORECARD_REGISTRY, now = () => new Date(), manifestForCarrier = null } = {}) {
  try {
    const proofSet = buildScorecardEvidenceProof({ rootDir, runContext, scorecard, registry, now, manifestForCarrier });
    const verdict = assessScorecardEvidenceProof(proofSet);
    return {
      ...proofSet,
      verdict: {
        ok: verdict.ok,
        checked: verdict.checked,
        violations: verdict.violations.slice(0, 50),
        violationCount: verdict.violations.length,
      },
    };
  } catch (error) {
    // Falha de plumbing não pode virar ausência silenciosa: o proof set entra
    // marcado como inválido e o verifier reprova por MISSING/EMPTY.
    return {
      artifactType: ARTIFACT_TYPE,
      artifactVersion: ARTIFACT_VERSION,
      generatedAt: now().toISOString(),
      runId: runContext?.runId || null,
      sourceFingerprint: runContext?.sourceFingerprint || null,
      runStartedAt: runContext?.startedAt || null,
      total: 0,
      summary: {},
      records: [],
      verdict: {
        ok: false,
        checked: 0,
        violations: [{ code: 'SCORECARD_EVIDENCE_PROOF_BUILD_FAILED', path: '-', detail: String((error && error.message) || error) }],
        violationCount: 1,
      },
    };
  }
}

/**
 * Julga um proof set. PURO (não toca disco) — é o MESMO critério que o verifier
 * offline aplica no payload, para que produtor e consumidor não possam divergir.
 *
 * @returns {{ok:boolean, violations:Array<{code:string,path:string,detail:string}>, checked:number}}
 */
function assessScorecardEvidenceProof(proof) {
  if (!proof || typeof proof !== 'object') {
    return { ok: false, violations: [{ code: 'SCORECARD_EVIDENCE_PROOF_MISSING', path: '-', detail: 'proof set ausente' }], checked: 0 };
  }
  const records = Array.isArray(proof.records) ? proof.records : [];
  if (records.length === 0) {
    return { ok: false, violations: [{ code: 'SCORECARD_EVIDENCE_PROOF_EMPTY', path: '-', detail: 'proof set sem registros' }], checked: 0 };
  }

  const violations = [];
  const runStartedMs = proof.runStartedAt ? Date.parse(proof.runStartedAt) : NaN;
  if (!Number.isFinite(runStartedMs)) {
    violations.push({ code: 'SCORECARD_EVIDENCE_RUN_START_UNKNOWN', path: '-', detail: `runStartedAt=${proof.runStartedAt}` });
  }

  for (const record of records) {
    // A ausência de prova é FAIL, nunca `continue`: era exatamente esse o
    // comportamento que deixava o scorecard inauditável offline.
    if (!record.exists) {
      violations.push({ code: 'SCORECARD_EVIDENCE_MISSING', path: record.path, detail: `${record.dimensionId}/${record.requirementId}` });
      continue;
    }
    if (!record.sha256) {
      violations.push({ code: 'SCORECARD_EVIDENCE_HASH_MISSING', path: record.path, detail: 'sem sha256' });
    }
    // Guarda adversarial: `bindingKind` diferente de FILE_BYTES só é legítimo no
    // artefato PORTADOR (único caso em que o hash de bytes é impossível). Marcar
    // outro caminho assim tentaria escapar do binding criptográfico.
    if (record.bindingKind && record.bindingKind !== BINDING_FILE_BYTES && record.path !== SELF_CARRIER_PATH) {
      violations.push({ code: 'SCORECARD_EVIDENCE_BINDING_KIND_FORGED', path: record.path, detail: `bindingKind=${record.bindingKind}` });
    }
    if (record.path === SELF_CARRIER_PATH && record.bindingKind !== BINDING_SELF_PROJECTION) {
      violations.push({ code: 'SCORECARD_EVIDENCE_CARRIER_UNBOUND', path: record.path, detail: `bindingKind=${record.bindingKind}` });
    }
    if (!record.classification) {
      violations.push({ code: 'SCORECARD_EVIDENCE_UNCLASSIFIED', path: record.path, detail: 'sem classificação na taxonomia canônica' });
    } else if (!record.classificationAuthoritative) {
      violations.push({ code: 'SCORECARD_EVIDENCE_NOT_AUTHORITATIVE', path: record.path, detail: `classification=${record.classification}` });
    }
    if (record.temporalValidity === 'PRE_RUN') {
      violations.push({ code: 'STALE_ARTIFACT', path: record.path, detail: `generatedAt=${record.generatedAt} < runStartedAt=${proof.runStartedAt}` });
    } else if (record.temporalValidity === 'UNKNOWN') {
      violations.push({ code: 'SCORECARD_EVIDENCE_TEMPORAL_UNKNOWN', path: record.path, detail: 'generatedAt não comparável com o início do run' });
    }
    // O veredito precisa EXISTIR e ser aceito: nota sustentada por evidência sem
    // julgamento registrado é indistinguível de nota atribuída por engano.
    if (record.result === null || record.result === undefined) {
      violations.push({ code: 'SCORECARD_EVIDENCE_WITHOUT_VERDICT', path: record.path, detail: `${record.dimensionId}/${record.requirementId}` });
    } else if (!record.resultAccepted) {
      violations.push({ code: 'SCORECARD_EVIDENCE_NOT_ACCEPTED', path: record.path, detail: `result=${record.result}` });
    }
  }

  return { ok: violations.length === 0, violations, checked: records.length };
}

module.exports = {
  ARTIFACT_TYPE,
  ARTIFACT_VERSION,
  ACCEPTED_REQUIREMENT_STATUSES,
  SELF_CARRIER_PATH,
  BINDING_FILE_BYTES,
  BINDING_SELF_PROJECTION,
  serializeManifest,
  selfCarrierProjection,
  evidenceBinding,
  listScorecardEvidence,
  buildScorecardEvidenceProof,
  materializeScorecardEvidence,
  assessScorecardEvidenceProof,
};
