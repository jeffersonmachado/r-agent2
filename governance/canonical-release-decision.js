'use strict';

/**
 * canonical-release-decision.js — AUTORIDADE ÚNICA da decisão de release (P0-4).
 *
 * DEFEITO MEDIDO (auditoria P0-4, 2026-10-16): existiam PELO MENOS OITO conjuntos
 * literais independentes de "o que é GO" (`canonical-decision.js`,
 * `seal-time-gate.js`, `validate-final-status-projection.js`,
 * `verify-payload-governance.js`, `final-consistency-gate.js`,
 * `generate-self-proving-report.js`, `config/mandatory-gate-dependencies.json`,
 * `decision-family.js`), com divergências materiais entre eles. Consequências
 * concretas encontradas no código:
 *   - `validate-self-proving.js` rejeitava só `/NO_GO/i`: `PASS_WITH_DEFERRED_PACKAGE_GATE`,
 *     `DELIVERED_PENDING_SCORECARD` e `CONTROLLED_PILOT` passavam como aprovados;
 *   - `tools/system/go-no-go.js` bloqueava só `NO_GO*`/`PENDING`;
 *   - `validate-engineering-router-v2-audit-items.js` tratava `GO_FAMILY` como
 *     "provado", incluindo `PASS_WITH_DEFERRED_PACKAGE_GATE` (estado PRÉ-pacote);
 *   - `api/services/engineeringRouter/releaseClosureService.js` aceitava
 *     `finalDecision.startsWith('PASS')`.
 *
 * Este módulo é a resposta: um vocabulário VERSIONADO, um classificador
 * fail-closed e a garantia explícita de que estado PRÉ-pacote NUNCA é lido como GO
 * definitivo. Módulo PURO (zero I/O) — quem lê arquivos é o consumidor.
 *
 * REGRA CENTRAL: literal de release desconhecido NÃO é final. Só os literais
 * declarados em `RELEASE_DECISION_LITERALS` como finais (ou o estado devolvido por
 * `clasificar` a partir de gates + selo + certificação + publicação + entrega)
 * produzem GO definitivo.
 */

/** Versão do vocabulário/decisão. Muda quando a semântica dos estados mudar. */
const DECISION_VERSION = '1.0.0';

/** Estados canônicos. Conjunto FECHADO — nada fora daqui é decisão válida. */
const STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  RUNNING: 'RUNNING',
  PRE_PACKAGE_PASS: 'PRE_PACKAGE_PASS',
  BLOCKED: 'BLOCKED',
  NO_GO: 'NO_GO',
  CERTIFIED_GO: 'CERTIFIED_GO',
  PUBLISHED_VERIFIED: 'PUBLISHED_VERIFIED',
});

/** Estados de GATE (escopo diferente do release — não confundir os vocabulários). */
const GATE_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  DEFERRED: 'DEFERRED',
  BLOCKED: 'BLOCKED',
  PENDING: 'PENDING',
});

/** Somente estes dois estados são GO DEFINITIVO. */
const FINAL_GO_STATES = Object.freeze([STATES.CERTIFIED_GO, STATES.PUBLISHED_VERIFIED]);

/**
 * Vocabulário LEGADO de decisão de RELEASE → estado canônico.
 *
 * Fonte única: qualquer consumidor que precise saber "isto é GO definitivo?"
 * pergunta AQUI, em vez de manter a sua própria lista. Fail-closed por construção:
 * o que não está declarado como final é PRÉ-pacote.
 */
