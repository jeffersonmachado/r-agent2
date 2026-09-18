'use strict';

/**
 * Semantic Extractor — transforma um `*_SIGNAL` classificado em FORMA
 * ESTRUTURADA: verbo + objeto de negócio + desfecho/comportamento.
 *
 * Ex.: "Members can freeze their memberships directly from the app"
 *      → `{ verb: 'freeze', object: 'membership', outcome: 'directly from the app',
 *          form: 'membership.freeze' }`
 *
 * Regras de negócio ganham estrutura própria `{ condition, rule, effect,
 * exceptions }` quando os elementos existem no texto ("freeze allowed up to 30
 * days per year" → condition: active membership; rule: freeze max 30 days;
 * effect: suspends billing/access; exceptions: ...). Regra que não rende NENHUM
 * elemento estruturado NÃO é promovida: vira `UNRESOLVED_SEMANTIC_CANDIDATE`.
 *
 * Tudo que resiste à estruturação é UNRESOLVED — auditável, persistido e
 * NUNCA contado como novidade canônica (isso é decidido na camada de serviço;
 * aqui o candidato só nasce com o status correto).
 */

const { normalizeTerm, tokenize } = require('../benchmarkResearchSemantics');
const { OBSERVATION_TYPES } = require('./observationClassifier');

const SEMANTIC_STATUS = Object.freeze({
  NORMALIZED: 'NORMALIZED',
  UNRESOLVED: 'UNRESOLVED_SEMANTIC_CANDIDATE',
});

/**
 * Verbo canônico por token observado. A forma normalizada usa ESTE vocabulário
 * para que "congela", "freeze" e "congelamento" produzam a mesma forma.
 */
const VERB_CANONICAL_MAP = Object.freeze({
  freeze: 'freeze', congela: 'freeze', congelar: 'freeze', congelamento: 'freeze', trancamento: 'freeze',
  pause: 'pause', pausa: 'pause',
  cancel: 'cancel', cancela: 'cancel', cancelar: 'cancel', cancelamento: 'cancel',
  suspend: 'suspend', suspende: 'suspend', suspensao: 'suspend', bloqueia: 'block', bloqueio: 'block', block: 'block', blocked: 'block',
  reactivate: 'reactivate', reativar: 'reactivate', reativacao: 'reactivate',
  expire: 'expire', expira: 'expire', expiracao: 'expire', vencimento: 'expire',
  book: 'book', booking: 'book', agenda: 'book', agendar: 'book', agendamento: 'book', schedule: 'book', reserva: 'book', reservar: 'book',
  charge: 'charge', cobra: 'charge', cobrar: 'charge', billing: 'charge', bill: 'charge', collect: 'charge', receba: 'charge', receber: 'charge',
  pay: 'pay', paga: 'pay', pagar: 'pay', payment: 'pay', pagamento: 'pay',
  manage: 'manage', management: 'manage', gestao: 'manage', gerenciamento: 'manage', administracao: 'manage', administre: 'manage',
  control: 'control', controle: 'control',
  track: 'track', tracking: 'track', acompanhe: 'track', monitoramento: 'track',
  send: 'send', envia: 'send', enviar: 'send', envio: 'send', notify: 'notify', notifica: 'notify', lembrete: 'notify', reminder: 'notify',
  create: 'create', cria: 'create', criar: 'create', crie: 'create', cadastro: 'register', cadastre: 'register', register: 'register', registro: 'register',
  sell: 'sell', venda: 'sell', vender: 'sell', vendas: 'sell', sale: 'sell',
  issue: 'issue', emite: 'issue', emitir: 'issue', emissao: 'issue',
  generate: 'generate', gera: 'generate', gerar: 'generate',
  sync: 'sync', sincroniza: 'sync', integrate: 'integrate', integra: 'integrate', integracao: 'integrate',
  import: 'import', importa: 'import', export: 'export', exporta: 'export',
  // §P0-SEMANTICS: `check` NÃO tem forma canônica própria — a forma depende do
  // CONTEXTO e é resolvida em `resolveContextualVerb`. Antes desta correção o
  // mapa dizia `check: 'checkin'`, e o texto de marketing "We check our
  // recurring payments constantly" virava `payment.checkin` — um check-in de
  // academia atribuído a verificação de cobrança. Palavra isolada não é verbo.
  checkin: 'checkin', 'check-in': 'checkin', libera: 'grant_access', liberacao: 'grant_access',
  verify: 'verify', verifica: 'verify', verificar: 'verify', verifique: 'verify', conferir: 'verify', confere: 'verify',
  consult: 'verify', consulta: 'verify', consultar: 'verify',
  prescribe: 'prescribe', prescricao: 'prescribe', prescreve: 'prescribe',
  evaluate: 'evaluate', avalia: 'evaluate', avaliacao: 'evaluate',
  automate: 'automate', automatiza: 'automate', automacao: 'automate',
  automatic: 'automate', automatica: 'automate', automatico: 'automate', automaticas: 'automate', automaticos: 'automate',
  recorrente: 'recurring', recurring: 'recurring', recurrence: 'recurring', recorrencia: 'recurring',
});

