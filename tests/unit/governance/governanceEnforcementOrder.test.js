'use strict';

/**
 * P0 (auditoria 2026-10-19) — AUTORIZAÇÃO TARDIA NO GATE AGREGADO.
 *
 * Defeitos reproduzidos contra a baseline `9758f828f` em
 * `scripts/governance/run-governance-enforcement.js`:
 *
 *  1) CADEIA VAZIA DAVA PASS: `passos.length === cadeia.length` (0 === 0) e
 *     `[].every(...) === true` ⇒ `todosPassaram = true`.
 *  2) AUTORIZAÇÃO TARDIA: todos os executores rodavam ANTES de qualquer decisão
 *     de identidade/autorização — o status virava BLOCKED depois do fato.
 *
 * A ordem exigida é: identidade → autorização → escopo → cadeia → executar →
 * verificar evidências → decidir. Nenhum executor pode ser chamado antes da
 * autorização; nenhuma cadeia vazia pode receber PASS.
 */

const {
  executarCadeia,
  validarEscopo,
  PASSOS_OBRIGATORIOS,
} = require('../../../scripts/governance/run-governance-enforcement.js');

const SHA = '9758f828f3fdd0fb07c08ebe591de1ace8df2ebe';
const ID_COMPLETO = {
  runId: 'rap-governed-teste',
  sourceFingerprint: 'f'.repeat(64),
  sourceCommit: SHA,
};
const AUTORIZADO = { operacao: 'SELO_FINAL', allowed: true, decision: 'ALLOWED', reasonCodes: [], requiredActions: [] };
const NEGADO = { operacao: 'SELO_FINAL', allowed: false, decision: 'DENIED', reasonCodes: ['CERTIFICACAO_AUSENTE'], requiredActions: [] };

/** Cadeia mínima válida para teste (contém os obrigatórios + extras). */
function cadeiaValida() {
  return [...PASSOS_OBRIGATORIOS, 'npm run validate:agent-adherence'];
}

