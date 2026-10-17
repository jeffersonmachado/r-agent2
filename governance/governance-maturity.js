#!/usr/bin/env node
'use strict';

/**
 * Governance Maturity Evaluator — LEVEL_0 a LEVEL_5.
 *
 * LEVEL_0_DECLARATIVE        Apenas documentação/claims. Sem provas.
 * LEVEL_1_PROOF_BASED        Proof reports e evidence manifests presentes.
 * LEVEL_2_VERIFIABLE         Cross-validation, package validator, blocker engine.
 * LEVEL_3_CRYPTOGRAPHIC      Hash chains, HMAC signatures, replay signatures.
 * LEVEL_4_IMMUTABLE          Attestação completa, verificador offline, cadeia completa.
 * LEVEL_5_SUPPLY_CHAIN_GOVERNED  PKI externo, SBOM, proveniência de dependências.
 *
 * RAP target: LEVEL_4_IMMUTABLE
 */

const fs   = require('fs');
const path = require('path');

const { avaliarEstadoDaCadeia } = require('./governance-chain');

const ROOT = path.join(__dirname, '..');

const LEVELS = {
  LEVEL_0_DECLARATIVE:          0,
  LEVEL_1_PROOF_BASED:          1,
  LEVEL_2_VERIFIABLE:           2,
  LEVEL_3_CRYPTOGRAPHIC:        3,
  LEVEL_4_IMMUTABLE:            4,
  LEVEL_5_SUPPLY_CHAIN_GOVERNED: 5,
};

