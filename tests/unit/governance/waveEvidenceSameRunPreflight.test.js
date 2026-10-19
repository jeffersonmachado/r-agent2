'use strict';

/**
 * Preflight de evidência de wave por run (P1-11 + selo).
 *
 * Contexto medido: com a vinculação por runId ativa no coverage gate, waves
 * carimbadas com o run ANTERIOR degradam para STALE. O selo cria run novo em
 * RUN_SOURCE_DRIFT e só depois roda a converge (~35 min de mesh): sem preflight,
 * o operador descobre o problema no fim. Este teste prova o verificador nos dois
 * sentidos, incluindo a leitura real de disco (coletar).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MOTIVO,
  avaliar,
  coletar,
  main,
} = require('../../../scripts/governance/check-wave-evidence-same-run');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wave-same-run-'));
}

function montarRelatorios(rootDir, { runId = 'run-ATUAL', semRunId = [], ausentes = [] } = {}) {
  fs.mkdirSync(path.join(rootDir, 'governance'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'governance', '.current-run.json'),
    `${JSON.stringify({ runId, startedAt: '2026-10-16T00:00:00.000Z' }, null, 2)}\n`
  );

  const waves = [
    { rel: 'reports/db-integrity-report.json', nome: 'db-integrity' },
    { rel: 'reports/api-surface-report.json', nome: 'api-surface' },
    { rel: 'reports/page-surface-report.json', nome: 'page-surface' },
  ];
  for (const w of waves) {
    if (ausentes.includes(w.nome)) continue;
    const payload = semRunId.includes(w.nome)
      ? { generatedAt: '2026-10-16T01:00:00.000Z' }
      : { generatedAt: '2026-10-16T01:00:00.000Z', runId };
    fs.writeFileSync(path.join(rootDir, w.rel), `${JSON.stringify(payload, null, 2)}\n`);
  }
  return rootDir;
}

describe('preflight de evidência de wave — vinculação por run', () => {
  test('todas as waves do run corrente => PASS (não-vacuidade: o gate sabe ficar verde)', () => {
    const rootDir = montarRelatorios(tempRoot());
    const r = coletar(rootDir);
    expect(r.ok).toBe(true);
    expect(r.violacoes).toEqual([]);
    expect(r.resultados.map((x) => x.status)).toEqual(['SAME_RUN', 'SAME_RUN', 'SAME_RUN']);
    expect(main).toBeInstanceOf(Function);
  });

  test('wave de OUTRO run => violação nomeada + remédio com o produtor exato', () => {
    const rootDir = montarRelatorios(tempRoot());
    fs.writeFileSync(
      path.join(rootDir, 'reports', 'api-surface-report.json'),
      `${JSON.stringify({ generatedAt: '2026-10-16T01:00:00.000Z', runId: 'run-ANTIGO' }, null, 2)}\n`
    );

    const r = coletar(rootDir);
    expect(r.ok).toBe(false);
    expect(r.violacoes).toHaveLength(1);
    expect(r.violacoes[0].motivo).toBe(MOTIVO.FOREIGN_RUN);
    expect(r.violacoes[0].runEncontrado).toBe('run-ANTIGO');
    expect(r.violacoes[0].runEsperado).toBe('run-ATUAL');
    expect(r.remedio).toEqual(['npm run wave:api-surface']);
  });

  test('wave SEM runId => NO_LINEAGE (não pode passar como se fosse do run)', () => {
    const rootDir = montarRelatorios(tempRoot(), { semRunId: ['page-surface'] });
    const r = coletar(rootDir);
    expect(r.ok).toBe(false);
    expect(r.violacoes).toHaveLength(1);
    expect(r.violacoes[0].motivo).toBe(MOTIVO.NO_LINEAGE);
    expect(r.violacoes[0].remedio).toBe('npm run wave:page-surface');
  });

  test('wave ausente é ignorada aqui (quem trata é o coverage gate, fonte missing)', () => {
    const rootDir = montarRelatorios(tempRoot(), { ausentes: ['db-integrity'] });
    const r = coletar(rootDir);
    expect(r.ok).toBe(true);
    expect(r.resultados[0]).toEqual({ wave: 'db-integrity', status: 'AUSENTE' });
  });

  test('sem run corrente não inventa violação (não reprova por ausência de contexto)', () => {
    const rootDir = tempRoot();
    fs.mkdirSync(path.join(rootDir, 'reports'), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, 'reports', 'db-integrity-report.json'),
      `${JSON.stringify({ generatedAt: '2026-10-16T01:00:00.000Z', runId: 'run-X' }, null, 2)}\n`
    );
    const r = coletar(rootDir);
    expect(r.runId).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.resultados[0].status).toBe('SEM_RUN_CORRENTE');
  });

  test('avaliar() é puro: mesma entrada, mesma saída, sem tocar disco', () => {
    const waves = [
      { wave: 'a', rel: 'a.json', produtor: 'p1', report: { runId: 'R' } },
      { wave: 'b', rel: 'b.json', produtor: 'p2', report: { runId: 'OUTRO' } },
      { wave: 'c', rel: 'c.json', produtor: 'p3', report: null },
    ];
    const r1 = avaliar({ currentRun: { runId: 'R' }, waves });
    const r2 = avaliar({ currentRun: { runId: 'R' }, waves });
    expect(r1).toEqual(r2);
    expect(r1.violacoes.map((v) => v.wave)).toEqual(['b']);
    expect(r1.resultados).toEqual([
      { wave: 'a', status: 'SAME_RUN', runIdEvidencia: 'R' },
      { wave: 'c', status: 'AUSENTE' },
    ]);
  });

  test('main() no repo real devolve código coerente com o estado medido', () => {
    const r = coletar(process.cwd());
    const codigo = main(['--json']);
    expect(codigo).toBe(r.ok ? 0 : 1);
  });
});
