'use strict';

/**
 * Diagnóstico de lote do release-suite.
 *
 * DEFEITO FECHADO (medido 2026-10-05): quando um lote do runner autoritativo morre, a violação
 * `BATCH_REPORT_MISSING` exibia APENAS a cauda do stdout do Jest — que com `--json --outputFile` é
 * legitimamente VAZIA, porque o Jest escreve o resumo legível no STDERR. Resultado: a violação
 * dizia "stdout: (vazio)" enquanto a causa real (evidência de runtime amarrada a um
 * `sourceFingerprint` antigo ⇒ `RUNTIME-EVIDENCE_UNAVAILABLE` numa das suítes) estava só no stderr.
 * O gate escondeu o próprio remédio e a falha parecia "lote que não rodou".
 *
 * O runner já capturava as duas caudas (`stdoutTail`/`stderrTail`); faltava divulgá-las. Este teste
 * extrai a função REAL de formatação (não duplica a lógica) e trava o contrato da mensagem.
 */

const fs = require('fs');
const path = require('path');

const RUNNER = path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'run-release-suites.js');

function readRunner() {
  return fs.readFileSync(RUNNER, 'utf8');
}

function extractOutputTail() {
  const match = readRunner().match(/const outputTail = \(value\) =>[\s\S]*?;\n/);
  if (!match) {
    throw new Error('outputTail() nao encontrada em scripts/governance/run-release-suites.js');
  }
  return match[0];
}

function buildOutputTail() {
  // eslint-disable-next-line no-new-func
  return new Function(`${extractOutputTail()}\nreturn outputTail;`)();
}

describe('diagnóstico de lote do release-suite — a violação deve nomear a causa real', () => {
  test('a violação divulga a cauda do STDERR e a do stdout, nomeadas', () => {
    const source = readRunner();
    const start = source.indexOf("code: 'BATCH_REPORT_MISSING'");
    expect(start).toBeGreaterThan(-1);
    const violation = source.slice(start, start + 1400);

    // Com --json --outputFile o resumo legível vive no stderr: é ele que nomeia a causa.
    expect(violation).toMatch(/stderr=\$\{outputTail\(failure\.stderrTail\)\}/);
    expect(violation).toMatch(/stdout=\$\{outputTail\(failure\.stdoutTail\)\}/);
  });

  test('a cauda marca vazio explicitamente e preserva as 3 últimas linhas', () => {
    const outputTail = buildOutputTail();

    expect(outputTail('')).toBe('(vazio)');
    expect(outputTail(null)).toBe('(vazio)');
    expect(outputTail('a\nb\nc\nd')).toBe('b | c | d');
  });

  test('a mensagem não volta a prometer apenas o stdout', () => {
    expect(readRunner()).not.toMatch(/o stdout do Jest abaixo diz se o lote ROU/);
  });
});
