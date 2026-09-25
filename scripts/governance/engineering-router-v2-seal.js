#!/usr/bin/env node
'use strict';

/**
 * engineering-router-v2-seal.js — SEAL AUTORITATIVO do Engineering Router V2.
 *
 * Executa a sequência ORDENADA de verificação e emite a decisão. Orquestra os verificadores que
 * já existem — não reimplementa nenhum deles (a missão proíbe arquitetura paralela, e o repositório
 * já tem o script certo para cada eixo).
 *
 * Princípios que este arquivo encarna, e que custaram ciclos inteiros quando faltaram:
 *
 *   1. ORDEM DECLARADA com dependências. Nenhum passo pode exigir artefato produzido por um passo
 *      POSTERIOR — a violação é reportada como `SEAL_PHASE_ORDER_VIOLATION` antes de qualquer
 *      execução, não descoberta no meio.
 *   2. GERAR ≠ VERIFICAR. O envelope é gerado num passo e verificado num passo SEPARADO, que
 *      consome o envelope já existente. A verificação nunca regenera.
 *   3. FALHA É BLOQUEANTE. Um passo obrigatório que falha interrompe a sequência; não existe
 *      "continuar e ver no fim".
 *   4. ESTADOS SEPARADOS. `ENGINEERING_ROUTER_V2` e `RAP_FINAL_RELEASE` são decisões distintas e
 *      este sealer NUNCA promove o release da plataforma.
 *   5. AUSÊNCIA DE CREDENCIAL É ESTADO. Um passo que exige credencial externa e não a tem é
 *      `NOT_APPLICABLE_CREDENTIAL_MISSING` — nunca PASS, nunca FAIL por motivo errado.
 *
 * Uso:
 *   node scripts/governance/engineering-router-v2-seal.js            # executa a sequência
 *   node scripts/governance/engineering-router-v2-seal.js --plan     # só mostra o plano
 *   node scripts/governance/engineering-router-v2-seal.js --from <id>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, writeReport } = require('./common');

const ENVELOPE_DIR = path.join(ROOT, 'dist', 'engineering-router-v2-audit-envelope');
const REPORT = 'engineering-router-v2-seal-execution.json';

const SEAL_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_APPLICABLE: 'NOT_APPLICABLE_CREDENTIAL_MISSING',
  PENDING: 'PENDING',
});

/**
 * Sequência ordenada. `phase` existe para que a checagem de ordem seja possível: um passo só pode
 * depender de artefato de fase igual ou ANTERIOR.
 */
const PHASES = Object.freeze(['PREPARE', 'VERIFY', 'EVIDENCE', 'SEAL', 'DECIDE']);

