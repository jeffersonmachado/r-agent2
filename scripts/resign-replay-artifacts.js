#!/usr/bin/env node
'use strict';

/**
 * resign-replay-artifacts.js
 *
 * Migração de protocolo: reemite a `governanceSignature` de artefatos de replay
 * JÁ EXISTENTES após a correção do binding (2026-09-13).
 *
 * Contexto do defeito corrigido:
 *   `governanceMessage()` passava a mensagem assinada por `stable()`, e `stable()`
 *   remove as chaves de `INTEGRITY_FIELDS` — que incluem `replayHash`. O hash era
 *   descartado da mensagem e a assinatura HMAC cobria apenas
 *   `{ blockers, goNoGo, isOperational }`: ficava idêntica para artefatos
 *   diferentes e portável entre tenants. Evidência real:
 *   `qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json` tinha 9 fluxos
 *   com `replayHash` distintos e a MESMA `governanceSignature`.
 *
 * O que este script faz — e o que NÃO faz:
 *   - NÃO gera evidência. NÃO reexecuta smoke. NÃO altera conteúdo, `replayHash`,
 *     `replayChecksum`, `signedAt` nem a decisão de governança.
 *   - Verifica, para cada artefato, que o hash recomputado do conteúdo confere com
 *     o `replayHash` gravado (fail-closed) e só então reemite a assinatura com o
 *     algoritmo corrigido (que liga `replayHash` + `tenantId` + `environment`).
 *   - Se qualquer artefato falhar a verificação de conteúdo, ABORTA sem escrever.
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/resign-replay-artifacts.js [arquivos...]
 *
 * Sem argumentos, usa as evidências de replay conhecidas do repositório.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const {
  computeReplayHash,
  computeGovernanceSignature,
  validateReplayIntegrity,
} = require(path.join(ROOT, 'lib', 'replayIntegrity'));
const { writeJsonAtomic } = require(path.join(ROOT, 'api', 'utils', 'atomicJsonFile'));

const DEFAULT_TARGETS = [
  'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
  'qa/smoke/qa-waves-operational-final-smoke.json',
];

/**
 * Diretórios com replays gravados (artefato plano, não `flows[].replay`).
 * Em dev ficam sob o runtime local; em produção, sob o runtime do serviço.
 */
function defaultReplayDirs() {
  const os = require('os');
  const runtimeRoot = process.env.RAGENT2_RUNTIME_ROOT || path.join(os.homedir(), '.local/share/ragent2-runtime');
  return [
    path.join(runtimeRoot, 'rpa', 'replay'),
    path.join(runtimeRoot, 'replays'),
    path.join(runtimeRoot, 'recordings'),
  ];
}

