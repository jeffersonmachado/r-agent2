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
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { applyOriginLineage, resolveRunLineage } = require('./lib/resolve-run-lineage');

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
  // DATABASE/MIGRATIONS (missão 2026-09-28): o pipeline precisa provar que o schema em uso está em
  // dia. `npm run db:migrate:status` NÃO servia de gate (sempre sai 0); este validador é fail-closed
  // e usa a mesma autoridade de migrations do runtime.
  { id: 'MIGRATIONS', phase: 'PREPARE', required: true, kind: 'command', command: 'node --env-file-if-exists=.env scripts/governance/validate-migrations-applied.js', detail: 'DB acessível e ZERO migrations pendentes (schema em dia)', produces: ['reports/migrations-applied-report.json'] },
  // EVIDÊNCIA DE RUNTIME V1 (missão 2026-09-28): a suíte de geração do envelope de auditoria exige
  // evidência de runtime FRESCA para o sourceFingerprint atual. Sem coletá-la dentro do pipeline,
  // qualquer alteração de código invalidava a evidência anterior e a suíte ficava sem sinal —
  // exatamente o que aconteceu quando a suíte entrou no manifesto e o anti-greenwashing expôs o
  // pulo silencioso. Aqui a coleta roda ANTES da execução das suítes, com o fingerprint corrente.
  // O binding entre cada item e o teste que o prova é validado por
  // tests/unit/governance/runtimeEvidenceBinding.test.js (achado real: um testId stale deixava um
  // item sem prova e o gate acusava RUNTIME_FAIL).
  { id: 'V1_RUNTIME_EVIDENCE', phase: 'VERIFY', required: true, kind: 'command', command: 'node --env-file-if-exists=.env scripts/governance/collect-engineering-router-runtime-evidence.js && node --env-file-if-exists=.env scripts/governance/validate-engineering-router-v1.js --runtime', detail: 'coleta executando os 25 testes reais de runtime do Router V1 e deriva o veredito', produces: ['reports/engineering-router-v1-runtime-evidence.json'], dependsOn: ['MIGRATIONS'] },
  { id: 'ANTI_GREENWASHING', phase: 'VERIFY', required: true, kind: 'command', command: 'node scripts/governance/validate-anti-greenwashing.js', detail: 'nenhuma suíte autoritativa com mecanismo de pulo silencioso', produces: ['reports/anti-greenwashing-report.json'] },
  { id: 'SUITE_EXECUTION', phase: 'VERIFY', required: true, kind: 'command', command: 'node scripts/governance/run-release-suites.js', env: { RELEASE_AUTHORITATIVE: '1' }, detail: 'execução canônica das suítes do manifesto', produces: ['reports/release-suite-execution.json'], dependsOn: ['V1_RUNTIME_EVIDENCE'] },
  { id: 'REQUIREMENTS_MATRIX', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/generate-v2-requirements-matrix.js', detail: 'matriz derivada dos eixos verificáveis', produces: ['reports/engineering-router-v2-requirements-matrix.json'], dependsOn: ['SUITE_EXECUTION', 'ANTI_GREENWASHING'] },
  // TESTES OBRIGATÓRIOS V2 (missão 2026-09-28): a seção "38. TESTES OBRIGATÓRIOS V2" do prompt
  // original exige provar individualmente V2-01..V2-42. O manifesto versionado
  // (config/engineering-router-v2-required-tests.json) traz os enunciados verbatim e a prova de
  // cada ID; este passo deriva o estado do valor REAL (suíte na execução autoritativa + relatório
  // declarado, com TTL) e FALHA se qualquer ID ficar sem prova. Não ficar fora do selo era
  // justamente o defeito: um requisito obrigatório que o pipeline não enxerga não governa nada.
  { id: 'REQUIRED_TESTS_V2', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/validate-engineering-router-v2-required-tests.js', detail: 'os 42 testes obrigatórios provados individualmente (V2-01..V2-42)', produces: ['reports/engineering-router-v2-required-tests-report.json'], dependsOn: ['SUITE_EXECUTION'] },
  { id: 'MISSION_CRASH_RECOVERY', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/verify-mission-crash-recovery.js', detail: 'crash real do worker (SIGKILL) retomado por varredura automática', produces: ['reports/mission-crash-recovery-report.json'] },
  { id: 'REAL_TASK_RECOVERY', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/verify-real-task-recovery.js', detail: 'crash real no MEIO da execução da TASK, retomada sem comando humano', produces: ['reports/real-task-recovery-report.json'] },
  // TIMEOUT_ARCHITECTURE entra no PIPELINE do selo (missão 2026-09-28). Antes, a arquitetura de
  // timeouts vivia em um script lateral de governança: o selo podia ser GO sem que lease,
  // heartbeat, fence, deadline e detecção de ausência de progresso estivessem provados no runtime.
  // São DOIS passos porque são duas provas distintas: o E2E produz a evidência de runtime contra o
  // banco real (task longa, worker morto, NO_PROGRESS, fallback de provider) e o validador deriva o
  // veredito dessa evidência + inventário. O V2_DECISION depende do veredito.
  { id: 'TIMEOUT_ARCHITECTURE_E2E', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node --env-file-if-exists=.env scripts/governance/verify-timeout-architecture-e2e.js', detail: 'prova em runtime real: task longa sobrevive, worker morto é recuperado, NO_PROGRESS ≠ DEAD, provider cai para fallback', produces: ['reports/timeout-architecture-evidence.json'] },
  { id: 'TIMEOUT_ARCHITECTURE', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/validate-timeout-architecture.js', detail: 'veredito da arquitetura de timeouts (inventário semântico + evidência de runtime)', produces: ['reports/TIMEOUT_ARCHITECTURE_REPORT.json'], dependsOn: ['TIMEOUT_ARCHITECTURE_E2E'] },
  // CICLO AUTÔNOMO DE BUG (missão 2026-09-29). Um bug descoberto durante a missão precisa voltar ao
  // loop de engenharia SOZINHO — sem ZIP novo, sem prompt novo, sem missão nova. O gate deriva o
  // veredito `BUG_AUTONOMOUS_LOOP` da execução AUTORITATIVA das suítes BUG-01..BUG-20 (declaradas em
  // config/engineering-bug-loop-required-tests.json) e recusa qualquer prova enfraquecida
  // (skip/only/xit, suíte removida, suíte fora do manifesto). Fica DEPOIS de SUITE_EXECUTION porque
  // consome o estado real dela — nunca presume.
  { id: 'BUG_AUTONOMOUS_LOOP', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node scripts/governance/validate-bug-autonomous-loop.js', detail: 'ciclo detecta→reproduz→confirma→tarefa→corrige→regressão→retoma missão, provado em runtime', produces: ['reports/bug-autonomous-loop-report.json'], dependsOn: ['SUITE_EXECUTION'] },
  // MISSION_RAG (missão 2026-09-28): a saúde do corpus é MEDIDA no banco e publicada como relatório;
  // o selo consome essa medição (nunca o eixo estático do status report, que é saída).
  { id: 'RAG_INDEX_HEALTH', phase: 'EVIDENCE', required: true, kind: 'command', command: 'node --env-file-if-exists=.env scripts/governance/validate-rag-index-health.js', detail: 'corpus RAG medido no banco: nenhum indexed sem chunks, failed declarado', produces: ['reports/rag-index-health-report.json'] },
  { id: 'ENVELOPE_GENERATE', phase: 'SEAL', required: true, kind: 'command', command: `node scripts/governance/generate-engineering-router-v2-audit-envelope.js ${ENVELOPE_DIR}`, detail: 'GERA o envelope físico de auditoria', produces: [ENVELOPE_DIR] },
  { id: 'ENVELOPE_VERIFY', phase: 'SEAL', required: true, kind: 'command', command: `node scripts/governance/verify-engineering-router-v2-audit-envelope.js ${ENVELOPE_DIR}`, detail: 'VERIFICA o envelope JÁ EXISTENTE (nunca regenera)', dependsOn: ['ENVELOPE_GENERATE'] },
  { id: 'V2_DECISION', phase: 'DECIDE', required: true, kind: 'command', command: 'node scripts/governance/validate-engineering-router-v2.js', detail: 'decisão do selo V2 (deriva os eixos e as pendências de relatórios reais)', produces: ['reports/engineering-router-v2-seal-report.json'], dependsOn: ['ENVELOPE_VERIFY', 'REQUIREMENTS_MATRIX', 'TIMEOUT_ARCHITECTURE', 'REQUIRED_TESTS_V2', 'BUG_AUTONOMOUS_LOOP'] },
  // CONFIRMAÇÃO ITEM A ITEM da auditoria (missão 2026-09-28): cada item citado pela auditoria é
  // confirmado contra a prova real e classificado (ALREADY_FIXED/CONFIRMED/REGRESSED/...).
  //
  // POSIÇÃO: DEPOIS de `V2_DECISION`, e não antes. DEFEITO REAL medido em 2026-09-28: na posição
  // antiga (EVIDENCE) este passo lia `reports/engineering-router-v2-seal-report.json` — que só é
  // escrito pelo passo de DECISÃO que roda depois dele. Resultado: a confirmação avaliava o selo da
  // geração ANTERIOR e terminava em FAIL de forma sistemática (3 runs seguidas), mesmo com o selo
  // corrente em GO. Confirmar item a item só faz sentido sobre a decisão JÁ PUBLICADA.
  //
  // `required: false` DE PROPÓSITO: além do selo, ele cobre itens de release da PLATAFORMA
  // (`RAP_FINAL_RELEASE`, `FINAL_GOVERNANCE_CONSISTENCY`), que só ficam verdes fora deste pipeline.
  // Exigi-lo como obrigatório criaria dependência circular; a falha de evidência é DECLARADA
  // (nunca silenciada) e o enforcement do escopo do Router vive nos itens do selo.
  { id: 'AUDIT_ITEMS_CONFIRMATION', phase: 'DECIDE', required: false, kind: 'command', command: 'node scripts/governance/validate-engineering-router-v2-audit-items.js', detail: 'cada item da auditoria confirmado contra a prova real JÁ PUBLICADA (evidência pós-decisão; enforcement no escopo do Router)', produces: ['reports/engineering-router-v2-audit-items-report.json'], dependsOn: ['V2_DECISION'] },
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

  const report = applyOriginLineage({
    artifactType: 'engineering-router-v2-seal-execution',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    // BINDING AO SOURCE: o selo autoriza UM código específico. Sem o fingerprint do source, um selo
    // antigo autorizaria qualquer pacote — e o pipeline de ZIP não teria como recusar.
    sourceFingerprint: computeSourceFingerprint(ROOT),
    authoritativeMode: process.env.RELEASE_AUTHORITATIVE === '1',
    phases: PHASES,
    orderViolations,
    orderViolationCount: orderViolations.length,
    steps: [],
    status: 'NO_GO',
    decisions: { ENGINEERING_ROUTER_V2: 'NO_GO', RAP_FINAL_RELEASE: 'NO_GO_INDEPENDENTE' },
  }, resolveRunLineage({ rootDir: ROOT }));

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

  const derived = deriveSealStatus(report.steps);
  report.status = derived.status;
  report.failedRequired = derived.failedRequired;
  report.failedOptionalEvidence = derived.failedOptionalEvidence;
  report.evidencePendencies = derived.evidencePendencies;
  report.decisions.ENGINEERING_ROUTER_V2 = report.status;

  writeReport(REPORT, report);
  for (const entry of derived.evidencePendencies) {
    console.log(`[seal-v2] EVIDÊNCIA não obrigatória em FAIL: ${entry.id} — ${entry.detail}`);
  }
  console.log(`[seal-v2] status=${report.status} passos=${report.steps.length} falhas-obrigatórias=${derived.failedRequired.length} falhas-evidência=${derived.failedOptionalEvidence.length} não-executados=${derived.notRun.length}`);
  console.log('[seal-v2] RAP_FINAL_RELEASE permanece NO_GO_INDEPENDENTE — este sealer nunca promove o release da plataforma');
  process.exit(report.status === 'GO' ? 0 : 1);
}

/**
 * STATUS DO SELO — núcleo puro, derivado do que foi OBSERVADO em cada passo.
 *
 * DEFEITO REAL corrigido em 2026-09-28: a derivação olhava TODOS os passos que falharam, sem
 * distinguir `required`. Um passo declarado `required: false` (como AUDIT_ITEMS_CONFIRMATION, que
 * consome o resultado do PRÓPRIO selo e itens de release da plataforma — exigi-lo criaria
 * dependência circular) rebaixava o selo inteiro para NO_GO: a declaração de não-obrigatoriedade
 * existia no papel e não tinha efeito na decisão. O correto é fail-closed no que é obrigatório e
 * DECLARADO no que não é — a falha de evidência aparece como pendência nomeada, nunca silenciada
 * e nunca convertida em GO pleno.
 */
function deriveSealStatus(steps = []) {
  const list = Array.isArray(steps) ? steps : [];
  const failed = list.filter((s) => s.status === SEAL_STATUS.FAIL);
  const failedRequired = failed.filter((s) => s.required !== false);
  const failedOptionalEvidence = failed.filter((s) => s.required === false);
  const notRun = list.filter((s) => s.status === 'SKIPPED_BY_FROM');
  const evidencePendencies = failedOptionalEvidence.map((s) => ({ id: s.id, detail: s.detail }));
  return {
    status: failedRequired.length === 0 && notRun.length === 0 ? 'GO' : 'NO_GO',
    failedRequired: failedRequired.map((s) => s.id),
    failedOptionalEvidence: failedOptionalEvidence.map((s) => s.id),
    evidencePendencies,
    notRun: notRun.map((s) => s.id),
  };
}

if (require.main === module) main();

module.exports = { STEPS, PHASES, validateOrder, SEAL_STATUS, deriveSealStatus };
