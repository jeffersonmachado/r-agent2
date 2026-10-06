#!/usr/bin/env node
'use strict';

/**
 * collect-engineering-router-runtime-evidence.js — ERV1-CLOSE-010 (Runtime certification) /
 * ER-V1-FINAL-007 (Evidence Precision).
 *
 * O gate `validate-engineering-router-v1.js` provava até aqui apenas STRUCTURAL_PASS: que o
 * código-fonte CONTÉM os padrões esperados (regex sobre arquivo). Isso nunca prova que o
 * comportamento realmente acontece em runtime — código morto, testes quebrados silenciosamente,
 * ou uma regressão introduzida depois do commit em que o check foi escrito passariam
 * despercebidos. Este script fecha essa lacuna: executa de verdade, via Jest, o teste que prova
 * cada item de evidência de runtime exigido pela missão de fechamento.
 *
 * ER-V1-FINAL-007 — achado real reproduzido: a versão anterior deste script rodava o ARQUIVO
 * INTEIRO (`npx jest <testPath>`) e considerava o requirement provado se `exitCode === 0` — sem
 * nenhuma granularidade sobre QUAL teste, dentro do arquivo, prova aquele requirement
 * específico. Reprodução ao vivo: `test.skip`-ando o único teste que prova
 * `SUPPORT_DENIAL_DEFAULT` em `engineeringRouterRoutes.test.js` (mantendo os outros 11 testes
 * do arquivo intactos), o arquivo inteiro continuava saindo com `exitCode 0` — o requirement
 * seria certificado como provado mesmo sem nenhum teste real cobrindo-o. Corrigido: cada item
 * agora executa com `--testNamePattern` (`-t`) restrito ao(s) teste(s) específico(s) que provam
 * aquele requirement, e usa `--json` para validar `numPassedTests >= 1` — um item cujo teste foi
 * removido/renomeado/skipado faz o Jest reportar `numPassedTests: 0` mesmo com `exitCode 0`
 * ("no tests matched", nunca silenciosamente aceito como prova).
 *
 * Uso: node scripts/governance/collect-engineering-router-runtime-evidence.js
 * (chamado por `npm run validate:engineering-router-v1:runtime`, e como parte do pipeline de
 * fechamento antes do gate agregado).
 */

const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, writeReport } = require('./common');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { loadEnvFile } = require('./lib/loadEnvFile');

// DEFEITO REAL medido em 2026-10-01: as suítes daqui exercitam serviços REAIS configurados pelo
// `.env` (ex.: o Engineering Runner dedicado, que só aceita cwd sob
// `ENGINEERING_ROUTER_WORKSPACE_ROOT`). Sem carregá-lo, o veredito dependia de QUEM invocava o
// processo: o item `SAFE_ENVIRONMENT` reprovava com `exitCode: null` / "saída do Jest não pôde
// ser parseada como JSON" — reprovação por CONFIGURAÇÃO, não por defeito do sandbox (com a
// chave presente: 3/3 PASS). Mesmo padrão já aplicado em `run-release-suites.js`.
loadEnvFile(ROOT);

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** O diretório é um work tree git? (`git` indisponível ou fora de repo ⇒ false.) */
function isGitWorkTree(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'true';
  } catch (_) {
    return false;
  }
}

/**
 * GUARD DE AMBIENTE — fail-closed ANTES dos 25 testes.
 *
 * MEDIDO em 2026-10-05: `ENGINEERING_ROUTER_HOST_REPO_ROOT=/opt/results/ria` (a variável
 * vazou para o shell compartilhado ao subir `docker compose` para o smoke agendado — e
 * `/opt/results/ria` NÃO é repositório git; o repo é `/opt/results/ria/r-agent2`).
 * `api/services/engineeringRouter/{contextBuilderService,executionSandbox}.js` usam essa
 * variável como ROOT; com ela apontando para um não-repo, o sandbox falha em
 * `git rev-parse HEAD` e 10 dos 25 itens reprovam com
 * "saída do Jest não pôde ser parseada como JSON" — sintoma que acusa o RUNNER, não a
 * causa, e que já custou um ciclo de selagem inteiro na fase `consolidate`.
 *
 * O guard troca ~20 min de falha enganosa por 200 ms dizendo exatamente qual variável
 * está errada e como corrigir. Nunca "conserta" o ambiente por conta própria: só recusa.
 */
