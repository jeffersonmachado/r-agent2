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

// Exceção governada (2026-09-17): a UI de governança de propostas de pesquisa
// é superfície DEVELOPMENT-only (rota /dev/benchmark-research, item de menu com
// classifications:['DEVELOPMENT'], API sob checkClassification('DEVELOPMENT') +
// tenant system fail-closed). O que continua PROIBIDO no frontend é material de
// benchmark fora dessa superfície: dados, relatórios, snapshots, páginas novas
// sem a mesma classificação. Qualquer arquivo frontend com "benchmark" no nome
// fora desta lista exata falha este teste.
const ALLOWED_DEV_GOVERNANCE_UI = [
  'frontend/src/api/benchmarkResearch.js',
  'frontend/src/pages/BenchmarkResearchGovernancePage.jsx',
  'frontend/src/pages/BenchmarkResearchGovernancePage.css',
  'frontend/src/pages/BenchmarkResearchGovernancePage.test.jsx',
];

/**
 * Derivados de BUILD da página de governança.
 *
 * O Vite emite `frontend/dist/assets/<Nome>-<hash>.js|css`: o nome exato do
 * fonte NUNCA casa com o artefato compilado, e cada build muda o hash. Permitir
 * apenas o derivado DESTA página (prefixo + hash + extensão de asset) mantém a
 * regra viva — qualquer OUTRO arquivo com "benchmark" no nome continua
 * reprovando — sem quebrar o teste a cada build.
 */
const DIST_DERIVATIVE_PATTERN = /^frontend\/dist\/assets\/BenchmarkResearchGovernancePage-[A-Za-z0-9_-]+\.(?:js|css|map)$/;

function isAllowedBenchmarkArtifact(rel) {
  return ALLOWED_DEV_GOVERNANCE_UI.includes(rel) || DIST_DERIVATIVE_PATTERN.test(rel);
}

describe('artefatos de benchmark são ENGINEERING, não operação do cliente', () => {
  it('nenhum artefato de benchmark vive no frontend fora da UI DEVELOPMENT de governança', () => {
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
      const notAllowed = offenders.filter((rel) => !isAllowedBenchmarkArtifact(rel));
      expect(notAllowed).toEqual([]);
      // A exceção não pode virar porteira aberta: os arquivos permitidos devem
      // existir e ser exatamente os declarados (nem mais, nem menos).
      for (const rel of ALLOWED_DEV_GOVERNANCE_UI) {
        expect(fs.existsSync(path.join(REPO_ROOT, rel))).toBe(true);
      }
    }
  });

  it('a UI de governança de pesquisa é DEVELOPMENT-only no menu e na rota', () => {
    const menu = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'src', 'navigation', 'menu.js'), 'utf8');
    const start = menu.indexOf("id: 'dev-benchmark-research'");
    expect(start).toBeGreaterThan(-1);
    const end = menu.indexOf("id: '", start + 10);
    const block = menu.slice(start, end === -1 ? start + 800 : end);
    expect(block).toContain("path: '/dev/benchmark-research'");
    expect(block).toMatch(/classifications:\s*\[\s*'DEVELOPMENT'\s*\]/);
    expect(block).not.toMatch(/'PRODUCTION'/);
    const main = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'src', 'main.jsx'), 'utf8');
    expect(main).toContain('/dev/benchmark-research');
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
