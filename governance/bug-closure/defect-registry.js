'use strict';

/**
 * BUG CLOSURE FIRST — inventário de defeitos derivado da fila OFICIAL.
 *
 * Fonte única: `AI_MEMORY/hardening-queue.json` (Constituição, §Continuidade).
 * Este módulo NÃO cria um segundo registry: ele MIGRA o vocabulário legado para
 * os estados canônicos, preservando o valor original em `legacyStatus`, e deriva
 * a severidade quando ela não está declarada.
 *
 * DEFEITO MEDIDO (2026-10-17): 93 itens, campos {id,title,status,commit,evidence},
 * ZERO campos de severidade, estados `done | verified | prevention_active |
 * blocked | blocked_external | pending`. Sem severidade o gate central não podia
 * priorizar correção sobre relatório; `done` era lido como resolvido sem teste de
 * regressão; e `blocked_external` saía da conta, deixando de bloquear certificação.
 *
 * FAIL-CLOSED: fila ausente/ilegível lança erro com código — inventário
 * desconhecido nunca é inventário vazio.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  ESTADOS,
  MIGRACAO_LEGADO,
  severidadeDoItem,
  eBloqueanteParaCertificacao,
  estaAberto,
} = require('./defect-states');
const { verificarProvaDeFechamento } = require('./closure-proof');
const { verificarLivro } = require('./transition-ledger');

const ESTADOS_FECHADOS = Object.freeze([ESTADOS.VERIFIED, ESTADOS.RESOLVED]);

/**
 * Contexto de verificação de fechamento (Camada B).
 *
 * Sem prova válida, um item que DECLARA estado de fechamento NÃO deixa de bloquear
 * operações certificantes: `stateEfetivo` volta a OPEN e o motivo fica registrado em
 * `provaDeFechamento`. `RISK_ACCEPTED` continua usando o mecanismo próprio de aceite
 * (assinatura + validade), que já é verificado em `eligibility.js`.
 */
function montarContextoDeFechamento(opcoes = {}) {
  const rootDir = opcoes.rootDir || path.resolve(__dirname, '..', '..');
  let livro = opcoes.livro;
  if (!livro) {
    const l = verificarLivro(rootDir, opcoes.livroPath);
    livro = { eventos: l.eventos, integridadeOk: l.integridadeOk, problemas: l.problemas };
  }
  return {
    rootDir,
    currentCommit: opcoes.currentCommit || null,
    currentFingerprint: opcoes.currentFingerprint || null,
    autoridades: opcoes.autoridades,
    livro,
    agora: opcoes.agora,
    existeArquivo: (rel) => fs.existsSync(path.join(rootDir, rel)),
  };
}

