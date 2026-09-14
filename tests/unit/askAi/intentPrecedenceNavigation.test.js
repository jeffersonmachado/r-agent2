'use strict';

/**
 * Precedência local × valor no roteador de intenção.
 *
 * RED medido antes do fix (2026-09-14): em 5 de 5 perguntas de LOCAL com palavra
 * de dado vivo, o roteador devolvia `OPERATIONAL_DATA` e o sinal
 * `navigation_marker` aparecia na lista sem efeito nenhum:
 *
 *   Onde encontro o relatório de frequência?   → OPERATIONAL_DATA
 *   Onde vejo a frequência dos alunos?         → OPERATIONAL_DATA
 *   Onde fica o painel de inadimplência?       → OPERATIONAL_DATA
 *   Onde vejo se o aluno está inadimplente?    → OPERATIONAL_DATA
 *   Onde acesso o saldo do cliente?            → OPERATIONAL_DATA
 *
 * Efeito: quem perguntava ONDE fica mandava o assistente buscar dado de
 * entidade — resposta sobre estado quando o pedido era de localização.
 *
 * A regra fixada aqui: o interrogativo separa as duas coisas. "onde" é LOCAL
 * (NAVIGATION_HELP); "qual/quanto/quantas/está" continua VALOR
 * (OPERATIONAL_DATA). Pergunta que pede local E método segue MIXED.
 */

const { classifyIntent, INTENTS } = require('../../../api/services/askAi/intentRouter');

const LOCAL_PROBES = [
  'Onde encontro o relatório de frequência?',
  'Onde vejo a frequência dos alunos?',
  'Onde fica o painel de inadimplência?',
  'Onde vejo se o aluno está inadimplente?',
  'Onde acesso o saldo do cliente?',
  'Onde encontro a agenda de reservas futuras?',
];

describe('pergunta de LOCAL não vira consulta de VALOR', () => {
  it.each(LOCAL_PROBES)('%s', (question) => {
    const result = classifyIntent({ question, classification: 'PRODUCTION' });
    expect(result.intent).toBe(INTENTS.NAVIGATION_HELP);
    // A ambiguidade é resolvida por regra, não por descartar o marcador.
    expect(result.signals).toContain('live_data_marker');
    expect(result.signals).toContain('navigation_marker');
  });

  it('pedido de local + método segue MIXED (os dois lados contam)', () => {
    const result = classifyIntent({
      question: 'Onde vejo a inadimplência e o que devo fazer?',
      classification: 'PRODUCTION',
    });
    expect(result.intent).toBe(INTENTS.MIXED);
  });
});

describe('pergunta de VALOR permanece dado vivo', () => {
  it.each([
    'Qual a frequência do João?',
    'Qual foi a última visita do João?',
    'Quantos dias sem vir o aluno está?',
    'Status do aluno João',
  ])('%s', (question) => {
    const result = classifyIntent({ question, classification: 'PRODUCTION' });
    expect(result.intent).toBe(INTENTS.OPERATIONAL_DATA);
  });

  it('método puro continua PROCEDURE', () => {
    expect(classifyIntent({ question: 'Como faço para cadastrar um aluno?' }).intent)
      .toBe(INTENTS.PROCEDURE);
  });

  it('navegação sem dado vivo continua NAVIGATION_HELP', () => {
    expect(classifyIntent({ question: 'Onde encontro campanhas?' }).intent)
      .toBe(INTENTS.NAVIGATION_HELP);
  });
});