function assertRouterEnvironmentUsable() {
  const declared = String(process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT || '').trim();
  if (declared) {
    const resolved = path.resolve(declared);
    if (!isGitWorkTree(resolved)) {
      process.stderr.write(
        '[runtime-evidence] ENV_HOST_REPO_ROOT_NOT_A_GIT_REPO — ENGINEERING_ROUTER_HOST_REPO_ROOT='
        + `${resolved} não é um repositório git.\n`
        + '  O Engineering Router resolve `git rev-parse HEAD` nesse diretório quando a variável está\n'
        + '  definida; fora de um repo, os itens de runtime reprovam com "saída do Jest não pôde ser\n'
        + '  parseada como JSON" (falha de AMBIENTE, não de código).\n'
        + '  Remédio: `unset ENGINEERING_ROUTER_HOST_REPO_ROOT` (o default é este repositório) ou aponte\n'
        + `  a variável para um clone git válido. Repositório desta aplicação: ${ROOT}\n`,
      );
      return { ok: false, declared: resolved };
    }
    return { ok: true, declared: resolved };
  }
  if (!isGitWorkTree(ROOT)) {
    process.stderr.write(`[runtime-evidence] ENV_REPO_ROOT_NOT_A_GIT_REPO — ${ROOT} não é repositório git.\n`);
    return { ok: false, declared: ROOT };
  }
  return { ok: true, declared: null };
}

