'use strict';

/**
 * Regressão dos DETECTORES da jornada funcional (H18).
 *
 * Cada caso abaixo corresponde a um falso positivo MEDIDO rodando a jornada real
 * em 2026-10-17 — não é teste de conveniência. Se a regra voltar atrás, o smoke
 * volta a acusar defeito inexistente e treina quem lê a ignorar vermelho.
 */

const {
  selecionarChipDeFiltro,
  classificarErroDeConsole,
  proximaLeituraDeEstabilidade,
} = require('../../../scripts/smoke/lib/journey-detectors');

describe('selecionarChipDeFiltro', () => {
  test('NÃO escolhe botão de ação como filtro (caso real: /tasks escolhia "Atualizar")', () => {
    const chips = ['Recolher menu da area ▾', 'Atualizar', 'Criar tarefa', '27', '28', 'Ativos'];
    expect(selecionarChipDeFiltro(chips)).toBe('Ativos');
  });

  test('NÃO escolhe grupos de menu lateral nem rótulo de usuário', () => {
    const chips = ['SA 99+ Super Admin ▼', 'MODELAGEM 3 ▾', 'EXECUÇÃO 3 ▾', 'Em risco'];
    expect(selecionarChipDeFiltro(chips)).toBe('Em risco');
  });

  test('NÃO escolhe paginação numérica nem setas', () => {
    expect(selecionarChipDeFiltro(['27', '28', '←', '→', 'Todos'])).toBe('Todos');
  });

  test('sem filtro identificável devolve null (ação inexistente não é sucesso)', () => {
    expect(selecionarChipDeFiltro(['Atualizar', 'Salvar', 'Criar tarefa'])).toBeNull();
    expect(selecionarChipDeFiltro([])).toBeNull();
    expect(selecionarChipDeFiltro(undefined)).toBeNull();
  });
});

describe('classificarErroDeConsole', () => {
  test('"Failed to fetch" durante a navegação do teste é CANCELAMENTO DECLARADO (caso real: /crm)', () => {
    expect(classificarErroDeConsole({
      texto: 'TypeError: Failed to fetch at fetchCrmMetrics',
      emNavegacao: true,
    })).toBe('CANCELAMENTO_DECLARADO');
  });

  test('o mesmo erro em tela ESTÁVEL continua sendo DEFEITO (não é supressão cega)', () => {
    expect(classificarErroDeConsole({
      texto: 'TypeError: Failed to fetch at fetchCrmMetrics',
      emNavegacao: false,
    })).toBe('DEFEITO');
  });

  test('erro que não é cancelamento nunca é abafado, mesmo durante navegação', () => {
    expect(classificarErroDeConsole({
      texto: 'Uncaught TypeError: cannot read property of undefined',
      emNavegacao: true,
    })).toBe('DEFEITO');
  });
});

describe('proximaLeituraDeEstabilidade', () => {
  test('"Carregando..." estável NÃO encerra a espera (caso real: /editor media 13 chars)', () => {
    let st = {};
    let r = proximaLeituraDeEstabilidade(st, { texto: 'Carregando...' });
    expect(r.concluido).toBe(false);
    st = r.estado;
    r = proximaLeituraDeEstabilidade(st, { texto: 'Carregando...' });
    // Duas leituras iguais — mas ainda é loading: continua esperando.
    expect(r.concluido).toBe(false);
  });

  test('conteúdo estável encerra a espera', () => {
    let r = proximaLeituraDeEstabilidade({}, { texto: 'Painel CRM com 9 linhas' });
    expect(r.concluido).toBe(false); // primeira leitura apenas registra
    r = proximaLeituraDeEstabilidade(r.estado, { texto: 'Painel CRM com 9 linhas' });
    expect(r.concluido).toBe(true);
    expect(r.chars).toBe('Painel CRM com 9 linhas'.length);
  });

  test('espera de loading tem LIMITE (nunca espera infinita)', () => {
    let st = {};
    let concluido = false;
    for (let i = 0; i < 40; i += 1) {
      const r = proximaLeituraDeEstabilidade(st, { texto: 'Carregando...', extrasAposLoading: 3 });
      st = r.estado;
      if (r.concluido) { concluido = true; break; }
    }
    expect(concluido).toBe(true);
    expect(st.extras).toBeLessThanOrEqual(3);
  });
});
