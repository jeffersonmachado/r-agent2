'use strict';

/**
 * `scripts/security-intel-verify-target.js` — aceite MECÂNICO de uma correção de dependência.
 *
 * Dois requisitos que este teste fixa:
 *   1. FAIL-CLOSED: quando as versões não são comparáveis, o resultado é INCOMPARABLE (código 2),
 *      nunca "passou". Uma prova de aceite que não consegue comparar não pode declarar sucesso.
 *   2. O script existe porque o comando inline não cabia em `engineering_test_runs.command`
 *      (varchar(255)) — medido em 2026-10-09: INSERT falhava com `22001` e o comando era
 *      classificado REJECTED sem nunca rodar.
 */

const {
  EXIT,
  parseArgs,
  verifyTarget,
  main,
} = require('../../../scripts/security-intel-verify-target');

describe('verify-target — aceite mecânico do alvo aplicado', () => {
  const resolver = (mapa) => (nome) => mapa[nome] || null;

  it('versão instalada >= alvo ⇒ OK (exit 0)', () => {
    const r = verifyTarget({
      packageName: 'fast-uri',
      targetVersion: '3.1.8',
      resolveVersion: resolver({ 'fast-uri': '3.1.8' }),
    });
    expect(r.status).toBe('OK');
    expect(r.installed).toBe('3.1.8');
    expect(r.message).toContain('ALVO APLICADO');
  });

  it('versão instalada < alvo ⇒ NOT_APPLIED (exit 1) com o número na mensagem', () => {
    const r = verifyTarget({
      packageName: 'proxy-addr',
      targetVersion: '2.0.8',
      resolveVersion: resolver({ 'proxy-addr': '2.0.7' }),
    });
    expect(r.status).toBe('NOT_APPLIED');
    expect(r.message).toContain('2.0.7 < 2.0.8');
  });

  it('pacote ausente da árvore ⇒ MISSING (não é sucesso)', () => {
    const r = verifyTarget({
      packageName: 'inexistente',
      targetVersion: '1.0.0',
      resolveVersion: resolver({}),
    });
    expect(r.status).toBe('MISSING');
    expect(r.installed).toBeNull();
  });

  it('FAIL-CLOSED: versão não comparável ⇒ INCOMPARABLE (exit 2), nunca OK', () => {
    const r = verifyTarget({
      packageName: 'algo',
      targetVersion: 'versao-invalida',
      resolveVersion: resolver({ algo: '1.2.3' }),
    });
    expect(r.status).toBe('INCOMPARABLE');
    expect(r.message).toContain('NAO pode declarar sucesso');
  });

  it('sem argumentos ⇒ MISSING, e o exit é de USO (não confunde com alvo não aplicado)', () => {
    const r = verifyTarget({ packageName: null, targetVersion: null, resolveVersion: resolver({}) });
    expect(r.status).toBe('MISSING');
    const codigo = main([], { log: () => {}, error: () => {} });
    expect(codigo).toBe(EXIT.USAGE);
  });

  it('parseArgs lê pacote, alvo e ecossistema', () => {
    expect(parseArgs(['transformers', '5.10.0', '--ecosystem=pypi'])).toEqual({
      packageName: 'transformers',
      targetVersion: '5.10.0',
      ecosystem: 'pypi',
    });
    expect(parseArgs(['fast-uri', '3.1.8'])).toEqual({
      packageName: 'fast-uri',
      targetVersion: '3.1.8',
      ecosystem: 'npm',
    });
  });

  it('main devolve o código do desfecho (0/1/2) e escreve a mensagem no canal certo', () => {
    const ok = [];
    const erros = [];
    // Pacote real da árvore (express) contra um alvo trivialmente satisfeito e outro impossível:
    // prova que a resolução de versão de verdade está ligada ao comando que o aceite executa.
    const log = (m) => ok.push(m);
    const error = (m) => erros.push(m);
    expect(main(['express', '1.0.0'], { log, error })).toBe(EXIT.OK);
    expect(ok.join(' ')).toContain('ALVO APLICADO');
    expect(main(['express', '99.0.0'], { log, error })).toBe(EXIT.NOT_APPLIED);
    expect(erros.join(' ')).toContain('ALVO NAO APLICADO');
    expect(main(['express', 'versao-invalida'], { log, error })).toBe(EXIT.INCOMPARABLE);
  });
});
