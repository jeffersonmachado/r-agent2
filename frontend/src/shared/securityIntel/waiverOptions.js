/**
 * Opções de achado para conceder isenção (waiver) na tela de engenharia.
 *
 * Regra de negócio que este módulo protege: a tela existe para o humano decidir
 * sobre a fila de triagem. Se a lista de achados da API for cortada (o endpoint
 * tem limite) ou a tela truncar a exibição, os achados que EXIGEM decisão ficam
 * inalcançáveis e a decisão só acontece por CLI — foi exatamente o defeito
 * medido em 2026-10-08: `findings.slice(0, 50)` sobre 1091 achados abertos
 * deixava 31 dos 35 achados de decisão humana fora da tela.
 *
 * Por isso:
 *  1. todo achado de decisão da fila (buckets `HUMAN_APPROVAL` e
 *     `WAIVER_OR_COMPENSATING_CONTROL`) é SEMPRE oferecido, mesmo que não esteja
 *     na lista de achados carregada (o corte da API não pode esconder decisão);
 *  2. o filtro do usuário NUNCA remove achados de decisão — ele só estreita o
 *     grupo "demais achados";
 *  3. quando a lista de "demais" vier cortada pela API, isso é REPORTADO
 *     (`capped`), nunca omitido.
 *
 * Módulo puro: sem React, sem I/O, sem relógio.
 */

/** Buckets da fila que exigem decisão humana explícita. */
export const HUMAN_DECISION_BUCKETS = ['HUMAN_APPROVAL', 'WAIVER_OR_COMPENSATING_CONTROL'];

const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };

function rankOf(severity) {
  const key = String(severity || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, key) ? SEVERITY_RANK[key] : 5;
}

function normalize(text) {
  return String(text == null ? '' : text).toLowerCase();
}

/**
 * Achados que exigem decisão humana, derivados da fila de triagem.
 *
 * @param {{groups?: Array}} triage dossiê da fila (mesma fonte da CLI e da API)
 * @returns {Array<{findingKey: string, packageName: string, severity: string, bucket: string, withoutFix: boolean, kev: boolean}>}
 */
export function decisionFindingsFromTriage(triage) {
  const groups = Array.isArray(triage && triage.groups) ? triage.groups : [];
  const byKey = new Map();

  for (const group of groups) {
    if (!HUMAN_DECISION_BUCKETS.includes(group && group.bucket)) continue;
    const keys = Array.isArray(group.findingKeys) ? group.findingKeys : [];
    const withoutFix = new Set(Array.isArray(group.withoutFixFindingKeys) ? group.withoutFixFindingKeys : []);
    for (const findingKey of keys) {
      if (!findingKey) continue;
      const existing = byKey.get(findingKey);
      // O mesmo achado pode aparecer em mais de um grupo: mantém o mais severo.
      if (existing && rankOf(existing.severity) <= rankOf(group.severity)) continue;
      byKey.set(findingKey, {
        findingKey,
        packageName: group.packageName || '',
        severity: group.severity || '',
        bucket: group.bucket,
        withoutFix: withoutFix.has(findingKey),
        kev: Boolean(group.kev),
      });
    }
  }

  return [...byKey.values()].sort((a, b) => (
    rankOf(a.severity) - rankOf(b.severity)
    || String(a.packageName).localeCompare(String(b.packageName))
    || String(a.findingKey).localeCompare(String(b.findingKey))
  ));
}

function labelOf(entry, fallback) {
  const severity = entry.severity ? `${entry.severity} · ` : '';
  const packageName = entry.packageName || fallback.package_name || '—';
  const version = fallback.installed_version ? `@${fallback.installed_version}` : '';
  const advisory = fallback.advisory_id || entry.findingKey.split('|')[0];
  return `${severity}${packageName}${version} · ${advisory}`;
}

/**
 * Monta os dois grupos de opções do seletor de achado.
 *
 * @param {object} input
 * @param {{items?: Array, total?: number}} [input.findings] resposta de `listSecurityFindings`
 * @param {object} [input.triage] dossiê da fila
 * @param {string} [input.filter] texto de filtro do usuário (aplica só em "demais")
 * @returns {{decision: Array, others: Array, decisionTotal: number, othersOffered: number,
 *            loaded: number, totalOpen: number, capped: boolean}}
 */
export function buildWaiverOptions({ findings, triage, filter } = {}) {
  const items = Array.isArray(findings && findings.items) ? findings.items : [];
  const totalOpen = Number(findings && findings.total) || items.length;
  const byKey = new Map();
  for (const row of items) {
    if (row && row.finding_key) byKey.set(row.finding_key, row);
  }

  const decisions = decisionFindingsFromTriage(triage);
  const decisionKeys = new Set(decisions.map((d) => d.findingKey));

  const decision = decisions.map((entry) => ({
    value: entry.findingKey,
    label: labelOf(entry, byKey.get(entry.findingKey) || {}),
    bucket: entry.bucket,
    withoutFix: entry.withoutFix,
  }));

  const needle = normalize(filter).trim();
  const others = items
    .filter((row) => row && row.finding_key && !decisionKeys.has(row.finding_key))
    .filter((row) => (
      !needle
      || normalize(row.package_name).includes(needle)
      || normalize(row.advisory_id).includes(needle)
      || normalize(row.installed_version).includes(needle)
    ))
    .map((row) => ({ value: row.finding_key, label: labelOf({}, row), bucket: null, withoutFix: false }));

  return {
    decision,
    others,
    decisionTotal: decision.length,
    othersOffered: others.length,
    loaded: items.length,
    totalOpen,
    // "Cortado" é fato medido, não impressão: a API devolveu menos itens do que
    // ela mesma declara existir.
    capped: totalOpen > items.length,
  };
}

export default { HUMAN_DECISION_BUCKETS, decisionFindingsFromTriage, buildWaiverOptions };
