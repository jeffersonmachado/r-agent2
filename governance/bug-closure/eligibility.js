'use strict';

/**
 * BUG CLOSURE FIRST — GATE CENTRAL DE ELEGIBILIDADE.
 *
 * `evaluateExecutionEligibility(context, operation)` decide se uma operação pode
 * COMEÇAR. É a única autoridade: backend, CLI, workers, scheduler e scripts de
 * processo longo devem consultá-la (missão §4).
 *
 * MOTIVAÇÃO MEDIDA (2026-10-17): a plataforma executava convergência completa
 * (~40-60 min, QA Mesh dentro), selo V2 (21 passos) e empacotamento mesmo com
 * defeitos P0 conhecidos ABERTOS — inclusive os dois P0 criptográficos da cadeia
 * (cadeia vazia e elo obrigatório ausente podendo certificar). O resultado era
 * relatório de qualidade extenso sobre uma base com defeitos que podiam ser
 * corrigidos naquele momento. Esta função inverte a prioridade: primeiro fechar
 * defeito, depois produzir prova.
 *
 * FAIL-CLOSED: contexto incompleto (sem SHA, sem inventário de defeitos, operação
 * desconhecida, ator sem permissão) NUNCA autoriza operação crítica. Na dúvida,
 * nega — e diz exatamente o que falta.
 */

const {
  ESTADOS,
  SEVERIDADES,
  normalizarSeveridade,
  eBloqueanteParaCertificacao,
} = require('./defect-states');

/** Operações controladas (nome canônico em maiúsculas). */
const OPERACOES = Object.freeze({
  DIAGNOSTICO: 'DIAGNOSTICO',
  REPRODUCAO: 'REPRODUCAO',
  CORRECAO_CODIGO: 'CORRECAO_CODIGO',
  TESTES_DIRECIONADOS: 'TESTES_DIRECIONADOS',
  TESTES_NEGATIVOS_REGRESSAO: 'TESTES_NEGATIVOS_REGRESSAO',
  L0_COMPLETO: 'L0_COMPLETO',
  L1_AMPLO: 'L1_AMPLO',
  L2_L3_EXTENSIVO: 'L2_L3_EXTENSIVO',
  QA_WAVES_COMPLETA: 'QA_WAVES_COMPLETA',
  REPLAY_MASSIVO: 'REPLAY_MASSIVO',
  CONVERGENCIA_COMPLETA: 'CONVERGENCIA_COMPLETA',
  SELO_FINAL: 'SELO_FINAL',
  PUBLICACAO_RELEASE: 'PUBLICACAO_RELEASE',
});

/** Operações que PODEM gerar certificação (as demais são diagnóstico/correção). */
const OPERACOES_CERTIFICANTES = Object.freeze([
  OPERACOES.L2_L3_EXTENSIVO,
  OPERACOES.QA_WAVES_COMPLETA,
  OPERACOES.REPLAY_MASSIVO,
  OPERACOES.CONVERGENCIA_COMPLETA,
  OPERACOES.SELO_FINAL,
  OPERACOES.PUBLICACAO_RELEASE,
]);

/**
 * Matriz de política (missão §4), expressa em termos do que cada operação exige.
 *
 * `comP0` / `comP1`: 'PERMITIDO' | 'CONDICIONAL' | 'BLOQUEADO'
 * Condicional = só libera se TODOS os defeitos abertos tiverem teste direcionado
 * aprovado registrado (o que prova que a correção está em andamento com sinal
 * verde) — e nunca produz certificação.
 */
