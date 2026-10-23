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

/** Campos informativos que um chamador pode acrescentar a um evento de status. */
const CAMPOS_EXTRA_PERMITIDOS = Object.freeze([
  'recuperado', 'recuperadoEm', 'problemas', 'esperado', 'atual', 'lockOcupado',
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
  const texto = String(bruto);
  // Cauda sem `\n` é escrita EM VOO (leitor concorrente) ou crash. ALERT 2 da 6ª passada: o
  // corte era feito DEPOIS do filtro de linhas vazias e podia descartar o ÚLTIMO REGISTRO VÁLIDO
  // (bastava remover o `\n` final, ou anexar um espaço). Agora o corte é pelo FRAGMENTO: só é
  // cauda em voo o que NÃO completa um registro; JSON completo sem `\n` final continua valendo.
  const partes = texto.split('\n');
  const semNewlineFinal = texto !== '' && !texto.endsWith('\n');
  let caudaIncompleta = false;
  if (semNewlineFinal) {
    const fragmento = partes[partes.length - 1];
    try {
      JSON.parse(fragmento);
    } catch (_) {
      partes.pop();
      caudaIncompleta = true;
    }
  }
  const linhas = partes.filter((l) => l.trim() !== '');
  const registros = [];
  for (let i = 0; i < linhas.length; i += 1) {
    try {
      registros.push(JSON.parse(linhas[i]));
    } catch (_) {
      return { registros, corrompido: true, motivo: `JOURNAL_ILEGIVEL:linha=${i}` };
    }
  }
  const quebra = verificarCadeia(registros);
  return {
    registros,
    corrompido: Boolean(quebra),
    motivo: quebra,
    caudaIncompleta,
    // Arquivo sem `\n` final precisa ser normalizado antes de QUALQUER append (senão a próxima
    // linha gruda na última). Não é perda de dado: `registros` já contém todos os válidos.
    precisaNormalizar: semNewlineFinal,
  };
}

const ARQUIVO_LOCK = 'journal.log.lock';
const LOCK_TIMEOUT_MS = () => {
  const bruto = Number(process.env.JOURNAL_LOCK_TIMEOUT_MS);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : 5000;
};

/** Dorme de forma SÍNCRONA e sem dependência (Atomics.wait em buffer compartilhado). */
function dormir(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { /* espera ativa como último recurso */ }
  }
}

function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * @deprecated REMOVIDO na 6ª passada da revisão independente.
 *
 * A remoção AUTOMÁTICA de lock órfão era um TOCTOU: `lstat`→`rmSync` não é compare-and-swap, e
 * entre a checagem e o `rm` o caminho podia ser recriado por outro processo — dois donos, `seq`
 * duplicado e cadeia quebrada de forma permanente (reproduzido em 4/40 rodadas). O símbolo é
 * mantido apenas para FALHAR de forma ruidosa se algum chamador antigo aparecer; a quebra de
 * lock agora é explícita em `quebrarLock()`.
 */
function removerLockOrfao() {
  throw new Error('removerLockOrfao foi REMOVIDO: use quebrarLock(rootDir, { confirmar: true })');
}

/** Lê o dono do lock. `null` quando o arquivo sumiu ou o conteúdo é ilegível. */
function lerDonoDoLock(abs) {
  try {
    const lido = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return { pid: lido && lido.pid, token: lido && lido.token };
  } catch (_) {
    return null;
  }
}

/**
 * Executa `fn` sob o LOCK do diário.
 *
 * ALERT 1 da 5ª passada: `O_APPEND` garante que os BYTES não se misturam, mas não garante a
 * alocação de `seq`/`prevHash` — dois processos liam N registros, ambos calculavam `seq=N` e
 * anexavam, e a cadeia quebrava de forma PERMANENTE (`iniciar` passava a recusar tudo). O par
 * leitura+append tem de ser serializado.
 *
 * ALERT 1 da 6ª passada: a versão anterior REMOVIA lock órfão automaticamente para quebrar
 * deadlock, o que abria um TOCTOU (`lstat`→`rmSync` não é compare-and-swap): entre a checagem e
 * o `rm` o caminho podia ser recriado por outro processo, dois processos entravam na seção
 * crítica e a cadeia quebrava (4/40 rodadas). Agora NADA é removido automaticamente: lock de
 * processo morto vira erro DISTINGUÍVEL (`JOURNAL_LOCK_ORFAO`) e a quebra é uma ação explícita
 * (`quebrarLock`, `--quebrar-lock --confirmar`).
 */