const STEPS = Object.freeze([
  { id: 'MANIFEST_CONSISTENT', phase: 'PREPARE', required: true, kind: 'inline', detail: 'manifesto canônico de suítes consistente com o disco', implements: 'lib/releaseSuiteManifest.resolveManifest' },
  { id: 'ANTI_GREENWASHING', phase: 'VERIFY', required: true, kind: 'command', command: 'node scripts/governance/validate-anti-greenwashing.js', detail: 'nenhuma suíte autoritativa com mecanismo de pulo silencioso', produces: ['reports/anti-greenwashing-report.json'] },
  { id: 'SUITE_EXECUTION', phase: 'VERIFY', required: true, kind: 'command', command: 'node scripts/governance/run-release-suites.js', env: { RELEASE_AUTHORITATIVE: '1' }, detail: 'execução canônica das suítes do manifesto', produces: ['reports/release-suite-execution.json'] },
  { id: 'REQUIREMENTS_MATRIX', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/generate-v2-requirements-matrix.js', detail: 'matriz derivada dos eixos verificáveis', produces: ['reports/engineering-router-v2-requirements-matrix.json'], dependsOn: ['SUITE_EXECUTION', 'ANTI_GREENWASHING'] },
  { id: 'MISSION_CRASH_RECOVERY', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/verify-mission-crash-recovery.js', detail: 'crash real do worker (SIGKILL) retomado por varredura automática', produces: ['reports/mission-crash-recovery-report.json'] },
  { id: 'REAL_TASK_RECOVERY', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/verify-real-task-recovery.js', detail: 'crash real no MEIO da execução da TASK, retomada sem comando humano', produces: ['reports/real-task-recovery-report.json'] },
  { id: 'ENVELOPE_GENERATE', phase: 'SEAL', required: true, kind: 'command', command: `node scripts/governance/generate-engineering-router-v2-audit-envelope.js ${ENVELOPE_DIR}`, detail: 'GERA o envelope físico de auditoria', produces: [ENVELOPE_DIR] },
  { id: 'ENVELOPE_VERIFY', phase: 'SEAL', required: true, kind: 'command', command: `node scripts/governance/verify-engineering-router-v2-audit-envelope.js ${ENVELOPE_DIR}`, detail: 'VERIFICA o envelope JÁ EXISTENTE (nunca regenera)', dependsOn: ['ENVELOPE_GENERATE'] },
  { id: 'V2_DECISION', phase: 'DECIDE', required: true, kind: 'command', command: 'node scripts/governance/validate-engineering-router-v2.js', detail: 'decisão do selo V2 (deriva os eixos e as pendências de relatórios reais)', produces: ['reports/engineering-router-v2-seal-report.json'], dependsOn: ['ENVELOPE_VERIFY', 'REQUIREMENTS_MATRIX'] },
]);

/** Checagem de ORDEM: dependência de fase posterior é violação detectada ANTES de executar. */
function validateOrder(steps) {
  const phaseIndex = new Map(PHASES.map((phase, index) => [phase, index]));
  const byId = new Map(steps.map((step) => [step.id, step]));
  const violations = [];
  for (const step of steps) {
    for (const dependencyId of step.dependsOn || []) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        violations.push({ code: 'SEAL_UNKNOWN_DEPENDENCY', step: step.id, detail: `dependência inexistente: ${dependencyId}` });
        continue;
      }
      if (phaseIndex.get(dependency.phase) > phaseIndex.get(step.phase)) {
        violations.push({
          code: 'SEAL_PHASE_ORDER_VIOLATION',
          step: step.id,
          detail: `${step.id} (${step.phase}) depende de ${dependencyId} (${dependency.phase}), que é de fase POSTERIOR`,
        });
      }
    }
  }
  return violations;
}

function runStep(step) {
  if (step.kind === 'inline') {
    try {
      const { resolveManifest } = require('./lib/releaseSuiteManifest');
      const manifest = resolveManifest();
      return {
        status: manifest.ok ? SEAL_STATUS.PASS : SEAL_STATUS.FAIL,
        detail: manifest.ok
          ? `${manifest.authoritative.length} suítes autoritativas, ${manifest.excluded.length} excluídas, ${manifest.unusedExclusions.length} exclusão(ões) inerte(s)`
          : `${manifest.violations.length} violação(ões) no manifesto: ${manifest.violations.slice(0, 3).map((v) => v.code).join(', ')}`,
      };
    } catch (error) {
      return { status: SEAL_STATUS.FAIL, detail: error.message };
    }
  }

  const [bin, ...args] = step.command.split(' ');
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    env: { ...process.env, ...(step.env || {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const stderrTail = (result.stderr || '').split('\n').filter(Boolean).slice(-6).join(' | ');
  if (result.status === 0) return { status: SEAL_STATUS.PASS, detail: 'exit=0', stderrTail };

  // Ausência de credencial externa é ESTADO declarado, nunca FAIL por motivo errado nem PASS.
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (/CREDENTIAL_UNAVAILABLE|no credential|sem credencial|401|403/.test(combined) && step.credentialDependent) {
    return { status: SEAL_STATUS.NOT_APPLICABLE, detail: 'credencial externa ausente', stderrTail };
  }
  return { status: SEAL_STATUS.FAIL, detail: `exit=${result.status}${result.signal ? ` signal=${result.signal}` : ''}`, stderrTail };
}

function main() {
  const showPlan = process.argv.includes('--plan');
  const fromIndex = process.argv.indexOf('--from');
  const fromId = fromIndex >= 0 ? process.argv[fromIndex + 1] : null;

  const orderViolations = validateOrder(STEPS);
  if (showPlan) {
    for (const step of STEPS) {
      console.log(`  [${step.phase}] ${step.id}${step.dependsOn ? ` (depois de ${step.dependsOn.join(', ')})` : ''} — ${step.detail}`);
    }
    console.log(`[seal-v2:plan] passos=${STEPS.length} violações de ordem=${orderViolations.length}`);
    process.exit(orderViolations.length === 0 ? 0 : 1);
  }

  const report = {
    artifactType: 'engineering-router-v2-seal-execution',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    authoritativeMode: process.env.RELEASE_AUTHORITATIVE === '1',
    phases: PHASES,
    orderViolations,
    orderViolationCount: orderViolations.length,
    steps: [],
    status: 'NO_GO',
    decisions: { ENGINEERING_ROUTER_V2: 'NO_GO', RAP_FINAL_RELEASE: 'NO_GO_INDEPENDENTE' },
  };

  if (orderViolations.length > 0) {
    // Ordem inválida = não se executa nada: um plano inconsistente produziria evidência que não
    // corresponde à sequência declarada.
    writeReport(REPORT, report);
    for (const v of orderViolations) console.error(`  - ${v.code} :: ${v.step} — ${v.detail}`);
    console.error('[seal-v2] sequência inválida — nada executado');
    process.exit(1);
  }

  let started = !fromId;
  for (const step of STEPS) {
    if (!started) {
      if (step.id === fromId) started = true;
      else {
        report.steps.push({ id: step.id, phase: step.phase, status: 'SKIPPED_BY_FROM', detail: `--from ${fromId}` });
        continue;
      }
    }
    const outcome = runStep(step);
    report.steps.push({
      id: step.id,
      phase: step.phase,
      required: step.required !== false,
      detail: step.detail,
      implements: step.implements || step.command,
      ...outcome,
    });
    console.log(`  [${outcome.status}] ${step.id} — ${outcome.detail}`);
    if (outcome.status === SEAL_STATUS.FAIL && step.required !== false) {
      console.error(`[seal-v2] ABORTADO no passo obrigatório ${step.id}`);
      break;
    }
  }

  const failed = report.steps.filter((s) => s.status === SEAL_STATUS.FAIL);
  const notRun = report.steps.filter((s) => s.status === 'SKIPPED_BY_FROM');
  report.status = failed.length === 0 && notRun.length === 0 ? 'GO' : 'NO_GO';
  report.decisions.ENGINEERING_ROUTER_V2 = report.status;

  writeReport(REPORT, report);
  console.log(`[seal-v2] status=${report.status} passos=${report.steps.length} falhas=${failed.length} não-executados=${notRun.length}`);
  console.log('[seal-v2] RAP_FINAL_RELEASE permanece NO_GO_INDEPENDENTE — este sealer nunca promove o release da plataforma');
  process.exit(report.status === 'GO' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { STEPS, PHASES, validateOrder, SEAL_STATUS };