const POLITICA = Object.freeze({
  [OPERACOES.DIAGNOSTICO]: { comP0: 'PERMITIDO', comP1: 'PERMITIDO', certifica: false },
  [OPERACOES.REPRODUCAO]: { comP0: 'PERMITIDO', comP1: 'PERMITIDO', certifica: false },
  [OPERACOES.CORRECAO_CODIGO]: { comP0: 'PERMITIDO', comP1: 'PERMITIDO', certifica: false },
  [OPERACOES.TESTES_DIRECIONADOS]: { comP0: 'PERMITIDO', comP1: 'PERMITIDO', certifica: false },
  [OPERACOES.TESTES_NEGATIVOS_REGRESSAO]: { comP0: 'PERMITIDO', comP1: 'PERMITIDO', certifica: false },
  [OPERACOES.L0_COMPLETO]: { comP0: 'CONDICIONAL', comP1: 'CONDICIONAL', certifica: false },
  [OPERACOES.L1_AMPLO]: { comP0: 'BLOQUEADO', comP1: 'CONDICIONAL', certifica: false },
  [OPERACOES.L2_L3_EXTENSIVO]: { comP0: 'BLOQUEADO', comP1: 'BLOQUEADO', certifica: true },
  [OPERACOES.QA_WAVES_COMPLETA]: { comP0: 'BLOQUEADO', comP1: 'BLOQUEADO', certifica: true },
  [OPERACOES.REPLAY_MASSIVO]: { comP0: 'BLOQUEADO', comP1: 'BLOQUEADO', certifica: true },
  [OPERACOES.CONVERGENCIA_COMPLETA]: { comP0: 'BLOQUEADO', comP1: 'BLOQUEADO', certifica: true },
  [OPERACOES.SELO_FINAL]: { comP0: 'BLOQUEADO', comP1: 'BLOQUEADO', certifica: true },
  [OPERACOES.PUBLICACAO_RELEASE]: { comP0: 'BLOQUEADO', comP1: 'BLOQUEADO', certifica: true },
});

/** Códigos de recusa/observação (estruturados, nunca texto solto). */
const CODIGOS = Object.freeze({
  OPERACAO_DESCONHECIDA: 'OPERACAO_DESCONHECIDA',
  SHA_AUSENTE: 'SHA_AUSENTE',
  INVENTARIO_AUSENTE: 'INVENTARIO_AUSENTE',
  ATOR_AUSENTE: 'ATOR_AUSENTE',
  P0_ABERTO: 'P0_ABERTO',
  P1_BLOQUEANTE_ABERTO: 'P1_BLOQUEANTE_ABERTO',
  SEVERIDADE_NAO_DECLARADA: 'SEVERIDADE_NAO_DECLARADA',
  TESTE_DIRECIONADO_PENDENTE: 'TESTE_DIRECIONADO_PENDENTE',
  DIAGNOSTICO_NAO_CERTIFICANTE: 'DIAGNOSTICO_NAO_CERTIFICANTE',
  BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO: 'BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO',
  RISCO_ACEITO_REGISTRADO: 'RISCO_ACEITO_REGISTRADO',
  RISCO_ACEITO_INEFICAZ: 'RISCO_ACEITO_INEFICAZ',
  CONTROLE_CRITICO_NAO_DISPENSAVEL: 'CONTROLE_CRITICO_NAO_DISPENSAVEL',
  CERTIFICACAO_AUSENTE: 'CERTIFICACAO_AUSENTE',
});

/**
 * CONTROLES INEGOCIÁVEIS (defeito P0 medido em 2026-10-19 contra `9758f828f`).
 *
 * `RISK_ACCEPTED` era descartado ANTES da avaliação de severidade: um P0 de
 * integridade criptográfica marcado como risco aceito liberava QA Waves. Isto
 * misturava aceitação ADMINISTRATIVA com elegibilidade TÉCNICA.
 *
 * Regras novas:
 *   - P0 NUNCA é dispensável por status, em nenhuma política (inclui P0 crítico);
 *   - P1 só é dispensável quando a aceitação é VÁLIDA (responsável, justificativa,
 *     validade futura, escopo declarado) e NÃO é de controle crítico;
 *   - aceitação vencida/sem responsável/sem justificativa é INEFICAZ: o defeito
 *     volta a contar como aberto.
 */
const CONTROLES_CRITICOS = Object.freeze([
  'CRYPTOGRAPHIC_INTEGRITY',
  'CHAIN_INTEGRITY',
  'AUTHORIZATION',
  'TENANT_ISOLATION',
  'DATA_LOSS',
  'CERTIFICATION_EVIDENCE',
]);

/** Lê os controles críticos declarados num defeito (campo explícito ou categoria). */
function controlesCriticosDoDefeito(d) {
  const declarados = [];
  const push = (v) => {
    if (v && typeof v === 'string') declarados.push(v.trim().toUpperCase());
  };
  push(d && d.control);
  push(d && d.criticalControl);
  if (Array.isArray(d && d.controls)) (d.controls || []).forEach(push);
  if (Array.isArray(d && d.categories)) (d.categories || []).forEach(push);
  if (d && typeof d.category === 'string') push(d.category);
  const unicos = [...new Set(declarados)];
  return unicos.filter((c) => CONTROLES_CRITICOS.includes(c));
}

