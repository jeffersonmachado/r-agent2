'use strict';

/**
 * transition-journal.js — diário (WAL) das operações de fechamento.
 *
 * POR QUE EXISTE (missão Codex, A4)
 * ---------------------------------
 * `applyTransition`/`applyAttestation` mutavam TRÊS artefatos (livro append-only, arquivo de
 * prova e fila) em sequência, sem registro de intenção. Uma falha no meio deixava estado
 * parcial — evento sem prova, prova sem fila, fila sem prova — e nada detectava. Pior: duas
 * operações concorrentes podiam sobrescrever a fila uma da outra (lost update), porque a
 * escrita era `writeFileSync` cego sobre o arquivo inteiro.
 *
 * MODELO (fail-closed, append-only preservado)
 * -------------------------------------------
 *   1. `iniciar()` grava `INTENT` com a base (hash da fila e do livro ANTES de mutar) e o
 *      efeito planejado. Nada foi mutado ainda.
 *   2. as mutações acontecem (livro → prova → fila), cada uma verificada contra a base;
 *   3. `marcarCommit()` grava `COMMITTED` — só então a operação é considerada concluída;
 *   4. qualquer falha depois do `INTENT` grava `ABORTED` com o motivo REAL.
 *
 * `recuperar()` reconcilia o diário com o disco de forma DETERMINÍSTICA e devolve o que
 * ficou pendente. Operação pendente ou abortada com efeito parcial torna a certificação
 * inelegível: o livro NUNCA é truncado para "desfazer" — o diário é a autoridade.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR_JORNAL = path.join('governance', 'bug-closure', 'journal');

const ESTADOS_JORNAL = Object.freeze({
  INTENT: 'INTENT',
  COMMITTED: 'COMMITTED',
  ABORTED: 'ABORTED',
});

const sha256Texto = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const sha256Arquivo = (abs) => (fs.existsSync(abs) ? sha256Texto(fs.readFileSync(abs, 'utf8')) : null);
const caminhoJornal = (rootDir) => path.join(rootDir, DIR_JORNAL);

function caminhoIntent(rootDir, transitionId) {
  return path.join(caminhoJornal(rootDir), `${transitionId}.json`);
}

/** Hash da fila/livro no instante anterior à mutação: base da detecção de lost update. */
function baseAtual(rootDir, queuePath, livroAbs) {
  return {
    queueHash: sha256Arquivo(queuePath),
    ledgerHash: sha256Arquivo(livroAbs),
  };
}

/**
 * Grava a INTENÇÃO. Precisa ser a primeira escrita da operação.
 * @returns {{ok:boolean, erro?:string, intent?:object}}
 */
function iniciar(rootDir, entrada = {}) {
  const dir = caminhoJornal(rootDir);
  fs.mkdirSync(dir, { recursive: true });
  const intent = {
    transitionId: entrada.transitionId,
    defectId: entrada.defectId,
    kind: entrada.kind, // TRANSITION | ATTESTATION
    from: entrada.from,
    to: entrada.to,
    proofRel: entrada.proofRel || null,
    proofHash: entrada.proofHash || null,
    queuePath: path.relative(rootDir, entrada.queuePath),
    ledgerRel: entrada.ledgerRel || null,
    base: entrada.base || null,
    status: ESTADOS_JORNAL.INTENT,
    startedAt: new Date(entrada.agora || Date.now()).toISOString(),
  };
  try {
    fs.writeFileSync(caminhoIntent(rootDir, entrada.transitionId), `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
    return { ok: true, intent };
  } catch (e) {
    return { ok: false, erro: `JOURNAL_INTENT_FALHOU:${e.message}` };
  }
}

function atualizarStatus(rootDir, transitionId, status, extra = {}) {
  const abs = caminhoIntent(rootDir, transitionId);
  if (!fs.existsSync(abs)) return { ok: false, erro: 'JOURNAL_INTENT_AUSENTE' };
  try {
    const atual = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const novo = { ...atual, ...extra, status, updatedAt: new Date().toISOString() };
    const tmp = `${abs}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(novo, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, abs);
    return { ok: true, intent: novo };
  } catch (e) {
    return { ok: false, erro: `JOURNAL_UPDATE_FALHOU:${e.message}` };
  }
}

const marcarCommit = (rootDir, transitionId, extra = {}) => atualizarStatus(rootDir, transitionId, ESTADOS_JORNAL.COMMITTED, extra);
const marcarAborto = (rootDir, transitionId, motivo, extra = {}) => atualizarStatus(rootDir, transitionId, ESTADOS_JORNAL.ABORTED, { motivo, ...extra });

/** Lê o diário inteiro (ordem determinística por `startedAt` + `transitionId`). */
function lerIntents(rootDir) {
  const dir = caminhoJornal(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch (_) {
        return { transitionId: f.replace(/\.json$/, ''), status: ESTADOS_JORNAL.INTENT, corrompido: true };
      }
    })
    .sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || ''))
      || String(a.transitionId).localeCompare(String(b.transitionId)));
}

