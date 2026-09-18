#!/usr/bin/env node
'use strict';

/**
 * validate-decision-semantics.js — gate de INTEGRIDADE SEMÂNTICA das decisões.
 *
 * Responde a duas perguntas que já foram respondidas ERRADO em artefato
 * persistido, e que nenhum outro gate cobria:
 *
 *  A) FINAL_PROOF_DECISION_SEMANTICS — alguma decisão persistida mistura
 *     BLOQUEIO com rótulo da família GO?
 *
 *     Defeito medido (2026-09-18): `governance/final-proof-report.json` publicou
 *     `finalDecision: "NO_GO:AUTONOMOUS_READY_GO"` com `blockingGaps: 1`. A
 *     string afirma as duas coisas: `startsWith('NO_GO')` lê bloqueio; o rótulo
 *     lê aprovação. Um relatório assim permite declarar sucesso onde a
 *     governança diz o contrário — é a forma mais barata de falso GO.
 *
 *     Regra: uma decisão da família NO_GO pode NOMEAR a causa
 *     (`NO_GO:BLOCKING_GAPS`, `NO_GO:MANDATORY_GATE_BLOCKED [...]`) mas NUNCA
 *     carregar maturidade da família GO (`AUTONOMOUS_READY`, `*_GO`, `READY`).
 *     Maturidade viaja em campo PRÓPRIO (`candidateMaturityLevel`).
 *
 *  B) RESEARCH_CANONICAL_PROVIDER_ONLY — o egress de pesquisa voltou a ser
 *     nativo por DEFAULT?
 *
 *     Defeito medido: os módulos de rotas de benchmark e de descoberta de mercado
 *     injetavam o provider NATIVO como default, ou seja, o caminho padrão de
 *     pesquisa pública do Core era `createNativeResearchProvider() → Internet`,
 *     fora do Canonical Tool Registry, do MCP Control Plane e de qualquer
 *     revogação por configuração.
 *
 *     Regra: o egress nativo exige opt-in EXPLÍCITO
 *     (`RESEARCH_NATIVE_PROVIDER_ENABLED`) e os módulos de rotas precisam
 *     resolver primeiro pelo registry governado.
 *
 * Saída: `reports/decision-semantics-report.json` (versionado).
 *
 * Uso: node scripts/governance/validate-decision-semantics.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'decision-semantics-report.json');

/**
 * Decisão bloqueada que carrega maturidade da família GO.
 *
 * `MANDATORY_GATE_BLOCKED` é permitido: nomeia a CAUSA do bloqueio, não uma
 * maturidade. O que se proíbe é `NO_GO:<algo da família GO>`.
 */
const AMBIGUOUS_BLOCKED_GO = /NO_GO:[A-Z_]*(?:READY|_GO)\b/;
const ALLOWED_BLOCKED_SUFFIXES = /^NO_GO:(?:MANDATORY_GATE_BLOCKED|BLOCKING_GAPS|UNKNOWN|STRICT_ENTERPRISE|GOVERNANCE_BLOCKED|RECALC_BLOCKED|MESH_BLOCKED)/;

/** Módulos que decidem o provider de pesquisa do RAP Core. */
const RESEARCH_ROUTE_MODULES = [
  'api/modules/benchmark-research/routes.js',
  'api/modules/market-discovery/routes.js',
];

const NATIVE_OPT_IN_ENV = 'RESEARCH_NATIVE_PROVIDER_ENABLED';
const GOVERNED_RESOLVER_MODULE = 'api/services/research/governedResearchProviders.js';

const ARTIFACT_DIRS = ['governance', 'reports'];
const ARTIFACT_SKIP = /(?:state|history|backlog|snapshot|trace)/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Percorre um artefato coletando TODO valor string que pareça uma decisão.
 * @returns {Array<{path: string, value: string}>}
 */
function collectDecisionStrings(node, pointer = '', found = []) {
  if (typeof node === 'string') {
    if (node.includes('NO_GO')) found.push({ path: pointer, value: node });
    return found;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectDecisionStrings(item, `${pointer}[${index}]`, found));
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectDecisionStrings(value, pointer ? `${pointer}.${key}` : key, found);
    }
  }
  return found;
}

/** A) Varre os artefatos persistidos procurando decisões ambíguas. */
function checkDecisionSemantics() {
  const violations = [];
  let scanned = 0;

  for (const dir of ARTIFACT_DIRS) {
    const absDir = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const entry of fs.readdirSync(absDir)) {
      if (!entry.endsWith('.json')) continue;
      if (ARTIFACT_SKIP.test(entry)) continue;
      const abs = path.join(absDir, entry);
      const data = readJsonSafe(abs);
      if (!data) continue;
      scanned += 1;
      const decisions = collectDecisionStrings(data);
      for (const decision of decisions) {
        const value = String(decision.value);
        if (ALLOWED_BLOCKED_SUFFIXES.test(value)) continue;
        if (AMBIGUOUS_BLOCKED_GO.test(value)) {
          violations.push({
            code: 'AMBIGUOUS_BLOCKED_DECISION_CARRIES_GO_MATURITY',
            file: `${dir}/${entry}`,
            path: decision.path,
            value,
            detail: 'Decisão bloqueada não pode carregar maturidade da família GO. Separe maturidade (candidateMaturityLevel) de decisão (finalDecision).',
          });
        }
      }
    }
  }

  return { scanned, violations };
}

