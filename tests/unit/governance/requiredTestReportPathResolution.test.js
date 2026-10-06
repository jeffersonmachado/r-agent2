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

  test('o gate REAL resolve os 3 relatórios do TEMPORAL-06 (prova de PATH, não de manifesto)', () => {
    const suiteReport = path.join(ROOT, 'reports', 'release-suite-execution.json');
    if (!fs.existsSync(suiteReport)) {
      // Sem execução autoritativa de suítes o gate não tem o que provar; o
      // cenário é pulado em vez de virar falso negativo.
      expect(true).toBe(true);
      return;
    }
    // O gate é executado com `--json` e o veredito é lido do ITEM: exigir
    // `status=PASS` do relatório inteiro acoplaria este teste ao estado do
    // manifesto (o runner de suítes reescreve `release-suite-execution.json`
    // enquanto os lotes rodam, então outras suítes podem estar NOT_EXECUTED).
    // O que este teste prova é a RESOLUÇÃO DE PATH: os três relatórios de
    // `governance/` existem e o requisito NÃO é reprovado por "relatório de
    // prova ausente".
    // O gate sai com 1 quando OUTRAS suítes do manifesto não estão PASS (o que
    // pode acontecer em lote); o JSON com o item vem no stdout de qualquer modo.
    let raw = '';
    try {
      raw = execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'governance', 'validate-engineering-router-v2-required-tests.js'), '--json'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
      );
    } catch (err) {
      raw = String(err.stdout || '');
    }
    expect(raw).toMatch(/^\s*\{/);
    const report = JSON.parse(raw);
    const item = (report.items || []).find((entry) => entry.id === 'TEMPORAL-06');
    expect(item).toBeDefined();
    expect(item.reports.every((row) => row.exists === true)).toBe(true);
    expect(item.detail || '').not.toMatch(/relatório de prova ausente/);

    // Sensibilidade ao defeito: com a convenção antiga (`reports/<declarado>`),
    // os MESMOS três caminhos seriam procurados em `reports/governance/…`.
    for (const row of item.reports) {
      const legacy = path.join(ROOT, 'reports', String(row.report).replace(/^reports\//, ''));
      expect(fs.existsSync(legacy)).toBe(false);
    }
  });
});
