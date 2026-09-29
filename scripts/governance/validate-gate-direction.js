#!/usr/bin/env node
'use strict';

/**
 * validate-gate-direction.js — GATE BLOQUEANTE do INVARIANTE DE DIREÇÃO (missão 2026-09-28).
 *
 * Problema real encontrado na auditoria: `governance/final-governance-report.json` declarava
 * `AUTONOMOUS_READY_GO` enquanto `reports/engineering-router-v2-seal-report.json` declarava
 * `NO_GO`. O estado proibido (`child NO_GO → parent GO`) existia no repositório e nada o detectava.
 *
 * Este gate lê a cadeia declarada em `config/mandatory-gate-dependencies.json`, resolve a decisão
 * de cada gate/filho nos relatórios REAIS e aplica o invariante puro de `governance/gate-direction`.
 *
 * Saída: `reports/gate-direction-report.json` (com a cadeia avaliada e as violações).
 * Uso: node scripts/governance/validate-gate-direction.js [--json]
 * Exit: 0 = PASS (nenhuma contradição), 1 = FAIL (contradição de governança).
 */

const fs = require('fs');
const path = require('path');

const { evaluateGateDirection } = require('../../governance/gate-direction');

const ROOT_DIR = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'mandatory-gate-dependencies.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'gate-direction-report.json');

/** Lê um caminho `a.b.c` de um objeto, devolvendo undefined quando qualquer elo faltar. */
function readPath(object, dotted) {
  if (!object || !dotted) return undefined;
  return dotted.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), object);
}

function loadDecision(reportRel, decisionPath) {
  const abs = path.join(ROOT_DIR, reportRel);
  if (!fs.existsSync(abs)) return { present: false, decision: null, error: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return { present: true, decision: readPath(parsed, decisionPath), error: null };
  } catch (error) {
    // Relatório ilegível é AUSÊNCIA de evidência, nunca aprovação silenciosa.
    return { present: false, decision: null, error: error.message };
  }
}

function resolveChain(config) {
  const gates = (config.gates || []).map((gate) => {
    const parent = loadDecision(gate.report, gate.decisionPath);
    return {
      id: gate.id,
      report: gate.report,
      decisionPath: gate.decisionPath,
      decision: parent.decision,
      present: parent.present,
      readError: parent.error,
      children: (gate.children || []).map((child) => {
        const loaded = loadDecision(child.report, child.decisionPath);
        return {
          id: child.id,
          report: child.report,
          decisionPath: child.decisionPath,
          decision: loaded.decision,
          present: loaded.present,
          readError: loaded.error,
        };
      }),
    };
  });
  return { gates };
}

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[gate-direction] configuração ausente: ${path.relative(ROOT_DIR, CONFIG_PATH)}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const { gates } = resolveChain(config);
  // `decision: undefined` de um filho AUSENTE precisa chegar ao núcleo como ausência — o núcleo
  // classifica `null`/`undefined` como ABSENT e reprova pai GO sem evidência do filho.
  const result = evaluateGateDirection({ gates });

  const report = {
    report: 'GATE_DIRECTION_INVARIANT',
    generatedAt: new Date().toISOString(),
    config: path.relative(ROOT_DIR, CONFIG_PATH),
    status: result.status,
    violations: result.violations,
    violationCount: result.violations.length,
    gates: gates.map((gate) => ({
      id: gate.id,
      report: gate.report,
      decisionPath: gate.decisionPath,
      decision: gate.decision === undefined ? null : gate.decision,
      present: gate.present,
      readError: gate.readError,
      children: gate.children.map((child) => ({
        id: child.id,
        report: child.report,
        decisionPath: child.decisionPath,
        decision: child.decision === undefined ? null : child.decision,
        present: child.present,
        readError: child.readError,
      })),
    })),
    invariants: [
      'child NO_GO ⇒ parent NO_GO',
      'child BLOCKED/INCONCLUSIVO/PENDENTE ⇒ parent não pode ser GO',
      'parent GO sem evidência do filho obrigatório ⇒ violação (ausência nunca é aprovação)',
      'direção única: runtime → gate → selo → readiness → governança final',
    ],
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const gate of gates) {
      const decision = gate.decision === undefined ? '(ausente)' : gate.decision;
      process.stdout.write(`  [${gate.id}] decisão=${decision} (${path.basename(gate.report)})\n`);
      for (const child of gate.children) {
        const childDecision = child.decision === undefined ? '(ausente)' : child.decision;
        process.stdout.write(`      filho ${child.id}: ${childDecision}\n`);
      }
    }
    for (const violation of result.violations) {
      process.stdout.write(`  [VIOLAÇÃO] ${violation.code} — ${violation.detail}\n`);
    }
    process.stdout.write(`[gate-direction] status=${result.status} violações=${result.violations.length} relatório=${path.relative(ROOT_DIR, REPORT_PATH)}\n`);
  }

  process.exit(result.status === 'PASS' ? 0 : 1);
}

main();
