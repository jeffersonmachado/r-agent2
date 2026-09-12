'use strict';

/**
 * validate-state-sync.js — GATE BLOQUEANTE da regra "sem setInterval para
 * sincronizar estado no frontend".
 *
 * POR QUE UM GATE PRÓPRIO, E NÃO O LINTER DE CAMADAS
 * A regra é uma PROIBIÇÃO explícita do projeto (AGENTS.md/CLAUDE.md: "Estado
 * realtime via WebSocket; PROIBIDO setInterval para sincronizar estado"), mas o
 * linter que a verificava (`validate-layer-conventions.js`) era estruturalmente
 * incapaz de falhar — `errors > 0` mapeava para WARN e o exit code só considerava
 * FAIL — e não estava no gate agregado. Efeito medido em 2026-09-12: 45
 * ocorrências (marcadas como `error` pelo próprio linter) convivendo com
 * `reports/governance-score.json` = PASS e `overallGovernance = 100`.
 *
 * Ligar o linter INTEIRO ao gate agregado faria o gate falhar por 123 erros
 * alheios (pureza de `engine/`, `console.log` em `api/`, ESM no backend) — dívida
 * real, mas de outra natureza e outro dono, que não deve travar release por esta
 * regra nem diluir esta regra naquela dívida. Então: esta regra ganha gate
 * bloqueante próprio; o linter amplo segue advisory no que é advisory.
 *
 * A regra em si vive em `scripts/governance/state-sync-rule.js` (fonte única,
 * consumida pelos dois). Isenções auditáveis com motivo e classificação em
 * `config/state-sync-exemptions.json`; a isenção declara quantas ocorrências o
 * arquivo pode ter, então um timer NOVO em arquivo já isentado continua sendo
 * bloqueado, e a contagem por arquivo (não por linha) não apodrece.
 */

const { ROOT, writeReport } = require('./common');
const { evaluateStateSyncRule, EXEMPTIONS_PATH } = require('./state-sync-rule');

function main() {
  const result = evaluateStateSyncRule(ROOT);

  const entries = result.exemptions.entries || [];
  const declared = entries.reduce((sum, entry) => sum + (Number(entry.allowedIntervals) || 0), 0);

  const report = {
    artifactType: 'state-sync-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    scope: 'frontend/src — a proibição de setInterval para sincronizar estado é de frontend; worker/scheduler de backend em timer é o padrão correto ali',
    exemptionsPath: EXEMPTIONS_PATH,
    status: result.ok ? 'PASS' : 'FAIL',
    filesWithInterval: Object.keys(result.counts).length,
    intervalsFound: Object.values(result.counts).reduce((sum, n) => sum + n, 0),
    intervalsDeclared: declared,
    exemptedFiles: entries.length,
    violations: result.violations,
    staleExemptions: result.stale,
  };

  const outPath = writeReport('state-sync-report.json', report);

  console.log(`[state-sync] status=${report.status} arquivos=${report.filesWithInterval} ocorrencias=${report.intervalsFound} declaradas=${declared} violacoes=${result.violations.length} isencoes_obsoletas=${result.stale.length}`);
  for (const issue of result.violations.slice(0, 10)) {
    console.log(`  ✗ ${issue.file}:${issue.line} — ${issue.message}`);
  }
  for (const issue of result.stale) {
    console.log(`  ⚠ ${issue.file} — ${issue.message}`);
  }
  console.log(`[state-sync] relatório: ${outPath}`);

  return report.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
