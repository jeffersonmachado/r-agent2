'use strict';

/**
 * P1-E — CHECKOUT LIMPO: TIMEOUT INTERPRETADO COMO SUCESSO e CONTAMINAÇÃO DE RAG
 * (missão Codex 2026-10-23).
 *
 * E1: `cenarioBancoIndisponivel` aceitava `exitCode === null` como "falhou fechado" e marcava o
 *     cenário como PASS. `exitCode === null` acontece por timeout, por sinal, por spawn falho ou
 *     por processo travado — nenhum deles prova que a aplicação falhou pelo motivo esperado.
 *
 * E2: quando o RAG isolado não subia, o ambiente caía em `http://127.0.0.1:8001` (serviço do
 *     desenvolvedor): evidência de OUTRO ambiente, ou de nenhum.
 *
 * Aqui testamos a classificação com PROCESSOS REAIS (timeout de verdade, sinal de verdade) e o
 * contrato de fonte do harness, sem executar o pipeline completo (que exige Docker/DB).
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { CLASSES, classificarResultado, vereditoDoRun } = require('../../../scripts/ci/lib/resultClassification');

const RAIZ = path.join(__dirname, '..', '..', '..');
const HARNESS = path.join(RAIZ, 'scripts', 'ci', 'clean-checkout-verify.js');
const FONTE = fs.readFileSync(HARNESS, 'utf8');

describe('P1-E1 — classificação explícita de resultado', () => {
  test('exit 0 no passo positivo ⇒ EXPECTED_SUCCESS (aprovável)', () => {
    const r = classificarResultado({ exitCode: 0, esperado: 0, saida: 'ok' });
    expect(r.classe).toBe(CLASSES.EXPECTED_SUCCESS);
    expect(r.ok).toBe(true);
  });

  test('exit != 0 no passo positivo ⇒ UNEXPECTED_FAILURE', () => {
    const r = classificarResultado({ exitCode: 1, esperado: 0 });
    expect(r.classe).toBe(CLASSES.UNEXPECTED_FAILURE);
    expect(r.ok).toBe(false);
  });

  test('exit 0 no passo negativo ⇒ UNEXPECTED_SUCCESS', () => {
    const r = classificarResultado({ exitCode: 0, esperado: 1 });
    expect(r.classe).toBe(CLASSES.UNEXPECTED_SUCCESS);
    expect(r.ok).toBe(false);
  });

  test('falha esperada SEM assinatura do motivo ⇒ EXPECTED_FAILURE_SEM_ASSINATURA (não passa)', () => {
    const r = classificarResultado({
      exitCode: 1, esperado: 1, assinaturasEsperadas: ['ECONNREFUSED'], saida: 'erro qualquer',
    });
    expect(r.classe).toBe(CLASSES.EXPECTED_FAILURE_SEM_ASSINATURA);
    expect(r.ok).toBe(false);
  });

  test('falha esperada COM assinatura do motivo ⇒ EXPECTED_FAILURE (aprovável)', () => {
    const r = classificarResultado({
      exitCode: 1, esperado: 1, assinaturasEsperadas: ['ECONNREFUSED'], saida: 'connect ECONNREFUSED 127.0.0.1:1',
    });
    expect(r.classe).toBe(CLASSES.EXPECTED_FAILURE);
    expect(r.ok).toBe(true);
  });

  test('exitCode=null SEM sinal e SEM timeout ⇒ NOT_EXECUTED (nunca PASS)', () => {
    const r = classificarResultado({ exitCode: null, esperado: 1 });
    expect(r.classe).toBe(CLASSES.NOT_EXECUTED);
    expect(r.ok).toBe(false);
  });

  test('exitCode=null por SINAL ⇒ SIGNALLED (nunca PASS)', () => {
    const r = classificarResultado({ exitCode: null, signal: 'SIGKILL', esperado: 1, saida: 'parcial' });
    expect(r.classe).toBe(CLASSES.SIGNALLED);
    expect(r.ok).toBe(false);
  });

  test('sinal aceito por contrato explícito pode passar (nunca por omissão)', () => {
    const semContrato = classificarResultado({ exitCode: null, signal: 'SIGTERM', esperado: 1 });
    const comContrato = classificarResultado({ exitCode: null, signal: 'SIGTERM', esperado: 1, sinaisAceitos: ['SIGTERM'] });
    expect(semContrato.ok).toBe(false);
    expect(comContrato.classe).toBe(CLASSES.EXPECTED_FAILURE);
    expect(comContrato.ok).toBe(true);
  });

  test('timeout ⇒ TIMEOUT e nunca PASS, mesmo com exit code esperado', () => {
    const r = classificarResultado({ exitCode: null, signal: 'SIGTERM', timedOut: true, esperado: 1 });
    expect(r.classe).toBe(CLASSES.TIMEOUT);
    expect(r.ok).toBe(false);
  });

  test('veredito do run: TIMEOUT reprova, INFRA bloqueia, tudo-ok passa', () => {
    expect(vereditoDoRun([{ classe: CLASSES.EXPECTED_SUCCESS }, { classe: CLASSES.TIMEOUT }])).toBe('FAIL');
    expect(vereditoDoRun([{ classe: CLASSES.EXPECTED_SUCCESS }, { classe: CLASSES.INFRASTRUCTURE_ERROR }])).toBe('BLOCKED');
    expect(vereditoDoRun([{ classe: CLASSES.EXPECTED_SUCCESS }, { classe: CLASSES.EXPECTED_FAILURE }])).toBe('PASS');
  });
});

describe('P1-E1 — processos REAIS: timeout e sinal não viram sucesso', () => {
  test('processo travado até o timeout ⇒ TIMEOUT (não PASS)', () => {
    const r = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { encoding: 'utf8', timeout: 400 });
    const classificado = classificarResultado({
      exitCode: typeof r.status === 'number' ? r.status : null,
      signal: r.signal,
      timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
      esperado: 1,
      assinaturasEsperadas: ['ECONNREFUSED'],
      saida: `${r.stdout || ''}${r.stderr || ''}`,
    });
    expect(classificado.classe).toBe(CLASSES.TIMEOUT);
    expect(classificado.ok).toBe(false);
  }, 60000);

  test('processo morto por SINAL ⇒ SIGNALLED (não PASS)', () => {
    const r = spawnSync('bash', ['-c', 'kill -KILL $$'], { encoding: 'utf8' });
    const classificado = classificarResultado({
      exitCode: typeof r.status === 'number' ? r.status : null,
      signal: r.signal,
      timedOut: false,
      esperado: 1,
      saida: `${r.stdout || ''}${r.stderr || ''}`,
    });
    expect(classificado.classe).toBe(CLASSES.SIGNALLED);
    expect(classificado.ok).toBe(false);
  }, 60000);

  test('processo que falha com exit 1 mas SEM a assinatura esperada ⇒ não passa', () => {
    const r = spawnSync('bash', ['-c', 'echo "erro genérico"; exit 1'], { encoding: 'utf8' });
    const classificado = classificarResultado({
      exitCode: r.status, esperado: 1, assinaturasEsperadas: ['ECONNREFUSED'], saida: `${r.stdout}${r.stderr}`,
    });
    expect(classificado.classe).toBe(CLASSES.EXPECTED_FAILURE_SEM_ASSINATURA);
    expect(classificado.ok).toBe(false);
  }, 60000);
});

describe('P1-E1/E2 — contrato do harness (fonte e comportamento observável)', () => {
  test('o cenário db-unavailable exige assinatura do motivo e não aceita exitCode nulo', () => {
    expect(FONTE).not.toContain('aceitoPorNaoSucesso');
    const trecho = FONTE.slice(FONTE.indexOf("function cenarioBancoIndisponivel"), FONTE.indexOf('function cenarioDockerIndisponivel'));
    expect(trecho).toContain('assinaturasEsperadas');
    expect(trecho).toContain('ECONNREFUSED');
    // Não pode existir caminho que marque ok por exitCode nulo dentro do cenário.
    expect(trecho).not.toMatch(/exitCode\s*===\s*null[^]*?\.ok\s*=\s*true/);
  });

  test('não existe fallback para o RAG preexistente em 8001', () => {
    // Nenhuma atribuição de URL de RAG para a porta do desenvolvedor.
    expect(FONTE).not.toMatch(/ragUrl:\s*ragPorta\s*\?[^,]*:\s*'http:\/\/127\.0\.0\.1:8001'/);
    expect(FONTE).not.toMatch(/ragUrl:\s*'http:\/\/127\.0\.0\.1:8001'/);
    // O harness declara explicitamente a recusa.
    expect(FONTE).toContain('ErroDeInfraestrutura');
    expect(FONTE).toContain('identidadeDoRag');
  });

  test('passo() classifica com a lib e registra a classe no relatório', () => {
    expect(FONTE).toContain("require('./lib/resultClassification')");
    expect(FONTE).toContain('registro.classe = classe.classe');
    expect(FONTE).toContain('registro.classificacaoMotivo');
  });

  test('falha de infraestrutura produz BLOCKED e exit code próprio', () => {
    expect(FONTE).toContain("veredito: ehInfra ? 'BLOCKED' : 'FAIL'");
    expect(FONTE).toContain("return veredito === 'BLOCKED' ? 3 : 1");
  });

  test('a identidade do RAG é validada por container próprio + health', () => {
    const trecho = FONTE.slice(FONTE.indexOf('function identidadeDoRag'), FONTE.indexOf('function derrubarRag'));
    expect(trecho).toContain('docker');
    expect(trecho).toContain("'inspect'");
    expect(trecho).toContain('/health');
    expect(trecho).toContain('healthSha256');
  });
});
