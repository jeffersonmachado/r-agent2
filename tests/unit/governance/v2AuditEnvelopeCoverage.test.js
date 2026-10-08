'use strict';

/**
 * tests/unit/governance/v2AuditEnvelopeCoverage.test.js
 *
 * PROVA REAL DOS REQUISITOS V2-37, V2-38 e V2-39.
 *
 * DEFEITO QUE ESTA SUÍTE ELIMINA (medido 2026-10-08): os três requisitos —
 *   V2-37 "Audit envelope inclui Mission Compiler."
 *   V2-38 "Audit envelope inclui approval/autoapproval."
 *   V2-39 "Audit envelope inclui Qwen status correto."
 * declaravam como ÚNICA prova `tests/integration/engineeringRouterAuditEnvelopeGeneration.test.js`,
 * um teste do envelope do Router V1 que NÃO menciona Mission Compiler, approval nem Qwen (grep: 0
 * ocorrências). Três requisitos selados sem prova real do que enunciam.
 *
 * O QUE ESTA SUÍTE VERIFICA: que a cobertura de auditoria dessas três capacidades existe, aponta
 * para uma prova RESOLVÍVEL e — quando a prova é uma suíte — que essa suíte realmente EXECUTA na
 * execução autoritativa. Uma prova `kind: suite` cuja suíte nunca roda é indistinguível de ausência
 * de prova: o item ficaria UNPROVABLE para sempre sem que nada acusasse.
 *
 * NÃO executa o validador (`validate-engineering-router-v2-audit-items.js`) como subprocesso de
 * propósito: ele regrava `reports/engineering-router-v2-audit-items-report.json`, e escrever em
 * `reports/` a partir de um teste sujaria a árvore durante a selagem (há gate de worktree limpo).
 * Em vez disso, a suíte lê a DECLARAÇÃO e cobra dela as propriedades que a tornam verificável.
 */

const fs = require('fs');
const path = require('path');

const { resolveManifest } = require('../../../scripts/governance/lib/releaseSuiteManifest');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const AUDIT_ITEMS_REL = 'config/engineering-router-v2-audit-items.json';
const SEAL_REL = 'scripts/governance/engineering-router-v2-seal.js';
const AUDIT_ITEMS_REPORT_REL = 'reports/engineering-router-v2-audit-items-report.json';

const auditItemsConfig = JSON.parse(fs.readFileSync(path.join(ROOT, AUDIT_ITEMS_REL), 'utf8'));
const itens = auditItemsConfig.items || [];
const provenValues = auditItemsConfig.provenValuesDefault || [];

/** Capacidades exigidas pelos três requisitos, mapeadas ao item de auditoria que as cobre. */
const COBERTURA_EXIGIDA = Object.freeze([
  { requisito: 'V2-37', capacidade: 'Mission Compiler', itemId: 'MISSION_COMPILER_LEASE_RUNTIME' },
  { requisito: 'V2-38', capacidade: 'approval/autoapproval', itemId: 'MISSION_APPROVAL' },
  { requisito: 'V2-39', capacidade: 'Qwen status', itemId: 'QWEN_STRUCTURAL' },
]);

/** Tipos de prova que o validador da auditoria sabe resolver (ver resolveObservedValue). */
const KINDS_RESOLVIVEIS = Object.freeze(['suite', 'report']);

function itemPorId(id) {
  return itens.find((i) => i && i.id === id) || null;
}

