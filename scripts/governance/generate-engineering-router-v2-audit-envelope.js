#!/usr/bin/env node
'use strict';

/**
 * generate-engineering-router-v2-audit-envelope.js — GENERATE do envelope de auditoria V2.
 *
 * Operação SEPARADA da verificação (ver `verify-engineering-router-v2-audit-envelope.js`).
 * Este script LÊ relatórios de governança já produzidos e escreve o envelope. Nunca executa uma
 * verificação — quem verifica é o verifier, sobre o envelope em disco.
 *
 * Regra de honestidade: um relatório esperado e AUSENTE não é inventado nem silenciado. Ele entra
 * em `envelope-inputs.json` como `NOT_AVAILABLE`, com o caminho esperado. Assim o envelope declara
 * exatamente o que tinha disponível quando foi selado.
 *
 * Uso:
 *   node scripts/governance/generate-engineering-router-v2-audit-envelope.js [dir-de-saida]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { generateEnvelope, signEnvelope } = require('./lib/engineeringV2Envelope');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'engineering-router-v2-audit-envelope');

/** Relatórios que o envelope V2 cobre. Ausente ⇒ declarado, nunca omitido. */
const EXPECTED_INPUTS = Object.freeze([
  'reports/release-suite-execution.json',
  'reports/anti-greenwashing-report.json',
  'reports/engineering-router-v2-status-report.json',
  'reports/governance-score.json',
  'governance/release-attestation.json',
  'reports/route-mount-report.json',
]);

function readJson(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return { available: false, path: relativePath };
  try {
    return { available: true, path: relativePath, value: JSON.parse(fs.readFileSync(absolute, 'utf8')) };
  } catch (err) {
    return { available: false, path: relativePath, error: `ilegível: ${err.message}` };
  }
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (_) {
    return null;
  }
}

function main() {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT;
  const available = [];
  const unavailable = [];
  const artifacts = {};

  for (const relativePath of EXPECTED_INPUTS) {
    const read = readJson(relativePath);
    if (read.available) {
      const name = `${path.basename(relativePath, '.json')}.json`;
      artifacts[name] = { ...read.value, sourcePath: relativePath };
      available.push(relativePath);
    } else {
      unavailable.push({ path: relativePath, error: read.error || 'não encontrado' });
    }
  }

  const runId = process.env.ENVELOPE_RUN_ID || `v2-envelope-${Date.now()}`;
  artifacts['envelope-inputs.json'] = {
    artifactType: 'engineering-v2-envelope-inputs',
    expectedInputs: EXPECTED_INPUTS.length,
    availableInputs: available,
    unavailableInputs: unavailable,
  };

  const result = generateEnvelope({
    outDir,
    artifacts,
    runId,
    sourceCommit: currentCommit(),
    sourceFingerprint: computeSourceFingerprint(ROOT),
  });

  // Assinatura é opcional POR CONFIGURAÇÃO: sem chave, o envelope é íntegro por hash e declara a
  // ausência de assinatura na verificação. Nunca um selo falso.
  const signed = signEnvelope(outDir, {});

  console.log(`[v2-envelope:generate] ${outDir}`);
  console.log(`  runId=${result.manifest.runId} artefatos=${result.files.length} disponíveis=${available.length}/${EXPECTED_INPUTS.length}`);
  if (signed.signed) console.log(`  assinado (ed25519, fingerprint=${signed.publicKeyFingerprint})`);
  else console.log(`  NÃO assinado: ${signed.reason}`);
  if (unavailable.length > 0) {
    console.log('  insumos ausentes (declarados no envelope, nunca omitidos):');
    for (const item of unavailable) console.log(`    - ${item.path}: ${item.error}`);
  }
}

if (require.main === module) main();

module.exports = { EXPECTED_INPUTS };
