'use strict';

/**
 * BUG CLOSURE FIRST — TESTES ADVERSARIAIS (missão 2026-10-17 §11).
 *
 * Cada teste aqui demonstra uma RECUSA. A regra central que eles travam:
 * nenhuma operação certificante pode começar enquanto existir P0 reproduceível ou
 * P1 bloqueante aberto — e "done" não é fechamento.
 *
 * Numeração dos cenários conforme a missão (§11). Os cenários 23-26 são cobertos
 * por suítes já existentes e citados no relatório final (propagação de exit code
 * em `devBranchCiGate.test.js`; infra ausente via PENDING_PHASE em
 * `governanceChainContract`/`release-artifact-identity`; segregação
 * PRODUCTION/SUPPORT/DEVELOPMENT em `validate:experience-api-segregation`;
 * isolamento de domínio do RAG na suíte do rag-service).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ESTADOS,
  SEVERIDADES,
  MOTIVOS,
  MIGRACAO_LEGADO,
  validarTransicao,
  estaAberto,
  eBloqueanteParaCertificacao,
  severidadeDoItem,
} = require('../../../governance/bug-closure/defect-states');
const {
  evaluateExecutionEligibility,
  OPERACOES,
  DECISOES,
  CODIGOS,
} = require('../../../governance/bug-closure/eligibility');
const { carregarInventario, migrarItem } = require('../../../governance/bug-closure/defect-registry');
const { deveReexecutar, identidadeDaEntrada } = require('../../../governance/bug-closure/execution-budget');
const { clasificar, identidadeCoerente } = require('../../../governance/canonical-release-decision');

const COMMIT = 'a'.repeat(40);
const GATES_OK = [
  { id: 'final_governance', status: 'PASS' },
  { id: 'final_readiness', status: 'PASS' },
  { id: 'final_proof', status: 'PASS' },
];

function ctx(extra = {}) {
  return { commit: COMMIT, actor: { id: 'teste' }, defects: [], ...extra };
}

const P0_ABERTO = { id: 'P0-A', title: 'defeito critico', severity: 'P0', state: ESTADOS.REPRODUCED };
const P1_ABERTO = { id: 'P1-A', title: 'defeito bloqueante', severity: 'P1', state: ESTADOS.OPEN };

describe('§11 #9/#10/#11 — estados de gate não aprovam', () => {
  it('UNKNOWN não é PASS', () => {
    const d = clasificar({ gates: [{ ...GATES_OK[0], status: 'UNKNOWN' }, GATES_OK[1], GATES_OK[2]], selado: true, certificado: true });
    expect(d.state).toBe('NO_GO');
    expect(String(d.reason)).toContain('GATE_STATUS_NAO_PERMITIDO');
  });

  it('NOT_EXECUTED não é PASS', () => {
    const d = clasificar({ gates: [{ ...GATES_OK[1], status: 'NOT_EXECUTED' }, GATES_OK[0], GATES_OK[2]], selado: true, certificado: true });
    expect(d.state).toBe('NO_GO');
    expect(String(d.reason)).toContain('GATE_STATUS_NAO_PERMITIDO');
  });

  it('PENDING_PHASE não gera aprovação', () => {
    const d = clasificar({ gates: [{ ...GATES_OK[2], status: 'PENDING_PHASE' }, GATES_OK[0], GATES_OK[1]], selado: true, certificado: true });
    expect(d.state).not.toBe('CERTIFIED_GO');
    expect(['RUNNING', 'NO_GO', 'PRE_PACKAGE_PASS']).toContain(d.state);
  });

  it('#12: um único gate PASS não certifica', () => {
    const d = clasificar({ gates: [GATES_OK[0]], selado: true, certificado: true });
    expect(d.state).toBe('NO_GO');
    expect(String(d.reason)).toContain('GATES_MINIMOS_AUSENTES');
  });
});

describe('§11 #8 — relatório sem sourceCommit obrigatório', () => {
  it('identidade sem sourceCommit é INCOMPLETA', () => {
    const r = identidadeCoerente({ identity: { runId: 'run-abc12345', sourceFingerprint: 'f'.repeat(64) } });
    expect(r.ok).toBe(false);
    expect(r.faltantes).toContain('sourceCommit');
  });
});

describe('§11 #13/#14 — estado legado não fecha defeito', () => {
  it('#13: P0 marcado `blocked` continua bloqueando (blocked -> OPEN)', () => {
    const defeito = migrarItem({ id: 'P0-BLOQUEADO', status: 'blocked', title: 'p0 bloqueado' });
    expect(defeito.state).toBe(ESTADOS.OPEN);
    expect(defeito.legacyStatus).toBe('blocked');
    expect(defeito.bloqueanteParaCertificacao).toBe(true);

    const d = evaluateExecutionEligibility(ctx({ defects: [defeito] }), OPERACOES.CONVERGENCIA_COMPLETA);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.P0_ABERTO);
  });

  it('#14: P1 bloqueante marcado `done` SEM teste continua aberto', () => {
    const defeito = migrarItem({ id: 'P1-DONE', status: 'done', title: 'p1 done sem teste' });
    expect(defeito.state).toBe(ESTADOS.FIXED_PENDING_VERIFICATION);
    expect(defeito.aberto).toBe(true);

    const d = evaluateExecutionEligibility(ctx({ defects: [defeito] }), OPERACOES.SELO_FINAL);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.P1_BLOQUEANTE_ABERTO);
  });

  it('`done` sem teste de regressão não pode virar RESOLVED', () => {
    // FECHAMENTO exige passar por VERIFIED; RESOLVED sem teste é recusado.
    const r = validarTransicao({
      de: ESTADOS.VERIFIED,
      para: ESTADOS.RESOLVED,
      evidence: 'reports/x.json',
      // regressionTest ausente de propósito
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(MOTIVOS.FECHAMENTO_SEM_TESTE_REGRESSAO);
  });

  it('não é possível ir de FIXED_PENDING_VERIFICATION direto a RESOLVED', () => {
    const r = validarTransicao({ de: ESTADOS.FIXED_PENDING_VERIFICATION, para: ESTADOS.RESOLVED, regressionTest: 't', evidence: 'e' });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(MOTIVOS.TRANSICAO_INVALIDA);
  });
});

describe('§11 #15/#16 — prova velha não fecha defeito', () => {
  it('#15: verificação em SHA anterior não conta para o código atual', () => {
    const r = validarTransicao({
      de: ESTADOS.FIXED_PENDING_VERIFICATION,
      para: ESTADOS.VERIFIED,
      regressionTest: 'tests/unit/x.test.js',
      evidence: 'reports/x.json',
      verificationCommit: 'b'.repeat(40),
      currentCommit: 'a'.repeat(40),
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(MOTIVOS.VERIFICACAO_EM_SHA_ANTERIOR);
  });

  it('#16: teste aprovado em tentativa anterior (sem registro atual) não libera condicional', () => {
    const d = evaluateExecutionEligibility(
      ctx({ defects: [{ ...P1_ABERTO, targetedTestPassing: false }] }),
      OPERACOES.L0_COMPLETO
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.TESTE_DIRECIONADO_PENDENTE);
  });

  it('controle positivo: teste direcionado registrado libera L0 (não certifica)', () => {
    const d = evaluateExecutionEligibility(
      ctx({ defects: [{ ...P1_ABERTO, targetedTestPassing: true }] }),
      OPERACOES.L0_COMPLETO
    );
    expect(d.allowed).toBe(true);
    expect(d.decision).toBe(DECISOES.ALLOWED);
    // L0 não é certificação: operação certificante continua bloqueada.
    const extensiva = evaluateExecutionEligibility(ctx({ defects: [{ ...P1_ABERTO, targetedTestPassing: true }] }), OPERACOES.QA_WAVES_COMPLETA);
    expect(extensiva.allowed).toBe(false);
  });
});

describe('§11 #17 — autorrevisão quando independência é obrigatória', () => {
  it('revisão feita pelo próprio autor é recusada', () => {
    const r = validarTransicao({
      de: ESTADOS.FIXED_PENDING_VERIFICATION,
      para: ESTADOS.VERIFIED,
      regressionTest: 'tests/unit/x.test.js',
      evidence: 'reports/x.json',
      verificationCommit: COMMIT,
      currentCommit: COMMIT,
      independentReviewRequired: true,
      author: 'agente-a',
      reviewedBy: 'agente-a',
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(MOTIVOS.REVISAO_NAO_INDEPENDENTE);
  });
});

describe('§11 #18/#19/#20 — processos extensivos e publicação', () => {
  it('#18: P0 aberto bloqueia TODA operação extensiva', () => {
    for (const op of [OPERACOES.QA_WAVES_COMPLETA, OPERACOES.CONVERGENCIA_COMPLETA, OPERACOES.SELO_FINAL, OPERACOES.REPLAY_MASSIVO, OPERACOES.L2_L3_EXTENSIVO]) {
      const d = evaluateExecutionEligibility(ctx({ defects: [P0_ABERTO] }), op);
      expect(d.allowed).toBe(false);
      expect(d.reasonCodes).toContain(CODIGOS.P0_ABERTO);
    }
  });

  it('#18 (controle): P0 aberto NÃO bloqueia correção, reprodução e testes direcionados', () => {
    for (const op of [OPERACOES.CORRECAO_CODIGO, OPERACOES.REPRODUCAO, OPERACOES.TESTES_DIRECIONADOS, OPERACOES.TESTES_NEGATIVOS_REGRESSAO, OPERACOES.DIAGNOSTICO]) {
      expect(evaluateExecutionEligibility(ctx({ defects: [P0_ABERTO] }), op).allowed).toBe(true);
    }
  });

  it('#19: P1 bloqueante aberto bloqueia operação extensiva', () => {
    const d = evaluateExecutionEligibility(ctx({ defects: [P1_ABERTO] }), OPERACOES.QA_WAVES_COMPLETA);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.P1_BLOQUEANTE_ABERTO);
  });

  it('#20: publicação sem certificação é negada', () => {
    const d = evaluateExecutionEligibility(ctx({ defects: [] }), OPERACOES.PUBLICACAO_RELEASE);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.CERTIFICACAO_AUSENTE);
  });

  it('bloqueio EXTERNO não libera certificação', () => {
    const d = evaluateExecutionEligibility(
      ctx({ defects: [{ id: 'P0-EXT', severity: 'P0', state: ESTADOS.BLOCKED_EXTERNAL }] }),
      OPERACOES.SELO_FINAL
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO);
  });
});

describe('§11 #21 — reexecução idêntica sem mudança de entradas', () => {
  it('mesma entrada não deve reexecutar', () => {
    const entrada = { operacao: OPERACOES.QA_WAVES_COMPLETA, commit: COMMIT, sourceFingerprint: 'f'.repeat(64), runId: 'run-1' };
    const r = deveReexecutar(entrada, { inputIdentity: identidadeDaEntrada(entrada) });
    expect(r.repetir).toBe(false);
    expect(r.code).toBe('ENTRADA_IDENTICA');
  });

  it('mudança de commit libera reexecução', () => {
    const anterior = { operacao: OPERACOES.QA_WAVES_COMPLETA, commit: COMMIT, sourceFingerprint: 'f'.repeat(64), runId: 'run-1' };
    const atual = { ...anterior, commit: 'b'.repeat(40) };
    expect(deveReexecutar(atual, { inputIdentity: identidadeDaEntrada(anterior) }).repetir).toBe(true);
  });
});

describe('§11 #22 / Cenário D — regressão reabre e bloqueia certificação', () => {
  it('VERIFIED pode reabrir (regressão) e volta a bloquear', () => {
    const reopen = validarTransicao({ de: ESTADOS.VERIFIED, para: ESTADOS.OPEN });
    expect(reopen.ok).toBe(true);

    const reaberto = { id: 'P0-REG', severity: 'P0', state: ESTADOS.OPEN };
    expect(eBloqueanteParaCertificacao(reaberto)).toBe(true);
    expect(evaluateExecutionEligibility(ctx({ defects: [reaberto] }), OPERACOES.SELO_FINAL).allowed).toBe(false);
  });

  it('não existe salto OPEN -> RESOLVED', () => {
    expect(validarTransicao({ de: ESTADOS.OPEN, para: ESTADOS.RESOLVED, regressionTest: 't', evidence: 'e' }).ok).toBe(false);
  });
});

describe('fail-closed — contexto insuficiente nunca autoriza', () => {
  it('sem SHA', () => {
    const d = evaluateExecutionEligibility({ actor: { id: 'x' }, defects: [] }, OPERACOES.CORRECAO_CODIGO);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.SHA_AUSENTE);
  });

  it('sem inventário de defeitos (ausência ≠ ausência de defeitos)', () => {
    const d = evaluateExecutionEligibility({ commit: COMMIT, actor: { id: 'x' } }, OPERACOES.CORRECAO_CODIGO);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.INVENTARIO_AUSENTE);
  });

  it('sem ator', () => {
    const d = evaluateExecutionEligibility({ commit: COMMIT, defects: [] }, OPERACOES.CORRECAO_CODIGO);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.ATOR_AUSENTE);
  });

  it('operação desconhecida', () => {
    const d = evaluateExecutionEligibility(ctx(), 'OPERACAO_INVENTADA');
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.OPERACAO_DESCONHECIDA);
  });

  it('severidade não declarada em operação certificante bloqueia', () => {
    const d = evaluateExecutionEligibility(ctx({ defects: [{ id: 'SEM-SEV', state: ESTADOS.OPEN }] }), OPERACOES.CONVERGENCIA_COMPLETA);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.SEVERIDADE_NAO_DECLARADA);
  });

  it('aceitação de risco não dispensa controle inegociável', () => {
    const r = validarTransicao({
      de: ESTADOS.REPRODUCED,
      para: ESTADOS.RISK_ACCEPTED,
      riskAcceptanceAllowed: true,
      touches: ['INTEGRIDADE_CRIPTOGRAFICA'],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(MOTIVOS.RISCO_EM_CONTROLE_INEGOCIAVEL);
  });

  it('exceção diagnóstica é ALLOWED_DIAGNOSTIC_ONLY e não certifica', () => {
    const d = evaluateExecutionEligibility(ctx({ defects: [P0_ABERTO], diagnosticPurpose: true }), OPERACOES.L1_AMPLO);
    expect(d.allowed).toBe(true);
    expect(d.decision).toBe(DECISOES.ALLOWED_DIAGNOSTIC_ONLY);
    expect(d.diagnosticOnly).toBe(true);
  });
});

describe('migração da fila oficial — histórico preservado, severidade derivada', () => {
  it('todos os estados legados têm mapeamento canônico', () => {
    for (const legado of ['pending', 'in_progress', 'done', 'verified', 'prevention_active', 'blocked', 'blocked_external', 'failed', 'ready_for_approval']) {
      expect(MIGRACAO_LEGADO[legado]).toBeTruthy();
    }
  });

  it('severidade é derivada do prefixo do ID quando não declarada', () => {
    expect(severidadeDoItem({ id: 'P0-CADEIA-X' })).toBe(SEVERIDADES.P0);
    expect(severidadeDoItem({ id: 'P1-ENTREGA-Y' })).toBe(SEVERIDADES.P1);
    expect(severidadeDoItem({ id: 'P2-Z' })).toBe(SEVERIDADES.P2);
    expect(severidadeDoItem({ id: 'SEM-PREFIXO' })).toBeNull();
    // Campo explícito vence a heurística.
    expect(severidadeDoItem({ id: 'P3-X', severity: 'P0' })).toBe(SEVERIDADES.P0);
  });

  it('carregarInventario migra a fila REAL e devolve resumo consistente', () => {
    const inv = carregarInventario();
    expect(inv.defeitos.length).toBeGreaterThan(0);
    expect(inv.resumo.total).toBe(inv.defeitos.length);
    for (const d of inv.defeitos) {
      expect(Object.values(ESTADOS)).toContain(d.state);
      expect(d.legacyStatus).toBeDefined();
    }
  });

  it('fila ausente lança erro com código (nunca inventário vazio)', () => {
    expect(() => carregarInventario({ queuePath: path.join(os.tmpdir(), 'nao-existe-xyz.json') })).toThrow(/FILA_AUSENTE/);
  });

  it('estado legado `done` é ABERTO (não é fechamento)', () => {
    expect(estaAberto({ state: MIGRACAO_LEGADO.done })).toBe(true);
  });
});

describe('Demonstrações A-D exigidas pela missão (execução real do gate)', () => {
  it('A: P0 aberto + QA Wave completa => DENIED', () => {
    expect(evaluateExecutionEligibility(ctx({ defects: [P0_ABERTO] }), OPERACOES.QA_WAVES_COMPLETA).decision).toBe(DECISOES.DENIED);
  });

  it('B: P0 corrigido mas regressão ainda não validada => DENIED', () => {
    const pendente = { id: 'P0-A', severity: 'P0', state: ESTADOS.FIXED_PENDING_VERIFICATION };
    const d = evaluateExecutionEligibility(ctx({ defects: [pendente], activeDefectIds: ['P0-A'] }), OPERACOES.L0_COMPLETO);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.TESTE_DIRECIONADO_PENDENTE);
  });

  it('C: P0 resolvido + teste direcionado aprovado => fase seguinte autorizada', () => {
    const resolvido = { id: 'P0-A', severity: 'P0', state: ESTADOS.RESOLVED, targetedTestPassing: true };
    const d = evaluateExecutionEligibility(ctx({ defects: [resolvido], activeDefectIds: ['P0-A'] }), OPERACOES.L0_COMPLETO);
    expect(d.allowed).toBe(true);
  });

  it('C (contraprova): P0 em RESOLVED sem teste direcionado registrado NÃO libera a fase', () => {
    const resolvidoSemTeste = { id: 'P0-A', severity: 'P0', state: ESTADOS.RESOLVED };
    const d = evaluateExecutionEligibility(ctx({ defects: [resolvidoSemTeste], activeDefectIds: ['P0-A'] }), OPERACOES.L0_COMPLETO);
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain(CODIGOS.TESTE_DIRECIONADO_PENDENTE);
  });

  it('D: nova regressão reabre P0 => certificação imediatamente bloqueada', () => {
    const reaberto = { id: 'P0-A', severity: 'P0', state: ESTADOS.OPEN };
    expect(evaluateExecutionEligibility(ctx({ defects: [reaberto] }), OPERACOES.SELO_FINAL).allowed).toBe(false);
  });
});
