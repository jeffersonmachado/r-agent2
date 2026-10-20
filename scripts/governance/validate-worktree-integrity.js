#!/usr/bin/env node
'use strict';

/**
 * scripts/governance/validate-worktree-integrity.js
 *
 * CLI da guarda de integridade do worktree (lógica em
 * `governance/worktree-integrity.js`). Falha fechado: qualquer violação
 * derruba o passo, inclusive em pre-commit, pre-push e no hook do agente.
 *
 * Uso:
 *   node scripts/governance/validate-worktree-integrity.js
 *   node scripts/governance/validate-worktree-integrity.js --base origin/main
 *   node scripts/governance/validate-worktree-integrity.js --waive tests/x.js --reason "remoção justificada e aprovada"
 *   node scripts/governance/validate-worktree-integrity.js --json
 *
 * Exit: 0 = PASS, 1 = FAIL, 2 = erro de infraestrutura (nunca tratado como PASS).
 */

const fs = require('fs');
const path = require('path');
const { evaluateWorktree } = require('../../governance/worktree-integrity');

function parseArgs(argv) {
  const options = { base: 'HEAD', json: false, report: undefined, cwd: process.cwd(), waiver: [] };
  let pendingWaiver = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') { options.base = argv[++i]; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--cwd') { options.cwd = path.resolve(argv[++i]); continue; }
    if (arg === '--report') { options.report = argv[++i]; continue; }
    if (arg === '--no-report') { options.report = false; continue; }
    if (arg === '--waive') {
      pendingWaiver = { path: argv[++i], reason: '', approvedBy: '' };
      options.waiver.push(pendingWaiver);
      continue;
    }
    if (arg === '--reason') {
      if (!pendingWaiver) {
        throw new Error('--reason sem --waive correspondente');
      }
      pendingWaiver.reason = argv[++i] || '';
      continue;
    }
    if (arg === '--approved-by') {
      if (!pendingWaiver) {
        throw new Error('--approved-by sem --waive correspondente');
      }
      pendingWaiver.approvedBy = argv[++i] || '';
      continue;
    }
    throw new Error(`argumento desconhecido: ${arg}`);
  }
  return options;
}

function formatHuman(report) {
  const lines = [];
  lines.push(`Integridade do worktree vs ${report.baseRef} (HEAD ${report.headSha || 'desconhecido'}): ${report.verdict}`);
  lines.push(`Arquivos alterados: ${report.filesChanged} | linhas +${report.totals.added} / -${report.totals.removed}`);
  if (report.violations.length > 0) {
    lines.push('VIOLAÇÕES:');
    for (const v of report.violations) {
      lines.push(`  [${v.code}] ${v.path} — ${v.detail}`);
    }
  }
  if (report.waived.length > 0) {
    lines.push('WAIVERS (auditáveis):');
    for (const w of report.waived) {
      lines.push(`  [${w.code}] ${w.path} — motivo: ${w.waiverReason}`);
    }
  }
  return lines.join('\n');
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  // WAIVER SEM AUTORIDADE HUMANA É ERRO DE USO, não liberação silenciosa.
  const semAutoridade = options.waiver.filter(
    (w) => !w.approvedBy || String(w.approvedBy).trim().length < 2 || !w.reason || w.reason.trim().length < 10,
  );
  if (semAutoridade.length > 0) {
    process.stderr.write(
      'WAIVER_INVALIDO: todo waiver exige --reason (>=10 caracteres) e --approved-by <humano>. '
      + `Faltando em: ${semAutoridade.map((w) => w.path).join(', ')}\n`,
    );
    process.exit(2);
  }

  let report;
  try {
    report = evaluateWorktree({ cwd: options.cwd, baseRef: options.base, waiver: options.waiver });
  } catch (error) {
    // Erro de infraestrutura NÃO é aprovação: falha explícita com código 2.
    process.stderr.write(`WORKTREE_INTEGRITY_UNAVAILABLE: ${error.message}\n`);
    process.exit(2);
  }

  const reportPath = options.report === false
    ? null
    : (options.report || path.join(options.cwd, 'reports', 'worktree-integrity-report.json'));
  if (reportPath) {
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`falha ao gravar relatório: ${error.message}\n`);
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHuman(report)}\n`);
  }

  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main();
