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

const path = require('path');
const { runTestCommands } = require('../../api/services/engineeringRouter/testRunnerService');

const PROBE_SCRIPT = 'tests/fixtures/engineering-router-sandbox/promptInjectionOutputProbe.js';

describe('ERV1-CLOSE-010 — autoridade de PASS/FAIL nunca é o texto do output (prompt injection real)', () => {
  const cwd = path.resolve(__dirname, '..', '..');

  test('exitCode != 0 com stdout tentando se passar por APPROVE/PASS ainda é reportado como FAIL', async () => {
    const { results } = await runTestCommands({
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
    const { results } = await runTestCommands({
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
