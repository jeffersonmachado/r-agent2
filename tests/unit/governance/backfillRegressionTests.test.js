'use strict';

/**
 * Contrato de `scripts/governance/backfill-regression-tests.js`.
 *
 * O script grava `regressionTest` na fila governada. Se a precedência de resolução estiver
 * errada, ele APONTA a suíte errada para um defeito fechado — prova que parece prova e não é.
 * Estes testes fixam: precedência (cita-o-id > evidência > commit), filtro de arquivo
 * inexistente e o caso "sem suíte" (que NUNCA pode virar um caminho inventado).
 */

const m = require('../../../scripts/governance/backfill-regression-tests');

describe('backfill-regression-tests — resolução da suíte de regressão', () => {
  test('Jest tem precedência sobre Playwright (só o primeiro é executável aqui)', () => {
    expect(m.melhorExecutavel(['frontend-e2e/a.spec.ts', 'tests/unit/b.test.js'])).toBe('tests/unit/b.test.js');
    expect(m.melhorExecutavel(['tests/unit/b.test.js', 'frontend-e2e/a.spec.ts'])).toBe('tests/unit/b.test.js');
    expect(m.melhorExecutavel(['frontend-e2e/a.spec.ts'])).toBe('frontend-e2e/a.spec.ts');
    expect(m.melhorExecutavel([])).toBeNull();
  });

  test('entre vários candidatos vence o que compartilha tokens com o id (não o alfabético)', () => {
    // Medido em dry-run real: o commit de E2E-SUPPORT-CENARIO1-PRECONDICAO tocou dois specs e a
    // ordem alfabética apontava o item de SUPORTE para o spec de REPLAY.
    const lista = ['frontend-e2e/qa-waves-replay.spec.ts', 'frontend-e2e/support-agent-flow.spec.ts'];
    expect(m.melhorExecutavel(lista, 'E2E-SUPPORT-CENARIO1-PRECONDICAO')).toBe('frontend-e2e/support-agent-flow.spec.ts');
    expect(m.melhorExecutavel(lista, 'E2E-REPLAY-DOMINIO-E-TAB')).toBe('frontend-e2e/qa-waves-replay.spec.ts');
    // Sem sinal de relevância a escolha continua reprodutível (alfabética).
    expect(m.melhorExecutavel(lista, '')).toBe('frontend-e2e/qa-waves-replay.spec.ts');
  });

  test('evidência só conta quando o arquivo EXISTE no repositório', () => {
    const existente = 'tests/unit/governance/bugClosureQueueModel.test.js';
    const citados = m.testesDaEvidencia({
      evidence: `passou: ${existente} e tambem tests/unit/nao-existe-mesmo.test.js`,
    });
    expect(citados).toEqual([existente]);
    expect(m.testesDaEvidencia({ evidence: 'sem caminho de teste aqui' })).toEqual([]);
  });

  // Ids são COMPOSTOS em tempo de execução: se fossem literais, este próprio arquivo casaria o
  // grep de "arquivo que cita o id" e o teste mediria a si mesmo (foi exatamente o que aconteceu
  // na primeira versão deste contrato).
  const idFicticio = () => `ITEM-FICTICIO-${Math.random().toString(36).slice(2, 10)}`;

  test('precedência: evidência vence o commit, e commit é usado quando não há evidência', () => {
    const daEvidencia = 'tests/unit/governance/bugClosureQueueModel.test.js';
    const itemComEvidencia = {
      id: idFicticio(),
      evidence: `prova: ${daEvidencia}`,
      commit: 'c6dd665e7',
    };
    expect(m.resolverTeste(itemComEvidencia)).toEqual({ teste: daEvidencia, fonte: 'EVIDENCIA_DO_ITEM' });

    const soCommit = { id: idFicticio(), commit: 'c6dd665e7' };
    const resolucao = m.resolverTeste(soCommit);
    expect(resolucao && resolucao.fonte).toBe('COMMIT_DO_FIX');
    expect(resolucao.teste).toMatch(/\.(test|spec)\.(js|jsx|cjs|mjs|ts|tsx)$/);
  });

  test('item sem suíte identificável devolve null — nunca um caminho inventado', () => {
    expect(m.resolverTeste({ id: idFicticio(), evidence: 'leitura direta do codigo', commit: null })).toBeNull();
    expect(m.resolverTeste({ id: idFicticio(), commit: '0000000' })).toBeNull();
  });

  test('LIMITE CONHECIDO: arquivo que apenas MENCIONA o id é aceito como CITA_O_ID', () => {
    // Um `grep` por id não distingue "teste que guarda este defeito" de "teste que cita o id de
    // passagem". A fonte vem registrada no relatório justamente para que essa diferença seja
    // auditável; a execução verde é o que separa declaração de prova.
    const id = 'CI-CHECKOUT-LIMPO-HARNESS';
    const resolucao = m.resolverTeste({ id, evidence: '', commit: null });
    expect(resolucao.fonte).toBe('CITA_O_ID');
    // A suíte histórica cita o id de propósito — está entre os candidatos; qual deles vence
    // depende do conjunto (este arquivo também cita), por isso a asserção é sobre o conjunto.
    expect(m.testesQueCitamOId(id)).toContain('tests/unit/governance/bugClosureHistoricalGuards.test.js');
  });
});