/**
 * Valida uma aceitação administrativa de risco. Retorna `{ valida, critico, motivo }`.
 * Ineficaz ⇒ o defeito continua contando como aberto (fail-closed).
 */
function avaliarAceitacaoDeRisco(d, agora = new Date()) {
  if (!d) return { valida: false, critico: false, motivo: 'DEFEITO_AUSENTE' };

  const critico = controlesCriticosDoDefeito(d).length > 0;
  const responsavel = d.riskAcceptedBy || d.acceptedBy || d.owner;
  const justificativa = d.riskAcceptedReason || d.acceptanceReason || d.justification;
  const expira = d.riskAcceptedExpiresAt || d.expiresAt || d.expiration;

  if (!NAO_VAZIO(responsavel)) return { valida: false, critico, motivo: 'ACEITACAO_SEM_RESPONSAVEL' };
  if (!NAO_VAZIO(justificativa)) return { valida: false, critico, motivo: 'ACEITACAO_SEM_JUSTIFICATIVA' };
  if (!NAO_VAZIO(expira)) return { valida: false, critico, motivo: 'ACEITACAO_SEM_VALIDADE' };

  const data = new Date(expira);
  if (Number.isNaN(data.getTime())) return { valida: false, critico, motivo: 'ACEITACAO_VALIDADE_INVALIDA' };
  if (data.getTime() <= agora.getTime()) return { valida: false, critico, motivo: 'ACEITACAO_VENCIDA' };

  // Aceitação de controle crítico nunca é válida para dispensar bloqueio técnico.
  if (critico) return { valida: false, critico: true, motivo: 'CONTROLE_CRITICO_NAO_DISPENSAVEL' };

  return { valida: true, critico: false, motivo: null };
}

const DECISOES = Object.freeze({
  ALLOWED: 'ALLOWED',
  ALLOWED_DIAGNOSTIC_ONLY: 'ALLOWED_DIAGNOSTIC_ONLY',
  DENIED: 'DENIED',
});

const NAO_VAZIO = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const SHA_VALIDO = (v) => /^[0-9a-f]{7,40}$/i.test(String(v || ''));

/**
 * Classifica os defeitos do inventário.
 * @param {Array<object>} defeitos itens com { id, state, severity, targetedTestPassing? }
 */
function classificarDefeitos(defeitos) {
  const p0 = [];
  const p1 = [];
  const naoDeclarada = [];
  const riscoAceito = [];
  const riscoAceitoIneficaz = [];
  const bloqueioExterno = [];

  for (let d of Array.isArray(defeitos) ? defeitos : []) {
    if (!d) continue;
    const sev = normalizarSeveridade(d.severity);
    const estado = String(d.state || '').toUpperCase();

    // RISK_ACCEPTED só dispensa quando a aceitação é VÁLIDA **e** o defeito não é
    // P0 nem controla um mecanismo crítico. Caso contrário cai na classificação
    // normal e bloqueia como qualquer aberto (defeito P0 de 2026-10-19).
    if (estado === ESTADOS.RISK_ACCEPTED) {
      const avaliacao = avaliarAceitacaoDeRisco(d);
      riscoAceito.push(d);
      const dispensa = avaliacao.valida && sev !== SEVERIDADES.P0;
      if (dispensa) continue;
      riscoAceitoIneficaz.push({
        id: d.id,
        severity: sev,
        motivo: avaliacao.motivo || (sev === SEVERIDADES.P0 ? 'P0_NAO_DISPENSAVEL' : null),
        controlesCriticos: controlesCriticosDoDefeito(d),
      });
      // Aceitação ineficaz mantém o defeito TECNICAMENTE ABERTO: o estado de
      // risco aceito não pode ser lido como "fechado" pelo predicado de bloqueio.
      d = { ...d, state: ESTADOS.OPEN };
    }
    // Bloqueio EXTERNO continua contando para certificação (missão §3).
    if (estado === ESTADOS.BLOCKED_EXTERNAL) bloqueioExterno.push(d);

    if (!eBloqueanteParaCertificacao({ ...d, severity: sev })) {
      // P2/P3 abertos não bloqueiam operação crítica.
      continue;
    }
    if (sev === null) { naoDeclarada.push(d); continue; }
    if (sev === SEVERIDADES.P0) p0.push(d);
    else if (sev === SEVERIDADES.P1) p1.push(d);
  }

  return { p0, p1, naoDeclarada, riscoAceito, riscoAceitoIneficaz, bloqueioExterno };
}