// Cada item mapeia para um teste REAL específico já existente no repositório (nunca um teste
// novo criado só para "passar o gate", nunca um arquivo inteiro sem granularidade). `testId` é
// o nome exato (ou uma substring única e estável) do `test(...)`/`describe(...) > test(...)`
// real — usado como `--testNamePattern` do Jest, então precisa ser seguro como regex (parênteses/
// colchetes/asteriscos evitados deliberadamente nos patterns escolhidos abaixo).
const RUNTIME_ITEMS = [
  { id: 'SHELL_INJECTION_REJECTED', testPath: 'tests/unit/engineeringRouterCommandExecutionSecurity.test.js', testId: 'REJECTED ou sem efeito colateral real' },
  { id: 'SAFE_ENVIRONMENT', testPath: 'tests/unit/engineeringRouterSafeEnvironment.test.js', testId: 'subprocess não recebe nenhum secret real por default' },
  { id: 'SECRET_REDACTION_MULTILINE', testPath: 'tests/unit/engineeringRouterSecretRedactionMultiline.test.js', testId: 'PEM genérico multiline é redigido' },
  { id: 'PATCH_PATH_BOUNDARIES', testPath: 'tests/unit/engineeringRouterPathBoundary.test.js', testId: 'travessia profunda o bastante para subir acima da raiz' },
  { id: 'ACTUAL_PATCH_APPLY', testPath: 'tests/integration/engineeringPatchApplyAndTestRunner.test.js', testId: 'cria workspace isolado, aplica patch real' },
  { id: 'DETERMINISTIC_FAILING_TEST_RED', testPath: 'tests/integration/engineeringRouterFullLoopE2E.test.js', testId: 'confirma RED antes do patch' },
  { id: 'RED_TO_FIX', testPath: 'tests/integration/engineeringRouterFullLoopE2E.test.js', testId: 'task BUG_FIX completa o loop real e chega a GREEN' },
  { id: 'INDEPENDENT_REVIEW', testPath: 'tests/unit/engineeringRouterModelSelector.test.js', testId: 'independência de provider é aplicada quando há dois providers' },
  { id: 'REVIEWER_REJECTION_RECODE', testPath: 'tests/integration/engineeringRouterReviewerRejectionRecodeE2E.test.js', testId: 'tentativa é rejeitada pelo reviewer' },
  { id: 'REGRESSION_EXECUTION', testPath: 'tests/integration/engineeringRegressionGovernanceService.test.js', testId: 'comandos do plano executam de verdade e passam' },
  { id: 'GOVERNANCE_EXECUTION', testPath: 'tests/integration/engineeringRouterRegressionGovernanceGate.test.js', testId: 'mas GOVERNANCE real reprova' },
  { id: 'PROVIDER_MODEL_FAILURE_REROUTE', testPath: 'tests/integration/engineeringRouterModelRerouteE2E.test.js', testId: 'CODER indisponível' },
  { id: 'RESTART_RESUME', testPath: 'tests/integration/engineeringTaskConcurrencyAndRestart.test.js', testId: 'não duplica a transição' },
  { id: 'CRASH_RESUME_MID_STAGE', testPath: 'tests/integration/engineeringTaskConcurrencyAndRestart.test.js', testId: 'sem regredir o estado' },
  { id: 'CONTROLLED_PROMOTION', testPath: 'tests/integration/engineeringPromotionService.test.js', testId: 'promove com sucesso: commit real' },
  { id: 'POST_PROMOTION_VERIFICATION', testPath: 'tests/integration/engineeringPromotionService.test.js', testId: 'promove com sucesso: commit real' },
  { id: 'EXACT_PATCH_PROMOTION', testPath: 'tests/integration/engineeringPromotionService.test.js', testId: 'promoção legítima expõe expectedTreeHash' },
  { id: 'FAIL_CLOSED_SCOPE', testPath: 'tests/unit/engineeringRouterFailClosedScope.test.js', testId: 'NO_PATCH_SCOPE' },
  { id: 'DEVELOPMENT_AUTHORIZATION', testPath: 'tests/unit/engineeringRouterRoutes.test.js', testId: 'retorna 200 para usuário DEVELOPMENT' },
  { id: 'PRODUCTION_DENIAL', testPath: 'tests/unit/engineeringRouterRoutes.test.js', testId: 'classification é PRODUCTION explicitamente' },
  { id: 'SUPPORT_DENIAL_DEFAULT', testPath: 'tests/unit/engineeringRouterRoutes.test.js', testId: 'classification é SUPPORT' },
  { id: 'TENANT_CREDENTIAL_ISOLATION', testPath: 'tests/unit/engineeringRouterRoutes.test.js', testId: 'ERV1-CLOSE-006' },
  { id: 'RELEASE_CLOSURE_SAME_RUN_INTEGRITY', testPath: 'tests/integration/engineeringReleaseClosureAuthority.test.js', testId: 'nunca declara cleanReleaseState' },
  { id: 'EXECUTION_SANDBOX_ISOLATION', testPath: 'tests/unit/engineeringRouterExecutionSandboxSecurity.test.js', testId: 'não acessa rede externa' },
  { id: 'MODEL_CATALOG_GOVERNANCE', testPath: 'tests/integration/engineeringModelCatalogService.test.js', testId: 'ausente da allowlist estática' },
];

/**
 * Roda `testPath` restrito a `testId` (via `--testNamePattern`) e usa `--json` para extrair
 * dados estruturados — nunca confia só no exitCode do processo. `numPassedTests === 0` (nenhum
 * teste bateu o pattern: removido, renomeado, ou skipado) é SEMPRE tratado como falha, mesmo
 * que o processo Jest em si saia com exitCode 0 (achado real: "no tests matched" sai com
 * exitCode 0 por padrão).
 */
