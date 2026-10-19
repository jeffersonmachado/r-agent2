'use strict';

/**
 * Regressão do retry de AMBIENTE no QA Mesh (medido em 2026-10-19).
 *
 * O mesh canônico do ciclo de selagem executou 144 cenários: 143 passaram e 1
 * falhou com `page.goto: Timeout 30000ms exceeded ... navigating to
 * "http://localhost:5173/dev/qa-waves"` — sob contenção de máquina, com a URL
 * correta (a rota responde 200 em curl). O classificador marcou `infra_error`,
 * o domínio `omnichannel` era crítico e o `go-no-go` foi para NO_GO,
 * abortando a fase `prepare` do `release:seal`.
 *
 * A causa: `isTransientEnvFailure` não reconhecia timeout de NAVEGAÇÃO — só
 * assinaturas de fetch/socket. Sem retry, uma flutuação de ambiente virava
 * reprovação funcional.
 *
 * A correção NÃO afrouxa assertiva: a reexecução é única e precisa passar
 * integralmente; a primeira falha continua na evidência. E timeout de SELETOR
 * segue fora — isso pode ser defeito de produto.
 */

const { isTransientEnvFailure, TRANSIENT_ENV_PATTERNS } = require('../../../qa-mesh/transientEnvRetry');

function resultado(erro) {
  return { status: 'failed', errorMessage: erro, errors: [erro], logs: [] };
}

describe('retry de ambiente do QA Mesh', () => {
  test('timeout de page.goto é transitório (caso medido do fitness-matricula-leads)', () => {
    const r = resultado(
      'page.goto: Timeout 30000ms exceeded. Call log: - navigating to "http://localhost:5173/dev/qa-waves", waiting until "domcontentloaded"',
    );
    expect(isTransientEnvFailure(r)).toBe(true);
  });

  test('erros de rede do browser são transitórios', () => {
    for (const erro of [
      'net::ERR_CONNECTION_REFUSED',
      'net::ERR_NAME_NOT_RESOLVED',
      'net::ERR_ADDRESS_UNREACHABLE',
      'net::ERR_TIMED_OUT',
    ]) {
      expect(isTransientEnvFailure(resultado(erro))).toBe(true);
    }
  });

  test('timeout de SELETOR não é transitório (pode ser defeito funcional)', () => {
    const r = resultado(
      'page.waitForSelector: Timeout 15000ms exceeded. waiting for locator("#btn-salvar")',
    );
    expect(isTransientEnvFailure(r)).toBe(false);
  });

  test('timeout de waitForFunction/expect não é transitório', () => {
    expect(isTransientEnvFailure(resultado('page.waitForFunction: Timeout 30000ms exceeded'))).toBe(false);
    expect(isTransientEnvFailure(resultado('expect(locator).toBeVisible: Timeout 10000ms exceeded'))).toBe(false);
  });

  test('falha funcional explícita continua não-transitória', () => {
    expect(isTransientEnvFailure(resultado('Lead não apareceu na lista após cadastro'))).toBe(false);
    expect(isTransientEnvFailure(resultado('esperado 200, recebido 422'))).toBe(false);
  });

  test('sucesso nunca é retentado', () => {
    expect(isTransientEnvFailure({ status: 'passed', errors: [], logs: [] })).toBe(false);
  });

  test('a lista de padrões não contém curinga amplo que engoliria timeout funcional', () => {
    // Trava: se alguém adicionar /Timeout/ genérico, este teste falha.
    const generico = TRANSIENT_ENV_PATTERNS.some(
      (p) => p.source === 'Timeout' || p.source === '.*' || p.source === 'Timeout.*',
    );
    expect(generico).toBe(false);
  });
});
