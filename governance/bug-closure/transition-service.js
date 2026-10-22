'use strict';

/**
 * governance/bug-closure/transition-service.js — ÚNICA API AUTORITATIVA DE TRANSIÇÃO.
 *
 * MISSÃO P0 (2026-10-22). A fila `AI_MEMORY/hardening-queue.json` é PROJEÇÃO auditável,
 * não autoridade: qualquer processo com escrita no arquivo podia mudar `state` e liberar
 * certificação. Este serviço é o caminho canônico para fechar/reabrir um defeito:
 *
 *   1. lê o estado DECLARADO da fila (e exige que seja o esperado — concorrência otimista);
 *   2. valida a transição na máquina de estados (`defect-states.validarTransicao`);
 *   3. para fechamento, exige PROVA verificada (SHA atual, fingerprint, testes reais com
 *      exit 0, artefatos com hash conferido, livro de transições e assinatura Ed25519 de
 *      autoridade registrada com `mayCloseDefects`);
 *   4. anexa o evento ao livro append-only ANTES de tocar a projeção (se a projeção falhar,
 *      o evento fica sem consumidor e a próxima leitura recusa por falta de prova);
 *   5. grava a fila de forma atômica (tmp + rename) sob lock exclusivo;
 *   6. reavalia a elegibilidade e devolve a decisão — nunca "declara sucesso" sem ela.
 *
 * O serviço NÃO cria prova sozinho, NÃO assina e NÃO promove nada por conveniência.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ESTADOS, validarTransicao } = require('./defect-states');
const { verificarProvaDeFechamento, hashDoPayload } = require('./closure-proof');
const { anexarEvento, verificarLivro } = require('./transition-ledger');

const CODIGOS = Object.freeze({
  DEFEITO_AUSENTE: 'DEFEITO_AUSENTE',
  ESTADO_DIVERGENTE: 'ESTADO_DIVERGENTE',
  TRANSICAO_RECUSADA: 'TRANSICAO_RECUSADA',
  PROVA_RECUSADA: 'PROVA_RECUSADA',
  FILA_ILEGIVEL: 'FILA_ILEGIVEL',
  FILA_OCUPADA: 'FILA_OCUPADA',
  ESCRITA_FALHOU: 'ESCRITA_FALHOU',
});

const ESTADOS_FECHADOS = Object.freeze([ESTADOS.VERIFIED, ESTADOS.RESOLVED]);
const STATUS_CANONICO = Object.freeze({
  [ESTADOS.OPEN]: 'pending',
  [ESTADOS.REPRODUCED]: 'failed',
  [ESTADOS.FIX_IN_PROGRESS]: 'in_progress',
  [ESTADOS.FIXED_PENDING_VERIFICATION]: 'ready_for_approval',
  [ESTADOS.VERIFIED]: 'verified',
  [ESTADOS.RESOLVED]: 'prevention_active',
  [ESTADOS.BLOCKED_EXTERNAL]: 'blocked_external',
  [ESTADOS.RISK_ACCEPTED]: 'blocked_external',
});

/**
 * Executa uma transição canônica.
 *
 * @param {object} entrada
 * @param {string} entrada.rootDir
 * @param {string} entrada.queuePath
 * @param {string} entrada.defectId
 * @param {string} entrada.to             estado destino
 * @param {string} [entrada.fromExpected] estado declarado esperado (concorrência otimista)
 * @param {object} [entrada.proof]        prova completa (obrigatória para fechamento)
 * @param {object} [entrada.actor]        { id, kind }
 * @param {string} [entrada.currentCommit]
 * @param {string} [entrada.currentFingerprint]
 * @param {object} [entrada.autoridades]  registro injetável (testes)
 * @param {string} [entrada.livroPath]
 * @param {string} [entrada.proofsPath]   onde gravar a prova aceita
 * @param {boolean} [entrada.dryRun]
 * @param {number} [entrada.agora]
 * @returns {{ok:boolean, code:string|null, reasons:string[], decisao?:object, evento?:object}}
 */
