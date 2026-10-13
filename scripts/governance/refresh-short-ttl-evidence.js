'use strict';

/**
 * scripts/governance/refresh-short-ttl-evidence.js
 *
 * REGENERA as evidências de TTL curto que o ciclo de release envelhece, e
 * verifica o frescor DEPOIS — fail-closed.
 *
 * DEFEITO MEDIDO (2026-10-13, ciclo de ~1h30): o `consolidate` roda o gate
 * agregado no FIM do ciclo, mas dois validadores dependem de evidências geradas
 * no INÍCIO dele:
 *   - `validate:governance-summary` reprovou com `replayIntegrity: STALE` (33 min);
 *   - `validate:security-release-gate` reprovou com `SECURITY_GATE_STALE_EVIDENCE`
 *     (exit 3) — SBOM anterior ao `startedAt` do run.
 * Na sessão isso custou DUAS retomadas manuais. O ciclo sabotava a si mesmo.
 *
 * Este script troca isso por trabalho determinístico no início do `consolidate`:
 * regenera os produtores oficiais e confere com `lib/short-ttl-evidence.js`. Não
 * afrouxa nada: se depois de regenerar a evidência continuar fora de validade, sai
 * != 0 e o ciclo PARA (mesma política do guard de smoke contínuo).
 *
 * Uso:
 *   node scripts/governance/refresh-short-ttl-evidence.js            # regenera + verifica
 *   node scripts/governance/refresh-short-ttl-evidence.js --check-only   # só verifica
 *
 * Exit: 0 = evidências frescas | 1 = fora de validade (ou produtor falhou)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const AGRUPADO = process.argv.includes('--check-only');

const { avaliarFrescorDeEvidenciasCurta } = require('./lib/short-ttl-evidence');

const REPLAY_REPORT = path.join(ROOT, 'reports', 'replay-governance-validation-report.json');
const SBOM_REPORT = path.join(ROOT, 'reports', 'security-intel-report.json');
const CURRENT_RUN = path.join(ROOT, 'governance', '.current-run.json');

function lerJson(caminho) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (_) {
    return null;
  }
}

function rodarProdutor(rotulo, comando, args) {
  process.stdout.write(`[short-ttl] regenerando ${rotulo}: ${comando} ${args.join(' ')} ... `);
  const r = spawnSync(comando, args, { cwd: ROOT, encoding: 'utf8', timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
  const ok = r.status === 0;
  console.log(ok ? 'OK' : `FALHOU (exit=${r.status})`);
  if (!ok) {
    const saida = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-4).join(' | ');
    console.error(`[short-ttl] ${rotulo}: ${saida.slice(0, 400)}`);
  }
  return ok;
}

function carimbarLineage() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'governance', 'stamp-report-lineage.js')], {
    cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024,
  });
  const ok = r.status === 0;
  console.log(`[short-ttl] lineage carimbado (relatórios regravados ganham o run corrente): ${ok ? 'OK' : 'FALHOU'}`);
  return ok;
}

function coletarEvidencias() {
  const replayRaw = lerJson(REPLAY_REPORT);
  const sbomRaw = lerJson(SBOM_REPORT);
  const run = lerJson(CURRENT_RUN);
  return {
    replay: replayRaw ? { generatedAt: replayRaw.generatedAt, maxAgeMs: replayRaw.maxAgeMs } : null,
    sbom: sbomRaw ? { generatedAt: sbomRaw.generatedAt } : null,
    runStartedAt: run && run.startedAt ? run.startedAt : null,
  };
}

function main() {
  console.log(`[short-ttl] modo=${AGRUPADO ? 'check-only' : 'regenerar+verificar'}`);
  const { EVIDENCIAS_TTL_CURTO } = require('./lib/short-ttl-evidence');
  const falhasProdutor = [];

  if (!AGRUPADO) {
    const produtores = [
      ['replay-governance', 'npm', ['run', '--silent', 'validate:replay-governance']],
      ['security-sbom', 'npm', ['run', '--silent', 'security:sbom']],
    ];
    for (const [rotulo, comando, args] of produtores) {
      if (!rodarProdutor(rotulo, comando, args)) falhasProdutor.push(rotulo);
    }
    // O relatório de replay é regravado SEM lineage; o carimbo devolve a coerência
    // ao run corrente (senão `validate:current-run-temporal-integrity` acusa
    // INVALID_AUTHORITATIVE_ARTIFACT e derruba `validate:required-tests` por tabela).
    if (falhasProdutor.length === 0) carimbarLineage();
  }

  const evidencias = coletarEvidencias();
  console.log(`[short-ttl] replay.generatedAt=${evidencias.replay ? evidencias.replay.generatedAt : 'AUSENTE'}`
    + ` | sbom.generatedAt=${evidencias.sbom ? evidencias.sbom.generatedAt : 'AUSENTE'}`
    + ` | run.startedAt=${evidencias.runStartedAt || 'AUSENTE'}`);

  const issues = avaliarFrescorDeEvidenciasCurta(evidencias);
  const ids = EVIDENCIAS_TTL_CURTO.map((e) => e.id).join(', ');

  if (falhasProdutor.length > 0) {
    console.error(`[short-ttl] FALHA: produtor(es) não conseguiram regenerar: ${falhasProdutor.join(', ')}`);
    console.error(`[short-ttl] evidências monitoradas: ${ids}`);
    return 1;
  }

  if (issues.length > 0) {
    console.error(`[short-ttl] FALHA: evidência de TTL curto FORA DE VALIDADE mesmo após regenerar:`);
    for (const i of issues) console.error(`  ✗ ${i.code} [${i.evidence}] — ${i.message}`);
    return 1;
  }

  console.log(`[short-ttl] OK — evidências de TTL curto frescas: ${ids}`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { coletarEvidencias, main };
