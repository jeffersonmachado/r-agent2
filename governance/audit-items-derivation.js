'use strict';

/**
 * governance/audit-items-derivation.js — CLASSIFICAÇÃO dos itens de auditoria (núcleo PURO).
 *
 * CONTEXTO (missão 2026-09-28): a auditoria externa entregou uma LISTA de estados por nome
 * (`ENGINEERING_ROUTER_V2 = NO_GO`, `TASK_LEASE_NORMAL_RUNTIME = NO_GO`, ...) e uma faixa numérica
 * legada (`V2-01..V2-42`) que **não existe em nenhum artefato do repositório**. O repositório já
 * declarava essa lacuna e proibia inventar identificadores — corretamente. Ao mesmo tempo, a missão
 * exige: "CONFIRME CADA ITEM NO REPOSITÓRIO ATUAL. Se algum finding já estiver corrigido:
 * classifique como ALREADY_FIXED e prove."
 *
 * Este núcleo faz exatamente isso, sem escrever status à mão: cada item aponta para a PROVA (um
 * relatório real + o caminho do campo de decisão) e o estado atual é LIDO de lá. A classificação
 * distingue:
 *
 *   ALREADY_FIXED   — a auditoria dizia negativo e a prova real diz que está resolvido;
 *   CONFIRMED       — a auditoria dizia negativo e a prova real confirma que continua negativo;
 *   REGRESSED       — a auditoria dizia positivo e a prova real diz negativo (o pior caso);
 *   STILL_PROVEN    — a auditoria dizia positivo e continua positivo;
 *   BLOCKED_EXTERNAL— a prova só pode vir de fora (credencial/janela) e o estado observado é o de
 *                     impedimento declarado — NUNCA convertido em aprovação;
 *   UNPROVABLE      — a prova não existe/não é legível: ausência de evidência, jamais aprovação.
 *
 * Regra de direção: nada aqui promove nada. O item só é "provado" se o VALOR REAL lido do relatório
 * estiver na lista de valores que provam aquele item.
 */

/** Estados possíveis da auditoria (entrada) normalizados. */
const NEGATIVE_AUDIT_STATES = /^(NO_GO|FAIL|PARTIAL|IMPROVED|INCONCLUSIVO|NOT_EXECUTED)/i;
const POSITIVE_AUDIT_STATES = /^(PASS|GO|GREEN|PASS_CORE|PASS_STRUCTURAL)/i;

function normalize(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  return text.length === 0 ? null : text;
}

/**
 * Classifica UM item.
 *
 * @param {{ id: string, auditState: string, provenValues: string[], blockedExternalValues?: string[] }} item
 * @param {*} observedValue valor lido do relatório real (null/undefined = ausente)
 * @returns {{ id: string, classification: string, auditState: string, observedValue: *, detail: string }}
 */
function classifyItem(item, observedValue) {
  const observed = normalize(observedValue);
  const proven = (item.provenValues || []).map(normalize);
  const blockedExternal = (item.blockedExternalValues || []).map(normalize);
  const audit = normalize(item.auditState);
  const auditNegative = audit !== null && NEGATIVE_AUDIT_STATES.test(audit);
  // Predicado de aprovação: permite à borda delegar a AUTORIDADE ÚNICA de decisão
  // (`governance/decision-family.js`) em vez de repetir uma lista literal de estados. Uma decisão
  // de família GO (`AUTONOMOUS_READY_GO`, `GO`, `PASS_WITH_DEFERRED_PACKAGE_GATE`, ...) é aprovação
  // ainda que o nome exato não esteja na lista — sem isso, um veredito legítimo era lido como não
  // provado e o item ficava CONFIRMED (falso bloqueio).
  const isProven = typeof item.isProven === 'function' ? item.isProven : (value) => proven.includes(normalize(value));

  if (observed === null) {
    return {
      id: item.id,
      classification: 'UNPROVABLE',
      auditState: item.auditState,
      observedValue: observedValue === undefined ? null : observedValue,
      detail: `sem valor observável na prova declarada (${item.proof && item.proof.report}/${item.proof && item.proof.decisionPath}) — ausência de evidência nunca é aprovação`,
    };
  }

  if (blockedExternal.includes(observed)) {
    return {
      id: item.id,
      classification: 'BLOCKED_EXTERNAL',
      auditState: item.auditState,
      observedValue,
      detail: `estado de impedimento externo declarado (${observed})`,
    };
  }

  if (isProven(observed)) {
    return {
      id: item.id,
      classification: auditNegative ? 'ALREADY_FIXED' : 'STILL_PROVEN',
      auditState: item.auditState,
      observedValue,
      detail: auditNegative
        ? `auditoria dizia ${item.auditState}; a prova real diz ${observed}`
        : `auditoria e prova concordam (${observed})`,
    };
  }

  return {
    id: item.id,
    classification: auditNegative ? 'CONFIRMED' : 'REGRESSED',
    auditState: item.auditState,
    observedValue,
    detail: auditNegative
      ? `auditoria dizia ${item.auditState} e a prova real confirma (${observed})`
      : `auditoria dizia ${item.auditState} mas a prova real diz ${observed}`,
  };
}

/**
 * Deriva TODOS os itens.
 * @param {{ items: Array, readValue: (item) => * }} input
 */
function deriveAuditItems({ items = [], readValue }) {
  const derived = items.map((item) => {
    let value = null;
    try {
      value = readValue(item);
    } catch (_) {
      value = null; // prova ilegível é ausência de prova
    }
    return {
      ...classifyItem(item, value),
      scope: item.scope || 'ENGINEERING_ROUTER_V2',
      proof: item.proof || null,
      note: item.note || null,
    };
  });

  const counts = derived.reduce((acc, entry) => {
    acc[entry.classification] = (acc[entry.classification] || 0) + 1;
    return acc;
  }, {});

  // ESCOPO (missão 2026-09-28): o selo do Router NÃO pode depender de item que só fica verde DEPOIS
  // dele (o próprio selo, ou o release da plataforma) — seria dependência circular. O status do
  // conjunto é decidido pelos itens do escopo do Router; os de plataforma ficam declarados à parte.
  const unresolved = derived.filter((entry) => ['CONFIRMED', 'REGRESSED', 'UNPROVABLE'].includes(entry.classification));
  const routerScopeUnresolved = unresolved.filter((entry) => entry.scope !== 'PLATFORM_RELEASE');
  const platformScopeUnresolved = unresolved.filter((entry) => entry.scope === 'PLATFORM_RELEASE');
  const external = derived.filter((entry) => entry.classification === 'BLOCKED_EXTERNAL');

  return {
    status: routerScopeUnresolved.length === 0 ? 'PASS' : 'FAIL',
    total: derived.length,
    counts,
    items: derived,
    unresolvedIds: unresolved.map((entry) => entry.id),
    routerScopeUnresolvedIds: routerScopeUnresolved.map((entry) => entry.id),
    platformScopeUnresolvedIds: platformScopeUnresolved.map((entry) => entry.id),
    externalBlockerIds: external.map((entry) => entry.id),
  };
}

module.exports = { deriveAuditItems, classifyItem, normalize };