function runTargetedTest(testPath, testId) {
  const startedAt = new Date().toISOString();
  const args = ['jest', '--config', 'jest.config.cjs', testPath, '--testNamePattern', testId, '--json'];
  let raw = '';
  let processExitCode = 0;
  let stderrTail = '';
  let terminationDetail = null;
  try {
    // Achado real: testes E2E reais (git real, subprocess real) produzem saída --json que
    // ultrapassa o maxBuffer default do execFileSync (1MB) — o processo era morto e o stdout
    // truncado, quebrando o JSON.parse mesmo com o teste tendo passado de verdade.
    raw = execFileSync('npx', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120000,
      // Ambiente explícito e completo: o `.env` já foi carregado acima (loadEnvFile) e o filho
      // precisa do MESMO ambiente do coletor — sem isto o veredito depende de quem invoca.
      env: process.env,
    });
  } catch (err) {
    processExitCode = typeof err.status === 'number' ? err.status : 1;
    raw = err.stdout || '';
    // O stderr do filho é a ÚNICA fonte da causa quando o reporter do Jest não chega a rodar
    // (globalSetup quebrado, runner que não sobe, timeout/morte do processo). DEFEITO REAL medido
    // em 2026-10-02: descartá-lo produziu 25 falhas IDÊNTICAS e indistinguíveis ("crash antes do
    // reporter") sem nenhum caminho para o diagnóstico — o Jest tinha impresso a causa e ela foi
    // jogada fora. Mesmo tratamento dado aos lotes em `run-release-suites.js` (stdoutTail/stderrTail).
    stderrTail = (err.stderr || '').split('\n').map((line) => line.trimEnd()).filter(Boolean).slice(-15).join('\n');
    if (err.signal) terminationDetail = `morto por sinal ${err.signal}`;
    else if (err.code === 'ETIMEDOUT') terminationDetail = 'timeout do execFileSync (120000ms)';
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    // saída não-JSON (crash antes do reporter rodar) — trata como falha explícita abaixo.
  }

  const finishedAt = new Date().toISOString();
  if (!parsed) {
    return {
      pass: false,
      processExitCode: processExitCode || 1,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      matchedTestNames: [],
      reason: `saída do Jest não pôde ser parseada como JSON (crash antes do reporter)${terminationDetail ? ` — ${terminationDetail}` : ''} — stderr: ${stderrTail ? stderrTail.split('\n')[0].slice(0, 300) : '(vazio)'}`,
      stderrTail: stderrTail || null,
      startedAt,
      finishedAt,
    };
  }

  const matchedTestNames = [];
  for (const suite of parsed.testResults || []) {
    for (const assertion of suite.assertionResults || []) {
      matchedTestNames.push({ fullName: assertion.fullName, status: assertion.status });
    }
  }

  const numPassedTests = parsed.numPassedTests || 0;
  const numFailedTests = parsed.numFailedTests || 0;
  const numPendingTests = parsed.numPendingTests || 0;

  // Achado real: "no tests matched" sai com processExitCode 0 e numPassedTests 0 — sem esta
  // checagem explícita, um teste removido/renomeado seria certificado como provado.
  const pass = processExitCode === 0 && numPassedTests >= 1 && numFailedTests === 0;

  let reason;
  if (numPassedTests === 0 && numFailedTests === 0 && numPendingTests === 0) {
    reason = `nenhum teste casou com o pattern "${testId}" em ${testPath} — removido, renomeado ou nunca existiu`;
  } else if (numPendingTests > 0 && numPassedTests === 0) {
    reason = `todos os testes que casaram com "${testId}" estão skip/pending — nenhuma prova real de comportamento`;
  } else if (numFailedTests > 0) {
    reason = `${numFailedTests} teste(s) que casaram com "${testId}" falharam`;
  }

  return {
    pass,
    processExitCode,
    numPassedTests,
    numFailedTests,
    numPendingTests,
    matchedTestNames,
    reason,
    startedAt,
    finishedAt,
  };
}