/** Todos os defeitos que precisam de teste direcionado aprovado para liberar condicional. */
function exigemTesteDirecionado(defeitos) {
  // DEFEITO MEDIDO (2026-10-17): a lista aplicava a exigência a defeitos JÁ FECHADOS.
  // Os 23 itens fechados antes deste mecanismo não têm `targetedTestPassing` (o campo não
  // existia), então `L0_COMPLETO` era negado para sempre com o motivo enganoso
  // "TESTE_DIRECIONADO_PENDENTE" apontando para P0/P1 já provados. A exigência é sobre
  // defeito ABERTO pendente de prova.
  //
  // Regra final (não afrouxa aberto):
  //   - VERIFIED     => já verificado, não exige teste novo;
  //   - RISK_ACCEPTED => excluído por definição;
  //   - RESOLVED     => exige teste novo A MENOS que qualquer prova esteja registrada
  //                     (`targetedTestPassing`, `verificationCommit` ou o `commit` do fix) —
  //                     é o caso dos itens fechados por processos anteriores;
  //   - demais (aberto) => exige sempre que for P0/P1/severidade não declarada. Um `commit`
  //                     no item aberto NÃO isenta: prova de fix não é prova de regressão.
  const PROVA_SHA = /^[0-9a-f]{7,40}$/i;
  return (Array.isArray(defeitos) ? defeitos : []).filter((d) => {
    const sev = normalizarSeveridade(d && d.severity);
    const estado = String((d && d.state) || '').toUpperCase();
    if (estado === ESTADOS.RISK_ACCEPTED) {
      const avaliacao = avaliarAceitacaoDeRisco(d);
      // Só dispensa teste quando a aceitação é válida e não é P0/controle crítico.
      const dispensa = avaliacao.valida && sev !== SEVERIDADES.P0;
      if (dispensa) return false;
      return sev === SEVERIDADES.P0 || sev === SEVERIDADES.P1 || sev === null;
    }
    if (estado === ESTADOS.VERIFIED) return false;
    if (estado === ESTADOS.RESOLVED) {
      const prova = d && (d.targetedTestPassing === true
        || PROVA_SHA.test(String(d.verificationCommit || '').trim())
        || PROVA_SHA.test(String(d.commit || '').trim()));
      return !prova;
    }
    return sev === SEVERIDADES.P0 || sev === SEVERIDADES.P1 || sev === null;
  });
}

/**
 * Decide se uma operação pode começar.
 *
 * @param {object} context
 *   commit          SHA do código avaliado (obrigatório)
 *   defects         inventário de defeitos (obrigatório; array, mesmo vazio)
 *   missionId       identidade da missão (obrigatório p/ certificantes)
 *   actor           { id, permissions? } (obrigatório)
 *   environment     'dev' | 'ci' | 'prod'
 *   budgetMs        orçamento de execução declarado
 *   diagnosticPurpose boolean — exceção restrita para L1_AMPLO com P0
 *   riskAcceptanceAllowed boolean
 * @param {string} operation
 * @returns {{allowed:boolean, decision:string, blockingFindings:Array, requiredActions:string[],
 *            evidenceRefs:string[], reasonCodes:string[], evaluatedCommit:string|null,
 *            operation:string, diagnosticOnly:boolean}}
 */