function comLockDoDiario(rootDir, fn) {
  const dir = caminhoJornal(rootDir);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, erro: `JOURNAL_LOCK_FALHOU:${e.message}` };
  }
  const abs = path.join(dir, ARQUIVO_LOCK);
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const limite = Date.now() + LOCK_TIMEOUT_MS();
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(abs, 'wx', 0o600);
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, erro: `JOURNAL_LOCK_FALHOU:${e.code || e.message}` };
      const st = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (st && st.isDirectory()) return { ok: false, erro: 'JOURNAL_LOCK_NAO_ARQUIVO' };
      const dono = lerDonoDoLock(abs);
      if (dono && !pidVivo(dono.pid)) {
        return {
          ok: false,
          erro: 'JOURNAL_LOCK_ORFAO',
          donoPid: dono.pid,
          instrucao: 'quebre com: node scripts/governance/recover-bug-closure-journal.js --quebrar-lock --confirmar',
        };
      }
      if (Date.now() > limite) return { ok: false, erro: 'JOURNAL_OCUPADO' };
      dormir(10);
    }
  }
  try {
    // Token único por aquisição: é ele — não o caminho — que prova quem é o dono ao liberar.
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }));
    fs.fsyncSync(fd);
  } catch (_) { /* informativo: a exclusão já é garantida pelo O_EXCL */ }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* já fechado */ }
    // Nunca apaga o lock de terceiro: só o arquivo que ainda carrega o NOSSO token.
    const dono = lerDonoDoLock(abs);
    if (dono && dono.token === token) {
      try { fs.rmSync(abs, { force: true }); } catch (_) { /* lock transitório */ }
    }
  }
}

/**
 * Quebra EXPLÍCITA de lock órfão (processo dono morto). Exige `confirmar: true`; recusa-se a
 * quebrar lock de processo vivo. A checagem de PID aqui é check-then-act, mas a operação é
 * manual e auditada — o caminho automático (que era o TOCTOU do Alert 1 da 6ª passada) não
 * existe mais.
 */
function quebrarLock(rootDir, opcoes = {}) {
  const abs = path.join(caminhoJornal(rootDir), ARQUIVO_LOCK);
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (!st) return { ok: true, nadaAQuebrar: true };
  const dono = st.isFile() ? lerDonoDoLock(abs) : null;
  if (dono && pidVivo(dono.pid)) {
    return { ok: false, erro: 'JOURNAL_LOCK_DE_PROCESSO_VIVO', donoPid: dono.pid };
  }
  if (opcoes.confirmar !== true) {
    return { ok: false, erro: 'QUEBRA_DE_LOCK_EXIGE_CONFIRMACAO', donoPid: dono ? dono.pid : null };
  }
  // Revalidação imediatamente antes do `rm`: mesmo `ino` E mesmo token. Não é CAS (a janela
  // remanescente exige intervenção manual exatamente neste instante), mas impede derrubar o
  // lock de um processo que o readquiriu entre a checagem e a remoção.
  const relido = fs.lstatSync(abs, { throwIfNoEntry: false });
  const donoRelido = relido && relido.isFile() ? lerDonoDoLock(abs) : null;
  if (!relido || relido.ino !== st.ino || String((donoRelido && donoRelido.token) || '') !== String((dono && dono.token) || '')) {
    return { ok: false, erro: 'LOCK_MUDOU_DURANTE_A_QUEBRA', donoPid: donoRelido ? donoRelido.pid : null };
  }
  try {
    fs.rmSync(abs, { recursive: true, force: true });
    return { ok: true, removido: true, donoPid: dono ? dono.pid : null };
  } catch (e) {
    return { ok: false, erro: `QUEBRA_DE_LOCK_FALHOU:${e.message}` };
  }
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
      // `writeSync` pode devolver menos bytes que o pedido: tratado como falha de escrita
      // (registro truncado no diário é pior que operação abortada).
      const carga = Buffer.from(`${JSON.stringify(registro)}\n`, 'utf8');
      const escritos = fs.writeSync(fd, carga);
      if (escritos !== carga.length) {
        throw new Error(`escrita parcial ${escritos}/${carga.length}`);
      }
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch (_) { /* já fechado */ }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: `JOURNAL_ESCRITA_FALHOU:${e.message}` };
  }
}

