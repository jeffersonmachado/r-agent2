'use strict';

/**
 * governance/child-gate-guard.js — BORDA ÚNICA do invariante de direção entre gates.
 *
 * `governance/gate-direction.js` é o núcleo PURO (sem I/O). Este módulo é a única borda que lê a
 * cadeia declarada em `config/mandatory-gate-dependencies.json` e os relatórios reais, e é
 * consumido por TODOS os pontos que precisam da regra:
 *
 *   - `scripts/governance/validate-gate-direction.js` (gate bloqueante)
 *   - `tools/system/platform-readiness.js` (produtor do readiness)
 *   - `governance/final-governance-engine.js` (produtor da governança final)
 *   - `governance/export-governance-artifacts.js` (projeção DB-derivada dos dois acima)
 *
 * Motivo de existir (missão 2026-09-28): a regra `child NO_GO ⇒ parent NO_GO` precisa ser a MESMA
 * em todos eles. Duas listas de dependência ou duas leituras diferentes do mesmo relatório
 * produziriam exatamente o defeito que a missão corrige — um elo declarando o que o outro nega.
 */

const fs = require('fs');
const path = require('path');

const { evaluateGateDirection } = require('./gate-direction');

const ROOT = path.join(__dirname, '..');
const CONFIG_REL = path.join('config', 'mandatory-gate-dependencies.json');

/** Lê um caminho `a.b.c` de um objeto; qualquer elo ausente devolve `undefined`. */
function readPath(object, dotted) {
  if (!object || !dotted) return undefined;
  return String(dotted)
    .split('.')
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), object);
}

/**
 * Carrega a cadeia completa, com o estado de leitura de cada relatório (para auditoria).
 * Nunca lança: erro de leitura vira `readError`/`configError` — o consumidor decide, e a decisão
 * correta é sempre fail-closed.
 */
function loadGateChain({ root = ROOT, readJson = null } = {}) {
  const reader = typeof readJson === 'function'
    ? readJson
    : (rel) => {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) return null;
      try {
        return JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch (_) {
        return null;
      }
    };

  let config = null;
  let configError = null;
  try {
    config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
  } catch (error) {
    configError = error.message;
  }

  const gates = ((config && config.gates) || []).map((gate) => {
    const parent = reader(gate.report);
    const describe = (entry) => {
      const report = reader(entry.report);
      return {
        id: entry.id,
        report: entry.report,
        decisionPath: entry.decisionPath,
        decision: report ? readPath(report, entry.decisionPath) : undefined,
        present: report !== null && report !== undefined,
      };
    };
    return {
      id: gate.id,
      report: gate.report,
      decisionPath: gate.decisionPath,
      decision: parent ? readPath(parent, gate.decisionPath) : undefined,
      present: parent !== null && parent !== undefined,
      children: (gate.children || []).map(describe),
    };
  });

  return { gates, configError };
}

/** Violações de UM gate (pai com a decisão informada + filhos lidos). */
function gateViolations({ id, decision, children }) {
  return evaluateGateDirection({ gates: [{ id, decision, children }] }).violations;
}

/**
 * Aplica a invariante a uma decisão que um produtor está prestes a publicar.
 *
 * @returns {{decision: *, violations: Array, downgraded: boolean, configError: string|null}}
 *   `downgraded` é true quando a decisão publicada foi rebaixada por violação de direção.
 */
function guardDecision({ selfId, decision, root = ROOT, readJson = null, fallbackDecision = 'NO_GO:CHILD_GATE_CONFLICT' } = {}) {
  const { gates, configError } = loadGateChain({ root, readJson });
  const gate = gates.find((entry) => entry.id === selfId);

  if (configError) {
    return {
      decision: fallbackDecision,
      downgraded: true,
      configError,
      violations: [{
        code: 'CHILD_GATE_CONFIG_UNREADABLE',
        parent: selfId,
        child: CONFIG_REL,
        detail: `cadeia de dependência dos gates ilegível: ${configError}`,
      }],
    };
  }

  if (!gate) return { decision, downgraded: false, configError: null, violations: [] };

  const violations = gateViolations({ id: selfId, decision, children: gate.children });
  if (violations.length === 0) return { decision, downgraded: false, configError: null, violations: [] };

  return {
    decision: fallbackDecision,
    downgraded: true,
    configError: null,
    violations,
  };
}

module.exports = {
  ROOT,
  CONFIG_REL,
  readPath,
  loadGateChain,
  gateViolations,
  guardDecision,
};
