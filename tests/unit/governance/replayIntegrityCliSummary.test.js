'use strict';

/**
 * O entrypoint CLI de `governance/replay-integrity.js` imprimia
 * `report.issues.length` assumindo SEMPRE o shape completo do relatório.
 * Quando `resolveArtifact()` falha (workspace sem payload de release — o caso
 * de qualquer execução fora do ciclo de release), o engine retorna
 * `{ generatedAt, pass:false, error }` e o CLI morria com
 * `TypeError: Cannot read properties of undefined (reading 'length')`.
 *
 * Um engine de governança deve FALHAR FECHADO com diagnóstico, nunca com
 * stack trace. Estes testes fixam o contrato do resumo de CLI nos dois shapes.
 */

const { formatCliSummary } = require('../../../governance/replay-integrity');

describe('replay-integrity CLI summary', () => {
  it('resume o shape completo do relatório', () => {
    const summary = formatCliSummary({
      pass: true,
      totalReplays: 9,
      issues: [{ type: 'x', severity: 'WARN' }],
    });

    expect(summary).toContain('pass=true');
    expect(summary).toContain('replays=9');
    expect(summary).toContain('issues=1');
  });

  it('resume o shape de erro sem lançar (fail-closed com causa)', () => {
    const summary = formatCliSummary({
      pass: false,
      error: 'release artifact not resolved',
    });

    expect(summary).toContain('pass=false');
    expect(summary).toContain('error=release artifact not resolved');
    expect(summary).not.toContain('issues=undefined');
  });

  it('nunca devolve string vazia para relatório ausente', () => {
    expect(formatCliSummary(undefined)).toContain('pass=false');
  });
});