/** Segue um caminho pontuado (`verdicts.LEASE`) dentro de um objeto. */
function readPath(objeto, pontuado) {
  if (!objeto || !pontuado) return undefined;
  return String(pontuado).split('.').reduce(
    (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
    objeto,
  );
}

/**
 * Resolve a prova declarada por um item. Devolve `{ok, code, detail}` — `code` explica a recusa,
 * nunca um booleano solto: a razão da reprovação é o que torna o diagnóstico possível.
 *
 * @param {Object} item item de auditoria com `proof`
 * @param {string[]} authoritative suítes do manifesto de release (o que REALMENTE executa)
 */
function resolverProva(item, authoritative) {
  const proof = (item && item.proof) || null;
  if (!proof || !proof.kind) return { ok: false, code: 'PROOF_UNDECLARED' };
  if (!KINDS_RESOLVIVEIS.includes(proof.kind)) {
    return { ok: false, code: 'PROOF_KIND_UNSUPPORTED', detail: proof.kind };
  }

  if (proof.kind === 'suite') {
    const rel = proof.suite;
    if (!rel) return { ok: false, code: 'PROOF_SUITE_UNDECLARED' };
    if (!fs.existsSync(path.join(ROOT, rel))) return { ok: false, code: 'PROOF_SUITE_MISSING', detail: rel };
    // Prova por suíte só vale se a suíte EXECUTA: fora do manifesto autoritativo ela nunca roda.
    if (!authoritative.includes(rel)) return { ok: false, code: 'PROOF_SUITE_NOT_AUTHORITATIVE', detail: rel };
    return { ok: true, code: null, detail: `suite ${rel}` };
  }

  const rel = proof.report;
  if (!rel) return { ok: false, code: 'PROOF_REPORT_UNDECLARED' };
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return { ok: false, code: 'PROOF_REPORT_MISSING', detail: rel };

  let relatorio;
  try {
    relatorio = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return { ok: false, code: 'PROOF_REPORT_UNREADABLE', detail: `${rel}: ${err.message}` };
  }

  let observado;
  if (proof.itemId) {
    const lista = readPath(relatorio, proof.itemsPath || 'items') || [];
    const achado = (Array.isArray(lista) ? lista : []).find((e) => e && e.id === proof.itemId);
    if (!achado) return { ok: false, code: 'PROOF_ITEM_ABSENT', detail: proof.itemId };
    observado = readPath(achado, proof.decisionPath || 'status');
  } else {
    observado = readPath(relatorio, proof.decisionPath);
  }

  if (observado === undefined || observado === null) {
    return { ok: false, code: 'PROOF_VALUE_UNRESOLVED', detail: `${rel}#${proof.decisionPath}` };
  }
  if (!provenValues.includes(observado)) {
    return { ok: false, code: 'PROOF_VALUE_NOT_PROVEN', detail: String(observado) };
  }
  return { ok: true, code: null, detail: `${rel}#${proof.decisionPath}=${observado}` };
}

describe('V2-37/38/39 — cobertura de auditoria REAL para Mission Compiler, approval e Qwen', () => {
  const manifest = resolveManifest();

  test('a prova declarada NÃO pode ser o teste do envelope do Router V1 (prova alheia ao enunciado)', () => {
    // Defeito medido: os três requisitos apontavam para
    // `tests/integration/engineeringRouterAuditEnvelopeGeneration.test.js`, que não menciona
    // Mission Compiler, approval nem Qwen. Este teste guarda a correção contra regressão.
    const manifestConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/engineering-router-v2-required-tests.json'), 'utf8'));
    const provaAlheia = 'tests/integration/engineeringRouterAuditEnvelopeGeneration.test.js';

    for (const { requisito } of COBERTURA_EXIGIDA) {
      const entrada = manifestConfig.requiredTests.find((t) => t.id === requisito);
      expect(entrada).toBeDefined();
      expect(entrada.suites).not.toContain(provaAlheia);
      // E precisa apontar para ESTA suíte, que verifica o enunciado de verdade.
      expect(entrada.suites).toContain('tests/unit/governance/v2AuditEnvelopeCoverage.test.js');
    }
  });

  test.each(COBERTURA_EXIGIDA)('$requisito ($capacidade): coberto por $itemId com prova resolvível', ({ itemId, capacidade }) => {
    const item = itemPorId(itemId);
    expect(item).not.toBeNull();

    const resolvido = resolverProva(item, manifest.authoritative);
    // A mensagem carrega o MOTIVO real da recusa quando falha.
    expect({ id: itemId, capacidade, ...resolvido }).toMatchObject({ ok: true });
  });

  test('a cobertura é ENFORÇADA na selagem: o passo de auditoria existe e produz o relatório', () => {
    const seal = fs.readFileSync(path.join(ROOT, SEAL_REL), 'utf8');

    // Sem o passo no selo, a cobertura seria apenas config — existir em arquivo e não ser consumido
    // é indistinguível de não existir.
    expect(seal).toContain('validate-engineering-router-v2-audit-items.js');
    expect(seal).toContain(AUDIT_ITEMS_REPORT_REL);
  });

  test('os três itens declaram estado de auditoria comparável (a classificação não é vazia)', () => {
    for (const { itemId } of COBERTURA_EXIGIDA) {
      const item = itemPorId(itemId);
      expect(typeof item.auditState).toBe('string');
      expect(item.auditState.length).toBeGreaterThan(0);
    }
  });

  test('ANTI-VACUIDADE: o resolvedor RECUSA prova ausente, tipo desconhecido, suíte fora do autoritativo e valor não provado', () => {
    const authoritativoFalso = ['tests/unit/existe.test.js'];

    // Prova não declarada.
    expect(resolverProva({ id: 'X' }, authoritativoFalso).code).toBe('PROOF_UNDECLARED');

    // Tipo que o validador não sabe resolver.
    expect(resolverProva({ id: 'X', proof: { kind: 'achismo' } }, authoritativoFalso).code)
      .toBe('PROOF_KIND_UNSUPPORTED');

    // Suíte que existe mas NÃO executa no autoritativo — o caso que deixaria o item UNPROVABLE.
    expect(resolverProva(
      { id: 'X', proof: { kind: 'suite', suite: 'tests/unit/engineeringMissionRbac.test.js' } },
      [],
    ).code).toBe('PROOF_SUITE_NOT_AUTHORITATIVE');

    // Relatório declarado que não existe no disco.
    expect(resolverProva(
      { id: 'X', proof: { kind: 'report', report: 'reports/nao-existe-mesmo.json', decisionPath: 'status' } },
      authoritativoFalso,
    ).code).toBe('PROOF_REPORT_MISSING');

    // Relatório real cujo decisionPath resolve para valor NÃO provado (prova negativa de verdade).
    const naoProvado = resolverProva(
      { id: 'X', proof: { kind: 'report', report: AUDIT_ITEMS_REPORT_REL, decisionPath: 'statusQueNaoExiste' } },
      authoritativoFalso,
    );
    expect(naoProvado.ok).toBe(false);
    expect(['PROOF_REPORT_MISSING', 'PROOF_VALUE_UNRESOLVED']).toContain(naoProvado.code);
  });
});
