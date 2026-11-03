'use strict';

/**
 * BUG CLOSURE FIRST — estados canônicos de defeito, severidade e transições.
 *
 * MISSÃO (2026-10-17): nenhum mecanismo pode executar convergência completa, QA
 * Waves massivas, replay de certificação, selagem ou empacotamento enquanto
 * existirem defeitos P0 ou P1 bloqueantes que ainda possam ser corrigidos.
 *
 * DEFEITO DO ESTADO ANTERIOR (medido): a fila oficial (`AI_MEMORY/hardening-queue.json`)
 * tinha 93 itens com os campos {id, title, status, commit, evidence} e os estados
 * legados `done | verified | prevention_active | blocked | blocked_external | pending`.
 * Consequências reais:
 *   - `done` era lido como "resolvido" mesmo sem teste de regressão e sem verificação
 *     em SHA atual;
 *   - `blocked` (item impossível) e `blocked_external` (dependência de terceiro)
 *     ambos saíam da lista de pendências, e com isso um bloqueio EXTERNO deixava de
 *     bloquear certificação;
 *   - NÃO existia severidade: nada distinguia P0 de P3, então nenhum gate podia
 *     priorizar correção sobre relatório.
 *
 * Este módulo estabelece o contrato: estados e severidade são INDEPENDENTES, as
 * transições são validadas com motivo estruturado e nenhuma transição de
 * fechamento é aceita sem prova.
 */

/** Estados canônicos. Nome em maiúsculas é a autoridade (não há alias silencioso). */
const ESTADOS = Object.freeze({
  OPEN: 'OPEN',
  REPRODUCED: 'REPRODUCED',
  FIX_IN_PROGRESS: 'FIX_IN_PROGRESS',
  FIXED_PENDING_VERIFICATION: 'FIXED_PENDING_VERIFICATION',
  VERIFIED: 'VERIFIED',
  RESOLVED: 'RESOLVED',
  BLOCKED_EXTERNAL: 'BLOCKED_EXTERNAL',
  RISK_ACCEPTED: 'RISK_ACCEPTED',
});