function evaluateExecutionEligibility(context = {}, operation) {
  const reasonCodes = [];
  const blockingFindings = [];
  const requiredActions = [];
  const evidenceRefs = [];

  const op = String(operation || '').toUpperCase();
  const politica = POLITICA[op];

  // ── Fail-closed: contexto mínimo ───────────────────────────────────────────
  if (!politica) {
    return {
      allowed: false,
      decision: DECISOES.DENIED,
      operation: operation || null,
      diagnosticOnly: false,
      evaluatedCommit: null,
      blockingFindings: [{ code: CODIGOS.OPERACAO_DESCONHECIDA, detail: `operação não é controlada: ${operation}` }],
      requiredActions: ['declarar a operação no catálogo OPERACOES (governance/bug-closure/eligibility.js)'],
      evidenceRefs: [],
      reasonCodes: [CODIGOS.OPERACAO_DESCONHECIDA],
    };
  }

  if (!SHA_VALIDO(context.commit)) {
    reasonCodes.push(CODIGOS.SHA_AUSENTE);
    blockingFindings.push({ code: CODIGOS.SHA_AUSENTE, detail: 'commit/SHA do código não informado — autorização seria sobre código indeterminado' });
    requiredActions.push('informar o SHA exato do código avaliado (`git rev-parse HEAD`)');
  }
  if (!Array.isArray(context.defects)) {
    reasonCodes.push(CODIGOS.INVENTARIO_AUSENTE);
    blockingFindings.push({ code: CODIGOS.INVENTARIO_AUSENTE, detail: 'inventário de defeitos ausente — ausência de inventário NÃO significa ausência de defeitos' });
    requiredActions.push('carregar o inventário (AI_MEMORY/hardening-queue.json) antes de autorizar');
  }
  if (!NAO_VAZIO(context.actor && context.actor.id)) {
    reasonCodes.push(CODIGOS.ATOR_AUSENTE);
    blockingFindings.push({ code: CODIGOS.ATOR_AUSENTE, detail: 'ator não identificado' });
    requiredActions.push('identificar o ator (missão/worker/CLI) que solicita a operação');
  }

  if (reasonCodes.length > 0) {
    return {
      allowed: false,
      decision: DECISOES.DENIED,
      operation: op,
      diagnosticOnly: false,
      evaluatedCommit: SHA_VALIDO(context.commit) ? String(context.commit) : null,
      blockingFindings,
      requiredActions,
      evidenceRefs,
      reasonCodes,
    };
  }

  const {
    p0, p1, naoDeclarada, riscoAceito, riscoAceitoIneficaz, bloqueioExterno,
  } = classificarDefeitos(context.defects);

  // "Publicação solicitada sem certificação" (missão §11 #20): operação de
  // publicação exige referência de certificação válida no contexto. Sem ela, nega
  // mesmo que não exista defeito aberto — fail-closed.
  if (op === OPERACOES.PUBLICACAO_RELEASE && !NAO_VAZIO(context.certification)) {
    reasonCodes.push(CODIGOS.CERTIFICACAO_AUSENTE);
    blockingFindings.push({ code: CODIGOS.CERTIFICACAO_AUSENTE, detail: 'publicação exige referência de certificação (CERTIFIED_GO) no contexto' });
    requiredActions.push('anexar a certificação canônica antes de autorizar publicação');
  }

  for (const d of riscoAceito) {
    reasonCodes.push(CODIGOS.RISCO_ACEITO_REGISTRADO);
    evidenceRefs.push(`defect:${d.id}:RISK_ACCEPTED`);
  }
  // Aceitação ineficaz NÃO dispensa: registra o motivo e mantém o bloqueio vivo.
  for (const item of riscoAceitoIneficaz) {
    if (!reasonCodes.includes(CODIGOS.RISCO_ACEITO_INEFICAZ)) reasonCodes.push(CODIGOS.RISCO_ACEITO_INEFICAZ);
    if (item.motivo === 'CONTROLE_CRITICO_NAO_DISPENSAVEL'
      && !reasonCodes.includes(CODIGOS.CONTROLE_CRITICO_NAO_DISPENSAVEL)) {
      reasonCodes.push(CODIGOS.CONTROLE_CRITICO_NAO_DISPENSAVEL);
    }
    blockingFindings.push({
      code: CODIGOS.RISCO_ACEITO_INEFICAZ,
      defectId: item.id,
      severity: item.severity,
      detail: item.motivo,
      controlesCriticos: item.controlesCriticos,
    });
  }
  if (riscoAceitoIneficaz.length > 0) {
    requiredActions.push('corrigir a aceitação de risco (responsável, justificativa e validade futura) ou fechar o defeito — P0 e controles críticos nunca são dispensáveis');
  }
  for (const d of bloqueioExterno) {
    // Observação obrigatória: bloqueio externo não é fechamento.
    if (!reasonCodes.includes(CODIGOS.BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO)) {
      reasonCodes.push(CODIGOS.BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO);
    }
    evidenceRefs.push(`defect:${d.id}:BLOCKED_EXTERNAL`);
  }

  // ── Regra dura: P0 aberto bloqueia tudo que certifica ──────────────────────
  const bloquearP0 = p0.length > 0 && politica.comP0 === 'BLOQUEADO';
  const bloquearP1 = p1.length > 0 && politica.comP1 === 'BLOQUEADO';

  if (bloquearP0) {
    reasonCodes.push(CODIGOS.P0_ABERTO);
    for (const d of p0) {
      blockingFindings.push({ code: CODIGOS.P0_ABERTO, defectId: d.id, severity: 'P0', state: d.state, detail: d.title || null });
    }
    requiredActions.push('fechar (VERIFIED com teste de regressão) todos os defeitos P0 antes desta operação');
  }
  if (bloquearP1) {
    reasonCodes.push(CODIGOS.P1_BLOQUEANTE_ABERTO);
    for (const d of p1) {
      blockingFindings.push({ code: CODIGOS.P1_BLOQUEANTE_ABERTO, defectId: d.id, severity: 'P1', state: d.state, detail: d.title || null });
    }
    requiredActions.push('fechar (VERIFIED com teste de regressão) todos os defeitos P1 bloqueantes antes desta operação');
  }

  // Severidade não declarada nunca é tratada como inofensiva.
  if (naoDeclarada.length > 0 && politica.certifica) {
    reasonCodes.push(CODIGOS.SEVERIDADE_NAO_DECLARADA);
    for (const d of naoDeclarada) {
      blockingFindings.push({ code: CODIGOS.SEVERIDADE_NAO_DECLARADA, defectId: d.id, state: d.state, detail: d.title || null });
    }
    requiredActions.push('classificar a severidade (P0..P3) de todo defeito aberto — severidade ausente não é P3');
  }

  // ── Condicional: exige teste direcionado aprovado ───────────────────────────
  // O requisito incide sobre os defeitos ATIVOS (escopo declarado da missão) ou,
  // sem escopo, sobre todos os abertos. O bloqueio de P0/P1 para operação
  // certificante continua GLOBAL — escopo não afrouxa certificação.
  let condicionalPendente = false;
  if ((politica.comP0 === 'CONDICIONAL' || politica.comP1 === 'CONDICIONAL')) {
    const escopo = Array.isArray(context.activeDefectIds) && context.activeDefectIds.length
      ? new Set(context.activeDefectIds)
      : null;
    const exigidos = exigemTesteDirecionado(context.defects)
      .filter((d) => (escopo ? escopo.has(d.id) : true));
    const semTeste = exigidos.filter((d) => d.targetedTestPassing !== true);
    if (semTeste.length > 0) {
      condicionalPendente = true;
      reasonCodes.push(CODIGOS.TESTE_DIRECIONADO_PENDENTE);
      for (const d of semTeste) {
        blockingFindings.push({ code: CODIGOS.TESTE_DIRECIONADO_PENDENTE, defectId: d.id, severity: normalizarSeveridade(d.severity), state: d.state, detail: d.title || null });
      }
      requiredActions.push('registrar teste direcionado APROVADO (targetedTestPassing=true) para cada defeito aberto antes de ampliar a execução');
    }
  }

  // ── Exceção diagnóstica (restrita, incapaz de certificar) ──────────────────
  const excecaoDiagnostica = bloquearP0
    && context.diagnosticPurpose === true
    && op === OPERACOES.L1_AMPLO;

  if (excecaoDiagnostica) {
    reasonCodes.push(CODIGOS.DIAGNOSTICO_NAO_CERTIFICANTE);
    return {
      allowed: true,
      decision: DECISOES.ALLOWED_DIAGNOSTIC_ONLY,
      operation: op,
      diagnosticOnly: true,
      evaluatedCommit: String(context.commit),
      blockingFindings,
      requiredActions,
      evidenceRefs,
      reasonCodes,
    };
  }

  const negado = bloquearP0 || bloquearP1 || condicionalPendente
    || (naoDeclarada.length > 0 && politica.certifica)
    || (op === OPERACOES.PUBLICACAO_RELEASE && !NAO_VAZIO(context.certification));

  return {
    allowed: !negado,
    decision: negado ? DECISOES.DENIED : DECISOES.ALLOWED,
    operation: op,
    // Operação que não certifica nunca "vira" certificação.
    diagnosticOnly: politica.certifica === false && negado === false
      ? false
      : politica.certifica === false,
    evaluatedCommit: String(context.commit),
    blockingFindings,
    requiredActions,
    evidenceRefs,
    reasonCodes,
  };
}

module.exports = {
  OPERACOES,
  OPERACOES_CERTIFICANTES,
  POLITICA,
  CODIGOS,
  DECISOES,
  classificarDefeitos,
  evaluateExecutionEligibility,
  avaliarAceitacaoDeRisco,
  controlesCriticosDoDefeito,
  CONTROLES_CRITICOS,
};
