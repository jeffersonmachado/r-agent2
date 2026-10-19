'use strict';

/**
 * DIAGNÓSTICO DO COLETOR DE RUNTIME EVIDENCE
 * (P2 HARDENING-ENG-GOV-RELEASE-RUNTIME-EVIDENCE-DIAGNOSTICO-ENGANOSO).
 *
 * DEFEITO MEDIDO: quando um teste falhava por ASSERÇÃO, o coletor fazia
 * `JSON.parse(stdout)` cru. O Jest escreve o JSON DEPOIS das linhas de log do
 * próprio teste, então o parse estourava e o relatório dizia
 * "saída do Jest não pôde ser parseada como JSON (crash antes do reporter)" —
 * culpando infraestrutura por uma falha de teste legível e identificável.
 */

const { extrairJsonDoJest } = require('../../../scripts/governance/collect-engineering-router-runtime-evidence');

const RELATORIO = {
  numFailedTests: 1,
  numPassedTests: 0,
  numTotalTests: 1,
  testResults: [{ name: 'x.test.js', assertionResults: [{ status: 'failed', fullName: 'espera A' }] }],
};

describe('extração do JSON do reporter do Jest', () => {
  it('JSON puro (execução limpa)', () => {
    expect(extrairJsonDoJest(JSON.stringify(RELATORIO))).toEqual(RELATORIO);
  });

  it('JSON precedido por LOGS do teste (o caso que virava "crash antes do reporter")', () => {
    const saida = [
      '[INFO] setup pronto',
      'console.log de diagnóstico do teste',
      '[INFO] conexão ok',
      JSON.stringify(RELATORIO),
    ].join('\n');
    const parsed = extrairJsonDoJest(saida);
    expect(parsed).not.toBeNull();
    expect(parsed.numFailedTests).toBe(1);
  });

  it('JSON concatenado em bloco único até o fim da saída', () => {
    const saida = `log inicial ${JSON.stringify(RELATORIO)}`;
    expect(extrairJsonDoJest(saida).numFailedTests).toBe(1);
  });

  it('saída sem JSON nenhum continua nula (aí sim é crash real)', () => {
    expect(extrairJsonDoJest('TypeError: Cannot read properties of undefined')).toBeNull();
    expect(extrairJsonDoJest('')).toBeNull();
    expect(extrairJsonDoJest(null)).toBeNull();
  });

  it('o coletor usa o extrator robusto (não parse cru)', () => {
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'collect-engineering-router-runtime-evidence.js'), 'utf8');
    expect(fonte).toContain('extrairJsonDoJest(raw)');
    expect(fonte).not.toMatch(/parsed = JSON\.parse\(raw\)/);
  });
});