/** Objeto canônico por token observado. */
const OBJECT_CANONICAL_MAP = Object.freeze({
  membership: 'membership', memberships: 'membership', matricula: 'membership', matriculas: 'membership',
  member: 'member', members: 'member', aluno: 'member', alunos: 'member', membro: 'member', membros: 'member', cliente: 'member', clientes: 'member',
  payment: 'payment', payments: 'payment', pagamento: 'payment', pagamentos: 'payment',
  billing: 'billing', cobranca: 'billing', cobrancas: 'billing',
  invoice: 'invoice', invoices: 'invoice', fatura: 'invoice', faturas: 'invoice',
  mensalidade: 'subscription_fee', mensalidades: 'subscription_fee',
  receivable: 'receivable', recebiveis: 'receivable', receita: 'revenue',
  checkin: 'checkin', 'check-in': 'checkin', 'check-ins': 'checkin',
  catraca: 'turnstile', catracas: 'turnstile', turnstile: 'turnstile',
  access: 'access', acesso: 'access',
  class: 'class', classes: 'class', aula: 'class', aulas: 'class',
  booking: 'booking', bookings: 'booking', agendamento: 'booking', agendamentos: 'booking',
  schedule: 'schedule', scheduling: 'schedule', reserva: 'booking', reservas: 'booking',
  waitlist: 'waitlist',
  workout: 'workout', workouts: 'workout', treino: 'workout', treinos: 'workout', wod: 'workout',
  plan: 'plan', plans: 'plan', plano: 'plan', planos: 'plan',
  subscription: 'subscription', subscriptions: 'subscription', assinatura: 'subscription', assinaturas: 'subscription',
  contract: 'contract', contracts: 'contract', contrato: 'contract', contratos: 'contract',
  report: 'report', reports: 'report', relatorio: 'report', relatorios: 'report', dashboard: 'report',
  crm: 'crm', lead: 'lead', leads: 'lead',
  app: 'app', aplicativo: 'app', portal: 'portal',
  pos: 'pos', venda: 'sale', vendas: 'sale', produto: 'product', produtos: 'product',
  avaliacao: 'assessment', avaliacoes: 'assessment',
  treinador: 'staff', trainer: 'staff', staff: 'staff', equipe: 'staff', professor: 'staff',
  despesa: 'expense', despesas: 'expense', caixa: 'cash_register', estoque: 'inventory', inventory: 'inventory',
  payroll: 'payroll', comissao: 'commission', comissoes: 'commission',
});

const CONDITION_RE = /\b(?:when|quando|if|se |in case of|em caso de|upon|ao |ap[oó]s|after|assim que)\b(.{3,80}?)(?:[,.;]|$)/i;
const LIMIT_RE = /\b(?:up to|at[eé]|maximum of|m[aá]ximo de|no m[aá]ximo)\s+(\d+)\s*(days?|dias?|months?|meses|mes|weeks?|semanas?|times?|vezes)\b(?:\s*(?:per|por|a cada)\s*(year|ano|month|m[eê]s|semester|semestre))?/i;
const EFFECT_RE = /\b(?:suspends?|suspende|pauses?|pausa|blocks?|bloqueia|extends?|estende|prorroga|charges?|cobra|cancels?|cancela|grants?|libera|prevents?|impede|stops?|interrompe)\b(.{3,80}?)(?:[,.;]|$)/i;
const EXCEPTION_RE = /\b(?:except|exceto|unless|a menos que|salvo|desde que n[aã]o)\b(.{3,80}?)(?:[,.;]|$)/i;
const OUTCOME_RE = /\b(?:directly from|diretamente (do|pelo|de)|from the app|pelo aplicativo|pelo app|no aplicativo|without|sem precisar|sem uso de|so that|para que|de modo que)\b(.{0,80})$/i;

function firstCanonical(tokens, map) {
  for (const token of tokens) {
    if (map[token]) return map[token];
  }
  return null;
}

