'use strict';

/**
 * Regressão de H12-RAG-REPARO: a política de saúde do índice RAG precisa ser EXECUTÁVEL.
 *
 * Antes, a regra de `HEALTHY`/`NO_GO` vivia inline em `main()` do validador, misturada com SQL
 * e escrita de relatório — uma regra de governança inegociável sem nenhuma prova. Aqui cada
 * cláusula é exercitada nos dois sentidos (passa quando deve, reprova quando deve).
 *
 * Contexto medido em 2026-10-17: o corpus real tem 3400 `indexed`, 4 `not_applicable_no_text`
 * e 2 `failed` DECLARADOS (fixtures "exemplo-invalido" e "host-inexistente-qa.invalid", sem
 * tenant, portanto nunca retornáveis e nunca reparáveis). Declarar não é esconder: a exceção
 * carrega motivo e origem e o documento continua visível no relatório.
 */

const { avaliarSaudeDoIndice } = require('../../../scripts/governance/lib/rag-index-health-policy');

const EXCECAO = Object.freeze({
  id: 'fixture-1',
  reason: 'fixture de validação sem tenant: a rota de indexação exige tenantId',
  origin: 'teste de validação',
});

function medicaoBase(over = {}) {
  return {
    byStatus: [{ index_status: 'indexed', total: 10 }],
    indexedWithoutChunks: [],
    failedDocs: [],
    noTextWithChunks: [],
    stuckIndexing: [],
    declaredExceptions: [],
    duplicatedPlaceholderLiterals: [],
    ...over,
  };
}

describe('avaliarSaudeDoIndice — índice saudável', () => {
  test('corpus consistente é HEALTHY sem violações', () => {
    const r = avaliarSaudeDoIndice(medicaoBase());
    expect(r.status).toBe('HEALTHY');
    expect(r.violations).toEqual([]);
    expect(r.statusByKey).toEqual({ indexed: 10 });
  });

  test('failed DECLARADO com motivo e origem não vira violação (mas continua listado)', () => {
    const r = avaliarSaudeDoIndice(medicaoBase({
      failedDocs: [{ id: 'fixture-1', tenant_key: null }],
      declaredExceptions: [EXCECAO],
    }));
    expect(r.status).toBe('HEALTHY');
    expect(r.violations).toEqual([]);
    expect(r.staleExceptions).toEqual([]);
  });
});

describe('avaliarSaudeDoIndice — cada cláusula reprova quando deve', () => {
  test('indexed SEM chunks reprova', () => {
    const r = avaliarSaudeDoIndice(medicaoBase({ indexedWithoutChunks: [{ id: 'd1' }] }));
    expect(r.status).toBe('NO_GO');
    expect(r.violations.map((v) => v.code)).toContain('INDEXED_WITHOUT_CHUNKS');
  });

  test('failed NÃO declarado reprova', () => {
    const r = avaliarSaudeDoIndice(medicaoBase({ failedDocs: [{ id: 'x', tenant_key: 't' }] }));
    expect(r.status).toBe('NO_GO');
    expect(r.violations.map((v) => v.code)).toContain('UNDECLARED_FAILED_DOCUMENT');
    expect(r.failedUndeclared).toEqual(['x']);
  });

  test('exceção SEM motivo/origem reprova (exceção sem justificativa é esconderijo)', () => {
    const r = avaliarSaudeDoIndice(medicaoBase({
      failedDocs: [{ id: 'fixture-1', tenant_key: null }],
      declaredExceptions: [{ id: 'fixture-1', reason: '', origin: '' }],
    }));
    expect(r.status).toBe('NO_GO');
    const codes = r.violations.map((v) => v.code);
    // Sem justificativa a exceção não vale: o documento entra como NÃO declarado também.
    expect(codes).toContain('DECLARED_EXCEPTION_WITHOUT_REASON');
    expect(codes).toContain('UNDECLARED_FAILED_DOCUMENT');
  });

  test('documento sem texto COM chunks (chunk fantasma) reprova', () => {
    const r = avaliarSaudeDoIndice(medicaoBase({ noTextWithChunks: [{ id: 'd2', chunks: 3 }] }));
    expect(r.status).toBe('NO_GO');
    expect(r.violations.map((v) => v.code)).toContain('NO_TEXT_DOCUMENT_WITH_CHUNKS');
  });

  test('placeholder duplicado fora do arquivo autorizado reprova', () => {
    const r = avaliarSaudeDoIndice(medicaoBase({ duplicatedPlaceholderLiterals: ['api/outro.js'] }));
    expect(r.status).toBe('NO_GO');
    expect(r.violations.map((v) => v.code)).toContain('RAG_PLACEHOLDER_SOURCE_DUPLICATED');
  });

  test('indexing preso além da janela reprova e cita o limite', () => {
    const r = avaliarSaudeDoIndice(
      medicaoBase({ stuckIndexing: [{ id: 'd3' }] }),
      { stuckIndexingMinutes: 30 },
    );
    expect(r.status).toBe('NO_GO');
    const v = r.violations.find((x) => x.code === 'RAG_INDEXING_STUCK');
    expect(v).toBeTruthy();
    expect(v.detail).toContain('30 min');
  });
});

describe('avaliarSaudeDoIndice — robustez de entrada', () => {
  test('medição ausente não lança e não inventa verde com dados', () => {
    const r = avaliarSaudeDoIndice();
    expect(r.status).toBe('HEALTHY'); // nada medido, nada violado — o corpus vazio é avaliado pelo chamador
    expect(r.violations).toEqual([]);
  });

  test('exceção declarada que não existe mais é reportada como STALE (não silencia)', () => {
    const r = avaliarSaudeDoIndice(medicaoBase({ declaredExceptions: [EXCECAO] }));
    expect(r.staleExceptions).toEqual(['fixture-1']);
  });
});
