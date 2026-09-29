/**
 * gateDirectionInvariant.test.js — INVARIANTE `child NO_GO → parent NO_GO`.
 *
 * DEFEITO REAL (auditoria 2026-09-28): `governance/final-governance-report.json` declarava
 * `AUTONOMOUS_READY_GO` enquanto `reports/engineering-router-v2-seal-report.json` declarava `NO_GO`.
 * Nada no repositório detectava essa contradição — o estado proibido era apenas prosa.
 *
 * Estes testes fixam a semântica do núcleo puro E provam que o CLI está ligado à cadeia declarada
 * em `config/mandatory-gate-dependencies.json` (não a uma lista escrita dentro do validador).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { evaluateGateDirection, classify } = require('../../../governance/gate-direction');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, 'scripts', 'governance', 'validate-gate-direction.js');
const CONFIG = path.join(ROOT, 'config', 'mandatory-gate-dependencies.json');

function gate(decision, children) {
  return { id: 'PARENT', report: 'reports/parent.json', decision, children };
}

function child(decision, id = 'CHILD') {
  return { id, report: `reports/${id.toLowerCase()}.json`, decision };
}

describe('gate-direction — classificação de estados', () => {
  test('aprovação, negação, bloqueio e ausência são classes DISTINTAS', () => {
    expect(classify('GO')).toBe('GO');
    expect(classify('AUTONOMOUS_READY_GO')).toBe('GO');
    expect(classify('GREEN')).toBe('GO');
    expect(classify('NO_GO')).toBe('NOT_GO');
    expect(classify('FAIL')).toBe('NOT_GO');
    expect(classify('BLOCKED_EXTERNAL')).toBe('BLOCKED');
    expect(classify('INCONCLUSIVO')).toBe('BLOCKED');
    expect(classify('NOT_EXECUTED_NO_CREDENTIAL')).toBe('BLOCKED');
    expect(classify(null)).toBe('ABSENT');
    expect(classify(undefined)).toBe('ABSENT');
    expect(classify('')).toBe('ABSENT');
  });

  test('bloqueado NÃO é aprovação (nunca converter BLOCKED_EXTERNAL em GO)', () => {
    expect(classify('BLOCKED_EXTERNAL')).not.toBe('GO');
    expect(classify('PENDENTE_APROVACAO_NEGOCIO')).not.toBe('GO');
  });
});

describe('gate-direction — invariante child → parent', () => {
  test('todos os filhos GO ⇒ parent GO é PASS', () => {
    const result = evaluateGateDirection({ gates: [gate('GO', [child('GO'), child('PASS', 'OTHER')])] });
    expect(result.status).toBe('PASS');
    expect(result.violations).toEqual([]);
  });

  test('filho NO_GO + parent GO ⇒ FAIL (o estado proibido da missão)', () => {
    const result = evaluateGateDirection({ gates: [gate('AUTONOMOUS_READY_GO', [child('GO'), child('NO_GO', 'V2')])] });
    expect(result.status).toBe('FAIL');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ code: 'PARENT_GO_WITH_CHILD_NO_GO', parent: 'PARENT', child: 'V2' });
  });

  test('filho BLOQUEADO + parent GO ⇒ FAIL com código próprio (bloqueio não é aprovação)', () => {
    const result = evaluateGateDirection({ gates: [gate('GO', [child('BLOCKED_EXTERNAL', 'CAPACITY')])] });
    expect(result.status).toBe('FAIL');
    expect(result.violations[0].code).toBe('PARENT_GO_WITH_CHILD_BLOCKED');
  });

  test('filho AUSENTE + parent GO ⇒ FAIL (ausência de evidência nunca é aprovação)', () => {
    const result = evaluateGateDirection({ gates: [gate('GO', [child(undefined, 'SEM_RELATORIO')])] });
    expect(result.status).toBe('FAIL');
    expect(result.violations[0].code).toBe('PARENT_GO_WITH_CHILD_EVIDENCE_ABSENT');
  });

  test('parent NO_GO com filho NO_GO ⇒ PASS: a invariante só julga quem AFIRMA aprovação', () => {
    const result = evaluateGateDirection({ gates: [gate('NO_GO', [child('NO_GO')])] });
    expect(result.status).toBe('PASS');
  });

  test('NUNCA escolhe o valor mais favorável: um filho vermelho entre vários verdes reprova', () => {
    const result = evaluateGateDirection({
      gates: [gate('GO', [child('GO', 'A'), child('GREEN', 'B'), child('NO_GO', 'C'), child('GO', 'D')])],
    });
    expect(result.status).toBe('FAIL');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].child).toBe('C');
  });

  test('a avaliação registra a cadeia inteira (auditabilidade do veredito)', () => {
    const result = evaluateGateDirection({ gates: [gate('GO', [child('NO_GO', 'V2'), child('GREEN', 'TIMEOUT')])] });
    expect(result.evaluated[0].children.map((c) => [c.id, c.class])).toEqual([['V2', 'NOT_GO'], ['TIMEOUT', 'GO']]);
  });
});

describe('gate-direction — CLI ligado à cadeia declarada', () => {
  jest.setTimeout(60000);

  test('o CLI lê config/mandatory-gate-dependencies.json e publica o relatório do invariante', () => {
    const result = spawnSync(process.execPath, [CLI, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const report = JSON.parse(result.stdout);

    const configured = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).gates.map((g) => g.id).sort();
    expect(report.gates.map((g) => g.id).sort()).toEqual(configured);
    expect(report.gates.length).toBeGreaterThanOrEqual(3);
    expect(report.invariants.join(' ')).toMatch(/child NO_GO/);

    // Exit code coerente com o status: PASS=0, FAIL=1 — nunca "FAIL com exit 0".
    expect(result.status).toBe(report.status === 'PASS' ? 0 : 1);

    // E o relatório é persistido para a cadeia de evidência.
    const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'gate-direction-report.json'), 'utf8'));
    expect(onDisk.status).toBe(report.status);
    expect(onDisk.violationCount).toBe(report.violations.length);
  });
});