/**
 * §P0-SEMANTICS — Contexto de CHECK-IN (entrada física de pessoa).
 *
 * Só existe check-in quando o texto declara ENTRADA de uma PESSOA em um local:
 *   - a forma composta `checkin` / `check-in` (sem ambiguidade);
 *   - `check <pessoa> in` ("Check members in at the front desk");
 *   - `check in at/to/no/na ...` ("check in at the front desk").
 *
 * O verbo nu `check` NÃO é check-in: "check payments", "check invoices",
 * "payment status check" são VERIFICAÇÃO de um objeto de negócio.
 */
const COMPOUND_CHECKIN_RE = /\bcheck-?ins?\b/i;
const CHECK_PERSON_IN_RE = /\bcheck(?:ing)?\s+(?:the\s+|a\s+|an\s+|our\s+|your\s+|os\s+|as\s+)?(?:members?|students?|alunos?|membros?|clientes?|guests?|visitantes?|users?|usu[aá]rios?|people|kids|crian[cç]as?)\s+in\b/i;
const CHECK_INTO_PLACE_RE = /\bcheck\s+in\s+(?:at|to|into|no|na|em|nas|nos)\b/i;

/**
 * Verbo canônico do token, com o desempate CONTEXTUAL de `check`.
 *
 * @param {string} verbToken
 * @param {string[]} tokens
 * @param {string} text
 * @returns {string|null}
 */
function resolveContextualVerb(verbToken, tokens = [], text = '') {
  if (!verbToken) return null;
  if (verbToken !== 'check') return VERB_CANONICAL_MAP[verbToken] || null;

  const raw = String(text || '');
  const isCheckIn = COMPOUND_CHECKIN_RE.test(raw)
    || CHECK_PERSON_IN_RE.test(raw)
    || CHECK_INTO_PLACE_RE.test(raw);
  if (isCheckIn) return 'checkin';

  // `check` sobre um objeto de negócio é VERIFICAÇÃO. Sem objeto, não há
  // semântica determinável — devolve null para o candidato seguir como
  // UNRESOLVED em vez de receber uma forma inventada.
  return objectAfterVerb(tokens, 'check') ? 'verify' : null;
}

/**
 * Objeto de negócio do candidato: o PRIMEIRO token-objeto DEPOIS do verbo
 * ("freeze their memberships" → membership), caindo para o primeiro objeto do
 * texto quando o verbo vem depois ("Cobrança recorrente").
 */
function objectAfterVerb(tokens, verbToken) {
  const verbIndex = verbToken ? tokens.indexOf(verbToken) : -1;
  const after = verbIndex >= 0 ? tokens.slice(verbIndex + 1) : tokens;
  for (const token of after) {
    if (OBJECT_CANONICAL_MAP[token] && token !== verbToken) return OBJECT_CANONICAL_MAP[token];
  }
  return firstCanonical(tokens.filter((token) => token !== verbToken), OBJECT_CANONICAL_MAP);
}

/** Primeiro token que é verbo de ação do produto. */
function verbTokenOf(tokens) {
  for (const token of tokens) {
    if (VERB_CANONICAL_MAP[token]) return token;
  }
  return null;
}

function captureOrNull(re, text) {
  const match = String(text).match(re);
  if (!match) return null;
  const captured = (match[1] !== undefined ? match[0] : match[0]).trim();
  return captured.length > 0 ? captured : null;
}

/**
 * Extrai a forma estruturada de regra de negócio: `{ condition, rule, effect,
 * exceptions }`. Cada campo é o trecho REAL do texto — nunca reescrito.
 */
function extractStructuredRule(text) {
  const condition = captureOrNull(CONDITION_RE, text);
  const limit = captureOrNull(LIMIT_RE, text);
  const effect = captureOrNull(EFFECT_RE, text);
  const exceptions = captureOrNull(EXCEPTION_RE, text);
  // A regra é o enunciado central do texto (limitação/ação declarada).
  const rule = limit || (captureOrNull(EFFECT_RE, text) === null ? null : null);
  const structured = {
    condition: condition || null,
    rule: limit || null,
    effect: effect || null,
    exceptions: exceptions || null,
  };
  const structuredFields = ['condition', 'rule', 'effect', 'exceptions']
    .filter((field) => structured[field] !== null);
  return { structured, structuredFields };
}

/**
 * Estrutura UM candidato a partir de um sinal classificado.
 *
 * @param {object} args
 * @param {object} args.observation  observação bruta original (text/locator/...)
 * @param {object} args.classified   saída de `classifyObservation`
 * @param {string} args.kind         capability | journey | businessRule (do tipo do sinal)
 * @returns {object} candidato com `semanticStatus` NORMALIZED | UNRESOLVED
 */