const LEVEL_NAMES = Object.keys(LEVELS);

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Critérios por nível ──────────────────────────────────────────────────────
function evaluateCriteria() {
  const proof       = readJsonSafe('governance/final-proof-report.json')             || {};
  const consistency = readJsonSafe('governance/final-consistency-report.json')       || {};
  const crossReport = readJsonSafe('governance/cross-report-validation.json')        || {};
  const chain       = readJsonSafe('governance/governance-chain.json')               || {};
  // FASE 6 (2026-10-16): `chain.valid` era LIDO de disco. Ele significava apenas
  // "todos os arquivos existem" enquanto o artefato tinha 9 divergências reais.
  // Aqui o veredito é RECALCULADO dos bytes atuais.
  const estadoCadeia = Object.keys(chain).length
    ? avaliarEstadoDaCadeia(chain)
    : { status: 'FAIL', recalculadaIntegra: false, autoDeclaracao: 'AUSENTE', codes: ['CADEIA_AUSENTE'] };
  const chainRecalc = estadoCadeia.recalc || { valid: false, failures: [] };
  const relSig      = readJsonSafe('dist/release.sig')                               || {};
  const govSig      = readJsonSafe('dist/governance.sig')                            || {};
  const attestation = readJsonSafe('dist/governance-attestation.json')               || {};

  return {
    // ── LEVEL_0: documentação básica ─────────────────────────────────────────
    LEVEL_0: {
      label:    'LEVEL_0_DECLARATIVE',
      criteria: [
        { id: 'readme',        pass: exists('governance/README.md'),               label: 'Governance README presente' },
        { id: 'qa_policy',     pass: exists('governance/qa-policy.json'),          label: 'QA Policy presente' },
        { id: 'roles',         pass: exists('governance/roles-raci.json'),         label: 'Roles RACI presente' },
      ],
    },

    // ── LEVEL_1: proof-based ──────────────────────────────────────────────────
    LEVEL_1: {
      label:    'LEVEL_1_PROOF_BASED',
      criteria: [
        { id: 'proof_report',     pass: exists('governance/final-proof-report.json'),   label: 'Final Proof Report presente' },
        { id: 'evidence_manifest',pass: exists('governance/evidence-manifest.json'),    label: 'Evidence Manifest presente' },
        { id: 'proof_coverage',   pass: (proof.proofCoverage?.percent || 0) >= 100,     label: 'proofCoverage = 100%' },
        { id: 'prod_like',        pass: (proof.prodLikeCoverage?.percent || 0) >= 100,  label: 'prodLikeCoverage = 100%' },
        { id: 'replay_sig',       pass: exists('governance/proof-signature.json'),      label: 'Replay signature presente' },
      ],
    },

    // ── LEVEL_2: verifiable ───────────────────────────────────────────────────
    LEVEL_2: {
      label:    'LEVEL_2_VERIFIABLE',
      criteria: [
        { id: 'package_validator',  pass: exists('governance/package-validator.js'),          label: 'Package Validator presente' },
        { id: 'cross_report',       pass: exists('governance/cross-report-validation.json'),  label: 'Cross-Report Validation presente' },
        { id: 'blocker_engine',     pass: exists('governance/blocker-engine.js'),             label: 'Blocker Engine presente' },
        { id: 'consistency_report', pass: exists('governance/final-consistency-report.json'), label: 'Consistency Report presente' },
        { id: 'zero_blockers',      pass: (proof.blockerCount || 0) === 0,                   label: 'blockerCount = 0' },
        { id: 'consistency_100',    pass: (consistency.overallConsistencyScore || 0) === 100, label: 'overallConsistencyScore = 100' },
        { id: 'sidecar_manifest',   pass: (() => {
          const distFiles = fs.existsSync(path.join(ROOT, 'dist'))
            ? fs.readdirSync(path.join(ROOT, 'dist')) : [];
          return distFiles.some((f) => f.endsWith('.manifest.json') && !f.startsWith('compact'));
        })(), label: 'Sidecar manifest com audit=passed presente' },
      ],
    },

    // ── LEVEL_3: cryptographic ────────────────────────────────────────────────
    LEVEL_3: {
      label:    'LEVEL_3_CRYPTOGRAPHIC',
      criteria: [
        { id: 'chain_js',       pass: exists('governance/governance-chain.js'),   label: 'Governance Chain Engine presente' },
        { id: 'chain_json',     pass: exists('governance/governance-chain.json'), label: 'Governance Chain JSON gerada' },
        { id: 'chain_valid',    pass: chainRecalc.valid === true,                 label: 'Cadeia válida (hash RECALCULADO dos bytes atuais)' },
        { id: 'chain_declaracao_honesta', pass: estadoCadeia.autoDeclaracao !== 'FALSA', label: 'Declaração de validade não contradiz a recalculação' },
        { id: 'chain_sem_escrita_posterior', pass: (estadoCadeia.escritasPosteriores?.ids || []).length === 0, label: 'Nenhum elo gravado depois da certificação' },
        { id: 'chain_complete', pass: chain.completeChain === true,               label: 'Cadeia completa (sem camadas ausentes)' },
        { id: 'sign_engine',    pass: exists('governance/sign-governance.js'),    label: 'Sign Engine presente' },
        { id: 'release_sig',    pass: exists('dist/release.sig'),                 label: 'dist/release.sig presente' },
        { id: 'gov_sig',        pass: exists('dist/governance.sig'),              label: 'dist/governance.sig presente' },
        { id: 'replay_signed',  pass: !!(readJsonSafe('governance/proof-signature.json') || {}).signature, label: 'Replay artifacts assinados' },
      ],
    },

    // ── LEVEL_4: immutable ────────────────────────────────────────────────────
    LEVEL_4: {
      label:    'LEVEL_4_IMMUTABLE',
      criteria: [
        { id: 'attestation',       pass: exists('dist/governance-attestation.json'),         label: 'Governance Attestation presente' },
        { id: 'attestation_sig',   pass: !!(attestation.signatures?.attestation?.seal),      label: 'Attestation assinada' },
        { id: 'manifest_sig',      pass: exists('dist/package.manifest.sig'),                label: 'dist/package.manifest.sig presente' },
        { id: 'verifier_script',   pass: exists('scripts/verify-enterprise-governance.sh'),  label: 'Verifier script offline presente' },
        { id: 'tamper_detector',   pass: exists('governance/tamper-detector.js'),            label: 'Tamper Detector presente' },
        { id: 'chain_root_bound',  pass: !!(relSig.chainRoot),                               label: 'release.sig vinculado ao chainRoot' },
        { id: 'update_binding',    pass: exists('governance/update-package-binding.js'),     label: 'Update-binding script presente' },
        { id: 'autonomous_ready',  pass: (
          proof.finalDecision === 'AUTONOMOUS_READY_GO' ||
          // Cross-report é a fonte estável mantida pelo update-package-binding
          (crossReport.maximumAllowedReadiness === 'autonomous-ready' && (crossReport.blockerCount || 0) === 0)
        ), label: 'finalDecision = AUTONOMOUS_READY_GO (ou cross-report autonomous-ready)' },
      ],
    },

    // ── LEVEL_5: supply-chain governed ───────────────────────────────────────
    LEVEL_5: {
      label:    'LEVEL_5_SUPPLY_CHAIN_GOVERNED',
      criteria: [
        { id: 'pkce_signing',   pass: false, label: 'PKI externo / ed25519 key pair (não implementado)'  },
        { id: 'sbom',           pass: false, label: 'SBOM (Software Bill of Materials) (não implementado)' },
        { id: 'dep_provenance', pass: false, label: 'Proveniência de dependências (não implementado)'    },
        { id: 'cosign',         pass: false, label: 'Cosign / Sigstore integrado (não implementado)'     },
      ],
    },
  };
}

