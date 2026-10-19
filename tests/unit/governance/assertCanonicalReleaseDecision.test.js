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

// Identidade COMPLETA e VÁLIDA (formatos reais: runId de run governado, commit 40 hex,
// fingerprint 64 hex). Fixtures com 'R1'/'C1'/'F1' legitimavam identidade inválida.
const IDENT = {
  runId: 'rap-governed-20261016144931085-033e1239',
  sourceCommit: '5efce7924932822c23888de97efc6243981da75e',
  sourceFingerprint: '1c10ffa62e169a18db1cd22e935fb41420fd5a865da58dd576b36a0f355d971e',
};

/** Cria um rootDir com os artefatos de decisão informados. */
function raiz(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-dec-'));
  temporarios.push(dir);
  fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
  const base = {
    'final-governance-report.json': { finalDecision: 'AUTONOMOUS_READY_GO', ...IDENT },
    'final-readiness-report.json': { finalDecision: 'AUTONOMOUS_READY_GO', ...IDENT },
    'final-proof-report.json': { finalDecision: 'AUTONOMOUS_READY_GO', ...IDENT },
    'governance-chain.json': { valid: true, chainRoot: 'a'.repeat(64) },
    '.current-run.json': { ...IDENT },
  };
  const arquivos = { ...base, ...overrides };
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    if (conteudo === null) continue; // ausente de propósito
    fs.writeFileSync(path.join(dir, 'governance', nome), JSON.stringify(conteudo, null, 2));
  }
  return dir;
}

/** Seam de teste: substitui APENAS a verificação da cadeia (não a identidade nem a decisão). */
const cadeiaIntegraStub = () => ({ valid: true, motivo: 'STUB_TESTE', chainRootValid: true, tampered: false, failures: [] });

