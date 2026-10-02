'use strict';

/**
 * engine/engineeringMission/governanceBaseline.js
 *
 * MANIFESTO DE CONTEÚDO DA AUTORIDADE DE GOVERNANÇA.
 *
 * GAP QUE ESTE MÓDULO FECHA (confirmado no código em 2026-10-02): o baseline de regras capturava os
 * scripts de `scripts/governance/` apenas pelo NOME (via `readdirSync`). O efeito é o furo mais
 * discreto possível: `scripts/governance/validate-x.js` continua existindo e continua na lista — só
 * que o CONTEÚDO dele mudou. Trocar
 *
 *     if (failure) return 'NO_GO';
 * por
 *     if (failure) return 'GO';
 *
 * dentro do arquivo não aparecia em lugar nenhum. Proteção por nome não protege nada.
 *
 * O QUE ESTE MÓDULO DECIDE:
 *
 *   1. Que cada arquivo autoritativo é identificado por `path` + `sha256` do CONTEÚDO + `size` +
 *      `classification`. Alterar o conteúdo muda o manifesto.
 *   2. Que o CONJUNTO de arquivos autoritativos não é uma lista manual: o diretório de gates É a
 *      lista (`scripts/governance/*.js`), então um gate NOVO passa a participar automaticamente do
 *      manifesto e um gate REMOVIDO aparece como remoção.
 *   3. Que nem toda mudança é igual. Enfraquecer um critério (`WEAKENING`) e REMOVER um artefato
 *      autoritativo (`STRUCTURAL_REMOVAL`) são violações de gravidade diferente — e ambas exigem
 *      aval humano explícito, nunca fechamento autônomo.
 *
 * Módulo PURO: recebe o manifesto atual (quem tem I/O monta), devolve o veredito. Sem `fs`, sem
 * relógio, sem aleatoriedade.
 */

/** Classificação de autoridade de um arquivo. Governa quais arquivos entram no manifesto. */
const FILE_CLASSIFICATIONS = Object.freeze({
  AUTHORITATIVE_GATE: 'AUTHORITATIVE_GATE',          // scripts/governance/*.js
  REQUIRED_TESTS_MANIFEST: 'REQUIRED_TESTS_MANIFEST', // config/*required-tests.json
  JUDGEMENT_POLICY: 'JUDGEMENT_POLICY',              // config/timeout-policy.json e afins
  TEST_HARNESS: 'TEST_HARNESS',                      // jest.config.cjs
  POLICY_CONFIG: 'POLICY_CONFIG',
});

/** Gravidade de uma violação de baseline, da mais leve à mais grave. */
const VIOLATION_SEVERITIES = Object.freeze(['NONE', 'WEAKENING', 'STRUCTURAL_REMOVAL']);
const VIOLATION_RANK = Object.freeze({ NONE: 0, WEAKENING: 1, STRUCTURAL_REMOVAL: 2 });

/** Códigos de veredito (vocabulário fechado). */
const BASELINE_CODES = Object.freeze({
  OK: null,
  WEAKENING: 'GOVERNANCE_BASELINE_VIOLATION',
  REMOVAL: 'GOVERNANCE_BASELINE_STRUCTURAL_REMOVAL',
  UNVERIFIED: 'GOVERNANCE_BASELINE_UNVERIFIED',
  HUMAN_AUTHORIZED: 'GOVERNANCE_BASELINE_HUMAN_AUTHORIZED',
});

/**
 * Classifica um caminho pela sua função na cadeia de decisão.
 *
 * A regra é derivada do CAMINHO/NOME (não de uma tabela mantida à mão): qualquer `.js` em
 * `scripts/governance/` é um gate autoritativo — inclusive os que ainda não existem hoje.
 */