function extractCandidate({ observation, classified, kind }) {
  const text = String(observation.text ?? '').trim();
  const tokens = tokenize(text);
  // §P0-SEMANTICS: quando NÃO há verbo no léxico, a construção de check-in
  // ainda pode nomear a ação ("Check in at the front desk", "check-in pelo
  // app"). `check` é resolvido contextualmente por `resolveContextualVerb`, que
  // só devolve `checkin` para essas construções — nunca para "check <objeto>".
  // Só preenche a LACUNA: se o léxico já achou verbo, ele continua vencendo.
  const checkinContext = COMPOUND_CHECKIN_RE.test(text)
    || CHECK_PERSON_IN_RE.test(text)
    || CHECK_INTO_PLACE_RE.test(text);
  const verbToken = verbTokenOf(tokens) || (checkinContext ? 'check' : null);
  const verb = resolveContextualVerb(verbToken, tokens, text);
  const object = objectAfterVerb(tokens, verbToken);
  const outcomeMatch = String(text).match(OUTCOME_RE);
  const outcome = outcomeMatch ? outcomeMatch[0].trim() : null;

  const base = {
    kind,
    externalName: text,
    locator: observation.locator || null,
    fragmentHash: observation.fragmentHash || null,
    description: observation.description || null,
    classification: observation.classification || null,
    viaFaqAnswer: classified.signals?.viaFaqAnswer === true,
  };

  if (kind === 'businessRule') {
    const { structured, structuredFields } = extractStructuredRule(text);
    // Regra que não rende NENHUM elemento estruturado (condição, limite, efeito,
    // exceção) não é regra estruturada: UNRESOLVED, nunca novidade canônica.
    if (structuredFields.length === 0) {
      return {
        ...base,
        semanticStatus: SEMANTIC_STATUS.UNRESOLVED,
        unresolvedReason: 'business_rule_without_structure',
        verb, object, outcome, structuredRule: null,
      };
    }
    return {
      ...base,
      semanticStatus: SEMANTIC_STATUS.NORMALIZED,
      verb: verb || null,
      object: object || null,
      outcome,
      form: [object, verb].filter(Boolean).join('.') || null,
      structuredRule: structured,
    };
  }

  if (kind === 'journey') {
    const actor = (String(text).match(/\b(member|members|aluno|alunos|membro|membros|cliente|clientes|gestor|manager|admin|staff|recepcionista|trainer|treinador|professor|instructor|user|usu[aá]rio)\b/i) || [null])[0];
    const hasTrigger = TRIGGER_PROBE.test(text);
    if (!actor && !hasTrigger && !verb) {
      return {
        ...base,
        semanticStatus: SEMANTIC_STATUS.UNRESOLVED,
        unresolvedReason: 'journey_without_actor_trigger_outcome',
        verb, object, outcome, structuredRule: null,
      };
    }
    return {
      ...base,
      semanticStatus: SEMANTIC_STATUS.NORMALIZED,
      actor: actor ? normalizeTerm(actor) : null,
      verb: verb || null,
      object: object || null,
      outcome,
      form: [object, verb].filter(Boolean).join('.') || normalizeTerm(text),
    };
  }

  // capability: exige verbo ou objeto de negócio identificável; quando o sinal
  // passou APENAS por termo declarado da política (ex.: "entradas"), a forma é
  // o canônico declarado — nunca UNRESOLVED por lacuna do léxico genérico.
  if (!verb && !object) {
    const declared = (classified.signals?.declaredMatches || [])[0];
    if (declared?.canonicalId) {
      return {
        ...base,
        semanticStatus: SEMANTIC_STATUS.NORMALIZED,
        verb: null,
        object: null,
        outcome,
        form: declared.canonicalId,
        structuredRule: null,
      };
    }
    return {
      ...base,
      semanticStatus: SEMANTIC_STATUS.UNRESOLVED,
      unresolvedReason: 'capability_without_verb_object',
      verb: null, object: null, outcome, structuredRule: null,
    };
  }
  return {
    ...base,
    semanticStatus: SEMANTIC_STATUS.NORMALIZED,
    verb: verb || null,
    object: object || null,
    outcome,
    form: [object, verb].filter(Boolean).join('.') || null,
    structuredRule: null,
  };
}

const TRIGGER_PROBE = /\b(when|quando|ao |ap[oó]s|after|once|assim que|upon)\b/i;

module.exports = {
  SEMANTIC_STATUS,
  VERB_CANONICAL_MAP,
  OBJECT_CANONICAL_MAP,
  COMPOUND_CHECKIN_RE,
  CHECK_PERSON_IN_RE,
  CHECK_INTO_PLACE_RE,
  resolveContextualVerb,
  extractStructuredRule,
  extractCandidate,
};
