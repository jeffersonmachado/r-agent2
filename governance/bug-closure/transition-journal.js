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
  const destino = caminhoIntent(rootDir, entrada.transitionId);
  // ALERT 1 (3ª passada): `iniciar` sobrescrevia a entrada anterior. Um retry legítimo da
  // MESMA operação transformava COMMITTED em INTENT e depois ABORTED, deixando a operação
  // "pendente para sempre" e negando o selo. Entrada existente NUNCA é sobrescrita.
  if (fs.existsSync(destino)) {
    let anteriorStatus = null;
    try { anteriorStatus = JSON.parse(fs.readFileSync(destino, 'utf8')).status; } catch (_) { anteriorStatus = 'ILEGIVEL'; }
    // Regra de idempotência: COMMITTED é terminal (retry é recusado sem tocar no diário);
    // INTENT é operação em andamento (recusa, não sobrescreve); ABORTED pode ser RETENTADO —
    // caso contrário uma recusa legítima (ex.: lock ocupado) impediria a operação para sempre.
    if (anteriorStatus !== ESTADOS_JORNAL.ABORTED) {
      return { ok: false, erro: `JOURNAL_TRANSICAO_JA_REGISTRADA:${anteriorStatus}`, jaRegistrada: true, statusAnterior: anteriorStatus };
    }
    intent.tentativa = Number((JSON.parse(fs.readFileSync(destino, 'utf8')).tentativa) || 1) + 1;
  }
  try {
    // Cadeia de hash no diário (ALERT 4, 3ª passada): cada entrada carrega `prevHash` do
    // diário anterior, então forjar `status` sem refazer a cadeia é detectável.
    const anteriores = lerIntents(rootDir);
    const ultimo = anteriores[anteriores.length - 1];
    intent.seq = anteriores.length;
    intent.prevHash = ultimo ? ultimo.hash : 'GENESIS';
    intent.hash = sha256Texto(JSON.stringify({
      seq: intent.seq, transitionId: intent.transitionId, defectId: intent.defectId, kind: intent.kind,
      from: intent.from, to: intent.to, proofHash: intent.proofHash, status: intent.status,
      startedAt: intent.startedAt, prevHash: intent.prevHash,
    }));
    if (intent.tentativa) {
      // Retry de uma entrada ABORTED: substitui de forma atômica (temp imprevisível + rename).
      const tmp = path.join(dir, `.tmp-intent-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try {
        fs.writeSync(fd, `${JSON.stringify(intent, null, 2)}\n`);
      } finally {
        try { fs.closeSync(fd); } catch (_) { /* fechado */ }
      }
      fs.renameSync(tmp, destino);
    } else {
      fs.writeFileSync(destino, `${JSON.stringify(intent, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
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
    // ALERT 1 (3ª passada): COMMITTED é TERMINAL. Nenhuma transição de status pode rebaixar
    // uma operação concluída (o retry legítimo deixava a operação pendente para sempre).
    if (atual.status === ESTADOS_JORNAL.COMMITTED && status !== ESTADOS_JORNAL.COMMITTED) {
      return { ok: false, erro: 'JOURNAL_COMMITTED_E_TERMINAL', statusAnterior: atual.status };
    }
    const novo = { ...atual, ...extra, status, updatedAt: new Date().toISOString() };
    const tmp = `${abs}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(novo, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
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
    // ALERT 7 do revisor (P2): arquivo de diário ilegível NÃO pode ser "abortado" — não dá
    // para provar que nada aconteceu, e reescrevê-lo apagaria a evidência. Fica PENDENTE.
    if (intent.corrompido) {
      pendentes.push({
        transitionId: intent.transitionId, defectId: null,
        evento: false, prova: false, fila: false, motivo: 'JOURNAL_ILEGIVEL', status: 'CORROMPIDO',
      });
      continue;
    }
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
      const r = marcarCommit(rootDir, intent.transitionId, { recuperado: true, recuperadoEm: new Date().toISOString() });
      if (r.ok) completados.push(intent.transitionId);
      else pendentes.push({ transitionId: intent.transitionId, defectId: intent.defectId, evento: Boolean(evento), prova: provaOk, fila: filaAplicada, motivo: r.erro });
    } else if (efeitos === 0) {
      const r = marcarAborto(rootDir, intent.transitionId, 'RECUPERACAO_SEM_EFEITO', { recuperado: true });
      // Se nem o aborto pôde ser gravado, a operação continua pendente — o relatório tem de
      // dizer isso e o CLI não pode sair 0.
      if (r.ok) abortados.push(intent.transitionId);
      else pendentes.push({ transitionId: intent.transitionId, defectId: intent.defectId, evento: Boolean(evento), prova: provaOk, fila: filaAplicada, motivo: r.erro });
    } else {
      pendentes.push({
        transitionId: intent.transitionId, defectId: intent.defectId,
        evento: Boolean(evento), prova: provaOk, fila: filaAplicada, status: intent.status,
      });
    }
  }

  // O veredito reflete o estado REAL do diário depois da reconciliação, não só o que foi
  // classificado nesta passada (um INTENT que não pôde ser fechado continua bloqueando).
  const aindaPendente = haOperacaoPendente(rootDir, { livroRel });
  return {
    completados,
    abortados,
    pendentes,
    ok: pendentes.length === 0 && !aindaPendente,
    // Operação pendente/irreconciliável: certificação tem de permanecer negada.
    bloqueiaCertificacao: pendentes.length > 0 || aindaPendente,
  };
}

/**
 * Há operação não reconciliada que impede certificação?
 * Inclui INTENT (em andamento/interrompida) e ABORTED **com evento no livro** (efeito parcial
 * irreversível). ABORTED sem efeito não bloqueia: nada foi aplicado.
 */
function haOperacaoPendente(rootDir, opcoes = {}) {
  // Raiz derivada do MÓDULO quando o chamador não informa: depender de `process.cwd()`
  // desligava a guarda em qualquer execução de subdiretório (alert 6 do revisor).
  const raiz = rootDir || path.resolve(__dirname, '..', '..');
  const livroRel = opcoes.livroRel || path.join('governance', 'bug-closure', 'transitions.log.jsonl');
  const abs = path.join(raiz, livroRel);
  const eventos = fs.existsSync(abs)
    ? fs.readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean)
    : [];
  return lerIntents(raiz).some((i) => {
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
