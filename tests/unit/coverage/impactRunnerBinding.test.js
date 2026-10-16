'use strict';

/**
 * Runner L1 — VÍNCULO DO GRAFO, INTEGRIDADE e NOT_EXECUTED (P0-5).
 *
 * DEFEITOS REAIS medidos em 2026-10-16 (auditoria P0-5):
 *
 *  (a) O artefato do grafo era lido e USADO sem conferir se descrevia o source atual.
 *      Um grafo de outro commit fazia a seleção decidir sobre uma árvore que não é a
 *      analisada, em silêncio.
 *  (b) O `--dry-run` (simulação, ZERO suíte executada) devolvia exit **0** — verde.
 *      Quem olhasse só o exit code concluía "L1 validado" sem nada ter rodado.
 *
 * Os testes de integração executam o CLI REAL com um grafo temporário injetado por
 * `--graph` (o artefato de `reports/` nunca é tocado).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'governance', 'run-impact-validation.js');

const { extrairUltimoJson, EXIT } = require('../../../scripts/governance/run-impact-validation');
const { computeSourceFingerprint } = require('../../../governance/proof-engine/fingerprint-chain');

function rodar(args, timeout = 120000) {
  let status = 0;
  let saida = '';
  try {
    saida = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout });
  } catch (erro) {
    status = erro.status === null || erro.status === undefined ? 1 : erro.status;
    saida = `${erro.stdout || ''}${erro.stderr || ''}`;
  }
  return { status, saida };
}

const temporarios = [];
function grafoTemporario(overrides = {}, conteudoBruto = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-grafo-'));
  temporarios.push(dir);
  const arquivo = path.join(dir, 'graph.json');
  const base = {
    schemaVersion: 1,
    kind: 'impact-graph',
    // Vínculo correto: o fingerprint do source ATUAL — é o que um grafo recém
    // construído por `impact:build` declara.
    sourceFingerprint: String(computeSourceFingerprint(ROOT)),
    sourceCommit: 'commit-de-teste',
    counts: {},
    reverse: {},
    edges: {},
    journeysByFile: {},
  };
  fs.writeFileSync(arquivo, conteudoBruto === null ? JSON.stringify({ ...base, ...overrides }) : conteudoBruto);
  return arquivo;
}

function saidaTemporaria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-out-'));
  temporarios.push(dir);
  return path.join(dir, 'report.json');
}

afterAll(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

describe('run-impact-validation — extrairUltimoJson (veredito do mesh)', () => {
  it('extrai o JSON final mesmo com logs antes', () => {
    const r = extrairUltimoJson('[qa-mesh] rodando...\n{ "goNoGo": "GO" }\n');
    expect(r).toEqual({ goNoGo: 'GO' });
  });

  it('aceita JSON puro na saída (sem log antes)', () => {
    expect(extrairUltimoJson('{"goNoGo":"NO_GO"}')).toEqual({ goNoGo: 'NO_GO' });
  });

  it('saída sem JSON devolve null (o chamador ESCALA — nunca presume veredito)', () => {
    expect(extrairUltimoJson('erro: stack fora do ar')).toBeNull();
    expect(extrairUltimoJson('')).toBeNull();
    expect(extrairUltimoJson('{ isso nao e json')).toBeNull();
  });
});

describe('run-impact-validation — vínculo e integridade do grafo (P0-5)', () => {
  it('grafo de OUTRO source ⇒ ESCALATE (nunca decidir sobre árvore que não é a analisada)', () => {
    const arquivo = grafoTemporario({ sourceFingerprint: 'deadbeefdeadbeefdeadbeefdeadbeef' });
    const r = rodar(['--files=x.test.js', `--graph=${arquivo}`, `--out=${saidaTemporaria()}`]);
    expect(r.status).toBe(EXIT.ESCALATE);
    expect(r.saida).toMatch(/grafo de OUTRO source/);
    expect(r.saida).toMatch(/impact:build/);
  });

  it('grafo SEM vínculo (formato anterior) ⇒ ESCALATE', () => {
    const arquivo = grafoTemporario({ sourceFingerprint: undefined });
    const r = rodar(['--files=x.test.js', `--graph=${arquivo}`, `--out=${saidaTemporaria()}`]);
    expect(r.status).toBe(EXIT.ESCALATE);
    expect(r.saida).toMatch(/sem `sourceFingerprint`/);
  });

  it('artefato estruturalmente inútil (sem `reverse`) ⇒ ESCALATE', () => {
    const arquivo = grafoTemporario({ reverse: undefined });
    const r = rodar(['--files=x.test.js', `--graph=${arquivo}`, `--out=${saidaTemporaria()}`]);
    expect(r.status).toBe(EXIT.ESCALATE);
    expect(r.saida).toMatch(/sem `reverse`/);
  });

  it('artefato ilegível (JSON quebrado) ⇒ ESCALATE, não INFRA silencioso', () => {
    const arquivo = grafoTemporario({}, '{ "reverse": { ');
    const r = rodar(['--files=x.test.js', `--graph=${arquivo}`, `--out=${saidaTemporaria()}`]);
    expect(r.status).toBe(EXIT.ESCALATE);
    expect(r.saida).toMatch(/ilegível/);
  });

  it('artefato AUSENTE ⇒ INFRA (erro de infraestrutura, não de decisão)', () => {
    const r = rodar(['--files=x.test.js', `--graph=${path.join(os.tmpdir(), 'nao-existe-l1.json')}`]);
    expect(r.status).toBe(EXIT.INFRA);
  });
});

describe('run-impact-validation — dry-run é NOT_EXECUTED, nunca verde (P0-5)', () => {
  it('--dry-run devolve exit 4 e estado explícito no relatório', () => {
    const arquivo = grafoTemporario();
    const out = saidaTemporaria();
    // Arquivo de TESTE alterado: sempre classificado (executa a si mesmo), então a
    // seleção fecha sem depender do resto do grafo.
    const r = rodar(['--files=engine/__tests__/x.test.js', `--graph=${arquivo}`, `--out=${out}`, '--dry-run']);
    expect(r.status).toBe(EXIT.NOT_EXECUTED);
    expect(r.status).not.toBe(EXIT.GREEN);
    expect(r.saida).toMatch(/NOT_EXECUTED/);
    const relatorio = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(relatorio.execution.state).toBe('NOT_EXECUTED');
    expect(relatorio.execution.testsExecuted).toBe(0);
    expect(relatorio.execution.dryRun).toBe(true);
  });

  it('o código de NOT_EXECUTED é distinto de TODOS os outros (nenhum consumidor confunde)', () => {
    const outros = [EXIT.GREEN, EXIT.RED, EXIT.ESCALATE, EXIT.INFRA];
    expect(outros).not.toContain(EXIT.NOT_EXECUTED);
    expect(new Set(outros.concat(EXIT.NOT_EXECUTED)).size).toBe(5);
  });
});
