'use strict';

/**
 * VEREDITO PRÓPRIO DO GATE AGREGADO
 * (P1 HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO).
 *
 * Antes: `validate:governance-enforcement` era uma cadeia `&&` do npm e o ÚNICO
 * registro do resultado era o exit code do processo chamador. Nada em disco
 * dizia qual run/commit/fingerprint foi avaliado, quais passos rodaram nem onde
 * parou — "nunca rodou" e "rodou e passou" eram indistinguíveis para auditoria.
 */

const fs = require('fs');
const path = require('path');

const {
  executarCadeia, lerCadeia, identidadeCompleta,
} = require('../../../scripts/governance/run-governance-enforcement');

const ID_OK = {
  runId: 'rap-governed-20261017100000000-abc12345',
  sourceFingerprint: 'f'.repeat(64),
  sourceCommit: 'a'.repeat(40),
};

const ok = () => ({ exitCode: 0, duracaoMs: 1, sha256Saida: 'ok', saidaFinal: 'ok' });
const falha = () => ({ exitCode: 1, duracaoMs: 1, sha256Saida: 'bad', saidaFinal: 'erro' });

describe('identidade do veredito', () => {
  it('exige runId, sourceFingerprint e sourceCommit de 40 hex', () => {
    expect(identidadeCompleta(ID_OK)).toEqual({ completa: true, faltantes: [] });
    expect(identidadeCompleta({ ...ID_OK, runId: null }).faltantes).toContain('runId');
    expect(identidadeCompleta({ ...ID_OK, sourceCommit: 'abc' }).faltantes).toContain('sourceCommit');
  });
});

describe('veredito do agregado', () => {
  it('todos os passos verdes + identidade completa ⇒ PASS', () => {
    const v = executarCadeia({ cadeia: ['a', 'b', 'c'], id: ID_OK, executor: ok });
    expect(v.status).toBe('PASS');
    expect(v.passosExecutados).toBe(3);
    expect(v.motivo).toBeNull();
  });

  it('falha interrompe a cadeia (fail-fast) e nomeia o passo', () => {
    const executados = [];
    const v = executarCadeia({
      cadeia: ['a', 'b', 'c'],
      id: ID_OK,
      executor: (cmd) => { executados.push(cmd); return cmd === 'b' ? falha() : ok(); },
    });
    expect(v.status).toBe('FAIL');
    expect(v.interrompidoEm).toBe('b');
    expect(v.passosExecutados).toBe(2);
    expect(executados).toEqual(['a', 'b']); // 'c' nunca rodou
    expect(v.motivo).toContain('passo falhou: b');
  });

  it('exit code null (morte por sinal) NUNCA é sucesso', () => {
    const v = executarCadeia({
      cadeia: ['a'],
      id: ID_OK,
      executor: () => ({ exitCode: null, duracaoMs: 1, sha256Saida: 'z', saidaFinal: '' }),
    });
    expect(v.status).toBe('FAIL');
  });

  it('sem identidade completa o veredito é BLOCKED (nunca PASS)', () => {
    const v = executarCadeia({ cadeia: ['a'], id: { runId: null }, executor: ok });
    expect(v.status).toBe('BLOCKED');
    expect(v.motivo).toContain('identidade de run incompleta');
  });
});

describe('cadeia única e registro em disco', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));

  it('a cadeia canônica vive em validate:governance-enforcement:chain (sem duplicação)', () => {
    expect(pkg.scripts['validate:governance-enforcement:chain']).toBeTruthy();
    expect(pkg.scripts['validate:governance-enforcement']).toBe('node scripts/governance/run-governance-enforcement.js');
    expect(lerCadeia().length).toBeGreaterThan(50);
  });

  it('o wrapper grava o veredito em reports/ com identidade', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'run-governance-enforcement.js'), 'utf8');
    expect(fonte).toContain('reports');
    expect(fonte).toContain('governance-enforcement-verdict.json');
    expect(fonte).toContain('identidade');
  });

  it('o alvo de escrita está na taxonomia canônica de persistência JSON', () => {
    const auditoria = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'governance', 'json-persistence-audit.js'), 'utf8');
    expect(auditoria).toContain("'reports/governance-enforcement-verdict.json'");
  });
});