afterAll(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

describe('assert-canonical-release-decision', () => {
  it('três decisões finais + identidade completa + cadeia íntegra ⇒ CERTIFIED_GO (não-vacuidade)', () => {
    const r = avaliar(raiz(), { verificarCadeia: cadeiaIntegraStub });
    expect(r.ok).toBe(true);
    expect(r.state).toBe(STATES.CERTIFIED_GO);
    expect(r.version).toBe(DECISION_VERSION);
    expect(r.gates).toEqual([
      'final_governance:PASS',
      'final_readiness:PASS',
      'final_proof:PASS',
      'governance_chain:PASS',
      'identidade:PASS',
    ]);
    expect(r.estadoDaIdentidadeDoRun).toBe('PRESENTE');
    expect(r.divergenciasDeIdentidade).toEqual([]);
    // Invariante que o próprio teste pegou: state e veredito não podem discordar.
    expect(r.estadoConcordaComVeredito).toBe(true);
  });

  it('gate de identidade entra como FAIL quando a identidade falta (state e ok concordam)', () => {
    const r = avaliar(raiz({ '.current-run.json': null }), { verificarCadeia: cadeiaIntegraStub });
    expect(r.gates).toContain('identidade:FAIL');
    expect(r.estadoConcordaComVeredito).toBe(true);
  });

  it('READINESS em estado PRÉ-pacote ⇒ NÃO é GO definitivo (o falso verde medido)', () => {
    const r = avaliar(raiz({ 'final-readiness-report.json': { finalDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE', ...IDENT } }), { verificarCadeia: cadeiaIntegraStub });
    expect(r.ok).toBe(false);
    expect(r.state).not.toBe(STATES.CERTIFIED_GO);
    expect(r.decisoesNaoFinais.join(' ')).toMatch(/final_readiness=.*PRE_PACKAGE_PASS/);
  });

  it('GO de governance ausente (literal desconhecido) ⇒ NÃO é GO definitivo', () => {
    const r = avaliar(raiz({ 'final-governance-report.json': { finalDecision: 'ALGO_NOVO_GO', ...IDENT } }), { verificarCadeia: cadeiaIntegraStub });
    expect(r.ok).toBe(false);
    expect(r.state).toBe(STATES.NO_GO);
  });

  // ── P0 CORRIGIDO: o campo `valid` GRAVADO não é autoridade ─────────────────
  it('cadeia com valid=true GRAVADO mas hashes que não fecham ⇒ FAIL (recomputação, não campo)', () => {
    // Antes da correção este caso passava: o avaliador lia `chain.valid === true`.
    const r = avaliar(raiz(), {}); // sem stub: usa a verificação REAL (recomputa bytes)
    expect(r.gates).toContain('governance_chain:FAIL');
    expect(r.ok).toBe(false);
    expect(r.cadeia.veredito).toBe('CADEIA_RECOMPUTADA_INVALIDA');
  });

  it('cadeia ausente ⇒ FAIL (não aprovar por ausência de cadeia)', () => {
    const r = avaliar(raiz({ 'governance-chain.json': null }), {});
    expect(r.gates).toContain('governance_chain:FAIL');
    expect(r.cadeia.veredito).toBe('CADEIA_AUSENTE');
  });

  it('artefato ausente ⇒ NÃO é GO definitivo (nunca aprovar por ausência)', () => {
    const r = avaliar(raiz({ 'final-proof-report.json': null }), { verificarCadeia: cadeiaIntegraStub });
    expect(r.ok).toBe(false);
    expect(r.decisoesNaoFinais.join(' ')).toMatch(/final_proof/);
  });

  // ── P0 CORRIGIDO: identidade AUSENTE ou INCOMPLETA bloqueia ────────────────
  it('.current-run.json AUSENTE ⇒ BLOQUEIA (antes: identidade vazia passava como coerente)', () => {
    const r = avaliar(raiz({ '.current-run.json': null }), { verificarCadeia: cadeiaIntegraStub });
    expect(r.ok).toBe(false);
    expect(r.estadoDaIdentidadeDoRun).toBe('AUSENTE');
    expect(r.divergenciasDeIdentidade.join(' ')).toContain('run_corrente:artefato_ausente');
    expect(r.state).not.toBe(STATES.CERTIFIED_GO);
  });

  it('runId AUSENTE no run corrente ⇒ BLOQUEIA com o campo nomeado', () => {
    const r = avaliar(raiz({ '.current-run.json': { sourceCommit: IDENT.sourceCommit, sourceFingerprint: IDENT.sourceFingerprint } }), {
      verificarCadeia: cadeiaIntegraStub,
    });
    expect(r.ok).toBe(false);
    expect(r.estadoDaIdentidadeDoRun).toBe('INCOMPLETA');
    expect(r.divergenciasDeIdentidade.join(' ')).toMatch(/faltantes=runId/);
  });

  it('sourceFingerprint com formato inválido ⇒ BLOQUEIA como inválido (não como ausente)', () => {
    const r = avaliar(raiz({ '.current-run.json': { ...IDENT, sourceFingerprint: 'nao-e-hash' } }), {
      verificarCadeia: cadeiaIntegraStub,
    });
    expect(r.ok).toBe(false);
    expect(r.divergenciasDeIdentidade.join(' ')).toMatch(/invalidos=sourceFingerprint/);
  });

  it('relatório SEM identidade (mas run completo) ⇒ BLOQUEIA por relatório incompleto', () => {
    const r = avaliar(raiz({ 'final-governance-report.json': { finalDecision: 'AUTONOMOUS_READY_GO' } }), {
      verificarCadeia: cadeiaIntegraStub,
    });
    expect(r.ok).toBe(false);
    expect(r.divergenciasDeIdentidade.join(' ')).toMatch(/final_governance:INCOMPLETA/);
  });

  it('identidade divergente do run ⇒ NÃO é GO definitivo, com o campo nomeado', () => {
    const r = avaliar(
      raiz({ 'final-readiness-report.json': { finalDecision: 'AUTONOMOUS_READY_GO', ...IDENT, runId: 'outro-run-governado-999' } }),
      { verificarCadeia: cadeiaIntegraStub }
    );
    expect(r.ok).toBe(false);
    expect(r.divergenciasDeIdentidade.join(' ')).toMatch(/final_readiness:DIVERGENTE:divergentes=runId/);
  });

  it('o estado devolvido é sempre do vocabulário canônico', () => {
    const estados = new Set(Object.values(STATES));
    for (const [variante, opcoes] of [
      [raiz(), { verificarCadeia: cadeiaIntegraStub }],
      [raiz({ 'final-readiness-report.json': { finalDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE', ...IDENT } }), { verificarCadeia: cadeiaIntegraStub }],
      [raiz(), {}],
      [raiz({ '.current-run.json': null }), { verificarCadeia: cadeiaIntegraStub }],
    ]) {
      expect(estados.has(avaliar(variante, opcoes).state)).toBe(true);
    }
  });
});