const REPORT_PATH = path.join(ROOT, 'reports', 'replay-signature-migration-report.json');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function migrateFile(relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  const result = {
    file: relPath,
    exists: fs.existsSync(abs),
    sha256Before: null,
    sha256After: null,
    artifacts: [],
    migrated: 0,
    alreadyBound: 0,
    aborted: false,
    abortReason: null,
  };
  if (!result.exists) {
    result.aborted = true;
    result.abortReason = 'file_missing';
    return result;
  }
  result.sha256Before = sha256File(abs);

  let document;
  try {
    document = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (error) {
    result.aborted = true;
    result.abortReason = `invalid_json:${error.message}`;
    return result;
  }

  const flows = Array.isArray(document.flows) ? document.flows : [];
  const withReplay = flows.filter((flow) => flow && typeof flow === 'object' && flow.replay && typeof flow.replay === 'object');
  if (withReplay.length === 0) {
    result.aborted = true;
    result.abortReason = 'no_replay_artifacts';
    return result;
  }

  // Fase 1 — verificação integral do conteúdo, antes de qualquer escrita.
  for (const flow of withReplay) {
    const replay = flow.replay;
    const expectedHash = computeReplayHash(replay);
    const expectedChecksum = `sha256:${expectedHash}`;
    const integrity = replay.integrity || {};
    const problems = [];
    if (!replay.replayHash || replay.replayHash !== expectedHash) problems.push('replay_hash_mismatch');
    if (!replay.replayChecksum || replay.replayChecksum !== expectedChecksum) problems.push('replay_checksum_mismatch');
    if (!replay.governanceSignature) problems.push('governance_signature_missing');
    if (integrity.signatureAlgorithm !== 'hmac-sha256') problems.push('signature_algorithm_unsupported');
    if (!integrity.signedAt) problems.push('signed_at_missing');
    if (problems.length > 0) {
      result.aborted = true;
      result.abortReason = `content_verification_failed:${flow.journeyId || 'unknown'}:${problems.join('+')}`;
      return result;
    }
  }

  // Fase 2 — reemissão da assinatura (somente ela) para cada artefato.
  for (const flow of withReplay) {
    const replay = flow.replay;
    const previousSignature = replay.governanceSignature;
    const expectedSignature = computeGovernanceSignature(replay, replay.governance || flow.governance || {});
    const entry = {
      journeyId: flow.journeyId || null,
      replayHash: replay.replayHash,
      previousSignature,
      newSignature: expectedSignature,
      changed: previousSignature !== expectedSignature,
    };
    if (entry.changed) {
      replay.governanceSignature = expectedSignature;
      if (replay.integrity && typeof replay.integrity === 'object') {
        replay.integrity.governanceSignature = expectedSignature;
      }
      result.migrated += 1;
    } else {
      result.alreadyBound += 1;
    }
    result.artifacts.push(entry);
  }

  if (result.migrated > 0) {
    result.sha256Before = sha256File(abs);
    writeJsonAtomic(abs, document);
    result.sha256After = sha256File(abs);
  } else {
    result.sha256After = result.sha256Before;
  }
  return result;
}

/**
 * Migra um replay GRAVADO (artefato plano: `replayHash`/`governanceSignature` no
 * topo, sem `flows[]`). Mesmas garantias do modo evidência: verifica o conteúdo
 * antes de escrever, reemite SOMENTE a assinatura e aborta sem escrever se o
 * conteúdo não conferir.
 *
 * Motivo: `getReplayFile` (api/services/testExecutionService.js) devolve `null`
 * quando a integridade falha, e o endpoint responde 404 "Replay não encontrado".
 * Assinaturas emitidas pelo algoritmo antigo tornavam todo replay gravado
 * inacessível pelo visualizador.
 */
function migrateReplayArtifact(absPath) {
  const result = {
    file: absPath,
    kind: 'replay_artifact',
    sha256Before: null,
    sha256After: null,
    replayHash: null,
    previousSignature: null,
    newSignature: null,
    changed: false,
    aborted: false,
    abortReason: null,
  };
  if (!fs.existsSync(absPath)) {
    result.aborted = true;
    result.abortReason = 'file_missing';
    return result;
  }
  result.sha256Before = sha256File(absPath);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    result.aborted = true;
    result.abortReason = `invalid_json:${error.message}`;
    return result;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    result.aborted = true;
    result.abortReason = 'not_an_object';
    return result;
  }
  const signed = Boolean(parsed.replayHash || parsed.replayChecksum || parsed.governanceSignature);
  if (!signed) {
    result.aborted = true;
    result.abortReason = 'not_signed';
    return result;
  }

  // Fase 1 — verificação integral do conteúdo (fail-closed, nada é escrito antes).
  const expectedHash = computeReplayHash(parsed);
  const expectedChecksum = `sha256:${expectedHash}`;
  const integrity = parsed.integrity && typeof parsed.integrity === 'object' ? parsed.integrity : {};
  const problems = [];
  if (!parsed.replayHash || parsed.replayHash !== expectedHash) problems.push('replay_hash_mismatch');
  if (!parsed.replayChecksum || parsed.replayChecksum !== expectedChecksum) problems.push('replay_checksum_mismatch');
  if (integrity.signatureAlgorithm && integrity.signatureAlgorithm !== 'hmac-sha256') problems.push('signature_algorithm_unsupported');
  if (!integrity.signedAt && !parsed.signedAt) problems.push('signed_at_missing');
  if (problems.length > 0) {
    result.aborted = true;
    result.abortReason = `content_verification_failed:${problems.join('+')}`;
    return result;
  }

  // Fase 2 — reemissão apenas da assinatura.
  result.replayHash = parsed.replayHash;
  result.previousSignature = parsed.governanceSignature || null;
  const governance = parsed.governance || parsed.governanceResult || {};
  result.newSignature = computeGovernanceSignature(parsed, governance);
  if (result.previousSignature === result.newSignature) {
    result.sha256After = result.sha256Before;
    return result;
  }
  parsed.governanceSignature = result.newSignature;
  if (parsed.integrity && typeof parsed.integrity === 'object') {
    parsed.integrity.governanceSignature = result.newSignature;
  }
  result.changed = true;
  writeJsonAtomic(absPath, parsed);
  result.sha256After = sha256File(absPath);
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const includeReplays = args.includes('--replays');
  const targets = args.filter((arg) => !arg.startsWith('--'));
  const files = targets.length > 0 ? targets : (includeReplays ? [] : DEFAULT_TARGETS);

  const results = files.map(migrateFile);

  // Modo replays gravados: artefatos planos nos diretórios de runtime.
  const replayResults = [];
  if (includeReplays) {
    for (const dir of defaultReplayDirs()) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        replayResults.push(migrateReplayArtifact(path.join(dir, name)));
      }
    }
  }
  const aborted = results.filter((item) => item.aborted);
  const migrated = results.reduce((acc, item) => acc + item.migrated, 0);
  const alreadyBound = results.reduce((acc, item) => acc + item.alreadyBound, 0);

  // Verificação pós-migração: toda assinatura gravada deve validar com o algoritmo
  // corrigido (senão a migração não cumpriu o objetivo).
  const postVerification = [];
  for (const item of results) {
    if (item.aborted) continue;
    const abs = path.isAbsolute(item.file) ? item.file : path.join(ROOT, item.file);
    const document = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const flows = (Array.isArray(document.flows) ? document.flows : []).filter((f) => f && f.replay);
    let invalid = 0;
    const reasons = new Set();
    for (const flow of flows) {
      const validation = validateReplayIntegrity(flow.replay, flow.replay.governance || flow.governance || {});
      if (validation.valid) continue;
      invalid += 1;
      validation.blockers.forEach((blocker) => reasons.add(blocker.reason));
    }
    postVerification.push({ file: item.file, artifacts: flows.length, invalid, reasons: [...reasons] });
  }

  // Pós-verificação dos replays gravados migrados.
  const replayPost = [];
  for (const item of replayResults) {
    if (item.aborted) continue;
    const document = JSON.parse(fs.readFileSync(item.file, 'utf8'));
    const validation = validateReplayIntegrity(document, document.governance || document.governanceResult || {}, { maxAgeMs: -1 });
    replayPost.push({ file: item.file, valid: validation.valid, reasons: validation.blockers.map((b) => b.reason) });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    artifactType: 'replay-signature-migration',
    artifactVersion: '1.0.0',
    defect: 'governance_signature_not_bound_to_artifact',
    fix: 'governanceMessage binds replayHash + tenantId + environment (no INTEGRITY_FIELDS stripping)',
    files: results,
    postVerification,
    replayArtifacts: replayResults,
    replayPostVerification: replayPost,
    summary: {
      files: results.length,
      aborted: aborted.length,
      migrated,
      alreadyBound,
      invalidAfter: postVerification.reduce((acc, item) => acc + item.invalid, 0),
      replayFiles: replayResults.length,
      replaysMigrated: replayResults.filter((item) => item.changed).length,
      replaysAborted: replayResults.filter((item) => item.aborted).length,
      replaysInvalidAfter: replayPost.filter((item) => !item.valid).length,
    },
  };
  writeJsonAtomic(REPORT_PATH, report);

  console.log(`[resign-replay] arquivos=${results.length} migrados=${migrated} ja_ligados=${alreadyBound} abortados=${aborted.length}`);
  for (const item of results) {
    console.log(`  ${item.file}: migrados=${item.migrated}${item.aborted ? ` ABORTADO=${item.abortReason}` : ''} sha=${String(item.sha256After).slice(0, 16)}`);
  }
  for (const item of postVerification) {
    console.log(`  pos-verificacao ${item.file}: artefatos=${item.artifacts} invalidos=${item.invalid}${item.reasons.length ? ` ${item.reasons.join(',')}` : ''}`);
  }
  if (replayResults.length > 0) {
    console.log(`[resign-replay] replays gravados=${replayResults.length} migrados=${report.summary.replaysMigrated} abortados=${report.summary.replaysAborted} invalidos_pos=${report.summary.replaysInvalidAfter}`);
    replayResults.filter((item) => item.aborted).slice(0, 5).forEach((item) => console.log(`  ABORTADO ${path.basename(item.file)}: ${item.abortReason}`));
  }
  console.log(`[resign-replay] relatorio: ${path.relative(ROOT, REPORT_PATH)}`);

  if (aborted.length > 0 || report.summary.invalidAfter > 0 || report.summary.replaysInvalidAfter > 0) {
    console.error('[resign-replay] FALHA: migração não resultou em assinaturas válidas para todos os artefatos.');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { migrateFile, DEFAULT_TARGETS };
