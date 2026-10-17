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

const {
  ESTADOS,
  MIGRACAO_LEGADO,
  severidadeDoItem,
  eBloqueanteParaCertificacao,
  estaAberto,
} = require('./defect-states');

const CODIGOS = Object.freeze({
  FILA_AUSENTE: 'FILA_AUSENTE',
  FILA_ILEGIVEL: 'FILA_ILEGIVEL',
  FILA_MALFORMADA: 'FILA_MALFORMADA',
});

/** Migra um item legado para o contrato canônico de defeito. */
function migrarItem(item) {
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

  defeito.aberto = estaAberto(defeito);
  defeito.bloqueanteParaCertificacao = eBloqueanteParaCertificacao(defeito);
  return defeito;
}

/**
 * Carrega e migra a fila oficial.
 * @param {{queuePath?: string}} [opcoes]
 * @returns {{defeitos:Array, resumo:object, origem:string, geradoEm:string}}
 */
function carregarInventario(opcoes = {}) {
  const queuePath = opcoes.queuePath
    || path.join(__dirname, '..', '..', 'AI_MEMORY', 'hardening-queue.json');

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

  const defeitos = fila.items.map(migrarItem);

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
    if (d.state === ESTADOS.RISK_ACCEPTED) resumo.riscoAceito += 1;
  }

  return {
    origem: queuePath,
    geradoEm: new Date().toISOString(),
    defeitos,
    resumo,
  };
}

module.exports = { carregarInventario, migrarItem, CODIGOS };
