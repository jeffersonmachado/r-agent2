'use strict';

/**
 * Síntese fundamentada do "Perguntar à IA" (A8) + proveniência tipada (A9).
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): a resposta era CONCATENAÇÃO —
 * "**Aluno — dados atuais**" + bullets de fato + a resposta do RAG colada
 * embaixo. Três defeitos reais decorrem disso:
 *
 *  1. o leitor não distingue FATO (veio do domínio) de CONHECIMENTO (veio de
 *     documento) — tudo aparece como texto corrido equivalente;
 *  2. nada diz o que os fatos SIGNIFICAM juntos (matrícula ativa + frequência
 *     caindo + sinal de risco é uma conclusão, não uma lista);
 *  3. a conclusão derivada não é atribuída — parece fato quando é inferência.
 *
 * Aqui a resposta é MONTADA a partir de fatos classificados, com cada bloco
 * rotulado pela sua origem:
 *
 *   SITUAÇÃO (fato)      — estado corrente da entidade, em frase
 *   EVIDÊNCIAS (fato)    — medidas, datas e sinais que sustentam a situação
 *   INFERÊNCIA           — leitura combinada dos fatos, explicitamente derivada
 *   RECOMENDAÇÃO/MÉTODO  — conhecimento documental aplicável (nunca fato)
 *   LACUNAS              — o que não foi possível confirmar
 *
 * Determinístico (zero LLM): a síntese é construída de regras sobre chaves
 * canônicas de fato. Nada é afirmado sem fonte — um fato ausente não vira
 * frase.
 */

const { sanitizeUntrustedContent } = require('./injectionGuard');

const FACT_KINDS = Object.freeze({
  STATE: 'STATE',
  MEASURE: 'MEASURE',
  DATE: 'DATE',
  SIGNAL: 'SIGNAL',
  OTHER: 'OTHER',
});

const PROVENANCE_TYPES = Object.freeze({
  FACT: 'FACT',
  KNOWLEDGE: 'KNOWLEDGE',
  INFERENCE: 'INFERENCE',
  RECOMMENDATION: 'RECOMMENDATION',
});

