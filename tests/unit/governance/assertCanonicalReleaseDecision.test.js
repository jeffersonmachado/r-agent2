'use strict';

/**
 * assert-canonical-release-decision — a PUBLICAÇÃO exige GO DEFINITIVO (P0-4).
 *
 * O script responde à pergunta que nenhum gate respondia sozinho: "este artefato está
 * certificado o bastante para virar uma tag pública?". Ele usa a autoridade única
 * (`canonical-release-decision`) sobre os artefatos reais e recusa:
 *   - decisão de release em estado PRÉ-pacote (`PASS_WITH_DEFERRED_PACKAGE_GATE`);
 *   - cadeia criptográfica não íntegra;
 *   - artefato ausente;
 *   - identidade divergente do run governado (GO de outro candidato).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { avaliar } = require('../../../scripts/governance/assert-canonical-release-decision');
const { STATES, DECISION_VERSION } = require('../../../governance/canonical-release-decision');

const temporarios = [];

/** Cria um rootDir com os artefatos de decisão informados. */
function raiz(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-dec-'));
  temporarios.push(dir);
  fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
  const base = {
    'final-governance-report.json': { finalDecision: 'AUTONOMOUS_READY_GO' },
    'final-readiness-report.json': { finalDecision: 'AUTONOMOUS_READY_GO' },
    'final-proof-report.json': { finalDecision: 'AUTONOMOUS_READY_GO' },
    'governance-chain.json': { valid: true, chainRoot: 'a'.repeat(64) },
    '.current-run.json': { runId: 'R1', sourceCommit: 'C1', sourceFingerprint: 'F1' },
  };
  const arquivos = { ...base, ...overrides };
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    if (conteudo === null) continue; // ausente de propósito
    fs.writeFileSync(path.join(dir, 'governance', nome), JSON.stringify(conteudo, null, 2));
  }
  return dir;
}

afterAll(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

describe('assert-canonical-release-decision', () => {
  it('três decisões finais + cadeia íntegra ⇒ CERTIFIED_GO (não-vacuidade)', () => {
    const r = avaliar(raiz());
    expect(r.ok).toBe(true);
    expect(r.state).toBe(STATES.CERTIFIED_GO);
    expect(r.version).toBe(DECISION_VERSION);
    expect(r.gates).toEqual([
      'final_governance:PASS',
      'final_readiness:PASS',
      'final_proof:PASS',
      'governance_chain:PASS',
    ]);
  });

  it('READINESS em estado PRÉ-pacote ⇒ NÃO é GO definitivo (o falso verde medido)', () => {
    const r = avaliar(raiz({ 'final-readiness-report.json': { finalDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE' } }));
    expect(r.ok).toBe(false);
    expect(r.state).not.toBe(STATES.CERTIFIED_GO);
    expect(r.decisoesNaoFinais.join(' ')).toMatch(/final_readiness=.*PRE_PACKAGE_PASS/);
  });

  it('GO de governance ausente (literal desconhecido) ⇒ NÃO é GO definitivo', () => {
    const r = avaliar(raiz({ 'final-governance-report.json': { finalDecision: 'ALGO_NOVO_GO' } }));
    expect(r.ok).toBe(false);
    expect(r.state).toBe(STATES.NO_GO);
  });

  it('cadeia NÃO íntegra ⇒ NÃO é GO definitivo', () => {
    const r = avaliar(raiz({ 'governance-chain.json': { valid: false, chainRoot: 'b'.repeat(64) } }));
    expect(r.ok).toBe(false);
    expect(r.gates).toContain('governance_chain:FAIL');
  });

  it('artefato ausente ⇒ NÃO é GO definitivo (nunca aprovar por ausência)', () => {
    const r = avaliar(raiz({ 'final-proof-report.json': null }));
    expect(r.ok).toBe(false);
    expect(r.decisoesNaoFinais.join(' ')).toMatch(/final_proof/);
  });

  it('identidade divergente do run ⇒ NÃO é GO definitivo, com o campo nomeado', () => {
    const r = avaliar(raiz({
      'final-readiness-report.json': { finalDecision: 'AUTONOMOUS_READY_GO', runId: 'OUTRO_RUN' },
    }));
    expect(r.ok).toBe(false);
    expect(r.divergenciasDeIdentidade.join(' ')).toMatch(/final_readiness:runId/);
  });

  it('o estado devolvido é sempre do vocabulário canônico', () => {
    const estados = new Set(Object.values(STATES));
    for (const variante of [
      raiz(),
      raiz({ 'final-readiness-report.json': { finalDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE' } }),
      raiz({ 'governance-chain.json': { valid: false } }),
    ]) {
      expect(estados.has(avaliar(variante).state)).toBe(true);
    }
  });
});
