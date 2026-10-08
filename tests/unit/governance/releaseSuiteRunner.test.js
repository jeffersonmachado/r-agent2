'use strict';

/**
 * Runner canônico — MAPEAMENTO do relatório do Jest para os estados do manifesto.
 *
 * Dois defeitos reais aconteceram exatamente aqui (2026-09-25), e ambos passariam por `node
 * --check`:
 *
 *   1. `numTotalTests` lido no NÍVEL DA SUÍTE — no JSON do Jest esse campo só existe na raiz; por
 *      suíte o que existe é `assertionResults[]`. Toda suíte virava "executou ZERO testes", ou
 *      seja, uma execução 100% verde era reprovada (e o inverso poderia aprovar suíte vazia);
 *   2. variável de decisão perdida numa edição (ReferenceError em runtime).
 *
 * Este teste fixa o mapeamento contra a ESTRUTURA REAL do Jest.
 */

const { mapSuiteResult, buildJestArgs } = require('../../../scripts/governance/run-release-suites');

function suite({ assertions = [], status = 'passed', message = '' }) {
  return {
    name: '/tmp/x.test.js',
    status,
    message,
    assertionResults: assertions.map((a) => ({ status: a })),
  };
}

describe('run-release-suites — mapSuiteResult', () => {
  it('conta os testes por assertionResults (o campo numTotalTests NÃO existe por suíte)', () => {
    const result = mapSuiteResult(suite({ assertions: ['passed', 'passed', 'passed'] }));
    expect(result.testsExecuted).toBe(3);
    expect(result.state).toBe('PASS');
  });

  it('suíte com ZERO testes é FAIL (nunca PASS vacuoso)', () => {
    const result = mapSuiteResult(suite({ assertions: [] }));
    expect(result.testsExecuted).toBe(0);
    expect(result.state).toBe('FAIL');
    expect(result.reason).toMatch(/ZERO testes/);
  });

  it('um único teste falhando marca a suíte inteira como FAIL', () => {
    const result = mapSuiteResult(suite({ assertions: ['passed', 'failed', 'passed'] }));
    expect(result.state).toBe('FAIL');
    expect(result.failed).toBe(1);
    expect(result.testsExecuted).toBe(3);
  });

  it('todos os testes pulados é NOT_EXECUTED (não conta como cobertura)', () => {
    const result = mapSuiteResult(suite({ assertions: ['pending', 'pending'] }));
    expect(result.state).toBe('NOT_EXECUTED');
    expect(result.skipped).toBe(2);
  });

  it('alguns pulados com o restante passando é PASS (pulo parcial é declarado, não é falha)', () => {
    const result = mapSuiteResult(suite({ assertions: ['passed', 'pending'] }));
    expect(result.state).toBe('PASS');
    expect(result.skipped).toBe(1);
    expect(result.testsExecuted).toBe(2);
  });

  it('INFRA_ERROR na mensagem de uma suíte que FALHOU tem estado próprio (não é FAIL genérico)', () => {
    // O `infraGate` LANÇA em modo autoritativo — a suíte fica `failed` com a mensagem. É esse o
    // cenário real. (Ler `message` de suíte que PASSOU seria a varredura de texto que causou o
    // falso positivo corrigido abaixo.)
    const result = mapSuiteResult(suite({ assertions: [], status: 'failed', message: 'INFRA_ERROR: postgres indisponível' }));
    expect(result.state).toBe('INFRA_ERROR');
  });

  it('INFRA_ERROR em failureMessages é detectado (estrutura, não texto de título)', () => {
    const result = {
      name: '/tmp/x.test.js',
      status: 'failed',
      message: 'suite falhou',
      assertionResults: [{ status: 'failed', title: 'DB', failureMessages: ['Error: INFRA_ERROR: postgres indisponível'] }],
    };
    expect(mapSuiteResult(result).state).toBe('INFRA_ERROR');
  });

  it('REGRESSÃO: a PALAVRA INFRA_ERROR no título de um teste que PASSOU não classifica a suíte', () => {
    // Defeito real: a varredura usava JSON.stringify(assertionResults), que inclui títulos. A
    // suíte que testa este mapeador tem casos com "INFRA_ERROR" no título e passou a ser marcada
    // como INFRA_ERROR no modo autoritativo — reprovando uma execução 100% verde.
    const result = {
      name: '/tmp/x.test.js',
      status: 'passed',
      message: '',
      assertionResults: [
        { status: 'passed', title: 'INFRA_ERROR em failureMessages é detectado', failureMessages: [] },
        { status: 'passed', title: 'INFRA_ERROR no erro de um teste', failureMessages: [] },
      ],
    };
    expect(mapSuiteResult(result).state).toBe('PASS');
  });

  it('REGRESSÃO: mensagem de FALHA real sem INFRA_ERROR continua FAIL (não vira estado especial)', () => {
    const result = {
      name: '/tmp/x.test.js',
      status: 'failed',
      message: 'expect(received).toBe(expected)',
      assertionResults: [{ status: 'failed', title: 'X', failureMessages: ['expect(received).toBe(expected)'] }],
    };
    expect(mapSuiteResult(result).state).toBe('FAIL');
  });

  it('suíte marcada failed sem assertions é FAIL (erro de suíte, não zero testes silencioso)', () => {
    const result = mapSuiteResult(suite({ assertions: [], status: 'failed', message: 'Cannot find module' }));
    expect(result.state).toBe('FAIL');
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('estrutura ausente não derruba o mapeamento (relatório malformado ⇒ FAIL, nunca exceção)', () => {
    expect(mapSuiteResult({ name: '/tmp/y.test.js' }).state).toBe('FAIL');
    expect(mapSuiteResult({}).state).toBe('FAIL');
  });
});

/**
 * POLÍTICA DE EXECUÇÃO DO LOTE — um lote NUNCA pode ser truncado.
 *
 * Defeito real medido em 2026-10-08: o `jest.config.cjs` traz `bail: 1` (comentado como "útil para
 * debug") e o runner não o desligava. O Jest abortava no primeiro teste falho do lote e NÃO
 * escrevia o `--outputFile`: as 6 suítes do lote viravam `MANIFEST_SUITE_NOT_EXECUTED`. Uma falha
 * real (uma suíte) apagava a evidência das suítes que nem chegaram a rodar, e o relatório agregado
 * passava a dizer "não executada" em vez de nomear a que falhou — causa e resultado escondidos ao
 * mesmo tempo.
 */
describe('run-release-suites — política de execução do lote', () => {
  it('desliga o bail EXPLICITAMENTE (o bail do projeto é conveniência de debug, não política de gate)', () => {
    const args = buildJestArgs(['tests/unit/x.test.js'], '/tmp/batch-0.json');
    expect(args).toContain('--bail=0');
  });

  it('nenhum `--bail` diferente de 0 pode entrar nos argumentos', () => {
    const args = buildJestArgs(['tests/unit/x.test.js'], '/tmp/batch-0.json');
    const bailFlags = args.filter((a) => String(a).startsWith('--bail'));
    expect(bailFlags).toEqual(['--bail=0']);
  });

  it('mantém a serialização e o transporte do relatório do lote', () => {
    const args = buildJestArgs(['tests/unit/x.test.js', 'tests/unit/y.test.js'], '/tmp/batch-3.json');
    expect(args).toContain('--runInBand');
    expect(args).toContain('--json');
    expect(args).toContain('--outputFile=/tmp/batch-3.json');
    // as suítes pedidas são exatamente as que o lote executa — nenhuma some no caminho
    expect(args.filter((a) => a.startsWith('tests/'))).toEqual(['tests/unit/x.test.js', 'tests/unit/y.test.js']);
  });
});
