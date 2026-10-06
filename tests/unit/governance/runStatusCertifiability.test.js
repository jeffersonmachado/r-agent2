'use strict';

/**
 * RUN_STATUS_CERTIFIABILITY — um run com desfecho de FALHA não certifica.
 *
 * DEFEITO MEDIDO (2026-10-05), reproduzido no artefato entregue:
 *   governance/rap-master-scorecard.json   → overallStatus=VERIFIED, 78/78, 0 blockers, 0 gaps
 *   governance/certification-snapshot.json → runStatus=FAILED, finalDecision=NO_GO
 * Os dois descreviam o MESMO run. O scorecard aceitava o estado porque
 * `ALLOWED_RUN_STATUSES` — uma lista LOCAL, duplicada do ciclo de vida real —
 * continha `FAILED`. Resultado: o envelope afirmava simultaneamente "está tudo
 * 10/10" e "o run falhou", e o leitor não tinha como saber qual valia.
 *
 * O que este teste trava (os quatro lados do contrato):
 *   1. a máquina de estados conhece FAILED e permite a RECUPERAÇÃO (FAILED → RUNNING);
 *   2. FAILED/INVALIDATED NUNCA certificam, em nenhuma fase;
 *   3. o scorecard passa a REPROVAR o run (CURRENT_RUN deixa de dar PASS);
 *   4. a decisão agregada deixa de ser VERIFIED — não existe "78/78 com FAILED".
 *
 * Nada aqui afrouxa regra existente: prova o endurecimento nos dois sentidos
 * (o que deve falhar falha; o que continua legítimo continua passando).
 */

const path = require('path');

const {
  RUN_STATES,
  ALLOWED_TRANSITIONS,
  CERTIFIABLE_FINAL_STATES,
  NON_CERTIFIABLE_STATES,
  assessCertifiableRunStatus,
  transitionRunContext,
} = require('../../../governance/shared/run-context');

const { validateRunContext, evaluateMasterScorecard } = require('../../../governance/master-scorecard-engine');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_FP = 'a'.repeat(64);

function runContext(overrides = {}) {
  return {
    runId: 'rap-governed-20261005120000000-deadbeef',
    sourceFingerprint: SOURCE_FP,
    startedAt: '2026-10-05T12:00:00.000Z',
    generatedAt: '2026-10-05T12:00:00.000Z',
    status: 'COMPLETED',
    artifactType: 'run-context',
    artifactVersion: '1.0.0',
    ...overrides,
  };
}

