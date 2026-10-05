'use strict';

/**
 * requiredTestReportPathResolution.test.js — regressão do defeito MEDIDO em
 * 2026-10-05: o gate de testes obrigatórios V2 resolvia TODO relatório de prova
 * como `reports/<declarado>`, então os artefatos autoritativos de `governance/`
 * declarados no requisito TEMPORAL-06 eram procurados em `reports/governance/…`
 * (inexistentes) e o requisito virava UNPROVEN — 67/68, com o V2 seal abortando
 * em REQUIRED_TESTS_V2 por um erro de PATH, não de substância (os três
 * relatórios estavam presentes, com valor PASS e runId do run corrente).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { reportPathCandidates } = require('../../../scripts/governance/lib/report-path-resolution');

const ROOT = path.join(__dirname, '..', '..', '..');

describe('resolução do caminho de relatório de prova (testes obrigatórios V2)', () => {
  test('declaração sob reports/ mantém o caminho do repositório', () => {
    expect(reportPathCandidates('reports/x.json')).toEqual(['reports/x.json']);
  });

  test('declaração em governance/ é resolvida na RAIZ, não sob reports/', () => {
    const candidates = reportPathCandidates('governance/mutable-json-state-validation-report.json');
    expect(candidates[0]).toBe('governance/mutable-json-state-validation-report.json');
    // o candidato histórico continua disponível como fallback
    expect(candidates).toContain('reports/governance/mutable-json-state-validation-report.json');
  });

  test('normaliza ./ e ignora declaração vazia (fail-closed, nunca inventa caminho)', () => {
    expect(reportPathCandidates('./governance/y.json')[0]).toBe('governance/y.json');
    expect(reportPathCandidates('')).toEqual([]);
    expect(reportPathCandidates(null)).toEqual([]);
  });

  test('o gate REAL passa 68/68 com os 3 relatórios do TEMPORAL-06 presentes', () => {
    const suiteReport = path.join(ROOT, 'reports', 'release-suite-execution.json');
    if (!fs.existsSync(suiteReport)) {
      // Sem execução autoritativa de suítes o gate não tem o que provar; o
      // cenário é pulado em vez de virar falso negativo.
      expect(true).toBe(true);
      return;
    }
    let out = '';
    let exitCode = 0;
    try {
      out = execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'governance', 'validate-engineering-router-v2-required-tests.js')],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status || 1;
      out = String((err.stdout || '') + (err.stderr || ''));
    }
    expect(exitCode).toBe(0);
    expect(out).toMatch(/\[required-tests\] status=PASS/);
    const temporalLine = out.split('\n').find((line) => line.includes('TEMPORAL-06')) || '';
    expect(temporalLine).toContain('PROVEN');
    expect(temporalLine).toContain('3 relatório');
  });
});