const RELEASE_DECISION_LITERALS = Object.freeze({
  // ── Finais (GO de release) ────────────────────────────────────────────────
  AUTONOMOUS_READY_GO: STATES.CERTIFIED_GO,
  ENTERPRISE_READY_GO: STATES.CERTIFIED_GO,
  PUBLISHED_VERIFIED: STATES.PUBLISHED_VERIFIED,
  DELIVERED_RELEASE_VERIFIED: STATES.PUBLISHED_VERIFIED,
  // ── PRÉ-pacote: NÃO são GO definitivo, ainda que "pareçam" aprovados ──────
  PASS_WITH_DEFERRED_PACKAGE_GATE: STATES.PRE_PACKAGE_PASS,
  DELIVERED_PENDING_SCORECARD: STATES.PRE_PACKAGE_PASS,
  AUTONOMOUS_READY: STATES.PRE_PACKAGE_PASS,
  PRODUCTION_READY: STATES.PRE_PACKAGE_PASS,
  CONTROLLED_PILOT: STATES.PRE_PACKAGE_PASS,
  // ── Em andamento / não iniciado / bloqueio ───────────────────────────────
  IN_PROGRESS: STATES.RUNNING,
  RUNNING: STATES.RUNNING,
  PENDING: STATES.RUNNING,
  NOT_STARTED: STATES.NOT_STARTED,
  BLOCKED: STATES.BLOCKED,
});

/** O literal pertence ao vocabulário de RELEASE (e não ao de gate)? */
function isReleaseDecisionLiteral(value) {
  const texto = String(value == null ? '' : value).trim();
  return Object.prototype.hasOwnProperty.call(RELEASE_DECISION_LITERALS, texto);
}

/**
 * Classifica um literal de decisão de RELEASE.
 *
 * Fail-closed: literal desconhecido ⇒ PRE_PACKAGE_PASS (nunca final). É esta regra
 * que impede a classe de falso verde "estado pré-pacote lido como GO definitivo".
 *
 * @param {string|null|undefined} value
 * @returns {{state: string, reason: string, version: string}}
 */
function classifyReleaseDecision(value) {
  const texto = String(value == null ? '' : value).trim();
  if (texto === '') {
    return { state: STATES.NOT_STARTED, reason: 'DECISAO_AUSENTE', version: DECISION_VERSION };
  }
  if (/^NO_GO/i.test(texto)) {
    return { state: STATES.NO_GO, reason: 'LITERAL_NO_GO', version: DECISION_VERSION };
  }
  if (isReleaseDecisionLiteral(texto)) {
    return { state: RELEASE_DECISION_LITERALS[texto], reason: 'LITERAL_MAPEADO', version: DECISION_VERSION };
  }
  return { state: STATES.PRE_PACKAGE_PASS, reason: 'LITERAL_DESCONHECIDO_NAO_E_FINAL', version: DECISION_VERSION };
}

/** O estado é GO DEFINITIVO? */
function isFinalGo(state) {
  return FINAL_GO_STATES.includes(String(state));
}

/**
 * Um consumidor pode tratar este literal/estado como GO definitivo?
 *
 * @param {string} value literal de release OU um estado canônico
 * @param {{consumidor?: string}} [options] rótulo para a mensagem
 * @returns {{ok: boolean, state: string, version: string, reason: string, consumidor: string|null}}
 */
function exigirGoFinal(value, options = {}) {
  const consumidor = options.consumidor || null;
  const texto = String(value == null ? '' : value).trim();
  const jaEstado = Object.values(STATES).includes(texto);
  const base = jaEstado
    ? { state: texto, reason: 'ESTADO_CANONICO', version: DECISION_VERSION }
    : classifyReleaseDecision(texto);
  const ok = isFinalGo(base.state);
  return {
    ok,
    state: base.state,
    version: base.version,
    reason: ok ? 'GO_FINAL' : base.reason,
    consumidor,
  };
}

/**
 * Classifica a decisão de release a partir dos FATOS (gates + estágios).
 *
 * Precedência fail-closed: gate obrigatório FALHO ou DIFERIDO ⇒ NO_GO (bloqueio não
 * resolvido é bloqueio); BLOQUEADO ⇒ BLOCKED; PENDENTE ⇒ RUNNING; sem gates ⇒
 * NOT_STARTED. Só depois disso o avanço de estágio é considerado, e cada estágio
 * exige o anterior.
 *
 * @param {{gates?: Array<{id: string, status: string, obrigatorio?: boolean}>,
 *   selado?: boolean, certificado?: boolean, publicado?: boolean,
 *   entregaVerificada?: boolean, identidade?: object}} [input]
 * @returns {{state: string, version: string, reason: string, identity: object|null}}
 */
