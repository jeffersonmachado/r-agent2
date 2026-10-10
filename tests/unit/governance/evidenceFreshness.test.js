'use strict';

/**
 * Frescor de evidência (P1-12).
 *
 * Defeito medido antes do fix: `governance/proof-engine/index.js` declarava
 * `proofStatus: 'valid'` e `governanceLinkage: ['final_decision']` para
 * `qa/smoke-evidence.json` com 50,8 dias de idade — nenhuma política de idade era
 * aplicada. Cada teste aqui corresponde a uma afirmação que o manifesto fazia sem
 * poder sustentar.
 */

const {
  DEFAULT_MAX_AGE_MS,
  STATUS,
  evaluateArtifactFreshness,
  resolveProofStatus,
  resolveGovernanceLinkage,
} = require('../../../governance/lib/evidence-freshness');

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

describe('evaluateArtifactFreshness — TTL de evidência', () => {
  test('o TTL canônico é o de 7 dias (o mesmo do master-scorecard e das waves)', () => {
    expect(DEFAULT_MAX_AGE_MS).toBe(7 * DAY);
  });

  test('evidência dentro do TTL é FRESH', () => {
    const verdict = evaluateArtifactFreshness({ timestamp: iso(NOW - 2 * DAY), now: NOW });
    expect(verdict.status).toBe(STATUS.FRESH);
    expect(verdict.reason).toBeNull();
  });

  test('exatamente no limite ainda é FRESH (o TTL vence DEPOIS do prazo, não no instante)', () => {
    const verdict = evaluateArtifactFreshness({ timestamp: iso(NOW - DEFAULT_MAX_AGE_MS), now: NOW });
    expect(verdict.status).toBe(STATUS.FRESH);
  });

  test('evidência de ~50 dias (o caso real medido) é STALE e diz a idade', () => {
    const produced = Date.parse('2026-08-21T01:26:02.857Z');
    const verdict = evaluateArtifactFreshness({ timestamp: produced, now: NOW });
    expect(verdict.status).toBe(STATUS.STALE);
    // 2026-08-21T01:26:02.857Z → 2026-10-10T12:00:00Z = 50 dias + 10h34m = 50.4 dias
    expect(verdict.reason).toContain('50.4');
    expect(verdict.reason).toContain('7');
  });

  test('artefato sem timestamp é UNKNOWN — nunca STALE (ausência de dado não é dado)', () => {
    const verdict = evaluateArtifactFreshness({ timestamp: null, now: NOW });
    expect(verdict.status).toBe(STATUS.UNKNOWN);
    expect(verdict.ageMs).toBeNull();
    expect(verdict.reason).toContain('não é o mesmo que vencido');
  });

  test('timestamp inválido (não parseável) também é UNKNOWN', () => {
    expect(evaluateArtifactFreshness({ timestamp: 'ontem', now: NOW }).status).toBe(STATUS.UNKNOWN);
  });

  test('artefato isento (fonte de governança) é UNKNOWN com o motivo declarado', () => {
    const verdict = evaluateArtifactFreshness({
      timestamp: iso(NOW - 400 * DAY),
      now: NOW,
      exemptReason: 'dominio governance (fonte)',
    });
    expect(verdict.status).toBe(STATUS.UNKNOWN);
    expect(verdict.exempt).toBe(true);
    expect(verdict.reason).toBe('dominio governance (fonte)');
  });

  test('produtor com política própria pode informar TTL menor (48 h do smoke agendado)', () => {
    const verdict = evaluateArtifactFreshness({
      timestamp: iso(NOW - 3 * DAY),
      now: NOW,
      maxAgeMs: 48 * 60 * 60 * 1000,
    });
    expect(verdict.status).toBe(STATUS.STALE);
  });
});

describe('resolveProofStatus — o frescor entra como terceira condição', () => {
  const stale = { status: STATUS.STALE };
  const fresh = { status: STATUS.FRESH };

  test('ausente continua missing', () => {
    expect(resolveProofStatus({ exists: false, freshness: fresh })).toBe('missing');
  });

  test('conteúdo semanticamente inválido continua invalid (e vence sobre o frescor)', () => {
    expect(resolveProofStatus({ exists: true, semanticViolations: ['ok===false'], freshness: stale })).toBe('invalid');
  });

  test('presente, semanticamente ok e VENCIDO é stale — nunca valid', () => {
    expect(resolveProofStatus({ exists: true, semanticViolations: [], freshness: stale })).toBe('stale');
  });

  test('presente, semanticamente ok e fresco é valid', () => {
    expect(resolveProofStatus({ exists: true, semanticViolations: [], freshness: fresh })).toBe('valid');
  });

  test('não-vacuidade: sem política de frescor o resultado seria valid — é o defeito que o teste trava', () => {
    // Simula o comportamento ANTIGO (sem a terceira condição) para provar que o
    // cenário realmente distinguiria as duas implementações.
    const legacy = (exists, violations) => (!exists ? 'missing' : (violations.length > 0 ? 'invalid' : 'valid'));
    expect(legacy(true, [])).toBe('valid');
    expect(resolveProofStatus({ exists: true, semanticViolations: [], freshness: stale })).toBe('stale');
  });
});

describe('resolveGovernanceLinkage — evidência vencida não afirma a decisão final', () => {
  const stale = { status: STATUS.STALE };
  const fresh = { status: STATUS.FRESH };

  test('evidência fresca linka final_decision', () => {
    expect(resolveGovernanceLinkage({ domain: 'foundation', freshness: fresh })).toEqual(['final_decision']);
  });

  test('evidência VENCIDA não linka final_decision (o vínculo é retirado, não mantido por inércia)', () => {
    expect(resolveGovernanceLinkage({ domain: 'foundation', freshness: stale })).toEqual([]);
  });

  test('domínio governance é fonte e linka proof_based_governance independentemente da idade', () => {
    expect(resolveGovernanceLinkage({ domain: 'governance', freshness: stale })).toEqual(['proof_based_governance']);
    expect(resolveGovernanceLinkage({ domain: 'governance', freshness: fresh })).toEqual(['proof_based_governance']);
  });
});
