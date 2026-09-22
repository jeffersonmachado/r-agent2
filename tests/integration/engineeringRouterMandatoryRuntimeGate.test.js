'use strict';

/**
 * ER-V1-FINAL-004 — Mandatory Runtime Gate.
 *
 * RED reproduzido (achado real, não hipotético): `package.json`'s
 * `validate:governance-enforcement` — a autoridade EXATA que `scripts/governance/
 * seal-release.sh` (o comando oficial `npm run release:seal`) chama para selar uma release —
 * invocava `npm run validate:engineering-router-v1` SEM `--runtime`. Isso significa que o
 * pipeline oficial de selagem aceitava `STRUCTURAL_PASS`/`RUNTIME_NOT_REQUESTED` como
 * suficiente para o Engineering Router V1 — nenhuma prova de comportamento real (testes
 * efetivamente executados, exitCode real, fingerprint amarrado à working tree) era exigida
 * para selar uma release que incluísse o Router.
 *
 * Corrigido: `validate:governance-enforcement` agora chama
 * `validate:engineering-router-v1:runtime`. O caminho ao vivo (`checkGovernance()` em
 * `regressionGovernanceService.js`, chamado dentro do estágio GOVERNANCE de toda
 * EngineeringTask real) continua invocando o script SEM `--runtime` diretamente — não passa
 * por `validate:governance-enforcement` nem por `package.json` — então esta correção NUNCA
 * reintroduz o deadlock de bootstrap já documentado em ERV1-CLOSE-010 (verificado abaixo).
 *
 * Este teste roda o script REAL (`validate-engineering-router-v1.js --runtime`) contra o
 * relatório de evidência real do disco, manipulando-o para provar os 4 cenários exigidos pela
 * missão — nunca mocka o gate em si.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GATE_SCRIPT = path.join(ROOT, 'scripts', 'governance', 'validate-engineering-router-v1.js');
const EVIDENCE_PATH = path.join(ROOT, 'reports', 'engineering-router-v1-runtime-evidence.json');
const BACKUP_PATH = path.join(ROOT, 'reports', '.engineering-router-v1-runtime-evidence.backup-for-test.json');

function runGate({ runtime = true } = {}) {
  const args = runtime ? [GATE_SCRIPT, '--runtime'] : [GATE_SCRIPT];
  try {
    const stdout = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: typeof err.status === 'number' ? err.status : 1, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('ER-V1-FINAL-004 — Mandatory Runtime Gate', () => {
  test('package.json: validate:governance-enforcement exige RUNTIME (nunca structural sozinho)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const script = pkg.scripts['validate:governance-enforcement'];
    expect(script).toContain('npm run validate:engineering-router-v1:runtime');
    // Nunca o comando SEM :runtime isolado — só como prefixo do :runtime (correto), não solto.
    expect(script).not.toMatch(/validate:engineering-router-v1 &&/);
  });

  test('checkGovernance() do loop ao vivo NUNCA passa por package.json/npm — continua sem --runtime (sem deadlock de bootstrap)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'api', 'services', 'engineeringRouter', 'regressionGovernanceService.js'),
      'utf8',
    );
    // checkGovernance invoca o script diretamente via execFile(node, [scriptPath]) — nunca
    // "npm run", nunca "--runtime". Prova de que o caminho ao vivo é imune à mudança desta
    // correção (que só afeta o npm script agregado).
    expect(src).toMatch(/execFileAsync\(process\.execPath, \[scriptPath\]/);
    expect(src).not.toMatch(/--runtime/);
  });

  describe('gate real com evidência manipulada (nunca mockado)', () => {
    let hadEvidence = false;

    beforeEach(() => {
      hadEvidence = fs.existsSync(EVIDENCE_PATH);
      if (hadEvidence) fs.copyFileSync(EVIDENCE_PATH, BACKUP_PATH);
    });

    afterEach(() => {
      if (hadEvidence) {
        fs.copyFileSync(BACKUP_PATH, EVIDENCE_PATH);
        fs.unlinkSync(BACKUP_PATH);
      } else {
        fs.rmSync(EVIDENCE_PATH, { force: true });
      }
    });

    test('runtime evidence ausente → --runtime FAIL (exitCode != 0)', () => {
      fs.rmSync(EVIDENCE_PATH, { force: true });
      const result = runGate({ runtime: true });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toContain('RUNTIME_EVIDENCE_PRESENT');
    }, 30000);

    test('runtime evidence com fingerprint stale (de outro código) → --runtime FAIL (exitCode != 0)', () => {
      if (!hadEvidence) {
        // Sem evidência real no disco para basear o teste — gera uma stub minimamente válida
        // (mesmo formato do coletor real) só para exercitar o campo sourceFingerprint.
        fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
        fs.writeFileSync(EVIDENCE_PATH, JSON.stringify({
          artifactType: 'engineering-router-v1-runtime-evidence',
          sourceCommit: 'stub',
          sourceFingerprint: 'stale-fingerprint-from-a-different-source-tree-0000000000',
          status: 'RUNTIME_PASS',
          items: [],
        }));
      } else {
        const real = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8'));
        real.sourceFingerprint = 'stale-fingerprint-from-a-different-source-tree-0000000000';
        fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(real));
      }
      const result = runGate({ runtime: true });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toContain('RUNTIME_EVIDENCE_FRESH');
    }, 30000);

    test('structural PASS sem --runtime continua aceito no modo padrão (RUNTIME_NOT_REQUESTED) — comportamento do loop ao vivo preservado', () => {
      fs.rmSync(EVIDENCE_PATH, { force: true });
      const result = runGate({ runtime: false });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('RUNTIME_NOT_REQUESTED');
    }, 30000);

    test('evidência com fingerprint real da working tree ATUAL (todos os itens exitCode 0) → --runtime PASS', () => {
      // Fabrica uma evidência sintética (mesmo formato do coletor real) com o fingerprint REAL
      // calculado ao vivo pela MESMA autoridade que o gate usa — não é mock do gate: o gate lê
      // este arquivo do disco exatamente como leria a saída real do coletor. Isolar esta
      // checagem do custo de rodar ~21 suítes reais a cada execução deste teste, mantendo o
      // gate em si 100% real (nunca mockado).
      // eslint-disable-next-line global-require
      const { computeSourceFingerprint } = require(path.join(ROOT, 'governance', 'proof-engine', 'fingerprint-chain.js'));
      const REQUIRED_RUNTIME_ITEM_IDS = [
        'SHELL_INJECTION_REJECTED', 'SAFE_ENVIRONMENT', 'SECRET_REDACTION_MULTILINE', 'PATCH_PATH_BOUNDARIES',
        'ACTUAL_PATCH_APPLY', 'DETERMINISTIC_FAILING_TEST_RED', 'RED_TO_FIX', 'INDEPENDENT_REVIEW',
        'REVIEWER_REJECTION_RECODE', 'REGRESSION_EXECUTION', 'GOVERNANCE_EXECUTION', 'PROVIDER_MODEL_FAILURE_REROUTE',
        'RESTART_RESUME', 'CONTROLLED_PROMOTION', 'POST_PROMOTION_VERIFICATION', 'DEVELOPMENT_AUTHORIZATION',
        'PRODUCTION_DENIAL', 'SUPPORT_DENIAL_DEFAULT', 'TENANT_CREDENTIAL_ISOLATION', 'RELEASE_CLOSURE_SAME_RUN_INTEGRITY',
        'EXECUTION_SANDBOX_ISOLATION', 'EXACT_PATCH_PROMOTION', 'FAIL_CLOSED_SCOPE',
      ];
      fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
      fs.writeFileSync(EVIDENCE_PATH, JSON.stringify({
        artifactType: 'engineering-router-v1-runtime-evidence',
        sourceCommit: 'test-synthetic',
        sourceFingerprint: computeSourceFingerprint(ROOT),
        status: 'RUNTIME_PASS',
        items: REQUIRED_RUNTIME_ITEM_IDS.map((id) => ({ id, testPath: 'synthetic', exitCode: 0 })),
      }));
      const result = runGate({ runtime: true });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('RUNTIME_PASS');
    }, 30000);
  });
});