/**
 * Reconcilia o diário com o disco. Determinístico e somente leitura do ponto de vista da
 * fila/livro (nunca trunca o livro append-only).
 *
 * Classificação por intent NÃO commitada:
 *  - `EFEITO_COMPLETO`   — evento no livro + prova no disco + fila reflete o efeito → vira COMMITTED;
 *  - `SEM_EFEITO`        — nada foi aplicado → vira ABORTED, estado governado intacto;
 *  - `EFEITO_PARCIAL`    — algo foi aplicado e algo não → fica PENDENTE (inelegível) e é reportado.
 */
function recuperar(rootDir, opcoes = {}) {
  const queuePath = opcoes.queuePath || path.join(rootDir, 'AI_MEMORY', 'hardening-queue.json');
  const livroRel = opcoes.livroRel || path.join('governance', 'bug-closure', 'transitions.log.jsonl');
  const livroAbs = path.join(rootDir, livroRel);

  const linhas = fs.existsSync(livroAbs)
    ? fs.readFileSync(livroAbs, 'utf8').split('\n').filter((l) => l.trim() !== '')
    : [];
  const eventos = linhas.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  const fila = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf8')) : { items: [] };

  const completados = [];
  const abortados = [];
  const pendentes = [];

  for (const intent of lerIntents(rootDir)) {
    const evento = eventos.find((e) => e && e.transitionId === intent.transitionId) || null;
    const temProva = Boolean(intent.proofRel);
    const provaOk = temProva ? fs.existsSync(path.join(rootDir, intent.proofRel)) : false;
    const item = (fila.items || []).find((i) => i && i.id === intent.defectId) || null;
    const filaAplicada = item
      ? (intent.kind === 'ATTESTATION'
        ? String(item.attestationId || '') === String(intent.transitionId)
        : String(item.state || '').toUpperCase() === String(intent.to).toUpperCase())
      : false;
    const efeitos = [Boolean(evento), provaOk, filaAplicada].filter(Boolean).length;
    const efeitosEsperados = temProva ? 3 : 2;

    if (intent.status === ESTADOS_JORNAL.ABORTED) {
      // ABORTADA **com efeito no livro** é efeito parcial: o append é irreversível (o livro é
      // append-only e não se trunca). Fica reportada e mantém a certificação negada até
      // recuperação canônica — nunca é "abortada, portanto sem efeito".
      if (evento) {
        pendentes.push({
          transitionId: intent.transitionId, defectId: intent.defectId,
          evento: true, prova: provaOk, fila: filaAplicada, motivo: intent.motivo || null, status: intent.status,
        });
      }
      continue;
    }
    if (intent.status !== ESTADOS_JORNAL.INTENT) continue;

    if (efeitos === efeitosEsperados) {
      marcarCommit(rootDir, intent.transitionId, { recuperado: true, recuperadoEm: new Date().toISOString() });
      completados.push(intent.transitionId);
    } else if (efeitos === 0) {
      marcarAborto(rootDir, intent.transitionId, 'RECUPERACAO_SEM_EFEITO', { recuperado: true });
      abortados.push(intent.transitionId);
    } else {
      pendentes.push({
        transitionId: intent.transitionId, defectId: intent.defectId,
        evento: Boolean(evento), prova: provaOk, fila: filaAplicada, status: intent.status,
      });
    }
  }

  return {
    completados,
    abortados,
    pendentes,
    ok: pendentes.length === 0,
    // Operação pendente com efeito parcial: certificação tem de permanecer negada.
    bloqueiaCertificacao: pendentes.length > 0,
  };
}

/**
 * Há operação não reconciliada que impede certificação?
 * Inclui INTENT (em andamento/interrompida) e ABORTED **com evento no livro** (efeito parcial
 * irreversível). ABORTED sem efeito não bloqueia: nada foi aplicado.
 */
function haOperacaoPendente(rootDir, opcoes = {}) {
  const livroRel = opcoes.livroRel || path.join('governance', 'bug-closure', 'transitions.log.jsonl');
  const abs = path.join(rootDir, livroRel);
  const eventos = fs.existsSync(abs)
    ? fs.readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean)
    : [];
  return lerIntents(rootDir).some((i) => {
    if (i.status === ESTADOS_JORNAL.INTENT) return true;
    if (i.status === ESTADOS_JORNAL.ABORTED) return eventos.some((e) => e && e.transitionId === i.transitionId);
    return false;
  });
}

module.exports = {
  DIR_JORNAL,
  ESTADOS_JORNAL,
  iniciar,
  marcarCommit,
  marcarAborto,
  lerIntents,
  recuperar,
  haOperacaoPendente,
  baseAtual,
  sha256Arquivo,
  caminhoIntent,
};
