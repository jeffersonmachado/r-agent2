#!/usr/bin/env node
'use strict';

/**
 * verify-engineering-router-v2-audit-envelope.js — VERIFY do envelope de auditoria V2.
 *
 * Consome um envelope JÁ EXISTENTE. NUNCA regenera, nunca reescreve os artefatos, nunca executa o
 * gerador. Se este script gerasse o envelope antes de verificá-lo, a verificação seria
 * AUTO-REFERENTE: sempre concordaria consigo mesma e não provaria integridade alguma.
 *
 * O caminho do envelope é argumento OBRIGATÓRIO — não existe default apontando para um envelope
 * "padrão", para que ninguém verifique por engano um envelope recém-criado em vez do selado.
 *
 * Uso:
 *   node scripts/governance/verify-engineering-router-v2-audit-envelope.js <dir-do-envelope>
 *
 * Saída: relatório humano no stdout + `verification.json` dentro do envelope (resultado, não
 * insumo) + exit 0 (VERIFIED) / 1 (INVALID). Um envelope corrompido produz INVALID explícito,
 * nunca exceção não tratada.
 */

const fs = require('fs');
const path = require('path');
const { verifyEnvelope, STATUS_FILE } = require('./lib/engineeringV2Envelope');

function main() {
  const envelopeDir = process.argv[2];
  if (!envelopeDir) {
    console.error('[v2-envelope:verify] uso: verify-engineering-router-v2-audit-envelope.js <dir-do-envelope>');
    console.error('  (o caminho é obrigatório: verificar um envelope implícito poderia verificar o envelope errado)');
    process.exit(1);
  }
  const absolute = path.resolve(envelopeDir);

  let result;
  try {
    result = verifyEnvelope(absolute);
  } catch (error) {
    // Falha de leitura/estrutura é INVALID declarado — nunca um stack trace sem veredito.
    console.error(`[v2-envelope:verify] INVALID — ${error.message}`);
    process.exit(1);
  }

  console.log(`[v2-envelope:verify] ${absolute}`);
  console.log(`  status=${result.status} checks=${result.checks.length} falhas=${result.failures.length}`);
  if (result.manifest) {
    console.log(`  runId=${result.manifest.runId} artefatos=${result.manifest.artifactCount} sourceCommit=${result.manifest.sourceCommit || '(ausente)'}`);
  }

  const report = {
    artifactType: 'engineering-v2-envelope-verification',
    artifactVersion: '2.0.0',
    generatedAt: new Date().toISOString(),
    envelopeDir: absolute,
    status: result.status,
    manifestRunId: result.manifest?.runId || null,
    artifactFiles: result.artifactFiles || [],
    checks: result.checks,
    failures: result.failures,
  };

  if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
    fs.writeFileSync(path.join(absolute, STATUS_FILE), `${JSON.stringify(report, null, 2)}\n`);
  }

  if (result.status !== 'VERIFIED') {
    for (const failure of result.failures) console.error(`  - ${failure.id}${failure.detail ? ` :: ${failure.detail}` : ''}`);
    process.exit(1);
  }
}

if (require.main === module) main();