function main() {
  const environment = assertRouterEnvironmentUsable();
  if (!environment.ok) process.exit(2); // 2 = ambiente recusado (≠ 1 = item de runtime reprovado)
  const sourceCommit = currentCommit();
  // Reutiliza a MESMA autoridade de fingerprint já usada pelo resto da governança do RAP
  // (governance/proof-engine/fingerprint-chain.js), em vez de um hash paralelo — amarra a
  // evidência de runtime ao conteúdo REAL da working tree no momento da execução (inclusive
  // alterações ainda não commitadas), não só ao HEAD do git.
  const sourceFingerprint = computeSourceFingerprint(ROOT);
  const items = [];

  for (const item of RUNTIME_ITEMS) {
    process.stdout.write(`[runtime-evidence] rodando ${item.id} (${item.testPath} :: "${item.testId}")...\n`);
    const result = runTargetedTest(item.testPath, item.testId);
    const evidenceHash = crypto.createHash('sha256')
      .update(JSON.stringify({ id: item.id, testPath: item.testPath, testId: item.testId, result }))
      .digest('hex');
    items.push({
      id: item.id,
      testSuite: item.testPath,
      testCaseId: item.testId,
      assertionResult: result.matchedTestNames,
      pass: result.pass,
      exitCode: result.pass ? 0 : (result.processExitCode || 1),
      numPassedTests: result.numPassedTests,
      numFailedTests: result.numFailedTests,
      numPendingTests: result.numPendingTests,
      reason: result.reason || null,
      stderrTail: result.stderrTail || null,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      sourceFingerprint,
      runId: sourceCommit,
      evidenceHash,
    });
  }

  const failed = items.filter((i) => !i.pass);
  // O progresso vai para stdout (convenção já existente neste coletor); a CAUSA da falha vai para
  // stderr, para que o diagnóstico seja separável do fluxo de progresso e do relatório em disco.
  for (const item of failed) {
    if (item.stderrTail) process.stderr.write(`[runtime-evidence] ${item.id} — stderr do filho:\n${item.stderrTail}\n`);
  }
  const report = {
    artifactType: 'engineering-router-v1-runtime-evidence',
    artifactVersion: '2.0.0',
    sourceCommit,
    sourceFingerprint,
    status: failed.length === 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    totalItems: items.length,
    failedItems: failed.length,
    items,
  };

  writeReport('engineering-router-v1-runtime-evidence.json', report);
  process.stdout.write(`[runtime-evidence] status=${report.status} items=${items.length} falhas=${failed.length} commit=${sourceCommit} fingerprint=${sourceFingerprint.slice(0, 16)}…\n`);
  if (failed.length > 0) {
    for (const f of failed) process.stdout.write(` - ${f.id} (${f.testSuite} :: "${f.testCaseId}"): ${f.reason || `exitCode=${f.exitCode}`}\n`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

module.exports = { RUNTIME_ITEMS, isGitWorkTree, assertRouterEnvironmentUsable };

// ER-V1-FINAL-009 (Full-Suite Isolation) — achado real: `validate-engineering-router-v1.js`
// (REQUIRED_RUNTIME_ITEM_IDS) e `tests/integration/engineeringRouterMandatoryRuntimeGate.test.js`
// mantinham CÓPIAS hardcoded desta mesma lista de IDs — cada blocker que adicionava um item novo
// (007, 008) tinha que lembrar de atualizar as 3 cópias manualmente, e o teste do gate (já
// GREEN desde ER-V1-FINAL-004) divergiu silenciosamente depois de 007/008 (2 IDs novos ausentes
// da cópia do teste, e a fixture sintética sem os campos do schema v2.0.0). Corrigido: os dois
// outros lugares agora importam `RUNTIME_ITEMS` deste módulo em vez de duplicar — autoridade
// única de verdade, nunca mais pode divergir. O guard abaixo garante que `require()`-ar este
// arquivo NUNCA dispara os 25 testes Jest reais (main() só roda via CLI direto).
if (require.main === module) {
  main();
}
