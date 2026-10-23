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
const { canonicalJson } = require('../risk-acceptance/signature');

const DIR_JORNAL = path.join('governance', 'bug-closure', 'journal');

const ESTADOS_JORNAL = Object.freeze({
  INTENT: 'INTENT',
  COMMITTED: 'COMMITTED',
  ABORTED: 'ABORTED',
});

const sha256Texto = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const sha256Arquivo = (abs) => (fs.existsSync(abs) ? sha256Texto(fs.readFileSync(abs, 'utf8')) : null);
const caminhoJornal = (rootDir) => path.join(rootDir, DIR_JORNAL);
const ARQUIVO_DIARIO = 'journal.log.jsonl';
const caminhoDiario = (rootDir) => path.join(caminhoJornal(rootDir), ARQUIVO_DIARIO);

/**
 * Compatibilidade: o diário unificou todos os registros num único log append-only, então não
 * existe mais um arquivo por operação. O helper é mantido porque era exportado e chamadores
 * antigos o usavam para localizar o diário; ele devolve o log compartilhado.
 */
const caminhoIntent = (rootDir) => caminhoDiario(rootDir);

/**
 * Campos que entram no hash do registro.
 *
 * ALERT 1 da 4ª passada: a cadeia anterior era **write-only** e hasheava `status`, então toda
 * entrada legitimamente COMMITTED nascia com hash inválido (ninguém verificava, mas a garantia
 * anunciada não existia). O modelo correto é EVENTO append-only: mudar `status` não é editar o
 * registro, é ANEXAR outro. Logo o hash cobre `status` do EVENTO (não há edição a proteger).
 */
const CAMPOS_ENCADEADOS = Object.freeze([
  'seq', 'em', 'transitionId', 'defectId', 'kind', 'from', 'to', 'proofRel', 'proofHash',
  'queueRel', 'ledgerRel', 'base', 'status', 'tentativa', 'motivo', 'prevHash',
]);

function hashDoRegistro(registro) {
  const base = {};
  for (const campo of CAMPOS_ENCADEADOS) base[campo] = registro[campo] === undefined ? null : registro[campo];
  return sha256Texto(canonicalJson(base));
}

/**
 * Verifica a cadeia de hash do diário inteiro.
 * Detecta: edição de qualquer campo encadeado, reordenação, remoção no MEIO e `seq` fora de
 * ordem. NÃO detecta truncamento da CAUDA nem remoção do arquivo — sem âncora externa, estado
 * in-tree não tem autenticidade (limite declarado, igual ao do livro).
 *
 * @returns {string|null} motivo da quebra, ou `null` se íntegra
 */
function verificarCadeia(registros) {
  let anterior = null;
  for (let i = 0; i < registros.length; i += 1) {
    const registro = registros[i];
    if (!registro || typeof registro !== 'object') return `JOURNAL_CADEIA_REGISTRO_INVALIDO:${i}`;
    if (Number(registro.seq) !== i) return `JOURNAL_CADEIA_SEQ_DIVERGENTE:${i}`;
    const esperado = anterior ? anterior.hash : 'GENESIS';
    if (String(registro.prevHash) !== String(esperado)) return `JOURNAL_CADEIA_QUEBRADA:${i}`;
    if (String(registro.hash) !== hashDoRegistro(registro)) return `JOURNAL_CADEIA_HASH_INVALIDO:${i}`;
    anterior = registro;
  }
  return null;
}

/** Lê e VALIDA o diário. Nunca lança: corrupção vira estado (fail-closed), não exceção. */
function lerRegistros(rootDir) {
  const abs = caminhoDiario(rootDir);
  let bruto = null;
  try {
    if (!fs.existsSync(abs)) return { registros: [], corrompido: false, motivo: null };
    bruto = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { registros: [], corrompido: true, motivo: `JOURNAL_ILEGIVEL:${e.message}` };
  }
  const linhas = String(bruto).split('\n').filter((l) => l.trim() !== '');
  const registros = [];
  for (let i = 0; i < linhas.length; i += 1) {
    try {
      registros.push(JSON.parse(linhas[i]));
    } catch (_) {
      return { registros, corrompido: true, motivo: `JOURNAL_ILEGIVEL:linha=${i}` };
    }
  }
  const quebra = verificarCadeia(registros);
  return { registros, corrompido: Boolean(quebra), motivo: quebra };
}

/**
 * Anexa um registro com `O_APPEND` + um único `write`.
 *
 * ALERT 2 da 4ª passada: a atualização de status usava `<id>.json.tmp` PREVISÍVEL. Aqui não há
 * temporário nenhum: o diário só cresce, então não existe "arquivo inteiro reescrito" para
 * seguir symlink nem tmp a ser pré-criado por terceiro. Residual: o DIRETÓRIO pai (janela de
 * `openat`), a mesma limitação declarada do modelo in-tree.
 */
