'use strict';

/**
 * governance/bug-closure/transition-ledger.js — LIVRO APPEND-ONLY DE TRANSIÇÕES.
 *
 * MISSÃO P0 (2026-10-22). Sem um registro ordenado e encadeado, duas coisas ficam
 * impossíveis de provar: (a) que a transição declarada na prova REALMENTE aconteceu
 * (e não foi escrita à mão junto com o `state`); (b) que ninguém a repetiu, reordenou
 * ou reutilizou para outro defeito.
 *
 * Formato: JSONL (uma linha = um evento). Cada evento carrega `seq`, `prevHash` e `hash`,
 * formando um encadeamento SHA-256 independente do conteúdo do inventário. Qualquer
 * linha alterada, removida ou reordenada quebra o encadeamento e é detectada por
 * `verificarLivro`.
 *
 * Limite declarado (e intencional): o encadeamento prova INTEGRIDADE RELATIVA. Ele não
 * é âncora de autenticidade — quem pode reescrever o arquivo pode reescrever a cadeia
 * inteira. A autenticidade vem da assinatura Ed25519 da prova (`closure-proof.js`) por
 * autoridade registrada; por isso os dois mecanismos são verificados juntos e nunca
 * isolados.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GENESIS = '0'.repeat(64);
const REL_PADRAO = 'governance/bug-closure/transitions.log.jsonl';

const CODIGOS = Object.freeze({
  LIVRO_AUSENTE: 'LIVRO_AUSENTE',
  LIVRO_ILEGIVEL: 'LIVRO_ILEGIVEL',
  CADEIA_ROMPIDA: 'CADEIA_ROMPIDA',
  SEQ_FORA_DE_ORDEM: 'SEQ_FORA_DE_ORDEM',
  EVENTO_SEM_ID: 'EVENTO_SEM_ID',
  TRANSICAO_ID_DUPLICADO: 'TRANSICAO_ID_DUPLICADO',
});

const sha256 = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');

function caminhoDoLivro(rootDir, rel = REL_PADRAO) {
  return path.isAbsolute(rel) ? rel : path.join(rootDir || process.cwd(), rel);
}

/** Hash do evento (sem os campos derivados `prevHash`/`hash`). */
function hashDoEvento(evento) {
  const base = {
    seq: evento.seq,
    transitionId: evento.transitionId,
    defectId: evento.defectId,
    from: evento.from,
    to: evento.to,
    at: evento.at,
    actorId: evento.actorId,
    proofHash: evento.proofHash,
    evaluatedCommit: evento.evaluatedCommit,
  };
  return sha256(JSON.stringify(base));
}

/**
 * Lê e verifica o livro.
 * @returns {{eventos:Array, integridadeOk:boolean, problemas:string[], existe:boolean}}
 */
function verificarLivro(rootDir, rel = REL_PADRAO) {
  const abs = caminhoDoLivro(rootDir, rel);
  if (!fs.existsSync(abs)) {
    return { eventos: [], integridadeOk: true, problemas: [], existe: false };
  }
  let texto;
  try {
    texto = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { eventos: [], integridadeOk: false, problemas: [`${CODIGOS.LIVRO_ILEGIVEL}:${e.message}`], existe: true };
  }

  const eventos = [];
  const problemas = [];
  const vistos = new Set();
  let anterior = GENESIS;

  texto.split('\n').filter((l) => l.trim() !== '').forEach((linha, indice) => {
    let evento;
    try {
      evento = JSON.parse(linha);
    } catch (_) {
      problemas.push(`${CODIGOS.LIVRO_ILEGIVEL}:linha ${indice + 1}`);
      return;
    }
    eventos.push(evento);
    if (!evento.transitionId) problemas.push(`${CODIGOS.EVENTO_SEM_ID}:linha ${indice + 1}`);
    if (vistos.has(evento.transitionId)) problemas.push(`${CODIGOS.TRANSICAO_ID_DUPLICADO}:${evento.transitionId}`);
    vistos.add(evento.transitionId);
    if (Number(evento.seq) !== indice) problemas.push(`${CODIGOS.SEQ_FORA_DE_ORDEM}:${evento.transitionId}`);
    if (String(evento.prevHash) !== anterior) problemas.push(`${CODIGOS.CADEIA_ROMPIDA}:${evento.transitionId}`);
    const esperado = hashDoEvento(evento);
    if (String(evento.hash) !== esperado) problemas.push(`${CODIGOS.CADEIA_ROMPIDA}:hash:${evento.transitionId}`);
    anterior = String(evento.hash);
  });

  return { eventos, integridadeOk: problemas.length === 0, problemas, existe: true };
}

/**
 * Anexa um evento ao livro, de forma atômica (arquivo temporário + rename) e exclusiva
 * (lock por arquivo com O_EXCL). Recusa transição repetida.
 *
 * @param {object} entrada { rootDir, rel?, defectId, from, to, actorId, proofHash, evaluatedCommit, at? }
 * @returns {{ok:boolean, code:string|null, evento?:object, problemas?:string[]}}
 */
function anexarEvento(entrada = {}) {
  const rootDir = entrada.rootDir || process.cwd();
  const rel = entrada.rel || REL_PADRAO;
  const abs = caminhoDoLivro(rootDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const lock = `${abs}.lock`;
  let fdLock;
  try {
    fdLock = fs.openSync(lock, 'wx');
  } catch (_) {
    return { ok: false, code: 'LIVRO_BLOQUEADO', problemas: ['outro processo está anexando ao livro'] };
  }

  try {
    const estado = verificarLivro(rootDir, rel);
    if (!estado.integridadeOk) return { ok: false, code: CODIGOS.CADEIA_ROMPIDA, problemas: estado.problemas };
    if (estado.eventos.some((e) => e.transitionId === entrada.transitionId)) {
      return { ok: false, code: CODIGOS.TRANSICAO_ID_DUPLICADO, problemas: [entrada.transitionId] };
    }

    const seq = estado.eventos.length;
    const prevHash = seq === 0 ? GENESIS : String(estado.eventos[seq - 1].hash);
    const evento = {
      seq,
      transitionId: entrada.transitionId,
      defectId: entrada.defectId,
      from: entrada.from,
      to: entrada.to,
      at: entrada.at || new Date().toISOString(),
      actorId: entrada.actorId,
      proofHash: entrada.proofHash,
      evaluatedCommit: entrada.evaluatedCommit,
      prevHash,
    };
    evento.hash = hashDoEvento(evento);

    const tmp = `${abs}.tmp`;
    const anterior = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    fs.writeFileSync(tmp, `${anterior}${JSON.stringify(evento)}\n`, 'utf8');
    fs.renameSync(tmp, abs);
    return { ok: true, code: null, evento };
  } finally {
    try { fs.closeSync(fdLock); } catch (_) { /* já fechado */ }
    try { fs.rmSync(lock, { force: true }); } catch (_) { /* lock transitório */ }
  }
}

module.exports = {
  REL_PADRAO,
  CODIGOS,
  GENESIS,
  caminhoDoLivro,
  hashDoEvento,
  verificarLivro,
  anexarEvento,
};
