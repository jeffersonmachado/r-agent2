#!/usr/bin/env node
'use strict';

/**
 * qa-waves-scheduled-ttl-preflight.js — a evidência do smoke contínuo das QA Waves
 * está DENTRO da validade (TTL)?
 *
 * POR QUE ISTO É UM SCRIPT, E NÃO PROSA NO RUNBOOK
 * A avaliação existia duplicada dentro do `preflight()` do `seal-release.sh`
 * (mesma bridge, mesmo `.env`). Duplicação de regra vira divergência: um ciclo
 * medido em 2026-10-05 entrou com a evidência válida (~46 h de 48 h), o pipeline
 * levou ~1,5 h e o TTL venceu no MEIO do ciclo — o agregado reprovou em
 * `validate:qa-governance` (`qa_waves_continuous_smoke_degraded`) depois de ~25 min
 * de varredura, e a única saída foi renovar o smoke e refazer a fase. Autoridade
 * única: preflight (entrada) e fase `consolidate` (antes do agregado) chamam ESTE
 * script, que sempre avalia com a MESMA bridge e o MESMO `.env`.
 *
 * SEMÂNTICA (não afrouxa nada)
 *   exit 0 — `healthy === true` (evidência dentro do TTL)
 *   exit 1 — evidência vencida/inválida (a linha de avaliação traz os motivos)
 *   exit 2 — NÃO avaliável (bridge/.env indisponível): falha de plumbing, nunca
 *            tratada como "ok"
 *
 * `--env-file-if-exists=.env` é OBRIGATÓRIO (medido 2026-09-27): sem a chave de
 * assinatura o `validateReplayIntegrity` reprova TODOS os fluxos e a checagem
 * bloquearia selo válido com `scheduled_flow_source_mismatch:<jornada>:integrityValid`.
 * Este script carrega o `.env` por conta própria para não depender de quem chama.
 *
 * Uso: node scripts/governance/qa-waves-scheduled-ttl-preflight.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('./lib/loadEnvFile');

const ROOT = path.resolve(__dirname, '..', '..');

const EVIDENCE_REL = 'qa/smoke/qa-waves-scheduled-operational-smoke.json';

/**
 * Avalia a evidência. Puro sobre o filesystem do `rootDir` (testável sem DB):
 * devolve `{ status: 'OK'|'STALE'|'UNAVAILABLE', detail, reasons, maxAgeHours, ageHours }`.
 */
function evaluate(rootDir = ROOT) {
  // O `.env` é carregado AQUI (e não no topo do módulo) para que `require()`-ar
  // este arquivo num teste não tenha efeito colateral de ambiente.
  loadEnvFile(rootDir);
  let assessScheduledEvidence;
  try {
    ({ assessScheduledEvidence } = require(path.join(rootDir, 'tools/system/lib/qa-waves-enterprise-governance-bridge')));
  } catch (err) {
    return { status: 'UNAVAILABLE', detail: `bridge indisponível: ${err && err.message}`, reasons: [], maxAgeHours: null, ageHours: null };
  }
  if (typeof assessScheduledEvidence !== 'function') {
    return { status: 'UNAVAILABLE', detail: 'bridge sem assessScheduledEvidence', reasons: [], maxAgeHours: null, ageHours: null };
  }
  const abs = path.join(rootDir, EVIDENCE_REL);
  let scheduled = null;
  try {
    scheduled = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return { status: 'UNAVAILABLE', detail: `evidência ausente/ilegível (${EVIDENCE_REL}): ${err && err.message}`, reasons: [], maxAgeHours: null, ageHours: null };
  }
  const result = assessScheduledEvidence(scheduled, { root: rootDir }) || {};
  const reasons = Array.isArray(result.reasons) ? result.reasons : [];
  const maxAgeHours = result.maxAgeHours == null ? null : result.maxAgeHours;
  const ageHours = result.ageHours == null ? null : result.ageHours;
  if (result.healthy === true) {
    return { status: 'OK', detail: `OK idade=${ageHours}h max=${maxAgeHours}h`, reasons, maxAgeHours, ageHours };
  }
  return {
    status: 'STALE',
    detail: `INVALIDO motivos=${reasons.join(',') || 'desconhecido'} idade=${ageHours}h max=${maxAgeHours}h`,
    reasons,
    maxAgeHours,
    ageHours,
  };
}

if (require.main === module) {
  const out = evaluate(ROOT);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else process.stdout.write(`${out.status === 'OK' ? 'OK' : out.detail}\n`);
  const exitCode = out.status === 'OK' ? 0 : (out.status === 'STALE' ? 1 : 2);
  if (exitCode !== 0) {
    process.stderr.write(
      '[qa-waves-ttl] renove com o produtor canônico:\n'
      + '  ./scripts/smoke/run-scheduled-production-health-smoke.sh   (exige stack prod-like em Docker; derruba os serviços de dev)\n',
    );
  }
  process.exit(exitCode);
}

module.exports = { evaluate, EVIDENCE_REL };
