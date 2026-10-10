'use strict';

/**
 * FRESCOR DE ARTEFATO DE EVIDÊNCIA (achado P1-12, auditoria 2026-10-10).
 *
 * Defeito medido: `governance/proof-engine/index.js` decidia o `proofStatus` de cada
 * artefato do evidence-manifest olhando apenas PRESENÇA e CONTEÚDO semântico —
 * `proofStatus: !exists ? 'missing' : (violações ? 'invalid' : 'valid')`. Nenhuma
 * política de idade era aplicada. Resultado real medido no run
 * `rap-governed-20261010045617268`: `qa/smoke-evidence.json`, com **50,8 dias**,
 * estava declarado `proofStatus: 'valid'` com `governanceLinkage: ['final_decision']`
 * — evidência de dois meses atestando a decisão final de um run de hoje.
 *
 * Por que NÃO inventar política nova: o repositório JÁ tem TTL de evidência, em três
 * lugares independentes:
 *   - `governance/master-scorecard-registry.js` → `maxAgeMs: 7 dias` por artefato;
 *   - `governance/master-scorecard-engine.js` → classifica `STALE`/`ARTIFACT_EXPIRED`;
 *   - `scripts/governance/validate-coverage-gate.js::applyWaveReportStaleness` → 7 dias;
 *   - `tools/system/lib/qa-waves-enterprise-governance-bridge.js` → 48 h para o smoke
 *     agendado (política PRÓPRIA, mais curta, do produtor daquele artefato).
 * Este módulo usa o TTL de 7 dias — o canônico para artefatos de evidência — e deixa o
 * default explícito para que um produtor com política própria (48 h) possa informá-la.
 *
 * ESCOPO DELIBERADO: o frescor bloqueia apenas o artefato que AFIRMA `final_decision`.
 * Artefatos de domínio `governance` são FONTE (assinatura, limpeza, prova de governança)
 * e linkam `proof_based_governance`; o frescor deles é tratado pela fingerprint chain do
 * próprio engine (FRESH/STALE por CONTEÚDO, nunca por timestamp). Aplicar TTL de
 * evidência a fonte seria falso positivo.
 *
 * `UNKNOWN` NÃO é `STALE`: sem timestamp não há como provar que a evidência venceu, e
 * tratar desconhecido como vencido transformaria ausência de dado em bloqueio — o mesmo
 * erro de classe, na direção oposta. O que não se pode é declarar `valid` sem saber.
 */

/** TTL canônico de artefato de evidência no repositório. */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const STATUS = Object.freeze({
  FRESH: 'FRESH',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
});

function parseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  // Timestamp em epoch (ms) é aceito: `Date.parse(1234)` devolve NaN, então sem este
  // ramo um instante perfeitamente válido virava "sem timestamp" — e o artefato seria
  // isentado do TTL por um detalhe de representação.
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function ageFrom(timestamp, now) {
  const produced = parseTime(timestamp);
  if (produced === null) return null;
  return now - produced;
}

/**
 * Decide o frescor de UM artefato.
 *
 * @param {Object} params
 * @param {string|Date} params.timestamp        quando a evidência foi produzida
 * @param {number} [params.now]                 referência (injetável para teste)
 * @param {number} [params.maxAgeMs]            TTL aplicável (default 7 dias)
 * @param {string} [params.exemptReason]        artefato fora do escopo (fonte) → UNKNOWN
 * @returns {{status:'FRESH'|'STALE'|'UNKNOWN', ageMs:number|null, maxAgeMs:number, exempt:boolean, reason:string|null}}
 */
function evaluateArtifactFreshness({ timestamp, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, exemptReason = null } = {}) {
  const ageMs = ageFrom(timestamp, now);

  if (exemptReason) {
    return { status: STATUS.UNKNOWN, ageMs, maxAgeMs, exempt: true, reason: exemptReason };
  }
  if (ageMs === null) {
    return {
      status: STATUS.UNKNOWN,
      ageMs: null,
      maxAgeMs,
      exempt: false,
      reason: 'artefato sem timestamp: frescor não verificável (não é o mesmo que vencido)',
    };
  }
  if (ageMs > maxAgeMs) {
    const ageDays = Number((ageMs / 86400000).toFixed(1));
    const maxDays = Number((maxAgeMs / 86400000).toFixed(1));
    return {
      status: STATUS.STALE,
      ageMs,
      maxAgeMs,
      exempt: false,
      reason: `evidência com ${ageDays} dia(s) excede o TTL de ${maxDays} dia(s)`,
    };
  }
  return { status: STATUS.FRESH, ageMs, maxAgeMs, exempt: false, reason: null };
}

/**
 * Compõe o `proofStatus` do manifesto. Presença e conteúdo semântico continuam
 * valendo o que valiam; o frescor entra como TERCEIRA condição, e `stale` é um
 * estado próprio (nunca `valid`) para que o verifier offline — que rejeita
 * `proofStatus !== 'valid'` — o trate como não-prova.
 */
function resolveProofStatus({ exists, semanticViolations = [], freshness } = {}) {
  if (!exists) return 'missing';
  if (Array.isArray(semanticViolations) && semanticViolations.length > 0) return 'invalid';
  if (freshness && freshness.status === STATUS.STALE) return 'stale';
  return 'valid';
}

/**
 * Vínculo de governança do artefato. Evidência vencida NÃO afirma a decisão final:
 * o vínculo é retirado (lista vazia) em vez de mantido por inércia.
 */
function resolveGovernanceLinkage({ domain, freshness } = {}) {
  if (domain === 'governance') return ['proof_based_governance'];
  if (freshness && freshness.status === STATUS.STALE) return [];
  return ['final_decision'];
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  STATUS,
  evaluateArtifactFreshness,
  resolveProofStatus,
  resolveGovernanceLinkage,
};