function carregarProvaDoItem(item, ctx) {
  const declarada = item && (item.closureProof || item.provaDeFechamento);
  if (!declarada) return null;
  if (typeof declarada === 'object') return declarada;
  if (typeof declarada === 'string') {
    const abs = path.isAbsolute(declarada) ? declarada : path.join(ctx.rootDir, declarada);
    try {
      return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (_) {
      return { __ilegivel: declarada };
    }
  }
  return null;
}

const CODIGOS = Object.freeze({
  FILA_AUSENTE: 'FILA_AUSENTE',
  FILA_ILEGIVEL: 'FILA_ILEGIVEL',
  FILA_MALFORMADA: 'FILA_MALFORMADA',
});

/** Migra um item legado para o contrato canônico de defeito. */
function migrarItem(item, opcoesDeFechamento = null) {
  const legacyStatus = String((item && item.status) || '').toLowerCase();

  // ── AUTORIDADE DO ESTADO (defeito medido 2026-10-17) ─────────────────────
  // O `state` PERSISTIDO é a autoridade. Re-migrar a partir de `status` a cada
  // leitura desfazia toda verificação gravada: um item com `state: VERIFIED` e
  // `status: done` (legado preservado de propósito) voltava para
  // FIXED_PENDING_VERIFICATION — 29 itens fechados com teste aprovado
  // reapareciam como abertos. A migração só se aplica a item SEM `state`
  // canônico.
  const persistido = item && item.state ? String(item.state).toUpperCase() : null;
  const stateCanonico = persistido && Object.prototype.hasOwnProperty.call(ESTADOS, persistido)
    ? persistido
    : null;
  const estado = stateCanonico || MIGRACAO_LEGADO[legacyStatus] || ESTADOS.OPEN;
  const severity = severidadeDoItem(item);

  const defeito = {
    id: item.id,
    title: item.title || null,
    severity,
    state: estado,
    legacyStatus,
    commit: item.commit || null,
    evidence: item.evidence || null,
    regressionTest: item.regressionTest || null,
    verificationCommit: item.verificationCommit || null,
    stateSource: stateCanonico ? 'PERSISTIDO' : 'MIGRADO_DO_STATUS',
    // Só é `true` quando alguém REGISTROU que o teste direcionado passou neste
    // código. Ausência não é sucesso (missão §3: relatório não substitui execução).
    targetedTestPassing: item.targetedTestPassing === true,
    blockedReason: item.blocked_reason || null,
    touches: Array.isArray(item.touches) ? item.touches : [],
  };

  // ── CAMADA B: PROVA DE FECHAMENTO ────────────────────────────────────────
  // O `state` declarado é PROJEÇÃO. Quem decide se o defeito ainda bloqueia
  // certificação é a prova verificada contra o código ATUAL, o livro de transições
  // e a assinatura de autoridade registrada. Sem prova válida, um `RESOLVED`
  // escrito à mão continua bloqueando (defeito do bypass de 2026-10-22).
  defeito.estadoDeclarado = estado;
  defeito.stateEfetivo = estado;
  defeito.provaDeFechamento = null;
  defeito.fechamentoNaoProvado = false;

  if (ESTADOS_FECHADOS.includes(estado)) {
    if (!opcoesDeFechamento) {
      // Sem contexto NÃO se presume fechado: fail-closed explícito.
      defeito.fechamentoNaoProvado = true;
      defeito.provaDeFechamento = { ok: false, code: 'CONTEXTO_DE_VERIFICACAO_AUSENTE', reasons: ['CONTEXTO_DE_VERIFICACAO_AUSENTE'] };
    } else {
      const prova = carregarProvaDoItem(item, opcoesDeFechamento);
      const veredito = prova && prova.__ilegivel
        ? { ok: false, code: 'PROVA_MALFORMADA', reasons: ['PROVA_MALFORMADA'] }
        : (prova
          ? verificarProvaDeFechamento(prova, { ...opcoesDeFechamento, defeito })
          : { ok: false, code: 'PROVA_DE_FECHAMENTO_AUSENTE', reasons: ['PROVA_DE_FECHAMENTO_AUSENTE'] });
      defeito.provaDeFechamento = { ok: veredito.ok, code: veredito.code || null, reasons: veredito.reasons || [], detalhe: veredito.detalhe || {} };
      if (!veredito.ok) {
        defeito.fechamentoNaoProvado = true;
        defeito.stateEfetivo = ESTADOS.OPEN;
      }
    }
  }

  defeito.aberto = estaAberto({ ...defeito, state: defeito.stateEfetivo });
  defeito.bloqueanteParaCertificacao = eBloqueanteParaCertificacao({ ...defeito, state: defeito.stateEfetivo });
  return defeito;
}

/**
 * Carrega e migra a fila oficial.
 * @param {{queuePath?: string}} [opcoes]
 * @returns {{defeitos:Array, resumo:object, origem:string, geradoEm:string}}
 */
function carregarInventario(opcoes = {}) {
  // `path.resolve` de propósito: o auditor de persistência (RAP-078) só reconhece
  // contexto de LEITURA quando o `path.join` está DENTRO de `fs.readFileSync(...)`.
  // Aqui o caminho é resolvido numa variável e lido depois, então `path.join`
  // virava "alvo de ESCRITA fantasma" da fila no inventário. `path.resolve`
  // produz o mesmo caminho sem o falso positivo.
  const queuePath = opcoes.queuePath
    // Override EXPLÍCITO para testes: sem ele, testes de RECUSA passam a depender do
    // estado vivo da fila e ficam vermelhos exatamente quando todos os defeitos são
    // fechados (medido em 2026-10-17). A política não muda: só o CAMINHO do inventário.
    || (process.env.BUG_CLOSURE_INVENTORY_PATH && String(process.env.BUG_CLOSURE_INVENTORY_PATH).trim())
    || path.resolve(__dirname, '..', '..', 'AI_MEMORY', 'hardening-queue.json');

  if (!fs.existsSync(queuePath)) {
    const erro = new Error(`${CODIGOS.FILA_AUSENTE}: ${queuePath} não existe`);
    erro.code = CODIGOS.FILA_AUSENTE;
    throw erro;
  }

  let fila;
  try {
    fila = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch (e) {
    const erro = new Error(`${CODIGOS.FILA_ILEGIVEL}: ${e.message}`);
    erro.code = CODIGOS.FILA_ILEGIVEL;
    throw erro;
  }

  if (!fila || !Array.isArray(fila.items)) {
    const erro = new Error(`${CODIGOS.FILA_MALFORMADA}: sem array \`items\``);
    erro.code = CODIGOS.FILA_MALFORMADA;
    throw erro;
  }

  // Só monta o contexto (e calcula fingerprint) quando ALGUM item declara fechamento:
  // o cálculo percorre as fontes do repositório e não pode onerar toda leitura da fila.
  const declaraFechamento = fila.items.some((i) => i && ESTADOS_FECHADOS.includes(String(i.state || '').toUpperCase()));
  let contexto = opcoes.opcoesDeFechamento || null;
  if (!contexto && declaraFechamento && (opcoes.currentCommit || opcoes.currentFingerprint || opcoes.livro)) {
    contexto = montarContextoDeFechamento({
      rootDir: opcoes.rootDir,
      currentCommit: opcoes.currentCommit,
      currentFingerprint: opcoes.currentFingerprint,
      autoridades: opcoes.autoridades,
      livro: opcoes.livro,
      livroPath: opcoes.livroPath,
      agora: opcoes.agora,
    });
  }
  if (!contexto && declaraFechamento) {
    let fingerprint = null;
    try {
      // eslint-disable-next-line global-require
      fingerprint = require('../proof-engine/fingerprint-chain').computeSourceFingerprint(path.resolve(__dirname, '..', '..'));
    } catch (_) {
      fingerprint = null;
    }
    let commit = null;
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (_) {
      commit = null;
    }
    contexto = montarContextoDeFechamento({ currentCommit: commit, currentFingerprint: fingerprint });
  }

  const defeitos = fila.items.map((item) => migrarItem(item, contexto));

  const resumo = {
    total: defeitos.length,
    porEstado: {},
    porSeveridade: {},
    abertos: 0,
    bloqueantesParaCertificacao: 0,
    semSeveridadeAbertos: 0,
    bloqueioExterno: 0,
    riscoAceito: 0,
  };

  for (const d of defeitos) {
    resumo.porEstado[d.state] = (resumo.porEstado[d.state] || 0) + 1;
    const sev = d.severity || 'NAO_DECLARADA';
    resumo.porSeveridade[sev] = (resumo.porSeveridade[sev] || 0) + 1;
    if (d.aberto) resumo.abertos += 1;
    if (d.bloqueanteParaCertificacao) resumo.bloqueantesParaCertificacao += 1;
    if (d.aberto && !d.severity) resumo.semSeveridadeAbertos += 1;
    if (d.state === ESTADOS.BLOCKED_EXTERNAL) resumo.bloqueioExterno += 1;
    if (d.fechamentoNaoProvado) resumo.fechamentoNaoProvado = (resumo.fechamentoNaoProvado || 0) + 1;
    if (d.state === ESTADOS.RISK_ACCEPTED) resumo.riscoAceito += 1;
  }

  return {
    origem: queuePath,
    geradoEm: new Date().toISOString(),
    defeitos,
    resumo,
  };
}

module.exports = { carregarInventario, migrarItem, montarContextoDeFechamento, CODIGOS };
