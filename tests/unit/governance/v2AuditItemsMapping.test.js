/**
 * v2AuditItemsMapping.test.js — CONFIRMAÇÃO ITEM A ITEM (missão 2026-09-28).
 *
 * A auditoria entregou estados por NOME (não a faixa `V2-01..V2-42`, que não existe em artefato
 * algum do repositório). A missão exige confirmar cada item e classificar como ALREADY_FIXED o que já
 * foi corrigido — provando, nunca afirmando.
 *
 * Estes testes fixam:
 *   1. a semântica da classificação (núcleo puro), nos dois sentidos;
 *   2. a integridade do MAPEAMENTO (sem id duplicado, toda prova declarada, nada de status à mão);
 *   3. a honestidade sobre a numeração legada (declarada como sem fonte, jamais inventada).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { deriveAuditItems, classifyItem } = require('../../../governance/audit-items-derivation');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG = path.join(ROOT, 'config', 'engineering-router-v2-audit-items.json');
const CLI = path.join(ROOT, 'scripts', 'governance', 'validate-engineering-router-v2-audit-items.js');

const proven = ['GO', 'GREEN', 'PASS'];

describe('audit-items — classificação', () => {
  test('auditoria negativa + prova positiva ⇒ ALREADY_FIXED (com o porquê)', () => {
    const result = classifyItem({ id: 'X', auditState: 'NO_GO', provenValues: proven }, 'GREEN');
    expect(result.classification).toBe('ALREADY_FIXED');
    expect(result.detail).toMatch(/NO_GO/);
    expect(result.detail).toMatch(/GREEN/);
  });

  test('auditoria negativa + prova ainda negativa ⇒ CONFIRMED (nunca ALREADY_FIXED)', () => {
    expect(classifyItem({ id: 'X', auditState: 'NO_GO', provenValues: proven }, 'NO_GO').classification).toBe('CONFIRMED');
  });

  test('auditoria positiva + prova negativa ⇒ REGRESSED (o pior caso tem nome)', () => {
    expect(classifyItem({ id: 'X', auditState: 'PASS', provenValues: proven }, 'FAIL').classification).toBe('REGRESSED');
  });

  test('auditoria positiva + prova positiva ⇒ STILL_PROVEN', () => {
    expect(classifyItem({ id: 'X', auditState: 'PASS', provenValues: proven }, 'GO').classification).toBe('STILL_PROVEN');
  });

  test('prova AUSENTE ⇒ UNPROVABLE (ausência de evidência nunca é aprovação)', () => {
    const result = classifyItem({ id: 'X', auditState: 'NO_GO', provenValues: proven }, null);
    expect(result.classification).toBe('UNPROVABLE');
    expect(result.detail).toMatch(/ausência de evidência/);
  });

  test('estado de impedimento externo ⇒ BLOCKED_EXTERNAL, nunca PASS', () => {
    const result = classifyItem(
      { id: 'X', auditState: 'NO_GO', provenValues: proven, blockedExternalValues: ['NOT_EXECUTED_NO_CREDENTIAL'] },
      'NOT_EXECUTED_NO_CREDENTIAL',
    );
    expect(result.classification).toBe('BLOCKED_EXTERNAL');
    expect(result.classification).not.toBe('ALREADY_FIXED');
  });

  test('um item NÃO resolvido derruba o status do conjunto (nada de média)', () => {
    const derived = deriveAuditItems({
      items: [
        { id: 'A', auditState: 'NO_GO', provenValues: proven, proof: { report: 'r', decisionPath: 'status' } },
        { id: 'B', auditState: 'NO_GO', provenValues: proven, proof: { report: 'r', decisionPath: 'status' } },
      ],
      readValue: (item) => (item.id === 'A' ? 'GREEN' : 'NO_GO'),
    });
    expect(derived.status).toBe('FAIL');
    expect(derived.unresolvedIds).toEqual(['B']);
    expect(derived.counts.ALREADY_FIXED).toBe(1);
  });

  test('leitura que explode é UNPROVABLE, não exceção não tratada', () => {
    const derived = deriveAuditItems({
      items: [{ id: 'A', auditState: 'NO_GO', provenValues: proven, proof: { report: 'r', decisionPath: 'status' } }],
      readValue: () => { throw new Error('relatório ilegível'); },
    });
    expect(derived.items[0].classification).toBe('UNPROVABLE');
  });
});

describe('audit-items — integridade do mapeamento', () => {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

  test('todo item declara PROVA (relatório+campo, ou suíte) e não tem status escrito à mão', () => {
    for (const item of config.items) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.auditState).toBe('string');
      expect(item.proof).toBeTruthy();
      if (item.proof.kind === 'suite') {
        expect(typeof item.proof.suite).toBe('string');
      } else {
        expect(typeof item.proof.report).toBe('string');
        expect(typeof item.proof.decisionPath).toBe('string');
      }
      // O mapeamento NÃO carrega o resultado: só a referência à prova.
      expect(item.status).toBeUndefined();
      expect(item.classification).toBeUndefined();
    }
  });

  test('nenhum id duplicado', () => {
    const ids = config.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('cobre os itens centrais citados pela missão', () => {
    const ids = new Set(config.items.map((item) => item.id));
    for (const esperado of [
      'TIMEOUT_ARCHITECTURE',
      'TASK_LEASE_NORMAL_RUNTIME',
      'TASK_LEASE_HEARTBEAT_RUNTIME',
      'FENCING_NORMAL_RUNTIME',
      'NO_PROGRESS_RUNTIME_INTEGRATION',
      'REAL_TASK_FULL_EXECUTION_RESUME',
      'ENGINEERING_RAG_TO_ENRICHER',
      'TIMEOUT_GATE_IN_V2_SEAL',
      'FINAL_GOVERNANCE_CONSISTENCY',
    ]) {
      expect(ids.has(esperado)).toBe(true);
    }
  });
});

describe('audit-items — CLI', () => {
  jest.setTimeout(60000);

  test('publica o relatório e aponta a numeração V2-01..V2-42 para a FONTE real (nunca inventada)', () => {
    const result = spawnSync(process.execPath, [CLI, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const report = JSON.parse(result.stdout);
    expect(report.report).toBe('ENGINEERING_ROUTER_V2_AUDIT_ITEMS');
    // A faixa continua DECLARADA — e agora aponta para o manifesto versionado que traz os 42
    // enunciados verbatim do prompt original (recuperado em 2026-09-28). Antes desta data o
    // status era NOT_MAPPED_BY_REPOSITORY: a numeração não tinha fonte em lugar nenhum.
    expect(report.legacyUnmapped.range).toBe('V2-01..V2-42');
    expect(report.legacyUnmapped.status).toBe('MAPPED_FROM_MISSION_PROMPT');
    expect(report.legacyUnmapped.manifest).toBe('config/engineering-router-v2-required-tests.json');
    expect(report.legacyUnmapped.gate).toBe('npm run validate:required-tests');
    expect(report.items.length).toBeGreaterThan(20);
    // Exit coerente com o status: FAIL nunca sai 0.
    expect(result.status).toBe(report.status === 'PASS' ? 0 : 1);
  });
});