/** Classificação por chave canônica de fato (o vocabulário é fechado). */
const FACT_KIND_BY_KEY = Object.freeze({
  membershipStatus: FACT_KINDS.STATE,
  billingStatus: FACT_KINDS.STATE,
  accessAllowed: FACT_KINDS.STATE,
  latestBillingStatus: FACT_KINDS.STATE,
  dueDate: FACT_KINDS.DATE,
  lastVisit: FACT_KINDS.DATE,
  latestBillingAt: FACT_KINDS.DATE,
  signalCreatedAt: FACT_KINDS.DATE,
  frequency7d: FACT_KINDS.MEASURE,
  frequency30d: FACT_KINDS.MEASURE,
  daysSinceLastVisit: FACT_KINDS.MEASURE,
  billingEvents: FACT_KINDS.MEASURE,
  signalType: FACT_KINDS.SIGNAL,
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function factKindOf(key) {
  return FACT_KIND_BY_KEY[String(key)] || FACT_KINDS.OTHER;
}

function factValue(facts, key) {
  const found = (facts || []).find((fact) => fact.key === key);
  return found ? String(found.value) : null;
}

/**
 * Lê um fato NUMÉRICO distinguindo AUSÊNCIA de zero.
 *
 * `Number(null)` é 0: tratar ausência como zero fabricava conclusões
 * ("apenas 0 visitas em 30 dias" quando a frequência nem foi consultada).
 */
function numericFact(facts, key) {
  const raw = factValue(facts, key);
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeText(value) {
  const sanitized = sanitizeUntrustedContent(String(value));
  return sanitized.text;
}

/**
 * SITUAÇÃO — frase única montada SOMENTE com fatos presentes.
 * Fato ausente não é mencionado (nunca "sem informação" dentro da frase).
 */
function buildSituationSentence({ entityLabel, facts }) {
  const subject = isNonEmptyString(entityLabel) ? entityLabel : 'entidade';
  const clauses = [];

  const membership = factValue(facts, 'membershipStatus');
  if (membership) clauses.push(`matrícula ${membership}`);

  const billing = factValue(facts, 'billingStatus') || factValue(facts, 'latestBillingStatus');
  if (billing) clauses.push(`financeiro ${billing}`);

  const access = factValue(facts, 'accessAllowed');
  if (access) clauses.push(`acesso ${access === 'sim' ? 'liberado' : 'bloqueado'}`);

  const days = factValue(facts, 'daysSinceLastVisit');
  const freq30 = factValue(facts, 'frequency30d');
  if (days && freq30) {
    clauses.push(`${freq30} visita(s) em 30 dias, ${days} dia(s) sem comparecer`);
  } else if (freq30) {
    clauses.push(`${freq30} visita(s) em 30 dias`);
  } else if (days) {
    clauses.push(`${days} dia(s) sem comparecer`);
  }

  if (clauses.length === 0) return null;
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)}: ${clauses.join('; ')}.`;
}

/**
 * INFERÊNCIA — leitura combinada dos fatos. Só é emitida quando os fatos que a
 * sustentam existem; nunca é apresentada como fato.
 */
function buildInference({ facts }) {
  const signal = factValue(facts, 'signalType');
  const days = numericFact(facts, 'daysSinceLastVisit');
  const freq30 = numericFact(facts, 'frequency30d');
  const access = factValue(facts, 'accessAllowed');
  const billing = factValue(facts, 'billingStatus') || factValue(facts, 'latestBillingStatus');

  const reasons = [];
  if (isNonEmptyString(signal)) reasons.push(`sinal ${signal} registrado`);
  if (days !== null && days >= 7) reasons.push(`${days} dias sem comparecer`);
  if (freq30 !== null && freq30 <= 1) reasons.push(`apenas ${freq30} visita(s) em 30 dias`);
  if (billing && /OVERDUE|PENDING|LATE|ATRAS|PENDENTE/i.test(billing)) reasons.push(`financeiro ${billing}`);
  if (access === 'não') reasons.push('acesso bloqueado');

  if (reasons.length < 2) return null;

  return {
    text: `Inferência (a partir dos dados acima): ${reasons.join('; ')}.`,
    basis: reasons,
  };
}

/**
 * Bloco de valores observados — rótulo + valor, na ordem em que as tools os
 * devolveram. Mantém a granularidade exata (o operador pode precisar do valor
 * bruto) e serve de lastro verificável para a frase de situação e para a
 * inferência.
 */
function buildEvidenceLines(facts) {
  const lines = [];
  for (const fact of facts || []) {
    const label = fact.label || fact.key;
    lines.push(`- ${label}: ${fact.value}`);
  }
  return lines;
}

/**
 * Monta a resposta fundamentada.
 *
 * @returns {{answer: string, provenance: {items: Array, inference: string|null, recommendation: string}}}
 */
function buildGroundedSynthesis({
  intent,
  entityLabel,
  facts = [],
  knowledgeAnswer = null,
  deniedTools = [],
  failedTools = [],
  accessDenied = false,
} = {}) {
  const items = [];
  const parts = [];

  if (accessDenied) {
    parts.push('Não consegui confirmar o acesso a esta entidade com as suas permissões. Nenhum dado operacional foi consultado.');
    return {
      answer: parts.join('\n\n'),
      provenance: { items, inference: null, recommendation: 'none' },
    };
  }

  for (const fact of facts) {
    items.push({ type: PROVENANCE_TYPES.FACT, key: fact.key, label: fact.label || fact.key, kind: factKindOf(fact.key) });
  }

  const situation = buildSituationSentence({ entityLabel, facts });
  const evidenceLines = buildEvidenceLines(facts);

  if (situation || evidenceLines.length > 0) {
    const header = entityLabel ? `**${entityLabel} — situação**` : '**Situação**';
    const block = [situation, evidenceLines.length > 0 ? evidenceLines.join('\n') : null]
      .filter(Boolean)
      .join('\n');
    parts.push(`${header}\n${block}`);
  }

  const inference = buildInference({ facts });
  if (inference) {
    parts.push(inference.text);
    items.push({ type: PROVENANCE_TYPES.INFERENCE, basis: inference.basis });
  }

  if (failedTools.length > 0) {
    parts.push(`_Com os dados disponíveis:_ não consegui confirmar ${failedTools.map((t) => t.label.toLowerCase()).join(', ')} com as fontes disponíveis.`);
  }

  if (knowledgeAnswer) {
    // Conhecimento documental entra ROTULADO — nunca se confunde com o estado
    // observado da entidade.
    const sanitized = sanitizeText(knowledgeAnswer);
    const header = intent === 'MIXED'
      ? '**Método aplicável (documentação operacional)**'
      : '**Conhecimento (documentação operacional)**';
    parts.push(`${header}\n${sanitized}`);
    items.push({ type: PROVENANCE_TYPES.KNOWLEDGE, label: 'documentação operacional' });
    items.push({ type: PROVENANCE_TYPES.RECOMMENDATION, label: 'documentação operacional' });
  }

  if (deniedTools.length > 0) {
    parts.push(`Você não possui acesso a: ${deniedTools.map((t) => t.label).join(', ')}.`);
  }

  if (parts.length === 0) {
    parts.push('Não consegui encontrar informação para responder com segurança. Tente reformular a pergunta.');
  }

  return {
    answer: parts.join('\n\n'),
    provenance: {
      items,
      inference: inference ? inference.text : null,
      recommendation: knowledgeAnswer ? 'knowledge-document' : 'none',
    },
  };
}

module.exports = {
  FACT_KINDS,
  PROVENANCE_TYPES,
  FACT_KIND_BY_KEY,
  factKindOf,
  buildSituationSentence,
  buildInference,
  numericFact,
  buildEvidenceLines,
  buildGroundedSynthesis,
};