describe('RUN_STATUS_CERTIFIABILITY', () => {
  describe('1. a máquina de estados conhece FAILED e a recuperação', () => {
    test('FAILED existe como estado (o banco já o gravava sem a máquina conhecê-lo)', () => {
      expect(RUN_STATES.FAILED).toBe('FAILED');
      expect(Object.keys(ALLOWED_TRANSITIONS)).toContain('FAILED');
    });

    test('recuperação é permitida: FAILED → RUNNING → COMPLETED', () => {
      expect(ALLOWED_TRANSITIONS.FAILED.has(RUN_STATES.RUNNING)).toBe(true);
      expect(ALLOWED_TRANSITIONS.RUNNING.has(RUN_STATES.COMPLETED)).toBe(true);
    });

    test('NÃO se pula a recuperação: FAILED → COMPLETED/VERIFIED é proibido', () => {
      expect(ALLOWED_TRANSITIONS.FAILED.has(RUN_STATES.COMPLETED)).toBe(false);
      expect(ALLOWED_TRANSITIONS.FAILED.has(RUN_STATES.VERIFIED)).toBe(false);
      expect(ALLOWED_TRANSITIONS.FAILED.has(RUN_STATES.PACKAGED)).toBe(false);
    });

    test('VERIFIED permanece terminal (não se "desverifica" um run selado)', () => {
      expect(ALLOWED_TRANSITIONS.VERIFIED.size).toBe(0);
    });
  });

  describe('2. FAILED/INVALIDATED nunca certificam', () => {
    test('FAILED é não-certificável com código explícito', () => {
      const verdict = assessCertifiableRunStatus('FAILED');
      expect(verdict.certifiable).toBe(false);
      expect(verdict.code).toBe('RUN_STATUS_NOT_CERTIFIABLE');
      expect(verdict.reason).toMatch(/RUNNING/);
    });

    test('INVALIDATED é não-certificável (drift de fonte)', () => {
      const verdict = assessCertifiableRunStatus('INVALIDATED');
      expect(verdict.certifiable).toBe(false);
      expect(verdict.code).toBe('RUN_INVALIDATED');
    });

    test('status desconhecido não passa por omissão', () => {
      expect(assessCertifiableRunStatus('BANANA').code).toBe('RUN_STATUS_UNKNOWN');
      expect(assessCertifiableRunStatus(null).code).toBe('RUN_STATUS_UNKNOWN');
      expect(assessCertifiableRunStatus('').code).toBe('RUN_STATUS_UNKNOWN');
    });

    test('os estados finais do ciclo continuam certificáveis', () => {
      for (const status of CERTIFIABLE_FINAL_STATES) {
        expect(assessCertifiableRunStatus(status).certifiable).toBe(true);
      }
      // O run ainda em curso também não é "não certificável" — ele é intermediário:
      // a exigência de estado FINAL é do selo, não da avaliação de progresso.
      expect(assessCertifiableRunStatus('RUNNING').certifiable).toBe(true);
      expect(assessCertifiableRunStatus('CREATED').certifiable).toBe(true);
    });

    test('a lista de não-certificáveis e a de finais são disjuntas', () => {
      for (const status of NON_CERTIFIABLE_STATES) {
        expect(CERTIFIABLE_FINAL_STATES).not.toContain(status);
      }
    });
  });

  describe('3. o RunContext é validado contra a fonte única (não uma cópia local)', () => {
    test('run FAILED ⇒ CURRENT_RUN não dá PASS', () => {
      const validation = validateRunContext(runContext({ status: 'FAILED' }));
      expect(validation.status).toBe('INVALID');
      expect(validation.code).toBe('RUN_STATUS_NOT_CERTIFIABLE');
    });

    test('run INVALIDATED ⇒ reprovado com o código de invalidação', () => {
      expect(validateRunContext(runContext({ status: 'INVALIDATED' })).code).toBe('RUN_INVALIDATED');
    });

    test('run COMPLETED ⇒ segue válido (sem regressão do caminho legítimo)', () => {
      const validation = validateRunContext(runContext({ status: 'COMPLETED' }));
      expect(validation.status).toBe('PASS');
      expect(validation.code).toBe('RUN_CONTEXT_VALID');
    });

    test('status inventado continua sendo RUN_STATUS_INVALID', () => {
      expect(validateRunContext(runContext({ status: 'WHATEVER' })).code).toBe('RUN_STATUS_INVALID');
    });
  });

  describe('4. ADVERSARIAL: 78/78 com runStatus=FAILED não é decisão certificável', () => {
    test('o scorecard completo reprova o run e NÃO declara VERIFIED', () => {
      const scorecard = evaluateMasterScorecard({
        rootDir: ROOT,
        runContext: runContext({ status: 'FAILED' }),
        sourceFingerprint: SOURCE_FP,
        requireCanonicalIds: false,
      });

      // O defeito era exatamente este par conviver: números perfeitos + run falho.
      expect(scorecard.runStatus).toBe('FAILED');
      expect(scorecard.overallStatus).not.toBe('VERIFIED');
      expect(scorecard.overallStatus).toBe('INVALID');

      // E a dimensão que sustenta a certificação precisa REFLETIR isso, não só o
      // campo de topo: um leitor que olhe apenas as dimensões vê a reprovação.
      const currentRun = scorecard.dimensions
        .flatMap((dimension) => dimension.requirements)
        .filter((requirement) => requirement.category === 'CURRENT_RUN');
      expect(currentRun.length).toBeGreaterThan(0);
      expect(currentRun.every((requirement) => requirement.status !== 'PASS')).toBe(true);
    }, 120000);

    test('o mesmo run em COMPLETED continua sendo avaliado normalmente', () => {
      const scorecard = evaluateMasterScorecard({
        rootDir: ROOT,
        runContext: runContext({ status: 'COMPLETED' }),
        sourceFingerprint: SOURCE_FP,
        requireCanonicalIds: false,
      });
      expect(scorecard.runStatus).toBe('COMPLETED');
      const currentRun = scorecard.dimensions
        .flatMap((dimension) => dimension.requirements)
        .filter((requirement) => requirement.category === 'CURRENT_RUN');
      expect(currentRun.every((requirement) => requirement.status === 'PASS')).toBe(true);
    }, 120000);
  });

  describe('5. a transição real é executável (não só declarada)', () => {
    test('transitionRunContext percorre FAILED → RUNNING → COMPLETED num root real', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-status-cert-'));
      fs.mkdirSync(path.join(tmp, 'governance'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'governance', '.current-run.json'),
        `${JSON.stringify(runContext({ status: 'FAILED' }), null, 2)}\n`,
      );

      const recovering = transitionRunContext({ rootDir: tmp, toStatus: 'RUNNING' });
      expect(recovering.status).toBe('RUNNING');
      const done = transitionRunContext({ rootDir: tmp, toStatus: 'COMPLETED' });
      expect(done.status).toBe('COMPLETED');
      // startedAt é preservado: a transição não pode reescrever o início do run.
      expect(done.startedAt).toBe(recovering.startedAt);

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('FAILED → VERIFIED (atalho de conveniência) é recusado', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-status-cert-'));
      fs.mkdirSync(path.join(tmp, 'governance'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'governance', '.current-run.json'),
        `${JSON.stringify(runContext({ status: 'FAILED' }), null, 2)}\n`,
      );

      expect(() => transitionRunContext({ rootDir: tmp, toStatus: 'VERIFIED' }))
        .toThrow(/INVALID_RUN_TRANSITION/);

      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('6. reconciliação entre o BANCO e o PONTEIRO do run', () => {
    const {
      planRunRecovery,
      syncRunContextStatus,
      RECOVERY_TARGET,
    } = require('../../../scripts/governance/lib/governed-run-status');

    test('run FAILED no banco é retomado antes da reavaliação', () => {
      const plan = planRunRecovery({ dbStatus: 'FAILED', runContextStatus: 'RUNNING' });
      expect(plan.recover).toBe(true);
      expect(plan.fromStatus).toBe('FAILED');
      expect(plan.toStatus).toBe(RECOVERY_TARGET);
    });

    test('run em estado saudável não é mexido', () => {
      for (const dbStatus of ['CREATED', 'RUNNING', 'COMPLETED', 'PACKAGED']) {
        expect(planRunRecovery({ dbStatus }).recover).toBe(false);
      }
    });

    test('INVALIDATED NÃO é retomado automaticamente (drift de fonte não se conserta sozinho)', () => {
      // A máquina permite INVALIDATED → nada; retomar exigiria fonte nova, e isso
      // é decisão de criar outro run, não de recuperar este.
      const plan = planRunRecovery({ dbStatus: 'INVALIDATED' });
      expect(plan.recover).toBe(false);
      expect(plan.reason).toMatch(/não é um desfecho de falha/);
    });

    test('o desfecho do banco chega ao ponteiro (o defeito era o ponteiro divergir)', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-status-sync-'));
      fs.mkdirSync(path.join(tmp, 'governance'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'governance', '.current-run.json'),
        `${JSON.stringify(runContext({ status: 'RUNNING' }), null, 2)}\n`,
      );

      // Decisão NO_GO ⇒ o ponteiro passa a dizer a verdade sobre o run.
      const failed = syncRunContextStatus({ rootDir: tmp, targetStatus: 'FAILED' });
      expect(failed.applied).toBe(true);
      expect(failed.status).toBe('FAILED');

      // Retomada ⇒ volta a RUNNING; e convergir ⇒ COMPLETED.
      expect(syncRunContextStatus({ rootDir: tmp, targetStatus: 'RUNNING' }).status).toBe('RUNNING');
      expect(syncRunContextStatus({ rootDir: tmp, targetStatus: 'COMPLETED' }).status).toBe('COMPLETED');

      // Idempotente: repetir o mesmo alvo não é erro.
      const again = syncRunContextStatus({ rootDir: tmp, targetStatus: 'COMPLETED' });
      expect(again.applied).toBe(false);
      expect(again.skippedReason).toBe('ALREADY_AT_TARGET');

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('o ponteiro NUNCA recebe uma transição que a máquina proíbe', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-status-sync-'));
      fs.mkdirSync(path.join(tmp, 'governance'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'governance', '.current-run.json'),
        `${JSON.stringify(runContext({ status: 'FAILED' }), null, 2)}\n`,
      );

      // O atalho que produziria "FAILED + 78/78" no arquivo final é recusado.
      const skipped = syncRunContextStatus({ rootDir: tmp, targetStatus: 'VERIFIED' });
      expect(skipped.applied).toBe(false);
      expect(skipped.skippedReason).toBe('TRANSITION_NOT_ALLOWED:FAILED->VERIFIED');

      // E o arquivo continua íntegro (nada foi gravado pela metade).
      const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'governance', '.current-run.json'), 'utf8'));
      expect(persisted.status).toBe('FAILED');

      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });
});
