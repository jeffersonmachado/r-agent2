'use strict';

/**
 * Segregação dos artefatos de benchmark (§46, §47).
 *
 * Benchmark research, arquétipos, novidade, saturação, holdout, gaps internos e
 * cobertura interna são material de ENGINEERING. Não podem aparecer na operação
 * do cliente (PRODUCTION) e pertencem ao domínio SYSTEM/INTERNAL do RAG.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RAG_SYNC = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'rag-sync.js'), 'utf8');

const BENCHMARK_PATHS = [
  'config/benchmarks/fitness.json',
  'config/benchmark-sufficiency-policy.json',
  'reports/benchmark-sufficiency-report.json',
];

describe('artefatos de benchmark são ENGINEERING, não operação do cliente', () => {
  it('nenhum artefato de benchmark vive no frontend', () => {
    for (const rel of BENCHMARK_PATHS) {
      expect(rel.startsWith('frontend/')).toBe(false);
    }
    for (const dir of ['frontend/src', 'frontend/dist']) {
      const abs = path.join(REPO_ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      const offenders = [];
      const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const next = path.join(current, entry.name);
          if (entry.isDirectory()) walk(next);
          else if (/benchmark/i.test(entry.name)) offenders.push(path.relative(REPO_ROOT, next));
        }
      };
      walk(abs);
      expect(offenders).toEqual([]);
    }
  });

  it('os diretórios de benchmark estão fora das superfícies PRODUCTION conhecidas', () => {
    for (const rel of BENCHMARK_PATHS) {
      expect(rel).toMatch(/^(config|reports|qa)\//);
    }
  });

  it('o sync de RAG classifica config/ (onde vivem os benchmarks) como SYSTEM', () => {
    // `config/` está no mapa de domínio SYSTEM/DEVELOPMENT do rag-sync: o
    // material de benchmark nunca entra no corpus OPERATIONAL/PRODUCTION.
    expect(RAG_SYNC).toMatch(/SYSTEM/);
    expect(RAG_SYNC).toMatch(/config/);
  });

  it('a documentação do mecanismo não é publicada como manual do cliente', () => {
    const docsDir = path.join(REPO_ROOT, 'docs', 'manual');
    if (!fs.existsSync(docsDir)) return;
    const offenders = [];
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) walk(next);
        else if (/benchmark/i.test(entry.name)) offenders.push(path.relative(REPO_ROOT, next));
      }
    };
    walk(docsDir);
    expect(offenders).toEqual([]);
  });
});