/** Executor espião: registra cada chamada e responde conforme o mapa. */
function executorEspiao(respostas = {}) {
  const chamadas = [];
  const fn = (comando) => {
    chamadas.push(comando);
    const r = respostas[comando] || {};
    return {
      exitCode: r.exitCode === undefined ? 0 : r.exitCode,
      duracaoMs: 5,
      sha256Saida: r.sha256Saida === undefined ? 'b'.repeat(64) : r.sha256Saida,
      saidaFinal: r.saidaFinal || 'ok',
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

describe('P0 agregado — nenhum executor roda antes da autorização', () => {
  test('identidade incompleta: ZERO chamadas de executor', () => {
    const executor = executorEspiao();
    const v = executarCadeia({
      cadeia: cadeiaValida(),
      executor,
      id: { runId: null, sourceFingerprint: null, sourceCommit: SHA },
      autorizacao: AUTORIZADO,
    });
    expect(v.status).toBe('BLOCKED');
    expect(executor.chamadas).toEqual([]);
    expect(v.passosExecutados).toBe(0);
    expect(v.motivo).toContain('identidade');
  });

  test('SHA inválido: ZERO chamadas', () => {
    const executor = executorEspiao();
    const v = executarCadeia({
      cadeia: cadeiaValida(),
      executor,
      id: { ...ID_COMPLETO, sourceCommit: 'abc' },
      autorizacao: AUTORIZADO,
    });
    expect(v.status).toBe('BLOCKED');
    expect(executor.chamadas).toEqual([]);
  });

  test('runId ausente: ZERO chamadas', () => {
    const executor = executorEspiao();
    const v = executarCadeia({
      cadeia: cadeiaValida(),
      executor,
      id: { sourceFingerprint: 'f'.repeat(64), sourceCommit: SHA },
      autorizacao: AUTORIZADO,
    });
    expect(v.status).toBe('BLOCKED');
    expect(executor.chamadas).toEqual([]);
  });

  test('autorização negada: ZERO chamadas de executor', () => {
    const executor = executorEspiao();
    const v = executarCadeia({ cadeia: cadeiaValida(), executor, id: ID_COMPLETO, autorizacao: NEGADO });
    expect(v.status).toBe('BLOCKED');
    expect(executor.chamadas).toEqual([]);
    expect(v.motivo).toContain('autorização negada');
    expect(v.etapas.find((e) => e.etapa === 'AUTORIZACAO').resultado).toBe('NEGADO');
  });

  test('executor não autorizado nunca é invocado, mesmo com cadeia válida', () => {
    const executor = executorEspiao();
    executarCadeia({ cadeia: cadeiaValida(), executor, id: ID_COMPLETO, autorizacao: NEGADO });
    expect(executor.chamadas).toHaveLength(0);
  });
});

describe('P0 agregado — cadeia vazia e escopo inválido nunca dão PASS', () => {
  test('cadeia vazia ⇒ BLOCKED, sem executar', () => {
    const executor = executorEspiao();
    const v = executarCadeia({ cadeia: [], executor, id: ID_COMPLETO, autorizacao: AUTORIZADO });
    expect(v.status).toBe('BLOCKED');
    expect(v.motivo).toContain('CADEIA_VAZIA');
    expect(executor.chamadas).toEqual([]);
  });

  test('cadeia sem passo obrigatório ⇒ BLOCKED', () => {
    const executor = executorEspiao();
    const v = executarCadeia({
      cadeia: ['npm run validate:ai-memory'],
      executor,
      id: ID_COMPLETO,
      autorizacao: AUTORIZADO,
    });
    expect(v.status).toBe('BLOCKED');
    expect(v.motivo).toContain('PASSO_OBRIGATORIO_AUSENTE');
    expect(executor.chamadas).toEqual([]);
  });

  test('passo duplicado na cadeia ⇒ BLOCKED', () => {
    const executor = executorEspiao();
    const cadeia = [...cadeiaValida(), 'npm run validate:ai-memory'];
    const v = executarCadeia({ cadeia, executor, id: ID_COMPLETO, autorizacao: AUTORIZADO });
    expect(v.status).toBe('BLOCKED');
    expect(v.motivo).toContain('PASSO_DUPLICADO');
  });

  test('validarEscopo é determinístico', () => {
    expect(validarEscopo([]).ok).toBe(false);
    expect(validarEscopo(cadeiaValida()).ok).toBe(true);
    expect(validarEscopo(cadeiaValida()).ausentes).toEqual([]);
  });
});

describe('P0 agregado — decisão exige execução real e evidência', () => {
  test('todos os passos verdes com digest ⇒ PASS', () => {
    const executor = executorEspiao();
    const v = executarCadeia({ cadeia: cadeiaValida(), executor, id: ID_COMPLETO, autorizacao: AUTORIZADO });
    expect(v.status).toBe('PASS');
    expect(v.passosExecutados).toBe(cadeiaValida().length);
    expect(v.motivo).toBeNull();
  });

  test('exit code não zero ⇒ FAIL e fail-fast', () => {
    const cadeia = cadeiaValida();
    const executor = executorEspiao({ [cadeia[2]]: { exitCode: 1 } });
    const v = executarCadeia({ cadeia, executor, id: ID_COMPLETO, autorizacao: AUTORIZADO });
    expect(v.status).toBe('FAIL');
    expect(v.interrompidoEm).toBe(cadeia[2]);
    expect(executor.chamadas).toHaveLength(3);
  });

  test('passo sem digest de saída ⇒ FAIL (evidência ausente)', () => {
    const cadeia = cadeiaValida();
    const executor = executorEspiao({ [cadeia[0]]: { sha256Saida: '' } });
    const v = executarCadeia({ cadeia, executor, id: ID_COMPLETO, autorizacao: AUTORIZADO });
    expect(v.status).toBe('FAIL');
    expect(v.evidencia.ok).toBe(false);
    expect(v.motivo).toContain('sem evidência');
  });

  test('cadeia truncada (executor para antes) ⇒ FAIL', () => {
    const cadeia = cadeiaValida();
    const executor = executorEspiao({ [cadeia[1]]: { exitCode: null } });
    const v = executarCadeia({ cadeia, executor, id: ID_COMPLETO, autorizacao: AUTORIZADO });
    expect(v.status).toBe('FAIL');
    expect(v.passosExecutados).toBeLessThan(cadeia.length);
  });

  test('etapas registradas na ordem canônica', () => {
    const v = executarCadeia({ cadeia: cadeiaValida(), executor: executorEspiao(), id: ID_COMPLETO, autorizacao: AUTORIZADO });
    const ordem = v.etapas.map((e) => e.etapa);
    expect(ordem[0]).toBe('IDENTIDADE');
    expect(ordem[1]).toBe('AUTORIZACAO');
    expect(ordem[2]).toBe('ESCOPO');
    expect(ordem).toContain('EXECUCAO');
    expect(ordem).toContain('EVIDENCIAS');
    expect(ordem[ordem.length - 1]).toBe('DECISAO');
  });
});
