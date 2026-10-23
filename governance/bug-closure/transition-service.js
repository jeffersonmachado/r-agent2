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
const { anexarEvento, verificarLivro, REL_PADRAO } = require('./transition-ledger');
const jornal = require('./transition-journal');


/**
 * Resolve o caminho REAL (symlinks seguidos) e confirma que ele está dentro da raiz.
 * `startsWith(rootDir)` sozinho não protege contra symlink: um link dentro da raiz apontando
 * para fora passa no teste textual e escreve fora do repositório. Aqui o alvo é resolvido
 * pelo ancestral existente mais próximo e comparado com o realpath da raiz.
 */
/**
 * Grava a prova SEM seguir symlink: recusa alvo que já é symlink, escreve em arquivo
 * temporário com O_EXCL no MESMO diretório e renomeia (rename substitui a ENTRADA do
 * link, não o alvo). `realpath` de ancestral não basta: o componente final pode não existir
 * ainda e ser um symlink pendente apontando para fora.
 */
function gravarProvaSemSeguirSymlink(dirProvas, absProva, conteudo) {
  // `existsSync` SEGUE o link: para symlink PENDENTE (alvo inexistente) ele devolve false e a
  // checagem era pulada. `lstatSync` lê a entrada do próprio link, exista o alvo ou não.
  let st = null;
  try { st = fs.lstatSync(absProva); } catch (_) { st = null; }
  if (st && st.isSymbolicLink()) return { ok: false, motivo: 'PROVA_E_SYMLINK' };
  const tmp = path.join(dirProvas, `.tmp-${path.basename(absProva)}-${process.pid}-${Date.now()}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeSync(fd, conteudo);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, absProva);
    return { ok: true };
  } catch (e) {
    if (fd !== null && fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* já fechado */ } }
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* temporário */ }
    return { ok: false, motivo: `FALHA_AO_GRAVAR_PROVA:${e.message}` };
  }
}

function caminhoRealDentroDaRaiz(rootDir, alvo) {
  try {
    const raizReal = fs.realpathSync(rootDir);
    let atual = path.resolve(alvo);
    const restante = [];
    while (!fs.existsSync(atual)) {
      restante.unshift(path.basename(atual));
      const pai = path.dirname(atual);
      if (pai === atual) return { ok: false, real: atual };
      atual = pai;
    }
    const real = path.join(fs.realpathSync(atual), ...restante);
    return { ok: real === raizReal || real.startsWith(`${raizReal}${path.sep}`), real };
  } catch (_) {
    return { ok: false, real: null };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  // ALERT 3a (revisor, P1): `transitionId` vinha do chamador e era usado como NOME DE ARQUIVO.
  // `../../governance/risk-acceptance/authorities.json` gravava fora do diretório de provas.
  if (entrada.proof) {
    const idProva = String(entrada.proof.transitionId || '');
    if (!UUID_RE.test(idProva)) {
      return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: ['TRANSITION_ID_INVALIDO'] };
    }
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

  // ALERT 3b (revisor, 2ª passada): a recusa por prova em transição não-fechamento era
  // avaliada DEPOIS do append no livro — uma chamada recusada deixava evento permanente de
  // uma transição que nunca ocorreu. Toda validação precede qualquer escrita.
  if (entrada.proof && !ESTADOS_FECHADOS.includes(to)) {
    return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['PROVA_EM_TRANSICAO_NAO_FECHAMENTO'] };
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
      // Âncora de confiança: chaves PINADAS (fora do JSON editável) — ver trusted-authorities.
      ancoragem: entrada.ancoragem,
      // Criação: o evento ainda NÃO existe (é anexado abaixo) — `null` desliga só esta
      // checagem. O append recusa transitionId duplicado, então replay continua bloqueado.
      livro: entrada.livro === undefined ? null : entrada.livro,
      agora: entrada.agora,
      existeArquivo: (rel) => fs.existsSync(path.join(rootDir, rel)),
    });
    if (!veredito.ok) return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: veredito.reasons };
  }

  if (entrada.dryRun) return { ok: true, code: null, reasons: [], evento: null };

  // A4 (missão Codex): base do lost update + INTENT no diário ANTES de qualquer mutação.
  // A partir daqui, toda recusa passa por `abortar()` para que o diário não fique em INTENT.
  const livroAbs = path.join(rootDir, entrada.livroPath || REL_PADRAO);
  const base = jornal.baseAtual(rootDir, queuePath, livroAbs);
  const intent = jornal.iniciar(rootDir, {
    transitionId: entrada.proof ? entrada.proof.transitionId : crypto.randomUUID(),
    defectId: item.id,
    kind: 'TRANSITION',
    from: estadoDeclarado,
    to,
    proofRel: entrada.proof
      ? path.relative(rootDir, path.resolve(rootDir, entrada.proofsPath || 'governance/bug-closure/proofs', `${entrada.proof.transitionId}.json`))
      : null,
    proofHash: entrada.proof ? hashDoPayload(entrada.proof) : null,
    queuePath,
    ledgerRel: entrada.livroPath || REL_PADRAO,
    base,
    agora: entrada.agora,
  });
  if (!intent.ok) return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: [intent.erro] };
  const abortar = (motivo, extra = {}) => {
    jornal.marcarAborto(rootDir, intent.intent.transitionId, motivo, extra);
    return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: [motivo] };
  };

  // P2 da 4ª passada do revisor: validar a CONTENÇÃO do caminho de prova ANTES de tocar no
  // livro. Antes, `proofsPath` inválido appendava um evento e só depois recusava — deixando
  // evento órfão que envenenava a checagem de ordem do próximo fechamento legítimo.
  let dirProvas = null;
  let absProva = null;
  if (entrada.proof) {
    dirProvas = path.resolve(rootDir, entrada.proofsPath || 'governance/bug-closure/proofs');
    if (!dirProvas.startsWith(`${path.resolve(rootDir)}${path.sep}`)
      || !caminhoRealDentroDaRaiz(rootDir, dirProvas).ok) {
      return abortar('CAMINHO_DE_PROVA_INVALIDO');
    }
    // Nome derivado do transitionId do chamador (UUID já validado acima), nunca campo livre.
    absProva = path.resolve(dirProvas, `${String(entrada.proof.transitionId)}.json`);
    if (!absProva.startsWith(`${dirProvas}${path.sep}`) || !caminhoRealDentroDaRaiz(rootDir, absProva).ok) {
      return abortar('CAMINHO_DE_PROVA_INVALIDO');
    }
  }

  // ALERT 3 do revisor (P1): o LOCK da fila e a checagem de BASE vêm ANTES de qualquer
  // append. Antes, um evento era anexado e a recusa posterior (FILA_OCUPADA/ESTADO_DIVERGENTE/
  // FILA_MUDOU_DESDE_A_BASE) deixava evento órfão permanente — que virava o "último evento" do
  // defeito e fazia o fechamento legítimo seguinte falhar com EVENTO_FORA_DE_ORDEM.
  const lock = `${queuePath}.lock`;
  let fdLock;
  try {
    fdLock = fs.openSync(lock, 'wx');
  } catch (_) {
    return abortar('FILA_OCUPADA', { lockOcupado: true });
  }
  let evento;
  try {
    const atual = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    const alvo = atual.items.find((i) => i && i.id === item.id);
    if (!alvo) return abortar('DEFEITO_AUSENTE');
    if (String(alvo.state || '').toUpperCase() !== estadoDeclarado) {
      return abortar('ESTADO_DIVERGENTE');
    }
    const hashAtual = jornal.sha256Arquivo(queuePath);
    if (base.queueHash && hashAtual && hashAtual !== base.queueHash) {
      return abortar('FILA_MUDOU_DESDE_A_BASE', { esperado: base.queueHash, atual: hashAtual });
    }

    // Só DEPOIS das pré-condições o livro é tocado.
    evento = anexarEvento({
      rootDir,
      rel: livroPath,
      transitionId: intent.intent.transitionId,
      defectId: item.id,
      from: estadoDeclarado,
      to,
      actorId: (entrada.actor && entrada.actor.id) || 'desconhecido',
      proofHash: entrada.proof ? hashDoPayload(entrada.proof) : null,
      // ALERT 5 do revisor (P2): o evento registra o commit ASSINADO na prova (o valor que a
      // assinatura cobre), não o HEAD da aplicação. Comparar commit de fix com HEAD na
      // releitura invalidava a prova que o próprio serviço acabou de aplicar.
      evaluatedCommit: (entrada.proof && entrada.proof.evaluatedCommit) || entrada.currentCommit || null,
      at: new Date(entrada.agora || Date.now()).toISOString(),
    });
    if (!evento.ok) return abortar(`EVENTO_NAO_ANEXADO:${evento.code}`, { problemas: evento.problemas || [] });

    alvo.state = to;
    alvo.status = STATUS_CANONICO[to] || alvo.status;
    alvo.legacyStatus = alvo.status;
    alvo.transitionId = evento.evento.transitionId;
    if (entrada.proof) {
      // `dirProvas`/`absProva` já validados ANTES do append (nenhum evento órfão). A criação do
      // diretório TAMBÉM está no try: EEXIST/EACCES aqui é falha de persistência, não crash.
      try {
        fs.mkdirSync(dirProvas, { recursive: true });
      } catch (e) {
        return abortar(`FALHA_AO_GRAVAR_PROVA:${e.message}`);
      }
      const gravacao = gravarProvaSemSeguirSymlink(dirProvas, absProva, `${JSON.stringify(entrada.proof, null, 2)}\n`);
      if (!gravacao.ok) return abortar(gravacao.motivo);
      alvo.closureProof = path.join(path.relative(rootDir, dirProvas), path.basename(absProva));
      alvo.verificationCommit = entrada.proof.evaluatedCommit;
    }
    atual.updatedAt = new Date(entrada.agora || Date.now()).toISOString().slice(0, 10);

    const tmp = `${queuePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(atual, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, queuePath);
    jornal.marcarCommit(rootDir, intent.intent.transitionId);
  } catch (e) {
    jornal.marcarAborto(rootDir, intent.intent.transitionId, `PROJECAO_FALHOU:${e.message}`);
    throw e;
  } finally {
    try { fs.closeSync(fdLock); } catch (_) { /* já fechado */ }
    try { fs.rmSync(lock, { force: true }); } catch (_) { /* lock transitório */ }
  }

  return { ok: true, code: null, reasons: [], evento: evento.evento };
}

/**
 * Atestação de re-verificação: para item que JÁ está em VERIFIED/RESOLVED e só carece de prova.
 * Não muda o estado da fila (não há transição a fazer), grava a prova e o evento `ATTESTATION`
 * no livro. Todos os requisitos de prova continuam valendo — inclusive assinatura ancorada.
 *
 * @param {object} entrada { rootDir, queuePath, defectId, proof, actor, currentCommit, currentFingerprint, ancoragem, dryRun, agora }
 */
function applyAttestation(entrada = {}) {
  const rootDir = entrada.rootDir || path.resolve(__dirname, '..', '..');
  const queuePath = entrada.queuePath || path.join(rootDir, 'AI_MEMORY', 'hardening-queue.json');
  const livroPath = entrada.livroPath || null; // null ⇒ REL_PADRAO do livro
  const prova = entrada.proof;
  if (!prova) return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['PROVA_DE_FECHAMENTO_AUSENTE'] };

  const atual = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const item = atual.items.find((i) => i && i.id === entrada.defectId);
  if (!item) return { ok: false, code: CODIGOS.DEFEITO_AUSENTE, reasons: [String(entrada.defectId)] };

  const estado = String(item.state || '').toUpperCase();
  if (!['VERIFIED', 'RESOLVED'].includes(estado)) {
    return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['ATESTACAO_SO_EM_ESTADO_DE_FECHAMENTO'] };
  }
  if (prova.policyDecision && prova.policyDecision.decision !== 'REVERIFY_EXISTING_CLOSURE') {
    return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['DECISAO_DE_POLITICA_INCOMPATIVEL'] };
  }
  if (!UUID_RE.test(String(prova.transitionId || ''))) {
    return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: ['TRANSITION_ID_INVALIDO'] };
  }

  // Caminho de prova validado (textual + realpath + alvo não-symlink) ANTES de qualquer mutação.
  const dirProvas = path.resolve(rootDir, entrada.proofsPath || 'governance/bug-closure/proofs');
  if (!dirProvas.startsWith(`${path.resolve(rootDir)}${path.sep}`)
    || !caminhoRealDentroDaRaiz(rootDir, dirProvas).ok) {
    return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['CAMINHO_DE_PROVA_INVALIDO'] };
  }
  const nomeProva = `${prova.transitionId}.json`;
  const absProva = path.resolve(dirProvas, nomeProva);
  if (!absProva.startsWith(`${dirProvas}${path.sep}`) || !caminhoRealDentroDaRaiz(rootDir, absProva).ok) {
    return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['CAMINHO_DE_PROVA_INVALIDO'] };
  }
  {
    let stProva = null;
    try { stProva = fs.lstatSync(absProva); } catch (_) { stProva = null; }
    if (stProva && stProva.isSymbolicLink()) {
      return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: ['PROVA_E_SYMLINK'] };
    }
  }

  const veredito = verificarProvaDeFechamento(prova, {
    defeito: { id: item.id, severity: item.severity, state: estado },
    currentCommit: entrada.currentCommit,
    currentFingerprint: entrada.currentFingerprint,
    rootDir,
    autoridades: entrada.autoridades,
    ancoragem: entrada.ancoragem,
    livro: entrada.livro === undefined ? null : entrada.livro,
    agora: entrada.agora,
    existeArquivo: (rel) => fs.existsSync(path.join(rootDir, rel)),
  });
  if (!veredito.ok) return { ok: false, code: CODIGOS.PROVA_RECUSADA, reasons: veredito.reasons };

  if (entrada.dryRun) return { ok: true, code: null, reasons: [], evento: null };

  // ALERT 2/4 do revisor: mesma disciplina do applyTransition — INTENT, lock, base, aborto
  // estruturado em qualquer falha e COMMITTED só depois da projeção.
  const livroAbs = path.join(rootDir, livroPath || REL_PADRAO);
  const base = jornal.baseAtual(rootDir, queuePath, livroAbs);
  const intent = jornal.iniciar(rootDir, {
    transitionId: prova.transitionId,
    defectId: item.id,
    kind: 'ATTESTATION',
    from: estado,
    to: estado,
    proofRel: path.relative(rootDir, absProva),
    proofHash: hashDoPayload(prova),
    queuePath,
    ledgerRel: livroPath || REL_PADRAO,
    base,
    agora: entrada.agora,
  });
  if (!intent.ok) return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: [intent.erro] };
  const abortar = (motivo, extra = {}) => {
    jornal.marcarAborto(rootDir, intent.intent.transitionId, motivo, extra);
    return { ok: false, code: CODIGOS.TRANSICAO_RECUSADA, reasons: [motivo] };
  };

  const lock = `${queuePath}.lock`;
  let fdLock;
  try {
    fdLock = fs.openSync(lock, 'wx');
  } catch (_) {
    return abortar('FILA_OCUPADA', { lockOcupado: true });
  }
  try {
    const filaAgora = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    const alvo = filaAgora.items.find((i) => i && i.id === item.id);
    if (!alvo) return abortar('DEFEITO_AUSENTE');
    if (String(alvo.state || '').toUpperCase() !== estado) return abortar('ESTADO_DIVERGENTE');
    const hashAtual = jornal.sha256Arquivo(queuePath);
    if (base.queueHash && hashAtual && hashAtual !== base.queueHash) {
      return abortar('FILA_MUDOU_DESDE_A_BASE', { esperado: base.queueHash, atual: hashAtual });
    }

    const evento = anexarEvento({
      rootDir,
      rel: livroPath,
      transitionId: prova.transitionId,
      defectId: item.id,
      from: estado,
      to: estado, // atestação não transiciona
      kind: 'ATTESTATION',
      actorId: (entrada.actor && entrada.actor.id) || 'desconhecido',
      proofHash: hashDoPayload(prova),
      evaluatedCommit: prova.evaluatedCommit || entrada.currentCommit || null,
      at: new Date(entrada.agora || Date.now()).toISOString(),
    });
    if (!evento.ok) return abortar(`EVENTO_NAO_ANEXADO:${evento.code}`, { problemas: evento.problemas || [] });

    try {
      fs.mkdirSync(dirProvas, { recursive: true });
    } catch (e) {
      return abortar(`FALHA_AO_GRAVAR_PROVA:${e.message}`);
    }
    const gravacao = gravarProvaSemSeguirSymlink(dirProvas, absProva, `${JSON.stringify(prova, null, 2)}\n`);
    if (!gravacao.ok) return abortar(gravacao.motivo);

    // A fila NÃO muda de estado: só registra a prova que faltava.
    alvo.closureProof = path.join(path.relative(rootDir, dirProvas), nomeProva);
    alvo.attestationId = prova.transitionId;
    alvo.attestedAt = new Date(entrada.agora || Date.now()).toISOString();
    filaAgora.updatedAt = new Date(entrada.agora || Date.now()).toISOString().slice(0, 10);
    const tmp = `${queuePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(filaAgora, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, queuePath);
    jornal.marcarCommit(rootDir, intent.intent.transitionId);
    return { ok: true, code: null, reasons: [], evento: evento.evento };
  } catch (e) {
    jornal.marcarAborto(rootDir, intent.intent.transitionId, `PROJECAO_FALHOU:${e.message}`);
    throw e;
  } finally {
    try { fs.closeSync(fdLock); } catch (_) { /* já fechado */ }
    try { fs.rmSync(lock, { force: true }); } catch (_) { /* lock transitório */ }
  }
}

module.exports = {
  applyAttestation, applyTransition, CODIGOS, STATUS_CANONICO, ESTADOS_FECHADOS };
