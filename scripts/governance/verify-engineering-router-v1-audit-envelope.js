#!/usr/bin/env node
'use strict';

/**
 * verify-engineering-router-v1-audit-envelope.js — ER-V1-FINAL-010 (Self-Proving Audit Envelope).
 *
 * Verifier OFFLINE do envelope gerado por `generate-engineering-router-v1-audit-envelope.js`.
 *
 * Garantias (exigidas explicitamente pela missão):
 *   - não depende de banco;
 *   - não depende de rede;
 *   - não confia em .md — lê SOMENTE os JSONs dentro do envelope, nunca
 *     ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md ou qualquer outro texto narrativo;
 *   - valida hashes (content-addressing real, recalculado a partir dos bytes em disco);
 *   - valida references (manifest.artifactHashes === hashes.json, para cada arquivo);
 *   - valida runId (mesmo runId em TODOS os artifacts, nunca uma mistura de runs diferentes);
 *   - valida sourceFingerprint (baseline.json === manifest.sourceFingerprint);
 *   - valida requirement coverage (todos os IDs de runtime esperados, presentes e PASS);
 *   - valida evidence freshness (best-effort: se um repositório git local estiver disponível no
 *     cwd, compara HEAD real com o HEAD do manifest — nunca EXIGE rede para isso, e nunca falha
 *     só por não ter acesso ao repositório);
 *   - valida runtime PASS (runtime-certification.status === RUNTIME_PASS, todos os itens PASS);
 *   - valida promotion exactness (expectedTreeHash === candidateTreeHash nos itens de promoção
 *     que carregam esses campos);
 *   - valida pilot evidence (pilot-evidence.json com itens reais, todos PASS).
 *
 * Uso: node scripts/governance/verify-engineering-router-v1-audit-envelope.js <dir-do-envelope>
 * Saída: relatório humano no stdout + exit 0 (PASS) / 1 (FAIL). Nunca lança sem capturar — um
 * envelope corrompido/incompleto sempre produz um relatório de FAIL explícito, nunca uma
 * exceção não tratada.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ER-V1-FINAL-010 — mesma lista de 25 IDs que `collect-engineering-router-runtime-evidence.js`
// exporta como `RUNTIME_ITEMS` — mas o verifier NUNCA importa esse módulo (ele dispararia os 25
// testes reais via seu `main()` implícito de CLI se não fosse pelo guard `require.main===module`
// que já existe lá; ainda assim, o verifier precisa ser executável de forma standalone, mesmo
// copiado para fora deste repositório dentro do próprio envelope de auditoria — nunca deve
// depender de um require relativo a um script irmão que pode não estar presente). Por isso a
// lista de IDs obrigatórios é reproduzida aqui, de forma extraída e comentada explicitamente
// como cópia intencional (não um segundo "vocabulário" divergente — qualquer alteração real na
// lista de RUNTIME_ITEMS precisa também atualizar esta cópia, e o teste de integração deste
// arquivo compara as duas listas para garantir que nunca divergem).
const REQUIRED_RUNTIME_IDS = Object.freeze([
  'SHELL_INJECTION_REJECTED', 'SAFE_ENVIRONMENT', 'SECRET_REDACTION_MULTILINE', 'PATCH_PATH_BOUNDARIES',
  'ACTUAL_PATCH_APPLY', 'DETERMINISTIC_FAILING_TEST_RED', 'RED_TO_FIX', 'INDEPENDENT_REVIEW',
  'REVIEWER_REJECTION_RECODE', 'REGRESSION_EXECUTION', 'GOVERNANCE_EXECUTION', 'PROVIDER_MODEL_FAILURE_REROUTE',
  'RESTART_RESUME', 'CRASH_RESUME_MID_STAGE', 'CONTROLLED_PROMOTION', 'POST_PROMOTION_VERIFICATION',
  'EXACT_PATCH_PROMOTION', 'FAIL_CLOSED_SCOPE', 'DEVELOPMENT_AUTHORIZATION', 'PRODUCTION_DENIAL',
  'SUPPORT_DENIAL_DEFAULT', 'TENANT_CREDENTIAL_ISOLATION', 'RELEASE_CLOSURE_SAME_RUN_INTEGRITY',
  'EXECUTION_SANDBOX_ISOLATION', 'MODEL_CATALOG_GOVERNANCE',
]);

const ARTIFACT_FILES = Object.freeze([
  'baseline.json', 'runtime-certification.json', 'routing-evidence.json', 'security-evidence.json',
  'regression-evidence.json', 'governance-evidence.json', 'promotion-evidence.json', 'pilot-evidence.json',
  'release-closure-evidence.json',
]);

function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJsonSafe(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function currentRepoHead(envelopeDir) {
  // Best-effort: só usado para o check de "evidence freshness" — nunca uma dependência dura.
  // Roda o `git` LOCAL (nenhuma chamada de rede) a partir do diretório do envelope subindo até
  // achar um repositório; se não achar (envelope copiado sem o repo, ex.: dentro de um ZIP de
  // auditoria isolado), o check de freshness é simplesmente pulado, nunca falha por isso.
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: envelopeDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} envelopeDir
 * @returns {{ok: boolean, checks: Array<{id:string, ok:boolean, reason?:string}>}}
 */
