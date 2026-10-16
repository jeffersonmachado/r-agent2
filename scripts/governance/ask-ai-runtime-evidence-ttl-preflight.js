#!/usr/bin/env node
'use strict';

/**
 * ask-ai-runtime-evidence-ttl-preflight.js — a evidência de runtime do Ask-AI
 * (`reports/ask-ai-copilot-runtime-evidence.json`) está DENTRO da validade?
 *
 * POR QUE ISTO EXISTE (defeito medido em 2026-10-15, com um ciclo de ~2 h perdido)
 * O `validate:ask-ai-runtime-evidence` roda DENTRO do gate agregado, que por sua
 * vez roda na ÚLTIMA fase (`consolidate`). A evidência tem TTL de 7 dias e o
 * produtor é manual (`npm run verify:ask-ai-copilot:runtime`, exige a API viva e
 * credencial de verificação). Resultado medido: o ciclo inteiro rodou — prepare
 * com QA Mesh real (~40 min), candidate com empacotamento (~20 min), final,
 * publish com tag publicada — e ABORTOU no `consolidate` com
 * `ASK_AI_RUNTIME_EVIDENCE_STALE` (177,8 h de 168 h). O preflight já fazia esse
 * fail-fast para o smoke contínuo das QA Waves; faltava a MESMA proteção aqui,
 * onde o custo de descobrir no fim é ainda maior (a fase já publicou a tag).
 *
 * AUTORIDADE ÚNICA: usa `evaluateRuntimeEvidence` — a MESMA função que o
 * `validate-ask-ai-runtime-evidence.js` usa. O TTL não é duplicado aqui: se o
 * default mudar na lib, os dois lados mudam juntos.
 *
 * SEMÂNTICA (não afrouxa nada)
 *   exit 0 — evidência fresca E com prova de geração (o agregado vai passar)
 *   exit 1 — bloqueia o agregado (vencida, inválida, ausente): o ciclo NÃO deve
 *            começar (ou deve parar antes da varredura, no consolidate)
 *   exit 2 — NÃO avaliável (lib indisponível): falha de plumbing, nunca "ok"
 *
 * Uso:
 *   node scripts/governance/ask-ai-runtime-evidence-ttl-preflight.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const EVIDENCE_REL = 'reports/ask-ai-copilot-runtime-evidence.json';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Avalia a evidência. Puro sobre o filesystem do `rootDir` (testável sem DB e sem
 * API): devolve `{ status, detail, violations, ageHours, maxAgeHours }`.
 *
 * @param {string} rootDir
 * @param {{maxAgeMs?: number, now?: number}} [options]
 */
function evaluate(rootDir = ROOT, options = {}) {
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? options.maxAgeMs
    : Number.parseInt(process.env.ASK_AI_RUNTIME_EVIDENCE_MAX_AGE_MS || String(DEFAULT_MAX_AGE_MS), 10);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeHours = Number((maxAgeMs / 3600000).toFixed(1));

  let evaluateRuntimeEvidence;
  try {
    ({ evaluateRuntimeEvidence } = require('./lib/askAiRuntimeEvidence'));
  } catch (err) {
    return {
      status: 'UNAVAILABLE',
      detail: `lib indisponível: ${err && err.message}`,
      violations: [],
      ageHours: null,
      maxAgeHours,
    };
  }
  if (typeof evaluateRuntimeEvidence !== 'function') {
    return {
      status: 'UNAVAILABLE',
      detail: 'lib sem evaluateRuntimeEvidence',
      violations: [],
      ageHours: null,
      maxAgeHours,
    };
  }

  const abs = path.join(rootDir, EVIDENCE_REL);
  let evidence = null;
  let readError = null;
  try {
    evidence = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    readError = err && err.message;
  }

  const { violations, evidenceAgeMs, generationCheck } = evaluateRuntimeEvidence({
    evidence,
    readError,
    maxAgeMs,
    now,
  });
  const ageHours = evidenceAgeMs == null ? null : Number((evidenceAgeMs / 3600000).toFixed(1));
  const lista = Array.isArray(violations) ? violations : [];

  if (lista.length === 0) {
    return {
      status: 'OK',
      detail: `OK idade=${ageHours}h max=${maxAgeHours}h geração=${generationCheck?.status || 'n/d'}`,
      violations: [],
      ageHours,
      maxAgeHours,
    };
  }
  return {
    status: 'STALE',
    detail: `INVALIDO motivos=${lista.map((v) => v.code).join(',')} idade=${ageHours}h max=${maxAgeHours}h`,
    violations: lista,
    ageHours,
    maxAgeHours,
  };
}

if (require.main === module) {
  const out = evaluate(ROOT);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else process.stdout.write(`${out.status === 'OK' ? 'OK' : out.detail}\n`);
  const exitCode = out.status === 'OK' ? 0 : (out.status === 'STALE' ? 1 : 2);
  if (exitCode !== 0) {
    process.stderr.write(
      '[ask-ai-runtime-ttl] renove com o produtor canônico (exige a API viva em :3001\n'
      + '                   e credencial de verificação — nunca hardcoded no repositório):\n'
      + '  ASKAI_VERIFY_USER=... ASKAI_VERIFY_PASSWORD=... npm run verify:ask-ai-copilot:runtime\n',
    );
  }
  process.exit(exitCode);
}

module.exports = { evaluate, EVIDENCE_REL, DEFAULT_MAX_AGE_MS };
