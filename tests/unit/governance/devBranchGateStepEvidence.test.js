'use strict';

/**
 * Regressão: falha de passo PRECISA ser diagnosticável sem re-executar.
 *
 * Defeito medido (2026-10-19): a fase C reprovou com exit=1 em 60,6s e o
 * relatório guardava apenas o digest e as últimas 12 linhas da saída. A falha
 * estava no MEIO da suíte (uma asserção de sandbox), fora das 12 linhas — e a
 * única forma de investigar era re-rodar o processo inteiro, quando o defeito
 * intermitente não reproduzia. Diagnóstico por repetição é o oposto de prova.
 *
 * Contrato agora: todo passo executa com a saída COMPLETA persistida em disco e
 * a referência (`saidaRef`) publicada no relatório.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { executar, definirContextoExecucao } = require('../../../scripts/ci/dev-branch-gate');

const SHA = 'a'.repeat(40);

describe('dev-branch-gate — evidência completa por passo', () => {
  let dirEvidencia;
  let envOriginal;

  beforeEach(() => {
    dirEvidencia = fs.mkdtempSync(path.join(os.tmpdir(), 'devgate-log-'));
    envOriginal = process.env.DEV_BRANCH_GATE_EVIDENCE_DIR;
    process.env.DEV_BRANCH_GATE_EVIDENCE_DIR = dirEvidencia;
    definirContextoExecucao({ sha: SHA, execucaoId: 'exec-teste-1', branch: 'dev/engineering-hardening' });
  });

  afterEach(() => {
    if (envOriginal === undefined) delete process.env.DEV_BRANCH_GATE_EVIDENCE_DIR;
    else process.env.DEV_BRANCH_GATE_EVIDENCE_DIR = envOriginal;
    fs.rmSync(dirEvidencia, { recursive: true, force: true });
  });

  test('passo com sucesso grava a saída completa e publica saidaRef existente', () => {
    const r = executar({ id: 'passo-ok', fase: 'C', nivel: 'L0', comando: 'echo MARCACAO_DE_LOG', orcamentoMs: 10000 });

    expect(r.exitCode).toBe(0);
    expect(typeof r.saidaRef).toBe('string');
    const absoluto = path.resolve(__dirname, '..', '..', '..', r.saidaRef);
    expect(fs.existsSync(absoluto)).toBe(true);
    expect(fs.readFileSync(absoluto, 'utf8')).toContain('MARCACAO_DE_LOG');
  });

  test('passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada', () => {
    const r = executar({
      id: 'passo-falho',
      fase: 'C',
      nivel: 'L0',
      comando: 'node -e "console.error(\'linha1-marcada\');console.error(\'linha2-marcada\');process.exit(3)"',
      orcamentoMs: 10000,
    });

    expect(r.exitCode).toBe(3);
    expect(r.sha256Saida).toMatch(/^[0-9a-f]{64}$/);
    const absoluto = path.resolve(__dirname, '..', '..', '..', r.saidaRef);
    const conteudo = fs.readFileSync(absoluto, 'utf8');
    // a linha que explica a falha está no arquivo, mesmo quando não está nas 12 últimas
    expect(conteudo).toContain('linha1-marcada');
    expect(conteudo).toContain('linha2-marcada');
  }, 30000);

  test('o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra', () => {
    const r1 = executar({ id: 'mesmo-passo', fase: 'C', nivel: 'L0', comando: 'echo EXECUCAO_UM', orcamentoMs: 10000 });
    definirContextoExecucao({ sha: SHA, execucaoId: 'exec-teste-2', branch: 'dev/engineering-hardening' });
    const r2 = executar({ id: 'mesmo-passo', fase: 'C', nivel: 'L0', comando: 'echo EXECUCAO_DOIS', orcamentoMs: 10000 });

    expect(r1.saidaRef).not.toBe(r2.saidaRef);
    const a = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', r1.saidaRef), 'utf8');
    const b = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', r2.saidaRef), 'utf8');
    expect(a).toContain('EXECUCAO_UM');
    expect(b).toContain('EXECUCAO_DOIS');
  });
});
