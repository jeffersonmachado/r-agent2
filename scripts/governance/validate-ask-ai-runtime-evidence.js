#!/usr/bin/env node
'use strict';

/**
 * validate-ask-ai-runtime-evidence.js — a evidência de RUNTIME do copiloto não
 * pode passar vencida, degradada ou sem a prova de geração.
 *
 * POR QUE EXISTE: em 2026-10-08 a evidência `reports/ask-ai-copilot-runtime-evidence.json`
 * estava `PASS` (gerada em 20/09, 18 dias antes) enquanto o copiloto NÃO
 * respondia — a geração falhava (provider sem crédito) e o rag-service devolvia
 * um trecho cru que o widget exibia como resposta. O gate agregado ficava verde
 * assim mesmo: nenhum validador olhava essa evidência.
 *
 * O que exige:
 *   1. a evidência existe (sem medição não há prova);
 *   2. está `PASS` (não é narrativa de sucesso em cima de falha);
 *   3. contém o check `first_turn_answer_generated` em PASS (a resposta foi
 *      SINTETIZADA, não é trecho recuperado nem degradação);
 *   4. é FRESCA (TTL 7 dias, `ASK_AI_RUNTIME_EVIDENCE_MAX_AGE_MS` para override)
 *      — decisão de produto: evidência vencida não conta como prova, como já
 *      vale para as evidências de wave no coverage gate.
 *
 * Refresh: `ASKAI_VERIFY_USER=… ASKAI_VERIFY_PASSWORD=… npm run verify:ask-ai-copilot:runtime`
 *
 * Saída: `reports/ask-ai-runtime-evidence-report.json`.
 * Uso: node scripts/governance/validate-ask-ai-runtime-evidence.js [--json]
 */

const fs = require('fs');
const path = require('path');

const { evaluateRuntimeEvidence } = require('./lib/askAiRuntimeEvidence');

const ROOT = path.join(__dirname, '..', '..');
const EVIDENCE_PATH = path.join(ROOT, 'reports', 'ask-ai-copilot-runtime-evidence.json');
const REPORT_PATH = path.join(ROOT, 'reports', 'ask-ai-runtime-evidence-report.json');

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function main() {
  const maxAgeMs = Number.parseInt(
    process.env.ASK_AI_RUNTIME_EVIDENCE_MAX_AGE_MS || String(DEFAULT_MAX_AGE_MS),
    10,
  );

  let evidence = null;
  let readError = null;
  try {
    evidence = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8'));
  } catch (error) {
    readError = error.message;
  }

  const { violations, evidenceAgeMs, generationCheck } = evaluateRuntimeEvidence({
    evidence,
    readError,
    maxAgeMs,
    now: Date.now(),
  });

  const report = {
    report: 'ASK_AI_RUNTIME_EVIDENCE',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'NO_GO',
    maxAgeMs,
    evidenceGeneratedAt: evidence?.generatedAt || null,
    evidenceAgeMs,
    evidenceStatus: evidence?.status || null,
    generationCheck,
    violations,
    note: 'Exige evidência de runtime FRESCA com prova de geração sintetizada (verify:ask-ai-copilot:runtime).',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const ageHours = evidenceAgeMs === null ? 'n/d' : (evidenceAgeMs / 3600000).toFixed(1);
    process.stdout.write(`[ask-ai-runtime-evidence] status=${report.status} evidencia=${report.evidenceStatus || 'ausente'} idade=${ageHours}h geração=${generationCheck?.status || 'n/d'} violações=${violations.length}\n`);
    for (const violation of violations) process.stdout.write(`  [VIOLAÇÃO] ${violation.code} — ${violation.detail}\n`);
  }
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main();