/** B) Varre os módulos de pesquisa procurando egress nativo por default. */
function checkResearchEgress() {
  const violations = [];

  const resolverPath = path.join(ROOT_DIR, GOVERNED_RESOLVER_MODULE);
  if (!fs.existsSync(resolverPath)) {
    violations.push({
      code: 'GOVERNED_RESEARCH_RESOLVER_MISSING',
      file: GOVERNED_RESOLVER_MODULE,
      detail: 'Módulo de resolução governada de providers de pesquisa ausente.',
    });
  } else {
    const source = fs.readFileSync(resolverPath, 'utf8');
    if (!source.includes(NATIVE_OPT_IN_ENV)) {
      violations.push({
        code: 'NATIVE_RESEARCH_OPT_IN_GATE_MISSING',
        file: GOVERNED_RESOLVER_MODULE,
        detail: `O egress nativo precisa do opt-in explícito ${NATIVE_OPT_IN_ENV}.`,
      });
    }
    if (!source.includes('external_mcp')) {
      violations.push({
        code: 'GOVERNED_RESOLVER_NOT_REGISTRY_BACKED',
        file: GOVERNED_RESOLVER_MODULE,
        detail: 'A resolução governada deve considerar apenas providers externos registrados pelo adapter MCP.',
      });
    }
  }

  for (const relative of RESEARCH_ROUTE_MODULES) {
    const abs = path.join(ROOT_DIR, relative);
    if (!fs.existsSync(abs)) {
      violations.push({ code: 'RESEARCH_ROUTE_MODULE_MISSING', file: relative });
      continue;
    }
    const source = fs.readFileSync(abs, 'utf8');
    // O default precisa passar pela resolução governada...
    if (!source.includes('resolveGovernedResearchRunners')) {
      violations.push({
        code: 'RESEARCH_EGRESS_NOT_GOVERNED',
        file: relative,
        detail: 'O provider default precisa ser resolvido pelo Canonical Tool Registry (resolveGovernedResearchRunners).',
      });
    }
    // ...e o nativo só pode aparecer atrás do opt-in.
    const nativeDefault = /injected\.providers\s*\|\|\s*nativeResearchProviders\(/.test(source)
      || /providers:\s*defaultResearchProviders\(deps\.logger\)\s*[,}]/.test(source);
    if (nativeDefault) {
      violations.push({
        code: 'NATIVE_RESEARCH_PROVIDER_IS_DEFAULT',
        file: relative,
        detail: 'O provider NATIVO não pode ser o default do módulo de rotas.',
      });
    }
    if (!source.includes(NATIVE_OPT_IN_ENV)) {
      violations.push({
        code: 'NATIVE_RESEARCH_OPT_IN_NOT_REFERENCED',
        file: relative,
        detail: `O módulo precisa referenciar o opt-in ${NATIVE_OPT_IN_ENV} para habilitar o egress nativo.`,
      });
    }
  }

  return { violations };
}

function run() {
  const decisions = checkDecisionSemantics();
  const egress = checkResearchEgress();
  const violations = [...decisions.violations, ...egress.violations];

  const report = {
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    artifactsScanned: decisions.scanned,
    checks: {
      FINAL_PROOF_DECISION_SEMANTICS: decisions.violations.length === 0 ? 'PASS' : 'FAIL',
      RESEARCH_CANONICAL_PROVIDER_ONLY: egress.violations.length === 0 ? 'PASS' : 'FAIL',
    },
    violations,
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function main() {
  const report = run();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(
      `[decision-semantics] status=${report.status} artifacts=${report.artifactsScanned} `
      + `decisionSemantics=${report.checks.FINAL_PROOF_DECISION_SEMANTICS} `
      + `researchEgress=${report.checks.RESEARCH_CANONICAL_PROVIDER_ONLY}`,
    );
    for (const violation of report.violations) {
      console.log(`  - ${violation.code}: ${violation.file}${violation.path ? ` (${violation.path})` : ''} — ${violation.detail || ''}`);
    }
  }
  process.exit(report.status === 'PASS' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { run, checkDecisionSemantics, checkResearchEgress, AMBIGUOUS_BLOCKED_GO, ALLOWED_BLOCKED_SUFFIXES };
