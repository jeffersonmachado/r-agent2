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

// ER-V1-SEAL-004: 5 arquivos novos (source-fingerprint, runtime-requirements,
// structural-certification, sandbox-evidence, resume-evidence) — sandbox/resume extraídas de
// dentro de security/routing para artifacts próprios (mesmos dados, nunca uma segunda fonte).
const ARTIFACT_FILES = Object.freeze([
  'baseline.json', 'source-fingerprint.json', 'runtime-requirements.json', 'runtime-certification.json',
  'structural-certification.json', 'routing-evidence.json', 'security-evidence.json', 'sandbox-evidence.json',
  'resume-evidence.json', 'regression-evidence.json', 'governance-evidence.json', 'promotion-evidence.json',
  'pilot-evidence.json', 'release-closure-evidence.json',
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

  for (const field of ['schemaVersion', 'generatedAt', 'head', 'sourceFingerprint', 'treeHash', 'runId', 'runtimeRunId', 'governanceRunId', 'artifactHashes', 'runtimeStatus', 'structuralStatus', 'promotionStatus', 'pilotTaskId', 'releaseStatus', 'finalDecision', 'expectedArtifacts']) {
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

  // ER-V1-SEAL-004 — source-fingerprint.json precisa bater exatamente com baseline/manifest (é o
  // mesmo valor, extraído para um artifact próprio e content-addressed — uma troca isolada deste
  // arquivo sem atualizar os outros dois é sinal de adulteração, nunca aceita silenciosamente).
  const sourceFingerprintArtifact = artifactPayloads['source-fingerprint.json'];
  if (sourceFingerprintArtifact) {
    push('SOURCE_FINGERPRINT_ARTIFACT_CONSISTENT', sourceFingerprintArtifact.sourceFingerprint === manifest.sourceFingerprint, 'source-fingerprint.json.sourceFingerprint != manifest.sourceFingerprint');
  }

  // ER-V1-SEAL-004 — runtime-requirements.json precisa listar EXATAMENTE o mesmo conjunto de IDs
  // obrigatórios que este verifier exige (REQUIRED_RUNTIME_IDS) — nunca um subconjunto menor
  // fabricado para passar cobertura sem provar todos os requisitos reais.
  const runtimeRequirements = artifactPayloads['runtime-requirements.json'];
  if (!runtimeRequirements) {
    push('RUNTIME_REQUIREMENTS_PRESENT', false, 'runtime-requirements.json ausente ou ilegível');
  } else {
    push('RUNTIME_REQUIREMENTS_PRESENT', true);
    const declaredIds = new Set(runtimeRequirements.requiredIds || []);
    const expectedIds = new Set(REQUIRED_RUNTIME_IDS);
    const missing = [...expectedIds].filter((id) => !declaredIds.has(id));
    const extra = [...declaredIds].filter((id) => !expectedIds.has(id));
    push('RUNTIME_REQUIREMENTS_MATCH_REQUIRED_IDS', missing.length === 0 && extra.length === 0, `runtime-requirements.json diverge do REQUIRED_RUNTIME_IDS deste verifier (faltando: ${missing.join(',') || '-'}; a mais: ${extra.join(',') || '-'})`);
  }

  // ER-V1-SEAL-004 — structural-certification.json precisa provar PASS estrutural+runtime.
  const structuralCertification = artifactPayloads['structural-certification.json'];
  if (!structuralCertification) {
    push('STRUCTURAL_CERTIFICATION_PRESENT', false, 'structural-certification.json ausente ou ilegível');
  } else {
    push('STRUCTURAL_CERTIFICATION_PRESENT', true);
    push('STRUCTURAL_CERTIFICATION_PASS', structuralCertification.status === 'PASS', `structural-certification.status = ${structuralCertification.status}`);
    push('MANIFEST_STRUCTURAL_STATUS_MATCHES', manifest.structuralStatus === structuralCertification.status, 'manifest.structuralStatus != structural-certification.status');
  }

  // ER-V1-SEAL-004 — sandbox-evidence.json e resume-evidence.json precisam existir com itens
  // reais, todos PASS (mesma garantia de PROMOTION_ITEM_PASS/PILOT_ITEM_PASS, aplicada às duas
  // categorias que antes viviam misturadas dentro de security/routing).
  const sandboxEvidence = artifactPayloads['sandbox-evidence.json'];
  if (!sandboxEvidence) {
    push('SANDBOX_EVIDENCE_PRESENT', false, 'sandbox-evidence.json ausente ou ilegível');
  } else {
    push('SANDBOX_EVIDENCE_PRESENT', true);
    push('SANDBOX_EVIDENCE_NON_EMPTY', Array.isArray(sandboxEvidence.items) && sandboxEvidence.items.length > 0, 'sandbox-evidence.json.items vazio');
    for (const item of sandboxEvidence.items || []) {
      push(`SANDBOX_ITEM_PASS_${item.id}`, item.pass === true, `${item.id}: pass=${item.pass}`);
    }
  }
  const resumeEvidence = artifactPayloads['resume-evidence.json'];
  if (!resumeEvidence) {
    push('RESUME_EVIDENCE_PRESENT', false, 'resume-evidence.json ausente ou ilegível');
  } else {
    push('RESUME_EVIDENCE_PRESENT', true);
    push('RESUME_EVIDENCE_NON_EMPTY', Array.isArray(resumeEvidence.items) && resumeEvidence.items.length > 0, 'resume-evidence.json.items vazio');
    for (const item of resumeEvidence.items || []) {
      push(`RESUME_ITEM_PASS_${item.id}`, item.pass === true, `${item.id}: pass=${item.pass}`);
    }
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

  // final decision — o verifier recalcula de forma independente (nunca confia cegamente no
  // finalDecision gravado pelo gerador) a partir dos MESMOS três sinais que o gerador usa.
  if (releaseClosure && runtimeCert && structuralCertification) {
    const expectedDecision = (runtimeCert.status === 'RUNTIME_PASS' && structuralCertification.status === 'PASS' && releaseClosure.allBlockersGreen === true) ? 'GO' : 'NO_GO';
    push('FINAL_DECISION_RECOMPUTED_MATCHES', manifest.finalDecision === expectedDecision, `manifest.finalDecision (${manifest.finalDecision}) != recalculado (${expectedDecision})`);
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

// ER-V1-SEAL-004 — a spec pede um comando único que também verifique o envelope diretamente
// dentro de um ZIP de release já empacotado (onde `generate-zip.sh` o injeta em
// evidence/engineering-router-v1/, ver scripts/generate-zip.sh::copy_engineering_router_v1_audit_envelope).
// Extrai só essa subpasta para um tmpdir e reaproveita o MESMO `verifyEnvelope` — nunca uma
// segunda implementação de verificação para o caso "dentro de um zip".
function extractEnvelopeFromZip(zipPath) {
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engineering-router-v1-envelope-zip-'));
  execFileSync('unzip', ['-q', '-o', zipPath, '*/evidence/engineering-router-v1/*', '-d', tmpDir]);
  const rootEntries = fs.readdirSync(tmpDir);
  for (const entry of rootEntries) {
    const candidate = path.join(tmpDir, entry, 'evidence', 'engineering-router-v1');
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(tmpDir, 'evidence', 'engineering-router-v1');
}

function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    process.stderr.write('Uso: node verify-engineering-router-v1-audit-envelope.js <dir-do-envelope | arquivo.zip>\n');
    process.exit(2);
  }
  const inputPath = path.resolve(inputArg);

  let envelopeDir;
  if (inputPath.endsWith('.zip')) {
    if (!fs.existsSync(inputPath)) {
      process.stdout.write('[audit-envelope-verify] status=FAIL checks=1 falhas=1\n - ZIP_FILE_EXISTS: arquivo não encontrado\n');
      process.exit(1);
    }
    try {
      envelopeDir = extractEnvelopeFromZip(inputPath);
    } catch (err) {
      process.stdout.write(`[audit-envelope-verify] status=FAIL checks=1 falhas=1\n - ZIP_EXTRACTION_FAILED: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    envelopeDir = inputPath;
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