/** Severidade, independente do estado. */
const SEVERIDADES = Object.freeze({ P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3' });

/** Estados que AINDA exigem ação de engenharia (nenhum deles é fechamento). */
const ESTADOS_ABERTOS = Object.freeze([
  ESTADOS.OPEN,
  ESTADOS.REPRODUCED,
  ESTADOS.FIX_IN_PROGRESS,
  ESTADOS.FIXED_PENDING_VERIFICATION,
]);

/** Estados de fechamento. `BLOCKED_EXTERNAL` NÃO é fechamento para certificação. */
const ESTADOS_FECHADOS = Object.freeze([
  ESTADOS.VERIFIED,
  ESTADOS.RESOLVED,
  ESTADOS.RISK_ACCEPTED,
]);

/**
 * Transições permitidas. A chave é o estado de origem; o valor, o conjunto de
 * destinos aceitos. Qualquer transição fora daqui é recusada com motivo.
 *
 * Regra dura: não existe salto de OPEN direto para RESOLVED — a correção precisa
 * ser reproduzida, testada e verificada em SHA atual.
 */
const TRANSICOES = Object.freeze({
  [ESTADOS.OPEN]: [ESTADOS.REPRODUCED, ESTADOS.BLOCKED_EXTERNAL, ESTADOS.RISK_ACCEPTED],
  [ESTADOS.REPRODUCED]: [ESTADOS.FIX_IN_PROGRESS, ESTADOS.BLOCKED_EXTERNAL, ESTADOS.RISK_ACCEPTED],
  [ESTADOS.FIX_IN_PROGRESS]: [ESTADOS.FIXED_PENDING_VERIFICATION, ESTADOS.BLOCKED_EXTERNAL, ESTADOS.RISK_ACCEPTED],
  [ESTADOS.FIXED_PENDING_VERIFICATION]: [ESTADOS.VERIFIED, ESTADOS.FIX_IN_PROGRESS, ESTADOS.BLOCKED_EXTERNAL],
  // Reabertura por regressão: VERIFIED/RESOLVED podem voltar a OPEN (nunca direto a VERIFIED).
  [ESTADOS.VERIFIED]: [ESTADOS.RESOLVED, ESTADOS.OPEN, ESTADOS.RISK_ACCEPTED],
  [ESTADOS.RESOLVED]: [ESTADOS.OPEN],
  [ESTADOS.BLOCKED_EXTERNAL]: [ESTADOS.OPEN, ESTADOS.FIX_IN_PROGRESS],
  [ESTADOS.RISK_ACCEPTED]: [ESTADOS.OPEN],
});

/**
 * Controles que aceitação de risco NUNCA dispensa (missão §3).
 * Se o defeito toca um destes, `RISK_ACCEPTED` é recusado.
 */
const CONTROLES_INEGOCIAVEIS = Object.freeze([
  'INTEGRIDADE_CRIPTOGRAFICA',
  'IDENTIDADE',
  'AUTORIZACAO',
  'GATE_OBRIGATORIO',
]);

/**
 * Mapa de migração dos estados LEGADOS da fila para os canônicos.
 * Preserva o valor original em `legacyStatus` (nada é apagado) e NÃO promove
 * fechamento sem prova: `done` vira FIXED_PENDING_VERIFICATION até existir
 * verificação registrada.
 */
const MIGRACAO_LEGADO = Object.freeze({
  pending: ESTADOS.OPEN,
  in_progress: ESTADOS.FIX_IN_PROGRESS,
  failed: ESTADOS.OPEN,
  done: ESTADOS.FIXED_PENDING_VERIFICATION,
  verified: ESTADOS.VERIFIED,
  // `prevention_active` significa "corrigido e com regra preventiva ativa" — é
  // fechamento de engenharia, mas continua exigindo commit + evidência (checado
  // em `validarTransicao`/`validarFechamento`).
  prevention_active: ESTADOS.RESOLVED,
  ready_for_approval: ESTADOS.FIXED_PENDING_VERIFICATION,
  blocked: ESTADOS.OPEN,
  // Bloqueio EXTERNO não é fechamento e não pode ser usado para liberar
  // certificação: permanece no conjunto que o gate consulta.
  blocked_external: ESTADOS.BLOCKED_EXTERNAL,
});

const NAO_VAZIO = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** Motivos estruturados de recusa (nunca string solta). */
const MOTIVOS = Object.freeze({
  ESTADO_DESCONHECIDO: 'ESTADO_DESCONHECIDO',
  TRANSICAO_INVALIDA: 'TRANSICAO_INVALIDA',
  FECHAMENTO_SEM_TESTE_REGRESSAO: 'FECHAMENTO_SEM_TESTE_REGRESSAO',
  FECHAMENTO_SEM_EVIDENCIA: 'FECHAMENTO_SEM_EVIDENCIA',
  FECHAMENTO_SEM_VERIFICACAO: 'FECHAMENTO_SEM_VERIFICACAO',
  VERIFICACAO_EM_SHA_ANTERIOR: 'VERIFICACAO_EM_SHA_ANTERIOR',
  REVISAO_NAO_INDEPENDENTE: 'REVISAO_NAO_INDEPENDENTE',
  RISCO_NAO_PERMITIDO: 'RISCO_NAO_PERMITIDO',
  RISCO_EM_CONTROLE_INEGOCIAVEL: 'RISCO_EM_CONTROLE_INEGOCIAVEL',
  SEVERIDADE_INVALIDA: 'SEVERIDADE_INVALIDA',
  SEVERIDADE_NAO_DECLARADA: 'SEVERIDADE_NAO_DECLARADA',
  DEPENDENCIA_ABERTA: 'DEPENDENCIA_ABERTA',
});

function normalizarSeveridade(valor) {
  const s = String(valor || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(SEVERIDADES, s) ? s : null;
}

/**
 * Deriva a severidade de um item legado. A fila real usa prefixos de ID
 * (`P0-CADEIA-…`, `P1-ENTREGA-…`, `P2-…`), que são a única informação de
 * severidade disponível hoje. Sem prefixo e sem campo, a severidade fica
 * NÃO DECLARADA — e o gate trata isso como fail-closed.
 */
function derivarSeveridadeDoId(id) {
  // Aceita o id como string OU o item inteiro: passar o objeto por engano
  // devolvia `null` silenciosamente (medido em 2026-10-17 na migração da fila,
  // onde os 93 itens saíram como "severidade não declarada").
  const bruto = (id && typeof id === 'object') ? (id.id || id.ID) : id;
  const texto = String(bruto || '');
  // Prefixo canônico (P0-1) ou marcador em ID composto
  // (HARDENING-ENG-GOV-RELEASE-P0-7).
  const m = /^P([0-3])[-\s]/i.exec(texto) || /[-_ ]P([0-3])[-_ ]/i.exec(texto);
  return m ? `P${m[1]}` : null;
}

/** Severidade efetiva de um item da fila (campo explícito tem precedência). */
function severidadeDoItem(item) {
  return normalizarSeveridade(item && item.severity) || derivarSeveridadeDoId(item && item.id);
}

/**
 * Um defeito está ABERTO? (contra o fechamento real, não contra o vocabulário
 * legado). `BLOCKED_EXTERNAL` conta como aberto para fins de CERTIFICAÇÃO.
 */
function estaAberto(defeito) {
  const estado = defeito && defeito.state;
  return ESTADOS_ABERTOS.includes(estado) || estado === ESTADOS.BLOCKED_EXTERNAL;
}

/** Bloqueante para certificação: aberto e severidade P0/P1 (ou não declarada). */
function eBloqueanteParaCertificacao(defeito) {
  if (!defeito) return false;
  const sev = normalizarSeveridade(defeito.severity);
  const fechado = ESTADOS_FECHADOS.includes(defeito.state);
  if (fechado) return false;
  // P0/P1 abertos bloqueiam. Severidade não declarada também bloqueia (fail-closed):
  // um defeito sem classificação não pode ser presumido inofensivo.
  if (sev === null) return true;
  return sev === SEVERIDADES.P0 || sev === SEVERIDADES.P1;
}

/**
 * Valida uma transição de estado com todas as provas exigidas.
 *
 * @param {object} entrada
 * @param {string} entrada.de   estado atual
 * @param {string} entrada.para estado desejado
 * @param {string} [entrada.severity]
 * @param {string} [entrada.regressionTest] caminho/ID do teste de regressão
 * @param {string} [entrada.evidence]       caminho da evidência
 * @param {string} [entrada.fixCommit]
 * @param {string} [entrada.verificationCommit] SHA em que a verificação rodou
 * @param {string} [entrada.currentCommit]      SHA atual do código
 * @param {string[]} [entrada.touches]      controles afetados
 * @param {boolean} [entrada.riskAcceptanceAllowed]
 * @returns {{ok:boolean, code:string|null, reasons:string[], detail?:string}}
 */
function validarTransicao(entrada = {}) {
  const { de, para } = entrada;
  const reasons = [];

  if (!Object.prototype.hasOwnProperty.call(ESTADOS, String(de))) {
    reasons.push(MOTIVOS.ESTADO_DESCONHECIDO);
  }
  if (!Object.prototype.hasOwnProperty.call(ESTADOS, String(para))) {
    reasons.push(MOTIVOS.ESTADO_DESCONHECIDO);
  }
  if (reasons.length) {
    return { ok: false, code: reasons[0], reasons, detail: `estado inválido: de=${de} para=${para}` };
  }

  const permitidos = TRANSICOES[de] || [];
  if (!permitidos.includes(para)) {
    return {
      ok: false,
      code: MOTIVOS.TRANSICAO_INVALIDA,
      reasons: [MOTIVOS.TRANSICAO_INVALIDA],
      detail: `${de} -> ${para} não é transição permitida (aceitas: ${permitidos.join(', ') || 'nenhuma'})`,
    };
  }

  // ── Provas de fechamento ────────────────────────────────────────────────────
  const exigeTeste = para === ESTADOS.FIXED_PENDING_VERIFICATION || para === ESTADOS.VERIFIED || para === ESTADOS.RESOLVED;
  if (exigeTeste && !NAO_VAZIO(entrada.regressionTest)) {
    reasons.push(MOTIVOS.FECHAMENTO_SEM_TESTE_REGRESSAO);
  }
  if ((para === ESTADOS.VERIFIED || para === ESTADOS.RESOLVED) && !NAO_VAZIO(entrada.evidence)) {
    reasons.push(MOTIVOS.FECHAMENTO_SEM_EVIDENCIA);
  }

  // "Não aceitar autorrevisão como revisão independente quando independência for
  // obrigatória" (missão §9). Só checa quando o chamador declara a exigência.
  if (entrada.independentReviewRequired === true
      && NAO_VAZIO(entrada.reviewedBy)
      && NAO_VAZIO(entrada.author)
      && String(entrada.reviewedBy) === String(entrada.author)) {
    reasons.push(MOTIVOS.REVISAO_NAO_INDEPENDENTE);
  }

  // VERIFIED exige verificação em SHA CONCRETO do histórico do código atual.
  //
  // DEFEITO CORRIGIDO (2026-10-22): antes exigia `verificationCommit === currentCommit`
  // literalmente. Isso tornava a certificação IMPOSSÍVEL por construção: a prova é um
  // artefato que precisa ser commitado, e commitar muda o HEAD — então toda prova nascia
  // "de outro SHA". Foi essa circularidade que empurrou 130 itens para "fechados" por edição
  // manual da fila, sem prova.
  //
  // A intenção original ("um teste aprovado em SHA antigo não comprova correção no código
  // atual") continua garantida pela Igualdade de CONTEÚDO: `closure-proof` exige que o
  // `codeFingerprint` gravado na prova seja o fingerprint do código ATUAL. Aqui, o commit
  // medido tem de ser o próprio HEAD ou um ANCESTRAL dele (prova não pode vir do futuro nem
  // de outro branch).
  if (para === ESTADOS.VERIFIED) {
    if (!NAO_VAZIO(entrada.verificationCommit)) {
      reasons.push(MOTIVOS.FECHAMENTO_SEM_VERIFICACAO);
    } else if (NAO_VAZIO(entrada.currentCommit)) {
      const mesmoCommit = String(entrada.verificationCommit).toLowerCase() === String(entrada.currentCommit).toLowerCase();
      const ancestral = typeof entrada.ehAncestralDe === 'function'
        ? entrada.ehAncestralDe(entrada.verificationCommit, entrada.currentCommit) === true
        : false;
      if (!mesmoCommit && !ancestral) {
        reasons.push(MOTIVOS.VERIFICACAO_EM_SHA_ANTERIOR);
      }
    }
  }

  // -- Aceitação de risco --------------------------------------------------
  if (para === ESTADOS.RISK_ACCEPTED) {
    if (entrada.riskAcceptanceAllowed !== true) {
      reasons.push(MOTIVOS.RISCO_NAO_PERMITIDO);
    }
    const toca = Array.isArray(entrada.touches) ? entrada.touches : [];
    if (toca.some((c) => CONTROLES_INEGOCIAVEIS.includes(c))) {
      // "Aceitação de risco não pode dispensar integridade criptográfica,
      //  identidade, autorização ou gates obrigatórios."
      reasons.push(MOTIVOS.RISCO_EM_CONTROLE_INEGOCIAVEL);
    }
  }

  if (reasons.length) {
    return { ok: false, code: reasons[0], reasons, detail: `transição ${de} -> ${para} recusada` };
  }
  return { ok: true, code: null, reasons: [] };
}

module.exports = {
  ESTADOS,
  SEVERIDADES,
  ESTADOS_ABERTOS,
  ESTADOS_FECHADOS,
  TRANSICOES,
  CONTROLES_INEGOCIAVEIS,
  MIGRACAO_LEGADO,
  MOTIVOS,
  normalizarSeveridade,
  derivarSeveridadeDoId,
  severidadeDoItem,
  estaAberto,
  eBloqueanteParaCertificacao,
  validarTransicao,
};