function anexarRegistro(rootDir, registro) {
  const abs = caminhoDiario(rootDir);
  try {
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (st && st.isSymbolicLink()) return { ok: false, erro: 'JOURNAL_SYMLINK' };
    if (st && !st.isFile()) return { ok: false, erro: 'JOURNAL_NAO_ARQUIVO' };
    const fd = fs.openSync(abs, 'a', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(registro)}\n`);
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch (_) { /* já fechado */ }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: `JOURNAL_ESCRITA_FALHOU:${e.message}` };
  }
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
  const lido = lerRegistros(rootDir);
  if (lido.corrompido) return { ok: false, erro: `JOURNAL_CORROMPIDO:${lido.motivo}` };

  // Regra de idempotência (alerts 1 das 3ª e 4ª passadas): COMMITTED é terminal, INTENT é
  // operação em andamento (recusa sem tocar no diário) e ABORTED pode ser RETENTADO — senão
  // uma recusa legítima (lock ocupado) impediria a operação para sempre. O retry ANEXA um novo
  // INTENT com `tentativa` incrementada; o registro ABORTED permanece como evidência.
  const mesma = lido.registros.filter((r) => String(r.transitionId) === String(entrada.transitionId));
  const ultimoMesmo = mesma.length ? mesma[mesma.length - 1] : null;
  let tentativa = 1;
  if (ultimoMesmo) {
    if (ultimoMesmo.status !== ESTADOS_JORNAL.ABORTED) {
      return {
        ok: false,
        erro: `JOURNAL_TRANSICAO_JA_REGISTRADA:${ultimoMesmo.status}`,
        jaRegistrada: true,
        statusAnterior: ultimoMesmo.status,
      };
    }
    tentativa = Number(ultimoMesmo.tentativa || 1) + 1;
  }

  const ultimo = lido.registros.length ? lido.registros[lido.registros.length - 1] : null;
  const intent = {
    seq: lido.registros.length,
    em: new Date(entrada.agora || Date.now()).toISOString(),
    transitionId: entrada.transitionId,
    defectId: entrada.defectId,
    kind: entrada.kind, // TRANSITION | ATTESTATION
    from: entrada.from,
    to: entrada.to,
    proofRel: entrada.proofRel || null,
    proofHash: entrada.proofHash || null,
    queueRel: path.relative(rootDir, entrada.queuePath),
    ledgerRel: entrada.ledgerRel || null,
    base: entrada.base || null,
    status: ESTADOS_JORNAL.INTENT,
    tentativa,
    motivo: null,
    prevHash: ultimo ? ultimo.hash : 'GENESIS',
  };
  intent.hash = hashDoRegistro(intent);

  try {
    fs.mkdirSync(caminhoJornal(rootDir), { recursive: true });
  } catch (e) {
    return { ok: false, erro: `JOURNAL_INTENT_FALHOU:${e.message}` };
  }
  const anexado = anexarRegistro(rootDir, intent);
  if (!anexado.ok) return { ok: false, erro: anexado.erro };
  return { ok: true, intent };
}

/**
 * Anexa um EVENTO de status (COMMITTED/ABORTED). O registro anterior nunca é reescrito: o
 * status vigente é o último evento daquela `transitionId`.
 */
function atualizarStatus(rootDir, transitionId, status, extra = {}) {
  const lido = lerRegistros(rootDir);
  if (lido.corrompido) return { ok: false, erro: `JOURNAL_CORROMPIDO:${lido.motivo}` };
  const mesma = lido.registros.filter((r) => String(r.transitionId) === String(transitionId));
  const atual = mesma.length ? mesma[mesma.length - 1] : null;
  if (!atual) return { ok: false, erro: 'JOURNAL_INTENT_AUSENTE' };
  // ALERT 1 da 3ª passada: COMMITTED é TERMINAL. Nenhuma transição de status pode rebaixar
  // uma operação concluída (o retry legítimo deixava a operação pendente para sempre).
  if (atual.status === ESTADOS_JORNAL.COMMITTED && status !== ESTADOS_JORNAL.COMMITTED) {
    return { ok: false, erro: 'JOURNAL_COMMITTED_E_TERMINAL', statusAnterior: atual.status };
  }
  if (atual.status === status) return { ok: true, intent: atual, idempotente: true };

  const ultimo = lido.registros[lido.registros.length - 1];
  const novo = {
    ...atual,
    seq: lido.registros.length,
    em: new Date().toISOString(),
    status,
    motivo: extra.motivo === undefined ? null : extra.motivo,
    ...extra,
    prevHash: ultimo.hash,
  };
  delete novo.hash;
  novo.hash = hashDoRegistro(novo);
  const anexado = anexarRegistro(rootDir, novo);
  if (!anexado.ok) return { ok: false, erro: anexado.erro };
  return { ok: true, intent: novo };
}

const marcarCommit = (rootDir, transitionId, extra = {}) => atualizarStatus(rootDir, transitionId, ESTADOS_JORNAL.COMMITTED, extra);
const marcarAborto = (rootDir, transitionId, motivo, extra = {}) => atualizarStatus(rootDir, transitionId, ESTADOS_JORNAL.ABORTED, { motivo, ...extra });

/**
 * Estado vigente por operação: último evento de cada `transitionId`.
 * Diário ilegível ou cadeia quebrada vira entrada `corrompido` (fail-closed) — nunca "vazio".
 */
function lerIntents(rootDir) {
  const { registros, corrompido, motivo } = lerRegistros(rootDir);
  const porOperacao = new Map();
  for (const registro of registros) {
    if (registro && typeof registro === 'object') porOperacao.set(String(registro.transitionId), registro);
  }
  const intents = [...porOperacao.values()];
  if (corrompido) {
    intents.push({
      transitionId: '__DIARIO_CORROMPIDO__',
      defectId: null,
      status: ESTADOS_JORNAL.INTENT,
      corrompido: true,
      motivo,
    });
  }
  return intents;
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
        evento: false, prova: false, fila: false, motivo: intent.motivo || 'JOURNAL_ILEGIVEL', status: 'CORROMPIDO',
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
  ARQUIVO_DIARIO,
  ESTADOS_JORNAL,
  iniciar,
  marcarCommit,
  marcarAborto,
  lerRegistros,
  verificarCadeia,
  lerIntents,
  recuperar,
  haOperacaoPendente,
  baseAtual,
  sha256Arquivo,
  caminhoDiario,
  caminhoIntent,
};
