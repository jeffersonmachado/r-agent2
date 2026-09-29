#!/usr/bin/env node
'use strict';

/**
 * validate-engineering-router-v2-audit-items.js — CONFIRMAÇÃO ITEM A ITEM da auditoria da missão.
 *
 * A missão exige: "ANTES DE ALTERAR QUALQUER CÓDIGO: CONFIRME CADA ITEM NO REPOSITÓRIO ATUAL. Se
 * algum finding já estiver corrigido: classifique como ALREADY_FIXED e prove."
 *
 * Este gate lê `config/engineering-router-v2-audit-items.json` (lista de itens nomeados pela
 * auditoria, com a prova de cada um), resolve o VALOR REAL no relatório declarado (ou o estado da
 * suíte no relatório de execução autoritativa) e classifica via núcleo puro
 * `governance/audit-items-derivation.js`.
 *
 * Regras que não podem ser afrouxadas:
 *   - status NUNCA é escrito à mão: vem do valor lido;
 *   - ausência de prova ⇒ UNPROVABLE (nunca "aprovado por falta de dado");
 *   - impedimento externo declarado ⇒ BLOCKED_EXTERNAL (nunca vira PASS);
 *   - a faixa numérica legada `V2-01..V2-42` NÃO é inventada: permanece declarada como sem fonte.
 *
 * Saída: `reports/engineering-router-v2-audit-items-report.json`
 * Uso: node scripts/governance/validate-engineering-router-v2-audit-items.js [--json]
 */

const fs = require('fs');
const path = require('path');

const { deriveAuditItems, normalize } = require('../../governance/audit-items-derivation');
const { decisionFamily, DECISION_FAMILY } = require('../../governance/decision-family');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'engineering-router-v2-audit-items.json');
const SUITE_REPORT = path.join(ROOT, 'reports', 'release-suite-execution.json');
const REPORT_PATH = path.join(ROOT, 'reports', 'engineering-router-v2-audit-items-report.json');

const DEFAULT_PROVEN = ['GO', 'GREEN', 'PASS', 'HEALTHY', 'COMPLETE', 'PASS_CORE', 'VERIFIED'];

function readJsonAbs(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readPath(object, dotted) {
  if (!object || !dotted) return undefined;
  return String(dotted).split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), object);
}

/** Resolve o valor observado para a prova declarada. `null` = prova ausente/ilegível. */
function resolveObservedValue(item) {
  const proof = item.proof || {};
  if (proof.kind === 'suite') {
    const suiteReport = readJsonAbs(SUITE_REPORT);
    const entry = ((suiteReport && suiteReport.results) || []).find((row) => row.suite === proof.suite);
    if (!entry) return null;
    return entry.state === 'PASS' ? 'PASS' : entry.state;
  }
  const report = readJsonAbs(path.join(ROOT, proof.report || ''));
  if (!report) return null;
  if (proof.itemId) {
    const list = readPath(report, proof.itemsPath || 'items') || [];
    const found = (Array.isArray(list) ? list : []).find((entry) => entry && entry.id === proof.itemId);
    if (!found) return null;
    return readPath(found, proof.decisionPath || 'status');
  }
  return readPath(report, proof.decisionPath);
}

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[audit-items] configuração ausente: ${path.relative(ROOT, CONFIG_PATH)}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const items = (config.items || []).map((item) => {
    const provenValues = item.provenValues || config.provenValuesDefault || DEFAULT_PROVEN;
    return {
      ...item,
      provenValues,
      // AUTORIDADE ÚNICA de "aprovado": os estados técnicos da lista OU qualquer decisão de
      // família GO segundo `governance/decision-family.js`. Antes, a aprovação era uma lista
      // literal e um veredito legítimo como `AUTONOMOUS_READY_GO` era lido como NÃO provado —
      // medido em 2026-09-28: `RAP_FINAL_RELEASE` ficava CONFIRMED com a prova real em GO.
      isProven: (value) => {
        if (provenValues.map(normalize).includes(normalize(value))) return true;
        return decisionFamily(value) === DECISION_FAMILY.GO_FAMILY;
      },
    };
  });

  const derived = deriveAuditItems({ items, readValue: resolveObservedValue });

  // Itens que a própria auditoria declarou sem fonte no repositório: nunca inventados, sempre ditos.
  const legacyUnmapped = {
    range: 'V2-01..V2-42',
    status: 'MAPPED_FROM_MISSION_PROMPT',
    manifest: 'config/engineering-router-v2-required-tests.json',
    gate: 'npm run validate:required-tests',
    reason: 'a numeração FOI localizada (seção 38 do prompt original da missão, recuperada do histórico da sessão 3ca8a6ba em 2026-09-28) e virou manifesto versionado com os 42 enunciados verbatim; o estado de cada ID é derivado por validate:required-tests',
  };

  const report = {
    report: 'ENGINEERING_ROUTER_V2_AUDIT_ITEMS',
    generatedAt: new Date().toISOString(),
    source: config.source,
    config: path.relative(ROOT, CONFIG_PATH),
    status: derived.status,
    total: derived.total,
    counts: derived.counts,
    unresolvedIds: derived.unresolvedIds,
    routerScopeUnresolvedIds: derived.routerScopeUnresolvedIds,
    platformScopeUnresolvedIds: derived.platformScopeUnresolvedIds,
    externalBlockerIds: derived.externalBlockerIds,
    legacyUnmapped,
    items: derived.items,
    note: 'Status derivado do valor REAL de cada prova (relatório ou suíte autoritativa). ALREADY_FIXED = a auditoria dizia negativo e a prova diz que está resolvido.',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const entry of derived.items) {
      const observed = entry.observedValue === null ? '(ausente)' : entry.observedValue;
      process.stdout.write(`  [${entry.classification}] ${entry.id} — auditoria=${entry.auditState} prova=${observed}\n`);
    }
    process.stdout.write(`[audit-items] status=${derived.status} itens=${derived.total} ${JSON.stringify(derived.counts)}\n`);
    if (derived.routerScopeUnresolvedIds.length > 0) {
      process.stdout.write(`[audit-items] NÃO resolvidos (escopo Router): ${derived.routerScopeUnresolvedIds.join(', ')}\n`);
    }
    if (derived.platformScopeUnresolvedIds.length > 0) {
      process.stdout.write(`[audit-items] não resolvidos (escopo PLATAFORMA — decididos pela governança final, não pelo selo): ${derived.platformScopeUnresolvedIds.join(', ')}\n`);
    }
  }
  process.exit(derived.status === 'PASS' ? 0 : 1);
}

main();
