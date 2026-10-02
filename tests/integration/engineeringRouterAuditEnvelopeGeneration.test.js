'use strict';

/**
 * ER-V1-FINAL-010 (Self-Proving Audit Envelope) — gerador REAL (a partir da evidência de
 * runtime/estrutural real já no disco) + verifier REAL sobre o output, ponta a ponta.
 *
 * Requer `reports/engineering-router-v1-runtime-evidence.json` e
 * `reports/engineering-router-v1-report.json` frescos (mesmo sourceFingerprint da working tree
 * atual, status RUNTIME_PASS/PASS) — produzidos por
 * `node scripts/governance/collect-engineering-router-runtime-evidence.js` seguido de
 * `node scripts/governance/validate-engineering-router-v1.js --runtime`.
 *
 * Evidência ausente/obsoleta passa pela PORTA ÚNICA `tests/helpers/infraGate`: em
 * `RELEASE_AUTHORITATIVE=1` isso é INFRA_ERROR (fail-closed, nunca verde por ausência de sinal);
 * em desenvolvimento é NOT_EXECUTED registrado. Antes disto o arquivo pulava com `console.warn`
 * e o gate anti-greenwashing o reprovou — corretamente, porque "passou" e "não rodou" ficavam
 * indistinguíveis no relatório agregado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson } = require('../../scripts/governance/common');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { generate, assertEvidenceFresh } = require('../../scripts/governance/generate-engineering-router-v1-audit-envelope');
const { verifyEnvelope, computeActualPackageSourceFingerprint } = require('../../scripts/governance/verify-engineering-router-v1-audit-envelope');

const ROOT = path.resolve(__dirname, '..', '..');

function freshEvidenceAvailable() {
  const runtimeEvidence = readJson('reports/engineering-router-v1-runtime-evidence.json');
  const structuralReport = readJson('reports/engineering-router-v1-report.json');
  if (!runtimeEvidence || !structuralReport) return false;
  const currentFingerprint = computeSourceFingerprint(ROOT);
  if (runtimeEvidence.sourceFingerprint !== currentFingerprint) return false;
  if (runtimeEvidence.status !== 'RUNTIME_PASS') return false;
  if (structuralReport.status !== 'PASS') return false;
  return true;
}

function skipIfNoFreshEvidence() {
  if (freshEvidenceAvailable()) return false;
  // Porta ÚNICA de infraestrutura: em RELEASE_AUTHORITATIVE=1 lança INFRA_ERROR (o gate não pode
  // passar sem sinal real); em dev registra NOT_EXECUTED com motivo.
  // eslint-disable-next-line global-require
  return require('../helpers/infraGate').skipOrFail({
    suite: 'engineering-router-audit-envelope-generation',
    available: false,
    reason: 'evidência de runtime/estrutural ausente ou obsoleta para o sourceFingerprint atual (rode collect-engineering-router-runtime-evidence + validate-engineering-router-v1 --runtime)',
    requirement: 'runtime-evidence',
  });
}

describe('ER-V1-FINAL-010 — geração real do envelope + verificação offline real', () => {
  let tmpOutDir;

  beforeEach(() => {
    tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engineering-router-audit-envelope-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpOutDir, { recursive: true, force: true });
  });

  test('gera o envelope real a partir da evidência real no disco, e o verifier real confirma PASS', () => {
    if (skipIfNoFreshEvidence()) return;

    const { manifest } = generate({ outDir: tmpOutDir });

    expect(manifest.runtimeStatus).toBe('RUNTIME_PASS');
    expect(manifest.structuralStatus).toBe('PASS');
    expect(manifest.releaseStatus).toBe('ENGINEERING_ROUTER_V1_10_OF_10_GREEN');
    expect(manifest.finalDecision).toBe('GO');
    expect(fs.existsSync(path.join(tmpOutDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutDir, 'hashes.json'))).toBe(true);
    // ER-V1-SEAL-004 — os 5 arquivos novos precisam existir de verdade no envelope real, não só
    // no fixture sintético do teste unitário do verifier.
    for (const name of ['source-fingerprint.json', 'runtime-requirements.json', 'structural-certification.json', 'sandbox-evidence.json', 'resume-evidence.json', 'seal-certification.json']) {
      expect(fs.existsSync(path.join(tmpOutDir, name))).toBe(true);
    }

    const result = verifyEnvelope(tmpOutDir);
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(result.ok).toBe(true);

    // ER-V1-SEALFIX-001 (Artifact-to-Source Binding) — o verifier recomputa o fingerprint REAL
    // diretamente do ROOT do repositório (nunca confia em nenhum valor declarado dentro do
    // envelope) e precisa bater exatamente com o que o gerador REAL certificou.
    const actualRootFingerprint = computeActualPackageSourceFingerprint(ROOT);
    expect(actualRootFingerprint).toBe(manifest.sourceFingerprint);
    const boundResult = verifyEnvelope(tmpOutDir, { packageRoot: ROOT });
    const boundFailed = boundResult.checks.filter((c) => !c.ok);
    expect(boundFailed).toEqual([]);
    expect(boundResult.ok).toBe(true);
    expect(boundResult.packageBindingVerifiable).toBe(true);

    // ER-V1-SEALFIX-001..004 GREEN — cada um com evidência real própria (testes adversariais,
    // crash/restart real, Docker Compose real com dois containers). Nunca fabricado: o valor
    // aqui é derivado de SEALFIX_BACKLOG (todos 'PASS'), recalculado independentemente pelo
    // próprio verifier em ENGINEERING_ROUTER_V1_SEALED_RECOMPUTED_MATCHES.
    expect(manifest.engineeringRouterV1Sealed).toBe(true);
  });

  test('gerar sem evidência de runtime fresca falha explicitamente (nunca certifica silenciosamente)', () => {
    // HERMETICIDADE — a versão anterior deste teste CORROMPIA o arquivo de evidência REAL
    // (`reports/engineering-router-v1-runtime-evidence.json`, gravando `status: RUNTIME_FAIL`) e o
    // restaurava num `finally`. Era um teste escrevendo num artefato GOVERNADO, e uma morte do
    // processo entre a corrupção e a restauração deixaria a evidência autoritativa FALSIFICADA no
    // disco — todos os gates a jusante passariam a falhar por um motivo fabricado pelo próprio
    // teste. Nada da garantia dependia daquela escrita: a decisão de frescor é uma função de suas
    // entradas (`assertEvidenceFresh`) e é ELA que o gerador real chama. As três condições de
    // fail-closed são exercitadas abaixo com entradas fabricadas, sem tocar em arquivo algum, e
    // nenhuma asserção foi enfraquecida.
    if (skipIfNoFreshEvidence()) return;

    const real = readJson('reports/engineering-router-v1-runtime-evidence.json');
    expect(real).toBeTruthy();
    const currentFingerprint = computeSourceFingerprint(ROOT);

    // 1) ausente
    expect(() => assertEvidenceFresh(null, { currentFingerprint })).toThrow(/ausente/);
    // 2) obsoleta — fingerprint de outra árvore
    expect(() => assertEvidenceFresh({ ...real, sourceFingerprint: 'deadbeef'.repeat(8) }, { currentFingerprint })).toThrow(/obsoleta/);
    // 3) presente e fresca, mas não RUNTIME_PASS
    expect(() => assertEvidenceFresh({ ...real, status: 'RUNTIME_FAIL' }, { currentFingerprint })).toThrow(/RUNTIME_PASS/);
    // 4) a evidência real, fresca, ATRAVESSA a mesma função que o gerador usa — o caminho feliz do
    //    gate é o mesmo objeto, não uma reimplementação paralela.
    expect(() => assertEvidenceFresh(real, { currentFingerprint })).not.toThrow();
  });
});
