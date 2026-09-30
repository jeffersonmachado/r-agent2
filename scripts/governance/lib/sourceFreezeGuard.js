'use strict';

/**
 * scripts/governance/lib/sourceFreezeGuard.js — O SOURCE PRECISA ESTAR CONGELADO (núcleo PURO).
 *
 * DEFEITO REAL medido em 2026-09-30, após TRÊS execuções do selo V2: o selo coletava a evidência de
 * runtime, e alguns minutos depois a execução autoritativa falhava com `RUNTIME-EVIDENCE_UNAVAILABLE`
 * — porque o `sourceFingerprint` tinha mudado no meio do pipeline. A causa não estava no ciclo de
 * bug nem no binding: outra sessão estava COMMITANDO e EDITANDO o MESMO worktree durante a
 * certificação (`api/services/websocketService.js`, `reports/qwen-live-evidence.json`,
 * `tests/unit/websocketService.rateLimit.test.js`, mais dois commits entrando entre os passos).
 *
 * Um selo que depende de fingerprint de source é, por definição, incompatível com um source que se
 * move. Sem este guard, o efeito observado é o pior possível: falha APARENTEMENTE aleatória em um
 * passo diferente a cada tentativa, com mensagem que aponta para o subsistema errado — e a única
 * saída é repetir e torcer, que é exatamente o comportamento que a governança do repositório proíbe.
 *
 * Este módulo só COMPARA snapshots (sem I/O): quem lê git/fingerprint é o chamador.
 */

const CODES = Object.freeze({
  SOURCE_CHANGED_DURING_CERTIFICATION: 'SOURCE_CHANGED_DURING_CERTIFICATION',
  SOURCE_DIRTY_AT_START: 'SOURCE_DIRTY_AT_START',
});

/**
 * Captura um snapshot congelável do source.
 *
 * @param {{fingerprint?:string|null, commit?:string|null, dirtyFiles?:string[]}} [input]
 * @returns {{fingerprint:string|null, commit:string|null, dirtyFiles:string[]}}
 */
function captureFreeze({ fingerprint = null, commit = null, dirtyFiles = [] } = {}) {
  return {
    fingerprint: typeof fingerprint === 'string' && fingerprint.trim() !== '' ? fingerprint.trim() : null,
    commit: typeof commit === 'string' && commit.trim() !== '' ? commit.trim() : null,
    dirtyFiles: [...new Set((Array.isArray(dirtyFiles) ? dirtyFiles : []).map((f) => String(f).trim()).filter(Boolean))].sort(),
  };
}

/**
 * O source mudou entre dois snapshots? Devolve o MOTIVO nomeado, nunca um booleano solto — a
 * decisão do chamador (abortar o selo) depende de O QUE mudou, e a mensagem precisa levar o operador
 * ao trabalho concorrente em vez de ao subsistema errado.
 *
 * @param {object} before
 * @param {object} after
 * @returns {{ok:boolean, code:string|null, detail:string|null, changes:object|null}}
 */
function compareFreeze(before = {}, after = {}) {
  const fpChanged = Boolean(before.fingerprint && after.fingerprint && before.fingerprint !== after.fingerprint);
  const commitChanged = Boolean(before.commit && after.commit && before.commit !== after.commit);

  const beforeDirty = new Set(Array.isArray(before.dirtyFiles) ? before.dirtyFiles : []);
  const afterDirty = new Set(Array.isArray(after.dirtyFiles) ? after.dirtyFiles : []);
  const newDirtyFiles = [...afterDirty].filter((f) => !beforeDirty.has(f)).sort();
  const cleanedFiles = [...beforeDirty].filter((f) => !afterDirty.has(f)).sort();

  const changed = fpChanged || commitChanged || newDirtyFiles.length > 0 || cleanedFiles.length > 0;
  if (!changed) return { ok: true, code: null, detail: null, changes: null };

  const parts = [];
  if (fpChanged) parts.push(`sourceFingerprint mudou (${String(before.fingerprint).slice(0, 12)}… → ${String(after.fingerprint).slice(0, 12)}…)`);
  if (commitChanged) parts.push(`commit mudou (${String(before.commit).slice(0, 8)} → ${String(after.commit).slice(0, 8)})`);
  if (newDirtyFiles.length > 0) parts.push(`${newDirtyFiles.length} arquivo(s) passaram a estar modificados: ${newDirtyFiles.slice(0, 5).join(', ')}${newDirtyFiles.length > 5 ? ', …' : ''}`);
  if (cleanedFiles.length > 0) parts.push(`${cleanedFiles.length} arquivo(s) deixaram de estar modificados: ${cleanedFiles.slice(0, 5).join(', ')}`);

  return {
    ok: false,
    code: CODES.SOURCE_CHANGED_DURING_CERTIFICATION,
    detail: `${parts.join(' | ')} — a certificação exige o source CONGELADO: outra sessão/processo mexeu no mesmo worktree durante o selo`,
    changes: { fingerprintChanged: fpChanged, commitChanged, newDirtyFiles, cleanedFiles },
  };
}

/**
 * O source já começa sujo? Isso não invalida a certificação por si só (o worktree pode ter
 * pendências legítimas do operador), mas precisa ser DECLARADO: um selo que passa com fonte suja
 * não é o mesmo artefato de um selo que passa com fonte limpa.
 */
function assessInitialFreeze(freeze = {}) {
  const dirtyFiles = Array.isArray(freeze.dirtyFiles) ? freeze.dirtyFiles : [];
  if (dirtyFiles.length === 0) return { declared: false, code: null, detail: null, dirtyFiles: [] };
  return {
    declared: true,
    code: CODES.SOURCE_DIRTY_AT_START,
    detail: `selo iniciado com ${dirtyFiles.length} arquivo(s) modificados não commitados — o artefato certificado não corresponde a um commit puro`,
    dirtyFiles,
  };
}

module.exports = { CODES, captureFreeze, compareFreeze, assessInitialFreeze };