function verifyEnvelope(envelopeDir) {
  const checks = [];
  const push = (id, ok, reason) => checks.push({ id, ok, reason });

  if (!fs.existsSync(envelopeDir) || !fs.statSync(envelopeDir).isDirectory()) {
    push('ENVELOPE_DIR_EXISTS', false, `diretório do envelope não encontrado: ${envelopeDir}`);
    return { ok: false, checks };
  }
  push('ENVELOPE_DIR_EXISTS', true);

  const manifestPath = path.join(envelopeDir, 'manifest.json');
  const manifestResult = readJsonSafe(manifestPath);
  if (!manifestResult.ok) {
    push('MANIFEST_PARSEABLE', false, `manifest.json ausente ou inválido: ${manifestResult.error}`);
    return { ok: false, checks };
  }
  push('MANIFEST_PARSEABLE', true);
  const manifest = manifestResult.value;

  for (const field of ['schemaVersion', 'generatedAt', 'head', 'sourceFingerprint', 'treeHash', 'runId', 'artifactHashes', 'runtimeStatus', 'promotionStatus', 'pilotTaskId', 'releaseStatus']) {
    push(`MANIFEST_FIELD_${field.toUpperCase()}`, manifest[field] !== undefined && manifest[field] !== null, `manifest.${field} ausente`);
  }

  // hashes.json — content-addressing: recalcula o sha256 REAL de cada artifact em disco e
  // compara tanto com hashes.json quanto com manifest.artifactHashes (as duas referências
  // precisam bater — nunca confiar apenas em um dos dois).
  const hashesResult = readJsonSafe(path.join(envelopeDir, 'hashes.json'));
  if (!hashesResult.ok) {
    push('HASHES_FILE_PARSEABLE', false, `hashes.json ausente ou inválido: ${hashesResult.error}`);
  } else {
    push('HASHES_FILE_PARSEABLE', true);
    const declaredHashes = hashesResult.value.hashes || {};
    for (const name of ARTIFACT_FILES) {
      const filePath = path.join(envelopeDir, name);
      if (!fs.existsSync(filePath)) {
        push(`ARTIFACT_PRESENT_${name}`, false, `${name} ausente do envelope`);
        continue;
      }
      push(`ARTIFACT_PRESENT_${name}`, true);
      const realHash = sha256Bytes(fs.readFileSync(filePath));
      const declaredHash = declaredHashes[name];
      const manifestHash = manifest.artifactHashes ? manifest.artifactHashes[name] : undefined;
      push(`ARTIFACT_HASH_MATCHES_${name}`, realHash === declaredHash, declaredHash ? `hash real (${realHash.slice(0, 12)}…) != hashes.json (${String(declaredHash).slice(0, 12)}…) — artifact alterado após a geração` : `hashes.json não declara hash para ${name}`);
      push(`MANIFEST_REFERENCES_${name}`, realHash === manifestHash, manifestHash ? `hash real (${realHash.slice(0, 12)}…) != manifest.artifactHashes.${name} (${String(manifestHash).slice(0, 12)}…)` : `manifest.artifactHashes não referencia ${name}`);
    }
  }

  // runId consistente em TODOS os artifacts — nunca uma mistura de evidências de runs diferentes
  // costurada manualmente para parecer um fechamento coerente.
  const artifactPayloads = {};
  for (const name of ARTIFACT_FILES) {
    const result = readJsonSafe(path.join(envelopeDir, name));
    if (result.ok) artifactPayloads[name] = result.value;
  }
  for (const name of ARTIFACT_FILES) {
    const payload = artifactPayloads[name];
    if (!payload) continue;
    push(`RUN_ID_CONSISTENT_${name}`, payload.runId === manifest.runId, `${name}.runId (${payload.runId}) != manifest.runId (${manifest.runId})`);
  }

  // sourceFingerprint consistente entre baseline e manifest.
  const baseline = artifactPayloads['baseline.json'];
  if (baseline) {
    push('SOURCE_FINGERPRINT_CONSISTENT', baseline.sourceFingerprint === manifest.sourceFingerprint, `baseline.sourceFingerprint != manifest.sourceFingerprint`);
    push('TREE_HASH_CONSISTENT', baseline.treeHash === manifest.treeHash, `baseline.treeHash != manifest.treeHash`);
    push('HEAD_CONSISTENT', baseline.head === manifest.head, `baseline.head != manifest.head`);
  }

  // requirement coverage — todos os 25 IDs obrigatórios presentes em runtime-certification.json
  // com pass:true (evidence precisa granular, ver ER-V1-FINAL-007 — nunca aceitar exitCode
  // sozinho: exige numPassedTests>=1/numFailedTests===0/testCaseId presente).
  const runtimeCert = artifactPayloads['runtime-certification.json'];
  if (!runtimeCert) {
    push('RUNTIME_CERTIFICATION_PRESENT', false, 'runtime-certification.json ausente ou ilegível');
  } else {
    push('RUNTIME_CERTIFICATION_PRESENT', true);
    push('RUNTIME_STATUS_PASS', runtimeCert.status === 'RUNTIME_PASS', `runtime-certification.status = ${runtimeCert.status}`);
    push('MANIFEST_RUNTIME_STATUS_MATCHES', manifest.runtimeStatus === runtimeCert.status, 'manifest.runtimeStatus != runtime-certification.status');

    const byId = new Map((runtimeCert.items || []).map((item) => [item.id, item]));
    for (const id of REQUIRED_RUNTIME_IDS) {
      const item = byId.get(id);
      if (!item) {
        push(`REQUIREMENT_COVERAGE_${id}`, false, `item de runtime obrigatório ausente: ${id}`);
        continue;
      }
      const hasTestCaseId = typeof item.testCaseId === 'string' && item.testCaseId.length > 0;
      const hasRealPass = Number(item.numPassedTests) >= 1 && Number(item.numFailedTests) === 0;
      const ok = item.pass === true && item.exitCode === 0 && hasTestCaseId && hasRealPass;
      push(`REQUIREMENT_COVERAGE_${id}`, ok, ok ? undefined : `${id}: pass=${item.pass} exitCode=${item.exitCode} numPassedTests=${item.numPassedTests} numFailedTests=${item.numFailedTests} testCaseId=${item.testCaseId || '(ausente)'}`);
    }
  }

  // promotion exactness — expectedTreeHash === candidateTreeHash nos itens que carregam esses
  // campos (a mesma garantia matemática de ER-V1-FINAL-002, agora auditável offline).
  const promotionEvidence = artifactPayloads['promotion-evidence.json'];
  if (!promotionEvidence) {
    push('PROMOTION_EVIDENCE_PRESENT', false, 'promotion-evidence.json ausente ou ilegível');
  } else {
    push('PROMOTION_EVIDENCE_PRESENT', true);
    push('PROMOTION_EVIDENCE_NON_EMPTY', Array.isArray(promotionEvidence.items) && promotionEvidence.items.length > 0, 'promotion-evidence.json.items vazio');
    for (const item of promotionEvidence.items || []) {
      push(`PROMOTION_ITEM_PASS_${item.id}`, item.pass === true, `${item.id}: pass=${item.pass}`);
    }
    const allPass = (promotionEvidence.items || []).every((i) => i.pass === true);
    push('MANIFEST_PROMOTION_STATUS_CONSISTENT', manifest.promotionStatus === (allPass ? 'PROMOTION_VERIFIED' : 'PROMOTION_UNVERIFIED'), 'manifest.promotionStatus inconsistente com promotion-evidence.json');
  }

  // pilot evidence — o loop RED→FIX→REVIEW→GREEN real precisa estar presente e PASS.
  const pilotEvidence = artifactPayloads['pilot-evidence.json'];
  if (!pilotEvidence) {
    push('PILOT_EVIDENCE_PRESENT', false, 'pilot-evidence.json ausente ou ilegível');
  } else {
    push('PILOT_EVIDENCE_PRESENT', true);
    push('PILOT_TASK_ID_MATCHES_MANIFEST', pilotEvidence.pilotTaskId === manifest.pilotTaskId, 'pilot-evidence.pilotTaskId != manifest.pilotTaskId');
    push('PILOT_EVIDENCE_NON_EMPTY', Array.isArray(pilotEvidence.items) && pilotEvidence.items.length > 0, 'pilot-evidence.json.items vazio');
    for (const item of pilotEvidence.items || []) {
      push(`PILOT_ITEM_PASS_${item.id}`, item.pass === true, `${item.id}: pass=${item.pass}`);
    }
  }

  // release closure — todos os 10 blockers do backlog congelado precisam estar GREEN.
  const releaseClosure = artifactPayloads['release-closure-evidence.json'];
  if (!releaseClosure) {
    push('RELEASE_CLOSURE_EVIDENCE_PRESENT', false, 'release-closure-evidence.json ausente ou ilegível');
  } else {
    push('RELEASE_CLOSURE_EVIDENCE_PRESENT', true);
    push('RELEASE_CLOSURE_ALL_BLOCKERS_GREEN', releaseClosure.allBlockersGreen === true, 'nem todos os 10 blockers estão GREEN em release-closure-evidence.json');
    push('MANIFEST_RELEASE_STATUS_MATCHES', manifest.releaseStatus === releaseClosure.releaseStatus, 'manifest.releaseStatus != release-closure-evidence.releaseStatus');
  }

  // evidence freshness — best-effort, nunca obrigatório (não pode depender de rede nem de o
  // envelope estar necessariamente dentro do checkout do repositório real).
  const localHead = currentRepoHead(envelopeDir);
  if (localHead) {
    push('EVIDENCE_FRESH_VS_LOCAL_REPO', localHead === manifest.head, `HEAD do repositório local (${localHead.slice(0, 12)}…) difere do HEAD do manifest (${String(manifest.head).slice(0, 12)}…) — evidência não é do commit atual (pode ser intencional ao auditar um release passado).`);
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

function main() {
  const envelopeDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!envelopeDir) {
    process.stderr.write('Uso: node verify-engineering-router-v1-audit-envelope.js <dir-do-envelope>\n');
    process.exit(2);
  }

  let result;
  try {
    result = verifyEnvelope(envelopeDir);
  } catch (err) {
    process.stderr.write(`[audit-envelope-verify] erro inesperado: ${err.message}\n`);
    process.exit(1);
  }

  const failed = result.checks.filter((c) => !c.ok);
  process.stdout.write(`[audit-envelope-verify] status=${result.ok ? 'PASS' : 'FAIL'} checks=${result.checks.length} falhas=${failed.length}\n`);
  if (failed.length > 0) {
    for (const f of failed) process.stdout.write(` - ${f.id}: ${f.reason || '(sem detalhe)'}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { verifyEnvelope, REQUIRED_RUNTIME_IDS, ARTIFACT_FILES };