function clasificar(input = {}) {
  const gates = Array.isArray(input.gates) ? input.gates : [];
  const obrigatorios = gates.filter((g) => g && g.obrigatorio !== false);
  const porStatus = (alvo) => obrigatorios.filter((g) => String(g.status || '').toUpperCase() === alvo);
  const ids = (lista) => lista.map((g) => g.id).join(',');
  const decidir = (state, reason) => ({
    state,
    version: DECISION_VERSION,
    reason,
    identity: input.identidade || null,
  });

  if (obrigatorios.length === 0) return decidir(STATES.NOT_STARTED, 'SEM_GATES_DECLARADOS');

  const falhos = porStatus(GATE_STATUS.FAIL);
  if (falhos.length > 0) return decidir(STATES.NO_GO, `GATE_OBRIGATORIO_FALHOU:${ids(falhos)}`);

  const diferidos = porStatus(GATE_STATUS.DEFERRED);
  if (diferidos.length > 0) return decidir(STATES.NO_GO, `GATE_OBRIGATORIO_DIFERIDO:${ids(diferidos)}`);

  const bloqueados = porStatus(GATE_STATUS.BLOCKED);
  if (bloqueados.length > 0) return decidir(STATES.BLOCKED, `GATE_OBRIGATORIO_BLOQUEADO:${ids(bloqueados)}`);

  const pendentes = obrigatorios.filter((g) => {
    const s = String(g.status || '').toUpperCase();
    return s === GATE_STATUS.PENDING || s === '';
  });
  if (pendentes.length > 0) return decidir(STATES.RUNNING, `GATES_PENDENTES:${pendentes.length}`);

  if (!input.selado) return decidir(STATES.PRE_PACKAGE_PASS, 'PACOTE_NAO_SELADO');
  if (!input.certificado) return decidir(STATES.PRE_PACKAGE_PASS, 'NAO_CERTIFICADO');
  if (input.publicado && !input.entregaVerificada) {
    return decidir(STATES.CERTIFIED_GO, 'PUBLICADO_SEM_ENTREGA_VERIFICADA');
  }
  if (input.publicado && input.entregaVerificada) {
    return decidir(STATES.PUBLISHED_VERIFIED, 'ENTREGA_VERIFICADA');
  }
  return decidir(STATES.CERTIFIED_GO, 'CERTIFICADO');
}

const IDENTITY_FIELDS = Object.freeze(['runId', 'sourceCommit', 'sourceFingerprint', 'releaseId']);

/**
 * A decisão é da MESMA identidade do candidato corrente?
 *
 * Identidade incompatível invalida o GO: uma decisão de outro run/commit é prova de
 * OUTRO artefato.
 *
 * @param {{identity?: object}|object} decision decisão (com `identity`) ou a própria identidade
 * @param {object} identidadeAtual
 * @returns {{ok: boolean, divergentes: string[]}}
 */
function identidadeCoerente(decision, identidadeAtual = {}) {
  const daDecisao = (decision && decision.identity) || {};
  const divergentes = [];
  for (const campo of IDENTITY_FIELDS) {
    const a = daDecisao[campo];
    const b = identidadeAtual[campo];
    if (a == null || b == null || a === '' || b === '') continue;
    if (String(a) !== String(b)) divergentes.push(campo);
  }
  return { ok: divergentes.length === 0, divergentes };
}

module.exports = {
  DECISION_VERSION,
  STATES,
  GATE_STATUS,
  FINAL_GO_STATES,
  RELEASE_DECISION_LITERALS,
  IDENTITY_FIELDS,
  isReleaseDecisionLiteral,
  classifyReleaseDecision,
  isFinalGo,
  exigirGoFinal,
  clasificar,
  identidadeCoerente,
};
