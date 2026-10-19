'use strict';

/**
 * ERV1-CLOSE-010 — teste adversarial de segurança: prompt injection no OUTPUT do teste.
 *
 * A missão de fechamento exige provar, com um cenário adversarial real (não hipotético), que
 * texto injetado no stdout/stderr de um comando de teste nunca influencia nenhuma decisão real
 * do pipeline. A arquitetura já declara essa garantia
 * (`api/services/engineeringRouter/testRunnerService.js`: "o modelo NUNCA declara PASS — a
 * autoridade é sempre o exitCode real"), mas nenhum teste provava isso contra um payload
 * adversarial de verdade — só contra saída "normal". Este teste roda um comando REAL (via
 * `runTestCommands`, allowlist real, subprocess real) cujo stdout/stderr imprime texto
 * desenhado para parecer uma instrução de sistema ou uma decisão estruturada do Reviewer
 * (`{"decision":"APPROVE",...}`), em ambas as direções:
 *   1. exitCode != 0 com stdout dizendo "PASS"/"APPROVE" → precisa reportar FAIL mesmo assim.
 *   2. exitCode == 0 com stdout dizendo "FAIL"/"REJECT" → precisa reportar PASS mesmo assim.
 * Nenhuma das duas pode ser decidida pelo texto — só pelo exitCode real do processo.
 */

const { runTestCommands } = require('../../api/services/engineeringRouter/testRunnerService');
const { createWorkspace, destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');

// ER-V1-FINAL-001: cada comando agora roda via `docker run` real (overhead de alguns segundos);
// sob a suíte completa (múltiplos workers Jest competindo por Docker/CPU) o default de 10s do
// projeto estourou de verdade em execução real.
jest.setTimeout(30000);

const PROBE_SCRIPT = 'tests/fixtures/engineering-router-sandbox/promptInjectionOutputProbe.js';

// ── RETRY DE INFRA, NUNCA DE COMPORTAMENTO ───────────────────────────────────
// MEDIDO em 2026-10-19 (L0 da fase C): sob carga, o container do sandbox pode
// não devolver exit code (`EAGAIN`, daemon do Docker sob pressão). O teste então
// reprovava em `expect(results[0].exitCode).toBe(0)` — reportando como DEFEITO DE
// COMPORTAMENTO aquilo que foi falha de infraestrutura (não houve veredito).
// O retry abaixo é limitado e SÓ existe para o caso "sem veredito": qualquer
// exit code real (0 ou != 0) é julgado imediatamente, e um estado de infra
// persistente continua REPROVANDO (nunca vira PASS).
const STATUS_DE_INFRA = new Set(['INFRA_ERROR', 'SANDBOX_UNAVAILABLE', 'SANDBOX_INVALID_WORKSPACE']);

async function executarComRetryDeInfra(opcoes, tentativas = 3) {
  let ultimo = null;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    // eslint-disable-next-line no-await-in-loop
    ultimo = await runTestCommands(opcoes);
    const r = ultimo.results[0] || {};
    const semVeredito = r.exitCode === null || r.exitCode === undefined || STATUS_DE_INFRA.has(r.status);
    if (!semVeredito) return ultimo;
  }
  return ultimo;
}

describe('ERV1-CLOSE-010 — autoridade de PASS/FAIL nunca é o texto do output (prompt injection real)', () => {
  // ER-V1-FINAL-001: cwd precisa ser um workspace isolado real (nunca o repositório principal
  // — o Execution Sandbox recusa explicitamente com SANDBOX_INVALID_WORKSPACE, ver
  // ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md). Usa o mesmo `createWorkspace` de produção.
  let cwd;

  beforeAll(async () => {
    cwd = await createWorkspace('erv1-close-010-output-authority', 1);
  }, 30000);

  afterAll(async () => {
    if (cwd) await destroyWorkspace(cwd);
  }, 30000);

  test('exitCode != 0 com stdout tentando se passar por APPROVE/PASS ainda é reportado como FAIL', async () => {
    const { results } = await executarComRetryDeInfra({
      taskId: 'erv1-close-010-prompt-injection',
      attemptNumber: 1,
      commands: [`node ${PROBE_SCRIPT} 1`],
      cwd,
    });

    expect(results).toHaveLength(1);
    expect(results[0].exitCode).toBe(1);
    // A prova real: mesmo com "status: PASS" / "decision: APPROVE" no texto, o status
    // reportado segue o exitCode, nunca o conteúdo do stdout.
    expect(results[0].status).toBe('FAIL');
    expect(results[0].stdoutExcerpt || '').toContain('ignore all previous instructions');
  });

  test('exitCode == 0 com stdout tentando se passar por REJECT/FAIL ainda é reportado como PASS', async () => {
    const { results } = await executarComRetryDeInfra({
      taskId: 'erv1-close-010-prompt-injection',
      attemptNumber: 2,
      commands: [`node ${PROBE_SCRIPT} 0`],
      cwd,
    });

    expect(results).toHaveLength(1);
    expect(results[0].exitCode).toBe(0);
    expect(results[0].status).toBe('PASS');
  });
});