function applyTransition(entrada = {}) {
  const rootDir = entrada.rootDir || path.resolve(__dirname, '..', '..');
  const queuePath = entrada.queuePath || path.join(rootDir, 'AI_MEMORY', 'hardening-queue.json');
  const livroPath = entrada.livroPath;
  const aguardar = [];

  if (!fs.existsSync(queuePath)) return { ok: false, code: CODIGOS.FILA_ILEGIVEL, reasons: ['fila ausente'] };
  let fila;
  try {
    fila = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch (e) {
    return { ok: false, code: CODIGOS.FILA_ILEGIVEL, reasons: [e.message] };
  }
  const itens = Array.isArray(fila.items) ? fila.items : null;
  if (!itens) return { ok: false, code: CODIGOS.FILA_ILEGIVEL, reasons: ['sem array items'] };

  const indice = itens.findIndex((i) => i && i.id === entrada.defectId);
  if (indice < 0) return { ok: false, code: CODIGOS.DEFEITO_AUSENTE, reasons: [String(entrada.defectId)] };
  const item = itens[indice];
  const estadoDeclarado = String(item.state || '').toUpperCase();
  if (entrada.fromExpected && estadoDeclarado !== String(entrada.fromExpected).toUpperCase()) {
    return { ok: false, code: CODIGOS.ESTADO_DIVERGENTE, reasons: [`esperado ${entrada.fromExpected}, persistido ${estadoDeclarado}`] };
  }

  const to = String(entrada.to || '').toUpperCase();
  const transicao = validarTransicao({
    de: estadoDeclarado,
    para: to,
    severity: item.severity,
    regressionTest: entrada.regressionTest
      || (entrada.proof && (entrada.proof.requiredTests || [])[0])
      || item.regressionTest,
    evidence: entrada.proof ? 'governance/bug-closure/proofs' : item.evidence,
    verificationCommit: entrada.proof ? entrada.proof.evaluatedCommit : item.verificationCommit,
    currentCommit: entrada.currentCommit,
  });
  if (!transicao.ok) {
    return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: transicao.reasons || [] };
  }

  // Fechamento exige prova verificada. A fila sozinha nunca fecha nada.
  if (ESTADOS_FECHADOS.includes(to)) {
    if (!entrada.proof) return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['PROVA_DE_FECHAMENTO_AUSENTE'] };
    const veredito = verificarProvaDeFechamento(entrada.proof, {
      defeito: { id: item.id, severity: item.severity, state: estadoDeclarado },
      currentCommit: entrada.currentCommit,
      currentFingerprint: entrada.currentFingerprint,
      rootDir,
      autoridades: entrada.autoridades,
      // Criação: o evento ainda NÃO existe (é anexado abaixo) — `null` desliga só esta
      // checagem. O append recusa transitionId duplicado, então replay continua bloqueado.
      livro: entrada.livro === undefined ? null : entrada.livro,
      agora: entrada.agora,
      existeArquivo: (rel) => fs.existsSync(path.join(rootDir, rel)),
    });
    if (!veredito.ok) return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: veredito.reasons };
  }

  if (entrada.dryRun) return { ok: true, code: null, reasons: [], evento: null };

  // 1) evento no livro (autoridade da ORDEM); recusa duplicação/replay.
  const evento = anexarEvento({
    rootDir,
    rel: livroPath,
    transitionId: entrada.proof ? entrada.proof.transitionId : crypto.randomUUID(),
    defectId: item.id,
    from: estadoDeclarado,
    to,
    actorId: (entrada.actor && entrada.actor.id) || 'desconhecido',
    proofHash: entrada.proof ? hashDoPayload(entrada.proof) : null,
    evaluatedCommit: entrada.currentCommit || null,
    at: new Date(entrada.agora || Date.now()).toISOString(),
  });
  if (!evento.ok) return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: evento.problemas || [evento.code] };

  // 2) projeção atômica da fila sob lock exclusivo.
  const lock = `${queuePath}.lock`;
  let fdLock;
  try {
    fdLock = fs.openSync(lock, 'wx');
  } catch (_) {
    return { ok: false, code: CODIGOS.FILA_OCUPADA, reasons: ['outra transição está em andamento'] };
  }
  try {
    const atual = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    const alvo = atual.items.find((i) => i && i.id === item.id);
    if (!alvo) return { ok: false, code: CODIGOS.DEFEITO_AUSENTE, reasons: [item.id] };
    if (String(alvo.state || '').toUpperCase() !== estadoDeclarado) {
      return { ok: false, code: CODIGOS.ESTADO_DIVERGENTE, reasons: ['fila mudou durante a transição'] };
    }

    alvo.state = to;
    alvo.status = STATUS_CANONICO[to] || alvo.status;
    alvo.legacyStatus = alvo.status;
    alvo.transitionId = evento.evento.transitionId;
    if (entrada.proof) {
      const dirProvas = path.join(rootDir, entrada.proofsPath || 'governance/bug-closure/proofs');
      fs.mkdirSync(dirProvas, { recursive: true });
      const rel = path.join(path.relative(rootDir, dirProvas), `${entrada.proof.transitionId}.json`);
      fs.writeFileSync(path.join(rootDir, rel), `${JSON.stringify(entrada.proof, null, 2)}\n`, 'utf8');
      alvo.closureProof = rel;
      alvo.verificationCommit = entrada.proof.evaluatedCommit;
    }
    atual.updatedAt = new Date(entrada.agora || Date.now()).toISOString().slice(0, 10);

    const tmp = `${queuePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(atual, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, queuePath);
  } finally {
    try { fs.closeSync(fdLock); } catch (_) { /* já fechado */ }
    try { fs.rmSync(lock, { force: true }); } catch (_) { /* lock transitório */ }
  }

  return { ok: true, code: null, reasons: [], evento: evento.evento };
}

module.exports = { applyTransition, CODIGOS, STATUS_CANONICO, ESTADOS_FECHADOS };