/**
 * Lê o livro append-only do MESMO root do diário, para o guardião de evidência do reparo.
 *
 * ALERT 1 da 7ª passada: a versão anterior ignorava o `rootDir` e verificava o livro do
 * REPOSITÓRIO DO MÓDULO — reparar um diretório de dados lia o livro errado e descartava
 * evidência. ALERT 2 da 7ª passada: livro ausente ou vazio deixava a cadeia "íntegra" com zero
 * eventos, então truncar/apagar o livro desarmava o guardião; agora isso é NÃO verificável.
 */
function lerLivro(rootDir) {
  try {
    const ledger = require('./transition-ledger');
    const lido = ledger.verificarLivro(rootDir, ledger.REL_PADRAO);
    const eventos = Array.isArray(lido.eventos) ? lido.eventos : [];
    const existe = lido.existe !== false;
    const integro = lido.integridadeOk !== false;
    return { eventos, existe, integro, verificavel: existe && integro && eventos.length > 0 };
  } catch (_) {
    return { eventos: [], existe: false, integro: false, verificavel: false };
  }
}

/**
 * Reparo CANÔNICO do diário: mantém o maior PREFIXO válido da cadeia e descarta a cauda
 * quebrada, gravando o resultado com temporário imprevisível + rename.
 *
 * Por que é necessário (5ª passada): uma vez `corrompido`, o diário recusava qualquer escrita e
 * não havia caminho de volta — virava um bloqueio permanente sem decisão possível. O reparo é
 * explícito, determinístico e NUNCA libera certificação: descartar um registro só pode rebaixar
 * o estado observado (COMMITTED → INTENT ⇒ pendente), e o livro append-only continua intacto.
 *
 * `opcoes.ledgerEventos` (eventos do livro) torna o reparo fail-closed quando o descarte
 * apagaria evidência de efeito já aplicado: nesse caso exige `opcoes.forcar === true`.
 *
 * @returns {{ok:boolean, mantidos?:number, descartados?:object[], erro?:string}}
 */
function repararDiario(rootDir, opcoes = {}) {
  return comLockDoDiario(rootDir, () => {
    const abs = caminhoDiario(rootDir);
    let bruto = '';
    try {
      if (fs.existsSync(abs)) bruto = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      return { ok: false, erro: `JOURNAL_ILEGIVEL:${e.message}` };
    }
    const linhas = String(bruto).split('\n').filter((l) => l.trim() !== '');
    const validos = [];
    let motivo = null;
    for (let i = 0; i < linhas.length; i += 1) {
      let registro;
      try {
        registro = JSON.parse(linhas[i]);
      } catch (_) {
        motivo = `JOURNAL_ILEGIVEL:linha=${i}`;
        break;
      }
      const quebra = verificarCadeia([...validos, registro]);
      if (quebra) {
        motivo = quebra;
        break;
      }
      validos.push(registro);
    }
    // `ultimaSemNewline`: fragmento de escrita em voo/crash — não pode ser registro completo, logo
    // é comprovadamente inofensivo. Linha ilegível COM `\n` não é comprovável: pode ser um registro
    // truncado por terceiro, então o guardião a trata como possível evidência (fail-closed).
    const indicesDescartados = linhas.length - validos.length;
    const descartados = linhas.slice(validos.length).map((linha, i) => {
      try {
        return JSON.parse(linha);
      } catch (_) {
        const doFim = i === indicesDescartados - 1;
        return {
          linhaIlegivel: String(linha).slice(0, 160),
          ultimaSemNewline: doFim && !String(bruto).endsWith('\n'),
          transitionId: (String(linha).match(/"transitionId"\s*:\s*"([^"\\]+)"/) || [])[1] || null,
        };
      }
    });
    if (descartados.length === 0) return { ok: true, nadaDescartado: true, mantidos: validos.length };

    // ALERT 4 da 6ª passada: sem livro VERIFICÁVEL o guardião de evidência ficava fail-OPEN
    // (lista vazia ⇒ nada "perde evidência" ⇒ diário zerado com `ok:true`). ALERT 1 da 7ª: o
    // snapshot tem de vir do MESMO root e ser lido AQUI, sob o lock — nunca aceito do chamador.
    const livro = lerLivro(rootDir);
    if (!livro.verificavel && opcoes.forcar !== true) {
      return {
        ok: false,
        erro: 'REPARO_SEM_LIVRO_VERIFICAVEL',
        descartados,
        motivo,
        livro: { existe: livro.existe, integro: livro.integro, eventos: livro.eventos.length },
      };
    }
    const eventos = livro.eventos;
    const perdeEvidencia = descartados.filter((d) => {
      if (!d) return false;
      if (d.ultimaSemNewline) return false;
      if (d.linhaIlegivel) return true;
      return Boolean(d.transitionId)
        && eventos.some((e) => e && String(e.transitionId) === String(d.transitionId));
    });
    if (perdeEvidencia.length > 0 && opcoes.forcar !== true) {
      return { ok: false, erro: 'REPARO_PERDERIA_EVIDENCIA_DE_EFEITO', descartados, perdeEvidencia, motivo };
    }

    const gravado = gravarPrefixo(rootDir, validos);
    if (!gravado.ok) return { ok: false, erro: gravado.erro };
    return { ok: true, mantidos: validos.length, descartados, motivo };
  });
}