function classifyAuthorityFile(relPath) {
  const p = String(relPath || '').replace(/\\+/g, '/').replace(/^\.\//, '').trim();
  if (p === '') return null;
  if (p.startsWith('scripts/governance/') && p.endsWith('.js')) return FILE_CLASSIFICATIONS.AUTHORITATIVE_GATE;
  if (p.startsWith('scripts/governance/') && p.endsWith('.sh')) return FILE_CLASSIFICATIONS.AUTHORITATIVE_GATE;
  if (/^config\/.*required-tests\.json$/.test(p)) return FILE_CLASSIFICATIONS.REQUIRED_TESTS_MANIFEST;
  if (/^config\/.*(policy|criticality|baseline).*\.json$/.test(p)) return FILE_CLASSIFICATIONS.JUDGEMENT_POLICY;
  if (p === 'jest.config.cjs' || p === 'jest.config.js') return FILE_CLASSIFICATIONS.TEST_HARNESS;
  if (p.startsWith('config/') && p.endsWith('.json')) return FILE_CLASSIFICATIONS.POLICY_CONFIG;
  return null;
}

/** Um arquivo autoritativo? (usado para descobrir o conjunto a partir de caminhos candidatos.) */
function isAuthorityFile(relPath) {
  return classifyAuthorityFile(relPath) !== null;
}

/**
 * Monta o manifesto a partir de entradas lidas do disco.
 *
 * `entries`: `[{ path, sha256, size }]`. O manifesto inclui APENAS arquivos classificáveis como
 * autoritativos — o conjunto não é escolhido à mão, é DERIVADO da classificação.
 */
function buildContentManifest(entries = []) {
  const files = {};
  const skipped = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const rel = String((entry && entry.path) || '').replace(/\\+/g, '/').replace(/^\.\//, '').trim();
    if (rel === '') continue;
    const classification = classifyAuthorityFile(rel);
    if (!classification) {
      skipped.push(rel);
      continue;
    }
    files[rel] = {
      sha256: entry.sha256 || 'ABSENT',
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : null,
      classification,
    };
  }
  return { version: 1, files, skipped };
}

/**
 * Diferença entre dois manifestos de conteúdo.
 *
 * `added` merece atenção especial: um gate NOVO que passa a participar da cadeia de decisão é
 * exatamente o caso que uma lista manual deixaria escapar.
 */
function diffContentManifest(baseline = {}, current = {}) {
  const before = (baseline && baseline.files) || {};
  const after = (current && current.files) || {};

  const removed = Object.keys(before).filter((p) => !(p in after));
  const added = Object.keys(after).filter((p) => !(p in before));
  const modified = Object.keys(before).filter((p) => {
    if (!(p in after)) return false;
    return String(before[p] && before[p].sha256) !== String(after[p] && after[p].sha256);
  });

  return {
    removed,
    added,
    modified,
    // Detalhe auditável: o que mudou, de qual hash para qual hash, e o que isso significa.
    modifiedDetail: modified.map((p) => ({
      path: p,
      classification: (after[p] && after[p].classification) || (before[p] && before[p].classification) || null,
      fromSize: before[p] ? before[p].size : null,
      toSize: after[p] ? after[p].size : null,
      from: String(before[p] && before[p].sha256).slice(0, 16),
      to: String(after[p] && after[p].sha256).slice(0, 16),
    })),
    removedDetail: removed.map((p) => ({
      path: p, classification: (before[p] && before[p].classification) || null, sha256: String(before[p] && before[p].sha256).slice(0, 16),
    })),
    addedDetail: added.map((p) => ({
      path: p, classification: (after[p] && after[p].classification) || null, sha256: String(after[p] && after[p].sha256).slice(0, 16),
    })),
    changed: removed.length > 0 || added.length > 0 || modified.length > 0,
  };
}

/**
 * Veredito do baseline com GRAVIDADE.
 *
 *   - remover um arquivo autoritativo OU modificar um manifesto de testes obrigatórios é
 *     STRUCTURAL_REMOVAL (o pior caso: o artefato que provava deixou de provar);
 *   - qualquer outra modificação de conteúdo é WEAKENING (o critério continua existindo, mas mudou
 *     dentro do arquivo — a forma mais discreta de afrouxar);
 *   - um gate NOVO é sinalizado como `added` e exige revisão: ele passa a participar da decisão.
 *
 * AVAL HUMANO: nenhuma das duas severidades é resolvida pelo próprio sistema. Se houver autorização
 * humana explícita e legítima (`assessApprovalAuthority`), o veredito é declarado como autorizado —
 * nunca aceito em silêncio.
 */
function assessBaselineIntegrity({ baseline = null, current = null, humanAuthorization = null } = {}) {
  if (!baseline || !baseline.files) {
    return {
      ok: false,
      code: BASELINE_CODES.UNVERIFIED,
      severity: 'STRUCTURAL_REMOVAL',
      reason: 'sem baseline de conteúdo capturado antes da correção — não há como provar que o critério não foi afrouxado',
      diff: null,
    };
  }

  const diff = diffContentManifest(baseline, current || {});

  if (!diff.changed) {
    return {
      ok: true,
      code: BASELINE_CODES.OK,
      severity: 'NONE',
      reason: `conteúdo dos ${Object.keys(baseline.files).length} arquivos autoritativos inalterado (hash a hash)`,
      diff,
    };
  }

  // Remoção de arquivo autoritativo ou alteração em manifesto de testes obrigatórios: o artefato que
  // PROVA deixou de existir/tem outra forma. É a violação mais grave.
  const structural = diff.removed.length > 0
    || diff.modified.some((p) => ((diff.modifiedDetail.find((d) => d.path === p) || {}).classification) === FILE_CLASSIFICATIONS.REQUIRED_TESTS_MANIFEST);

  const severity = structural ? 'STRUCTURAL_REMOVAL' : 'WEAKENING';
  const code = structural ? BASELINE_CODES.REMOVAL : BASELINE_CODES.WEAKENING;

  if (humanAuthorization && humanAuthorization.allowed === true) {
    return {
      ok: true,
      code: BASELINE_CODES.HUMAN_AUTHORIZED,
      severity,
      authorized: true,
      reason: `mudança nas regras de julgamento com aval humano explícito (${humanAuthorization.actor || 'humano'}) — alteração declarada, não silenciosa`,
      diff,
      authorization: humanAuthorization,
    };
  }

  return {
    ok: false,
    code,
    severity,
    reason: structural
      ? 'artefato autoritativo de governança REMOVIDO ou manifesto de testes obrigatórios alterado — a prova deixou de provar; exige aval humano explícito'
      : 'o CONTEÚDO de um artefato autoritativo mudou (hash diferente) — enfraquecer um critério dentro de um arquivo que continua existindo é a forma mais discreta de afrouxar; exige aval humano explícito',
    diff,
  };
}

/** Uma severidade é mais grave que outra? (ordenação explícita, nunca string.) */
function isMoreSevere(a, b) {
  return (VIOLATION_RANK[String(a).toUpperCase()] || 0) > (VIOLATION_RANK[String(b).toUpperCase()] || 0);
}

module.exports = {
  FILE_CLASSIFICATIONS,
  VIOLATION_SEVERITIES,
  VIOLATION_RANK,
  BASELINE_CODES,
  classifyAuthorityFile,
  isAuthorityFile,
  buildContentManifest,
  diffContentManifest,
  assessBaselineIntegrity,
  isMoreSevere,
};