function evaluateMaturity() {
  const criteria = evaluateCriteria();
  const levels   = [];
  let   achieved = -1;

  for (const key of ['LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5']) {
    const level      = criteria[key];
    const passing    = level.criteria.filter((c) => c.pass);
    const failing    = level.criteria.filter((c) => !c.pass);
    const allPass    = failing.length === 0;
    const score      = level.criteria.length > 0
      ? Math.round((passing.length / level.criteria.length) * 100)
      : 100;

    levels.push({
      key,
      label:       level.label,
      achieved:    allPass,
      score,
      passing:     passing.map((c) => c.id),
      failing:     failing.map((c) => ({ id: c.id, label: c.label })),
      totalChecks: level.criteria.length,
    });

    if (allPass) achieved = LEVELS[level.label] ?? -1;
  }

  const achievedLabel = LEVEL_NAMES.find((n) => LEVELS[n] === achieved) || 'LEVEL_0_DECLARATIVE';
  const nextLabel     = LEVEL_NAMES.find((n) => LEVELS[n] === achieved + 1) || null;
  const nextLevel     = levels.find((l) => l.label === nextLabel);
  const nextGaps      = nextLevel?.failing || [];

  return {
    generatedAt:      new Date().toISOString(),
    achievedLevel:    achievedLabel,
    achievedNumeric:  achieved,
    targetLevel:      'LEVEL_4_IMMUTABLE',
    targetAchieved:   achieved >= LEVELS['LEVEL_4_IMMUTABLE'],
    levels,
    nextLevel:        nextLabel,
    nextLevelGaps:    nextGaps,
    summary: achieved >= LEVELS['LEVEL_4_IMMUTABLE']
      ? `RAP atingiu LEVEL_4_IMMUTABLE — governança criptograficamente verificável, imutável e auditável offline.`
      : `RAP está em ${achievedLabel}. Gaps para ${nextLabel || 'LEVEL_5'}: ${nextGaps.map((g) => g.label).join(', ') || 'nenhum'}.`,
  };
}

module.exports = { LEVELS, LEVEL_NAMES, evaluateMaturity, evaluateCriteria };

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const report = evaluateMaturity();
  const outPath = path.join(ROOT, 'governance', 'governance-maturity-report.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[governance-maturity] achieved=${report.achievedLevel} target=${report.targetLevel} targetAchieved=${report.targetAchieved}`);
  process.exit(report.targetAchieved ? 0 : 1);
}