/**
 * Regrava o diário com o prefixo informado (temporário IMPREVISÍVEL + `O_EXCL` + rename).
 * Precisa ser chamado SOB o lock do diário. Usado pelo reparo e pela limpeza de cauda
 * incompleta — nunca para "desfazer" registro válido.
 */
function gravarPrefixo(rootDir, registros) {
  const abs = caminhoDiario(rootDir);
  const conteudo = registros.map((r) => `${JSON.stringify(r)}\n`).join('');
  const tmp = path.join(caminhoJornal(rootDir), `.reparo-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeSync(fd, conteudo);
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch (_) { /* já fechado */ }
    }
    fs.renameSync(tmp, abs);
    return { ok: true };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nada a limpar */ }
    return { ok: false, erro: `JOURNAL_REPARO_FALHOU:${e.message}` };
  }
}

/**
 * Remove a cauda SEM `\n` (escrita em voo/crash) antes de anexar.
 * Sem isso, um append depois do fragmento o transformaria em linha do MEIO e quebraria a
 * cadeia — a leitura já ignora a cauda, mas a escrita precisa descartá-la de fato.
 */
function limparCaudaIncompleta(rootDir, lido) {
  if (!lido.precisaNormalizar) return { ok: true };
  return gravarPrefixo(rootDir, lido.registros);
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
  return comLockDoDiario(rootDir, () => iniciarSemLock(rootDir, entrada));
}

function iniciarSemLock(rootDir, entrada = {}) {
  const lido = lerRegistros(rootDir);
  if (lido.corrompido) return { ok: false, erro: `JOURNAL_CORROMPIDO:${lido.motivo}` };
  const cauda = limparCaudaIncompleta(rootDir, lido);
  if (!cauda.ok) return { ok: false, erro: cauda.erro };

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

  const anexado = anexarRegistro(rootDir, intent);
  if (!anexado.ok) return { ok: false, erro: anexado.erro };
  return { ok: true, intent };
}

/**
 * Anexa um EVENTO de status (COMMITTED/ABORTED). O registro anterior nunca é reescrito: o
 * status vigente é o último evento daquela `transitionId`.
 */
function atualizarStatus(rootDir, transitionId, status, extra = {}) {
  return comLockDoDiario(rootDir, () => atualizarStatusSemLock(rootDir, transitionId, status, extra));
}

function atualizarStatusSemLock(rootDir, transitionId, status, extra = {}) {
  const lido = lerRegistros(rootDir);
  if (lido.corrompido) return { ok: false, erro: `JOURNAL_CORROMPIDO:${lido.motivo}` };
  const cauda = limparCaudaIncompleta(rootDir, lido);
  if (!cauda.ok) return { ok: false, erro: cauda.erro };
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
  const novo = { ...atual };
  // ALERT 2 da 5ª passada: `extra` NÃO pode sobrescrever campo de controle (status/seq/hash/
  // prevHash) — só campos informativos da allowlist entram, e os de controle vêm por último.
  for (const campo of CAMPOS_EXTRA_PERMITIDOS) {
    if (extra[campo] !== undefined) novo[campo] = extra[campo];
  }
  novo.motivo = extra.motivo === undefined ? null : extra.motivo;
  novo.seq = lido.registros.length;
  novo.em = new Date().toISOString();
  novo.status = status;
  novo.prevHash = ultimo.hash;
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
  repararDiario,
  quebrarLock,
  hashDoRegistro,
  comLockDoDiario,
};
