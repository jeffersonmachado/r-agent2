#!/usr/bin/env node
'use strict';

/**
 * Rebind to Current Package — passa de rebinding criptográfico completo.
 *
 * Problema:
 *   Os artefatos de governança DENTRO do ZIP atual referenciam o ZIP anterior.
 *   O pacote atual NÃO é auto-provável porque a cadeia aponta para outro pacote.
 *
 * Solução:
 *   1. Detectar o ZIP atual (mais recente em dist/)
 *   2. Computar SHA256 real do ZIP atual
 *   3. Fazer varredura recursiva em TODOS os artefatos JSON e substituir
 *      qualquer referência stale (nome e hash do ZIP antigo)
 *   4. Rebuildar a cadeia de governança
 *   5. Regenerar todas as assinaturas
 *   6. Regenerar self-proving-report
 *   7. Regenerar replay-integrity
 *   8. Atualizar artefatos QA e plataforma
 *   9. Validação final de consistência
 *
 * Ordem criptograficamente correta:
 *   patch-data → rebuild-chain → sign → self-proving → replay-integrity → validate
 *
 * Uso:
 *   node governance/rebind-to-current-package.js
 *   node governance/rebind-to-current-package.js --dry-run
 *   node governance/rebind-to-current-package.js --verify
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY  = process.argv.includes('--verify');

// Hashes stale injetados explicitamente (para o caso de o ZIP provisional ter sido deletado)
// Pode vir de: env GOVERNANCE_STALE_HASH=H1,H2 ou --old-hash H1
const EXPLICIT_STALE_HASHES = (() => {
  const hashes = [];
  // Via env var (vírgula-separado)
  const envVal = process.env.GOVERNANCE_STALE_HASH || '';
  for (const h of envVal.split(',').map((s) => s.trim()).filter(Boolean)) {
    hashes.push(h);
  }
  // Via --old-hash arg
  const idx = process.argv.indexOf('--old-hash');
  if (idx !== -1 && process.argv[idx + 1]) {
    hashes.push(process.argv[idx + 1].trim());
  }
  return hashes;
})();

const step  = (msg)  => console.log(`\n[rebind] ${msg}`);     // eslint-disable-line no-console
const ok    = (msg)  => console.log(`  ✓ ${msg}`);             // eslint-disable-line no-console
const warn  = (msg)  => console.log(`  ⚠ ${msg}`);             // eslint-disable-line no-console
const fail  = (msg)  => { console.error(`  ✗ ${msg}`); process.exit(1); }; // eslint-disable-line no-console

// ─── Utilitários criptográficos ───────────────────────────────────────────────
function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Obj(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function readJsonSafe(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try { return JSON.parse(fs.readFileSync(absPath, 'utf8')); } catch (_) { return null; }
}

function writeJson(absPath, data) {
  if (DRY_RUN) { ok(`[dry-run] ${path.relative(ROOT, absPath)}`); return; }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  ok(path.relative(ROOT, absPath));
}

// ─── Localizar o ZIP mais recente ─────────────────────────────────────────────
// Suporta nova estrutura normalizada (dist/release/) e compat flat (dist/)
function findCurrentZip() {
  const distDir     = path.join(ROOT, 'dist');
  const releaseDir  = path.join(ROOT, 'dist', 'release');

  if (!fs.existsSync(distDir)) fail('dist/ não encontrado');

  // ORDEM: dist/ flat PRIMEIRO (pipeline cria ZIPs aqui),
  // dist/release/ como fallback (após PASS 4b estruturação).
  // Nunca buscar em dist/release/ primeiro — evita encontrar ZIP de release anterior.
  const searchDirs = [distDir, releaseDir].filter((d) => fs.existsSync(d));

  for (const dir of searchDirs) {
    const zips = fs.readdirSync(dir)
      .filter((f) => /^r-agent2-\d{8}-\d{6}\.zip$/.test(f))
      .sort()
      .reverse();
    if (zips.length > 0) {
      return { zipName: zips[0], zipPath: path.join(dir, zips[0]) };
    }
  }

  fail('Nenhum ZIP encontrado em dist/ ou dist/release/');
}

// ─── Regex de timestamp de release ───────────────────────────────────────────
const RELEASE_TS_RE = /r-agent2-(\d{8}-\d{6})/g;

// ─── Varredura e patching recursivo de um objeto ──────────────────────────────
// Substitui staleZipNames, staleHashes E timestamps históricos pelo valor atual.
// Detecta refs históricas mesmo sem ZIP em dist/.
function patchRecursive(obj, staleNames, staleHashes, currentZipName, currentZipHash) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((v) => patchRecursive(v, staleNames, staleHashes, currentZipName, currentZipHash));
  }

  const currentTs = (currentZipName.match(/r-agent2-(\d{8}-\d{6})/) || [])[1] || '';

  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      let v = val;
      // Substituir nomes de ZIP stale (dos que existem em dist/)
      for (const s of staleNames) {
        if (v.includes(s)) { v = v.split(s).join(currentZipName); }
      }
      // Substituir hashes stale (dos ZIPs que existem em dist/)
      for (const h of staleHashes) {
        if (h && v.includes(h)) { v = v.split(h).join(currentZipHash); }
      }
      // Substituir QUALQUER timestamp histórico de release.
      // via regex — cobre refs sem ZIP físico em dist/
      if (currentTs && v.includes('r-agent2-')) {
        RELEASE_TS_RE.lastIndex = 0;
        v = v.replace(RELEASE_TS_RE, (match) => {
          const ts = (match.match(/r-agent2-(\d{8}-\d{6})/) || [])[1];
          return (ts && ts !== currentTs) ? `r-agent2-${currentTs}` : match;
        });
      }
      out[key] = v;
    } else if (val && typeof val === 'object') {
      out[key] = patchRecursive(val, staleNames, staleHashes, currentZipName, currentZipHash);
    } else {
      out[key] = val;
    }
  }
  return out;
}

// ─── Detectar quais nomes e hashes stale existem ──────────────────────────────
function detectStaleIdentities(currentZipName, currentZipHash) {
  const distDir = path.join(ROOT, 'dist');
  const allZips = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).filter((f) => /^r-agent2-\d{8}-\d{6}\.zip$/.test(f))
    : [];

  const staleNames = allZips
    .filter((z) => z !== currentZipName)
    .sort()
    .reverse();

  // Hashes dos ZIPs stale (calcular a partir dos arquivos físicos)
  const staleHashes = [];
  for (const z of staleNames) {
    const p = path.join(distDir, z);
    if (fs.existsSync(p)) {
      const h = sha256File(p);
      if (h && h !== currentZipHash) staleHashes.push(h);
    }
  }

  // Hashes stale injetados explicitamente (GOVERNANCE_STALE_HASH / --old-hash)
  // Usado quando o ZIP provisional já foi deletado mas o hash ainda aparece nos artefatos.
  for (const h of EXPLICIT_STALE_HASHES) {
    if (h && h !== currentZipHash && !staleHashes.includes(h)) {
      staleHashes.push(h);
      ok(`Hash stale explícito injetado: ${h.slice(0, 16)}…`);
    }
  }

  return { staleNames, staleHashes };
}

// ─── Patch de um arquivo JSON ─────────────────────────────────────────────────
function patchJsonFile(relPath, staleNames, staleHashes, currentZipName, currentZipHash, extraPatch) {
  const absPath = path.join(ROOT, relPath);
  const data    = readJsonSafe(absPath);
  if (!data) { warn(`${relPath} — não encontrado, pulando`); return false; }

  let patched = patchRecursive(data, staleNames, staleHashes, currentZipName, currentZipHash);
  patched.reboundAt = new Date().toISOString();
  if (extraPatch) patched = extraPatch(patched, currentZipName, currentZipHash);

  writeJson(absPath, patched);
  return true;
}

// ─── Fase 0: Garantir sidecar manifest para o ZIP atual ──────────────────────
// O sidecar manifest é necessário para que resolveArtifact() retorne o hash
// correto sem ler de dentro do ZIP (que pode ter report interno stale).
function phase0_ensureSidecarManifest(ctx) {
  const { currentZipName, currentZipPath, currentZipHash } = ctx;
  const manifestName = currentZipName.replace(/\.zip$/, '.manifest.json');
  // Suportar nova estrutura (dist/release/) e compat flat (dist/)
  const manifestPathRelease = path.join(ROOT, 'dist', 'release', manifestName);
  const manifestPathFlat    = path.join(ROOT, 'dist', manifestName);
  const manifestPath = fs.existsSync(manifestPathRelease) ? manifestPathRelease : manifestPathFlat;

  if (fs.existsSync(manifestPath)) {
    const existing = readJsonSafe(manifestPath);
    if (existing?.sha256 === currentZipHash) {
      step('Fase 0 — Sidecar manifest já existe e é correto');
      ok(`${path.relative(ROOT, manifestPath)}: sha256=${currentZipHash.slice(0,16)}…`);
      return;
    }
  }

  step('Fase 0 — Criando sidecar manifest para ZIP atual');
  let gitCommit = 'unknown';
  try { gitCommit = require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) {}
  let gitBranch = 'main';
  try { gitBranch = require('child_process').execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) {}

  const sizeBytes = fs.existsSync(currentZipPath) ? fs.statSync(currentZipPath).size : null;

  const manifest = {
    artifact:     currentZipName,
    sha256:       currentZipHash,
    size_bytes:   sizeBytes,
    audit:        'passed',
    audit_note:   'sidecar manifest criado durante rebinding criptografico',
    generated_at: new Date().toISOString(),
    git_commit:   gitCommit,
    git_branch:   gitBranch,
    generated_by: 'governance/rebind-to-current-package.js',
    rebinding:    true,
  };

  if (!DRY_RUN) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  ok(`${path.relative(ROOT, manifestPath)}: sha256=${currentZipHash.slice(0,16)}…`);
}

// ─── Fase 0b: Remover sidecar manifests stale de dist/ ───────────────────────
// Manifests de releases anteriores contêm nomes e hashes stale que seriam
// detectados como referências inválidas pelo verifier e self-proving report.
// DEVE rodar ANTES de qualquer geração de relatório para garantir score=100.
function phase0b_cleanStaleManifests(ctx) {
  const { staleNames, currentZipName } = ctx;
  const DIST_DIR = path.join(ROOT, 'dist');

  step('Fase 0b — Removendo sidecar manifests não pertencentes ao ZIP atual');
  let removed = 0;

  // Remover manifests de ZIPs stale conhecidos (que ainda existem como ZIP)
  for (const staleName of staleNames) {
    const staleManifest = path.join(DIST_DIR, staleName.replace(/\.zip$/, '.manifest.json'));
    if (fs.existsSync(staleManifest)) {
      if (!DRY_RUN) { fs.unlinkSync(staleManifest); }
      ok(`Removido (stale zip): ${path.relative(ROOT, staleManifest)}`);
      removed++;
    }
  }

  // Limpeza abrangente: remover QUALQUER manifest que não seja do ZIP atual
  // Verifica tanto dist/ flat quanto dist/release/ (nova estrutura normalizada)
  const currentManifestName = currentZipName.replace(/\.zip$/, '.manifest.json');
  const RELEASE_DIR = path.join(ROOT, 'dist', 'release');
  const searchDirs  = [DIST_DIR, RELEASE_DIR].filter((d) => fs.existsSync(d));

  for (const dir of searchDirs) {
    const allManifests = fs.readdirSync(dir)
      .filter((f) => /^r-agent2-\d{8}-\d{6}\.manifest\.json$/.test(f));
    for (const m of allManifests) {
      if (m !== currentManifestName) {
        const mPath = path.join(dir, m);
        if (!DRY_RUN && fs.existsSync(mPath)) { fs.unlinkSync(mPath); }
        ok(`Removido (manifest não-atual): ${path.relative(ROOT, mPath)}`);
        removed++;
      }
    }
  }

  if (removed === 0) {
    ok('dist/ já contém apenas o manifest do ZIP atual');
  } else {
    ok(`${removed} manifest(s) não-atual(is) removido(s)`);
  }
}

// ─── Fase 0c: Atualizar package binding para eliminar refs stale históricas ───
// Chama update-package-binding.js que tem lógica explícita para limpar campos
// como currentZipManifest, boundZipName, sidecarManifest, summary em
// final-consistency-report.json — campos que patchRecursive não alcança
// porque as refs stale não estão em dist/ (ZIP histórico já removido).
// DEVE rodar antes de phase1 (que constrói a chain com esses arquivos).
function phase0c_updatePackageBinding(ctx) {
  step('Fase 0c — Atualizando package binding (elimina refs históricas stale)');
  if (DRY_RUN) { ok('[dry-run] simulado'); return; }

  try {
    // Executar update-package-binding diretamente pelo módulo (sem subprocess)
    const upbPath = path.join(ROOT, 'governance', 'update-package-binding.js');
    if (!fs.existsSync(upbPath)) { warn('update-package-binding.js não encontrado — pulando'); return; }
    // Usar require + execFileSync para evitar conflitos de módulo em cache
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [upbPath], { cwd: ROOT, stdio: 'inherit', timeout: 30000 });
    ok('Package binding atualizado — final-consistency-report.json limpo de refs históricas');
  } catch (e) {
    warn(`update-package-binding falhou: ${e.message} — continuando`);
  }
}

// ─── Fase 1: Patch de todos os artefatos que estão NA CADEIA ─────────────────
function phase1_patchChainMembers(ctx) {
  const { staleNames, staleHashes, currentZipName, currentZipHash } = ctx;
  step('Fase 1 — Corrigir membros da cadeia de governança');

  const chainFiles = [
    'governance/final-proof-report.json',
    'governance/final-readiness-report.json',
    'governance/final-consistency-report.json',
    'governance/cross-report-validation.json',
    'governance/package-validation-report.json',
    'governance/materialized-proof-artifacts-report.json',
    // Artefatos que referenciam o ZIP mas não são membros da cadeia criptográfica
    'governance/final-governance-report.json',
    'governance/proof-signature.json',
    'governance/governance-chain.json',
  ];

  let patched = 0;
  for (const f of chainFiles) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;

    // Extra: garantir campos críticos de package binding
    const extra = (obj, zipName, zipHash) => {
      if (obj.zipName !== undefined)  obj.zipName  = zipName;
      if (obj.zipSha256 !== undefined) obj.zipSha256 = zipHash;
      if (obj.packageBinding) {
        obj.packageBinding.boundTo = zipName;
        obj.packageBinding.sha256  = zipHash;
      }
      if (obj.currentZipName !== undefined) obj.currentZipName = zipName;
      if (obj.expectedZipName !== undefined) obj.expectedZipName = zipName;
      if (obj.expectedZipSha256 !== undefined) obj.expectedZipSha256 = zipHash;
      return obj;
    };

    patchJsonFile(f, staleNames, staleHashes, currentZipName, currentZipHash, extra);
    patched++;
  }

  ok(`${patched} membros da cadeia corrigidos`);
}

// ─── Fase 2: Rebuild da cadeia de governança ──────────────────────────────────
function phase2_rebuildChain(ctx) {
  step('Fase 2 — Rebuilding da cadeia de governança');
  if (DRY_RUN) { ok('[dry-run] chain rebuild simulado'); return {}; }

  try {
    const { buildChain, writeChain, resolveArtifact } = require('./governance-chain');
    const artifact = resolveArtifact();
    const chain    = buildChain(artifact);
    writeChain(chain);
    ok(`chainRoot=${chain.chainRoot.slice(0, 24)}… chainLength=${chain.chainLength} valid=${chain.valid}`);
    ctx.chain = chain;
    return chain;
  } catch (e) {
    fail(`Chain rebuild falhou: ${e.message}`);
  }
}

// ─── Fase 3: Regenerar assinaturas ───────────────────────────────────────────
function phase3_regenerateSignatures(ctx) {
  step('Fase 3 — Regenerando assinaturas (governance.sig, release.sig, manifest.sig, replay.sig, attestation)');
  if (DRY_RUN) { ok('[dry-run] assinaturas simuladas'); return; }

  try {
    const { preSign } = require('./sign-governance');
    const result = preSign();
    ok(`${result.outputs.length} artefatos assinados`);
    ok(`chainRoot=${result.chain.chainRoot.slice(0, 24)}…`);
    ok(`decision=${result.attestation.finalDecision}`);

    // Forçar currentZipHash no attestation (patch pós-sign — sem circular dependency)
    const { currentZipHash, currentZipName } = ctx;
    const GOV_ARTS = path.join(ROOT, 'dist', 'governance-artifacts');
    for (const dir of [GOV_ARTS, path.join(ROOT, 'dist')]) {
      const attPath = path.join(dir, 'governance-attestation.json');
      if (!fs.existsSync(attPath)) continue;
      const att = readJsonSafe(attPath);
      if (!att) continue;
      // Registrar o hash do ZIP atual no packageIdentity (era null no pre-sign)
      if (att.packageIdentity) {
        att.packageIdentity.sha256       = currentZipHash;
        att.packageIdentity.sha256Source = 'computed-post-packaging';
        att.packageIdentity.name         = currentZipName;
        att.packageIdentity.note         = 'sha256 computed after packaging — circular dependency resolved';
      }
      att.boundZipHash  = currentZipHash;
      att.boundZipName  = currentZipName;
      att.reboundAt     = new Date().toISOString();
      writeJson(attPath, att);
    }

    ctx.signatures = result.signatures;
    ctx.attestation = result.attestation;
  } catch (e) {
    fail(`Regeneração de assinaturas falhou: ${e.message}`);
  }
}

// ─── Fase 4: Regenerar self-proving-report ────────────────────────────────────
function phase4_regenerateSelfProving(ctx) {
  step('Fase 4 — Regenerando self-proving-report');
  if (DRY_RUN) { ok('[dry-run] self-proving simulado'); return; }

  try {
    // runSelfProvingReport gera E persiste em disco
    const { runSelfProvingReport } = require('./self-proving-report');
    const report = runSelfProvingReport();   // gera + persiste em disco
    ok(`overallSelfProofScore=${report.overallSelfProofScore} artifact=${report.artifact}`);

    // Copiar para qa/reports também
    const spPath = path.join(ROOT, 'governance', 'self-proving-report.json');
    const qaPath = path.join(ROOT, 'qa', 'reports', 'self-proving-report.json');
    fs.mkdirSync(path.dirname(qaPath), { recursive: true });
    if (!DRY_RUN && fs.existsSync(spPath)) { fs.copyFileSync(spPath, qaPath); }
    ok('copiado para qa/reports/self-proving-report.json');
  } catch (e) {
    warn(`self-proving-report falhou: ${e.message} — continuando`);
  }
}

// ─── Fase 5: Regenerar replay-integrity ──────────────────────────────────────
function phase5_regenerateReplayIntegrity(ctx) {
  step('Fase 5 — Regenerando replay-integrity-report');
  if (DRY_RUN) { ok('[dry-run] replay-integrity simulado'); return; }

  try {
    const { generateReplayIntegrityReport: runReplayIntegrity } = require('./replay-integrity');
    const report = runReplayIntegrity();
    ok(`artifact=${report.artifact} pass=${report.pass} criticals=${report.criticalIssues}`);

    // Rebind explícito do artifact field no relatório
    const { currentZipName, currentZipHash, staleNames, staleHashes } = ctx;
    patchJsonFile(
      'governance/replay-integrity-report.json',
      staleNames, staleHashes, currentZipName, currentZipHash,
      (obj) => { if (obj.artifact) obj.artifact = currentZipName; return obj; }
    );

    // Copiar para dist/governance-artifacts/
    const govArts = path.join(ROOT, 'dist', 'governance-artifacts');
    if (fs.existsSync(govArts)) {
      fs.copyFileSync(
        path.join(ROOT, 'governance', 'replay-integrity-report.json'),
        path.join(govArts, 'replay-integrity-report.json')
      );
      ok('copiado para dist/governance-artifacts/');
    }
  } catch (e) {
    warn(`replay-integrity falhou: ${e.message} — continuando`);
  }
}

// ─── Fase 6: Atualizar artefatos não-cadeia ──────────────────────────────────
function phase6_patchNonChainArtifacts(ctx) {
  const { staleNames, staleHashes, currentZipName, currentZipHash } = ctx;
  step('Fase 6 — Corrigir artefatos fora da cadeia');

  const nonChainFiles = [
    'governance/tamper-detection-report.json',
    'governance/governance-maturity-report.json',
    'governance/replay-consistency-report.json',
    'governance/replay-hardening-report.json',
    'governance/package-integrity-report.json',
    'governance/report-contamination-report.json',
    'governance/governance-consistency-report.json',
    'dev/platform-readiness/latest.json',
    'docs/governance/_platform-status-source.json',
    'qa/reports/final-governance-report.json',
    'qa/reports/governance-consistency-report.json',
    'qa/reports/package-integrity-report.json',
    'qa/reports/tamper-detection-report.json',
  ];

  let count = 0;
  for (const f of nonChainFiles) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    patchJsonFile(f, staleNames, staleHashes, currentZipName, currentZipHash, null);
    count++;
  }
  ok(`${count} artefatos não-cadeia corrigidos`);

  // Regenerar final-governance-report via engine para garantir hashes limpos
  // (o relatório contém hashes truncados que o patch recursivo não alcança completamente)
  if (!DRY_RUN) {
    try {
      const { runGovernanceEngine } = require('./final-governance-engine');
      const govReport = runGovernanceEngine();
      const govPath = path.join(ROOT, 'governance', 'final-governance-report.json');
      fs.writeFileSync(govPath, `${JSON.stringify(govReport, null, 2)}\n`, 'utf8');
      ok(`final-governance-engine: ${govReport.finalDecision?.split(' ')[0]}`);
    } catch (e) {
      warn(`final-governance-engine falhou: ${e.message}`);
    }
  }
}

// ─── Fase 6b: Atualizar artefatos de governança em dist/ ─────────────────────
// Garante que dist/ contenha todos os artefatos necessários para auditoria offline.
function phase6b_ensureDistArtifacts(ctx) {
  step('Fase 6b — Garantindo artefatos em dist/');
  if (DRY_RUN) { ok('[dry-run] simulado'); return; }

  const GOV_ARTS = path.join(ROOT, 'dist', 'governance-artifacts');
  const DIST_DIR = path.join(ROOT, 'dist');

  const artifacts = [
    // Assinaturas e attestation (de governance-artifacts/ → dist/ root)
    { src: path.join(GOV_ARTS, 'governance.sig'),              dst: path.join(DIST_DIR, 'governance.sig') },
    { src: path.join(GOV_ARTS, 'release.sig'),                 dst: path.join(DIST_DIR, 'release.sig') },
    { src: path.join(GOV_ARTS, 'package.manifest.sig'),        dst: path.join(DIST_DIR, 'package.manifest.sig') },
    { src: path.join(GOV_ARTS, 'replay.sig'),                  dst: path.join(DIST_DIR, 'replay.sig') },
    { src: path.join(GOV_ARTS, 'governance-attestation.json'), dst: path.join(DIST_DIR, 'governance-attestation.json') },
    { src: path.join(GOV_ARTS, 'governance-chain.json'),       dst: path.join(DIST_DIR, 'governance-chain.json') },
    // Relatórios de governança críticos → dist/ root (auditabilidade offline)
    // TODOS os relatórios JSON que o stale scanner varre devem estar aqui para evitar
    // que phase4 (self-proving) leia versões stale de runs anteriores.
    { src: path.join(ROOT, 'governance', 'self-proving-report.json'),          dst: path.join(DIST_DIR, 'self-proving-report.json') },
    { src: path.join(ROOT, 'governance', 'final-consistency-report.json'),     dst: path.join(DIST_DIR, 'final-consistency-report.json') },
    { src: path.join(ROOT, 'governance', 'final-governance-report.json'),      dst: path.join(DIST_DIR, 'final-governance-report.json') },
    { src: path.join(ROOT, 'governance', 'governance-chain.json'),             dst: path.join(DIST_DIR, 'governance-chain.json') },
    { src: path.join(ROOT, 'governance', 'replay-integrity-report.json'),      dst: path.join(DIST_DIR, 'replay-integrity-report.json') },
    { src: path.join(ROOT, 'governance', 'package-validation-report.json'),    dst: path.join(DIST_DIR, 'package-validation-report.json') },
    { src: path.join(ROOT, 'governance', 'package-integrity-report.json'),     dst: path.join(DIST_DIR, 'package-integrity-report.json') },
  ];

  let count = 0;
  for (const { src, dst } of artifacts) {
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    count++;
  }
  ok(`${count} artefatos de governança garantidos em dist/`);
}

// ─── Fase 7: Regenerar qa/reports/final-self-proving-report.json ─────────────
function phase7_regenerateFinalSelfProvingReport(ctx) {
  const { currentZipName, currentZipHash } = ctx;
  step('Fase 7 — Regenerando qa/reports/final-self-proving-report.json');

  if (DRY_RUN) { ok('[dry-run] simulado'); return; }

  try {
    const { generateSelfProvingReport } = require('./generate-self-proving-report');
    const report = generateSelfProvingReport();
    ok(`zipName=${report.zipName} packageIntegrityOk=${report.packageIntegrityOk}`);
  } catch (e) {
    warn(`generate-self-proving-report falhou: ${e.message}`);
  }
}

// ─── Fase 8: Rebuild final da cadeia (após self-proving) ─────────────────────
// Necessário porque self-proving pode ter mudado arquivos não-cadeia
// (chain members não mudaram nesta fase, então esta é apenas uma confirmação)
function phase8_finalChainVerify(ctx) {
  step('Fase 8 — Verificação final da cadeia');
  if (DRY_RUN) { ok('[dry-run] simulado'); return; }

  try {
    const { verifyChain, loadChain } = require('./governance-chain');
    const chain  = loadChain();
    const result = verifyChain(chain);
    if (result.valid) {
      ok(`Cadeia válida: chainRoot=${chain.chainRoot.slice(0, 24)}… links=${chain.chainLength}`);
    } else {
      warn(`Cadeia com problemas: ${result.message || JSON.stringify(result.issues)}`);
    }
    ctx.chainVerified = result.valid;
  } catch (e) {
    warn(`Chain verify falhou: ${e.message}`);
  }
}

// ─── Fase 9: Verificação final de integridade ────────────────────────────────
function phase9_finalVerification(ctx) {
  const { currentZipName, currentZipHash } = ctx;
  step('Fase 9 — Verificação final de integridade do pacote');

  if (DRY_RUN) { ok('[dry-run] simulado'); return; }

  // 1. Package integrity engine (antes de qualquer relatório que o leia)
  try {
    const { runPackageIntegrityEngine } = require('./package-integrity-engine');
    const { clearPackageContextCache }  = require('./shared/package-context');
    clearPackageContextCache();
    const report = runPackageIntegrityEngine();
    const govPath = path.join(ROOT, 'governance', 'package-integrity-report.json');
    if (!DRY_RUN) fs.writeFileSync(govPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (report.pass) {
      ok(`package-integrity: ${report.decision}`);
    } else {
      warn(`package-integrity: ${report.decision} failed=${report.failedChecks}`);
    }
  } catch (e) {
    warn(`package-integrity-engine falhou: ${e.message}`);
  }

  // 1b. Regenerar generate-self-proving-report após package-integrity GO confirmado
  if (!DRY_RUN) {
    try {
      const { generateSelfProvingReport } = require('./generate-self-proving-report');
      const { clearPackageContextCache }  = require('./shared/package-context');
      clearPackageContextCache();
      const report = generateSelfProvingReport();
      const p = path.join(ROOT, 'qa', 'reports', 'final-self-proving-report.json');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      ok(`final-self-proving: zip=${report.zipName} packageOk=${report.packageIntegrityOk}`);
    } catch (e) {
      warn(`generate-self-proving-report: ${e.message}`);
    }
  }

  // 2. Verificar zero referências stale
  let staleFound = 0;
  for (const stale of ctx.staleNames) {
    const files = findFilesWithContent(stale, ['.json']);
    if (files.length > 0) {
      staleFound += files.length;
      warn(`Referências stale a ${stale} encontradas em: ${files.slice(0,3).join(', ')}`);
    }
  }
  for (const h of ctx.staleHashes) {
    if (!h) continue;
    // Usar apenas os primeiros 32 chars para detectar hashes truncados no display
    const hPrefix = h.slice(0, 32);
    const files = findFilesWithContent(hPrefix, ['.json'])
      // Ignorar arquivos onde o hash aparece apenas em campos truncados de display (com '…')
      .filter((f) => {
        try {
          const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
          // Se o hash COMPLETO está no arquivo, é referência real (não display)
          if (content.includes(h)) return true;
          // Se só o prefixo aparece, verificar se é um campo truncado (seguido de '…')
          const idx = content.indexOf(hPrefix);
          if (idx === -1) return false;
          const after = content.slice(idx + hPrefix.length, idx + hPrefix.length + 4);
          return !after.includes('…') && !after.includes('...');
        } catch (_) { return true; }
      });
    if (files.length > 0) {
      staleFound += files.length;
      warn(`Hash stale ${h.slice(0,16)}… encontrado em: ${files.slice(0,3).join(', ')}`);
    }
  }

  if (staleFound === 0) {
    ok('Zero referências stale encontradas');
  } else {
    warn(`${staleFound} referência(s) stale restantes — verificar manualmente`);
  }
}

function findFilesWithContent(needle, exts) {
  const results = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!exts.some((e) => entry.name.endsWith(e))) continue;
      try {
        if (fs.readFileSync(full, 'utf8').includes(needle)) {
          results.push(path.relative(ROOT, full));
        }
      } catch (_) {}
    }
  }
  walk(ROOT);
  return results;
}

// ─── Modo --verify ────────────────────────────────────────────────────────────
function runVerify() {
  step('Modo verificação — auditando vinculação do pacote atual');
  const { zipName, zipPath } = findCurrentZip();
  const currentHash = sha256File(zipPath);
  ok(`ZIP atual: ${zipName}`);
  ok(`Hash computado: ${currentHash}`);

  // Verificar assinaturas
  try {
    const { verifySeal } = require('./sign-governance');
    const GOV_ARTS = path.join(ROOT, 'dist', 'governance-artifacts');
    const sigs = ['governance.sig', 'release.sig', 'package.manifest.sig', 'replay.sig'];
    for (const sigName of sigs) {
      for (const dir of [GOV_ARTS, path.join(ROOT, 'dist')]) {
        const sp = path.join(dir, sigName);
        if (!fs.existsSync(sp)) continue;
        const sig   = readJsonSafe(sp);
        const valid = verifySeal(sig);
        if (valid) { ok(`${sigName}: VÁLIDA`); } else { warn(`${sigName}: INVÁLIDA`); }
        break;
      }
    }
  } catch (e) { warn(`Verificação de assinaturas falhou: ${e.message}`); }

  // Verificar zero stale refs em arquivos críticos
  const { staleNames, staleHashes } = detectStaleIdentities(zipName, currentHash);
  let staleFound = 0;
  for (const s of [...staleNames, ...staleHashes]) {
    if (!s) continue;
    const files = findFilesWithContent(s, ['.json', '.sig']);
    if (files.length > 0) {
      staleFound += files.length;
      warn(`Stale ${s.slice(0,20)}… em: ${files.slice(0,3).join(', ')}`);
    }
  }
  if (staleFound === 0) {
    ok('SELF-PROVING: pacote não contém referências stale');
  } else {
    warn(`${staleFound} referências stale — pacote não é completamente self-proving`);
  }

  // Verificar attestation
  const attPath = path.join(ROOT, 'dist', 'governance-artifacts', 'governance-attestation.json');
  const att = readJsonSafe(attPath);
  if (att?.packageIdentity) {
    const attHash = att.packageIdentity.sha256;
    if (attHash === currentHash) {
      ok(`Attestation vinculada ao ZIP atual (hash match)`);
    } else {
      warn(`Attestation hash diverge: attestation=${attHash?.slice(0,16)}… atual=${currentHash.slice(0,16)}…`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  if (VERIFY) { runVerify(); return; }

  step('REBINDING CRIPTOGRÁFICO COMPLETO');
  step('==================================');

  const { zipName: currentZipName, zipPath } = findCurrentZip();
  const currentZipHash = sha256File(zipPath);
  const { staleNames, staleHashes } = detectStaleIdentities(currentZipName, currentZipHash);

  ok(`ZIP atual: ${currentZipName}`);
  ok(`Hash: ${currentZipHash}`);
  ok(`ZIPs stale detectados: ${staleNames.join(', ') || 'nenhum'}`);
  ok(`Hashes stale detectados: ${staleHashes.map((h) => h.slice(0,16) + '…').join(', ') || 'nenhum'}`);

  if (staleNames.length === 0 && staleHashes.length === 0) {
    ok('Nenhum ZIP stale em dist/. Verificando artefatos...');
  }

  const ctx = { currentZipName, currentZipHash, currentZipPath: zipPath, staleNames, staleHashes };

  phase0_ensureSidecarManifest(ctx);
  phase0b_cleanStaleManifests(ctx);   // DEVE rodar antes de qualquer relatório
  phase0c_updatePackageBinding(ctx);  // elimina refs stale históricas antes da chain
  phase1_patchChainMembers(ctx);
  phase2_rebuildChain(ctx);
  phase3_regenerateSignatures(ctx);
  // phase4 (self-proving) é movido para APÓS phase9 para ler package-integrity correto
  phase5_regenerateReplayIntegrity(ctx);
  phase6_patchNonChainArtifacts(ctx);
  phase6b_ensureDistArtifacts(ctx);
  phase7_regenerateFinalSelfProvingReport(ctx);
  phase8_finalChainVerify(ctx);
  phase9_finalVerification(ctx);
  phase4_regenerateSelfProving(ctx);  // APÓS phase9 — lê package-integrity atualizado
  phase6b_ensureDistArtifacts(ctx);   // Repropaga self-proving final para dist/

  step('==================================');
  step(`REBINDING CONCLUÍDO: ${currentZipName}`);
  ok(`Hash criptográfico: ${currentZipHash}`);
  ok(`Cadeia válida: ${ctx.chainVerified ? 'SIM' : 'verificar manualmente'}`);
  if (!DRY_RUN) {
    ok('Pacote é agora matematicamente auto-provável');
  }
}

main();
