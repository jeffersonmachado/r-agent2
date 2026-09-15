'use strict';

/**
 * Observation Classifier — PRIMEIRA barreira semântica da pesquisa de
 * benchmarks (missão 2026-09-15, garbage-in de headlines/slogans).
 *
 * PROBLEMA MEDIDO: o run real fitness (`fitness-real-2026-09-15-r5`) promoveu
 * 936 linhas brutas a "achados" porque a inspeção é por palavra-chave
 * ("linha contém billing → capability"). Resultado: títulos de seção
 * ("Financeiro"), slogans ("Every payment, every membership, every dollar.
 * In one place."), benefícios de marketing ("Aumente a retenção em +25%") e
 * perguntas de FAQ entraram na curva de novidade como se fossem capacidades.
 *
 * Este módulo classifica cada OBSERVAÇÃO BRUTA (texto + locator + contexto de
 * seção) em um TIPO explícito. Apenas os tipos `*_SIGNAL` seguem para a
 * extração semântica; todo o resto é rejeição NOMINAL e contada em métrica.
 *
 * Sinais usados (todos determinísticos, nenhum modelo estatístico):
 *   - pontuação terminal (`?`, `!`);
 *   - padrões de CTA/slogan e voz de marketing de 1ª/2ª pessoa;
 *   - contexto de seção (nav/footer/pricing/faq) derivado do locator;
 *   - contagem de cláusulas e enumerações;
 *   - comprimento como SINAL (nunca como regra única);
 *   - presença de estrutura verbo + objeto de negócio.
 *
 * `FAQ_ANSWER` é o único tipo não-sinal que pode AINDA render sinal: respostas
 * de FAQ descrevem comportamento real do produto ("Members can freeze an
 * active membership for up to 30 days"), então passam por reavaliação
 * estrutural (`viaFaqAnswer: true`).
 */

const { normalizeTerm, tokenize, NORMALIZATION_POLICY } = require('../benchmarkResearchSemantics');

const OBSERVATION_TYPES = Object.freeze({
  CAPABILITY_SIGNAL: 'CAPABILITY_SIGNAL',
  JOURNEY_SIGNAL: 'JOURNEY_SIGNAL',
  BUSINESS_RULE_SIGNAL: 'BUSINESS_RULE_SIGNAL',
  MARKETING_CLAIM: 'MARKETING_CLAIM',
  HEADLINE: 'HEADLINE',
  FAQ_QUESTION: 'FAQ_QUESTION',
  FAQ_ANSWER: 'FAQ_ANSWER',
  BENEFIT_STATEMENT: 'BENEFIT_STATEMENT',
  PRICING_TEXT: 'PRICING_TEXT',
  NAVIGATION: 'NAVIGATION',
  TESTIMONIAL: 'TESTIMONIAL',
  LEGAL_TEXT: 'LEGAL_TEXT',
  NOISE: 'NOISE',
});

/** Únicos tipos que seguem para extração semântica. */
const SIGNAL_TYPES = Object.freeze([
  OBSERVATION_TYPES.CAPABILITY_SIGNAL,
  OBSERVATION_TYPES.JOURNEY_SIGNAL,
  OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL,
]);

/**
 * Léxico de objetos de negócio do domínio de gestão (fitness e afins).
 * Vocabulário DECLARADO — como KIND_PATTERNS do provider de inspeção: a
 * presença aqui é o que permite a um texto curto ser sinal; a ausência é a
 * resposta correta para "não sei do que se trata".
 */
const BUSINESS_OBJECT_TERMS = Object.freeze([
  'membership', 'member', 'members', 'matricula', 'matriculas', 'aluno', 'alunos', 'membro', 'membros',
  'billing', 'payment', 'payments', 'pagamento', 'pagamentos', 'cobranca', 'cobrancas', 'mensalidade',
  'mensalidades', 'invoice', 'invoices', 'fatura', 'faturas', 'receivable', 'recebiveis', 'receita',
  'checkin', 'check-in', 'check-ins', 'catraca', 'catracas', 'turnstile', 'access', 'acesso',
  'class', 'classes', 'aula', 'aulas', 'booking', 'bookings', 'agendamento', 'agendamentos',
  'schedule', 'scheduling', 'reserva', 'reservas', 'waitlist', 'workout', 'workouts', 'treino', 'treinos',
  'plan', 'plans', 'plano', 'planos', 'subscription', 'subscriptions', 'assinatura', 'assinaturas',
  'contract', 'contracts', 'contrato', 'contratos', 'report', 'reports', 'relatorio', 'relatorios',
  'dashboard', 'crm', 'lead', 'leads', 'app', 'aplicativo', 'portal', 'pos', 'venda', 'vendas',
  'produto', 'produtos', 'avaliacao', 'avaliacoes', 'wod', 'treinador', 'trainer', 'staff', 'equipe',
  'despesa', 'despesas', 'caixa', 'estoque', 'inventory', 'payroll', 'comissao', 'comissoes',
]);

/** Verbos (e substantivos de gestão) que indicam AÇÃO do produto. */
const ACTION_VERB_TERMS = Object.freeze([
  'manage', 'management', 'gestao', 'gerenciamento', 'administre', 'administracao',
  'control', 'controle', 'track', 'tracking', 'acompanhe', 'monitoramento',
  'freeze', 'congela', 'congelar', 'congelamento', 'trancamento', 'pause', 'pausa',
  'cancel', 'cancela', 'cancelar', 'cancelamento', 'suspend', 'suspende', 'suspensao',
  'reactivate', 'reativar', 'reativacao', 'expire', 'expira', 'expiracao', 'vencimento',
  'book', 'booking', 'agenda', 'agendar', 'agendamento', 'schedule', 'reserva', 'reservar',
  'charge', 'cobra', 'cobrar', 'billing', 'bill', 'collect', 'receba', 'receber',
  'pay', 'paga', 'pagar', 'payment', 'pagamento',
  'send', 'envia', 'enviar', 'envio', 'notify', 'notifica', 'lembrete', 'reminder',
  'create', 'cria', 'criar', 'crie', 'cadastro', 'cadastre', 'register', 'registro',
  'sell', 'venda', 'vender', 'vendas', 'sale',
  'issue', 'emite', 'emitir', 'emissao', 'generate', 'gera', 'gerar',
  'sync', 'sincroniza', 'integrate', 'integra', 'integracao', 'import', 'importa', 'export', 'exporta',
  'check', 'checkin', 'check-in', 'libera', 'liberacao', 'bloqueia', 'bloqueio', 'block', 'blocked',
  'prescribe', 'prescricao', 'prescreve', 'evaluate', 'avalia', 'avaliacao',
  'automate', 'automatiza', 'automacao', 'automatic', 'automatica', 'automatico', 'automaticas', 'automaticos',
  'recorrente', 'recurring', 'recurrence', 'recorrencia',
]);

/** Voz de marketing: imperativo de BENEFÍCIO ao negócio do cliente (não ação do produto). */
const MARKETING_VOICE_RE = /^(economize|aumente|reduza|ganhe|poupe|impulsione|maximize|acelere|otimize|melhore|transforme|descubra|conquiste|venda mais|fature|boost|grow|increase|reduce|save|drive|unlock|supercharge|maximize|elevate|transform|discover|get more|do more)\b/i;

const CTA_RE = /\b(agende (uma )?demo|fale com|comece (agora|gratis)|try (it )?free|get started|start (your )?free|sign up|request a demo|book a demo|saiba mais|learn more|ver planos|see plans|compre agora|buy now|free trial|teste gr[aá]tis)\b/i;

const SUPERLATIVE_RE = /\b(all[- ]in[- ]one|tudo em (um|uma) s[oó] (lugar|plataforma)|in one place|the best|o melhor|a melhor|#1|number one|l[ií]der|leading|ultimate|complete solution|solu[cç][aã]o completa|mais completo|everything you need|tudo que voc[eê] precisa|tudo o que voc[eê] precisa)\b/i;

const BENEFIT_RE = /\b(retention|reten[cç][aã]o|revenue|receita|faturamento|lucro|profit|produtividade|productivity|efici[eê]ncia|efficiency|time[- ]saving|economia de tempo|growth|crescimento)\b.*(\+\s?\d+\s?%|\d+\s?%|em at[eé]|up to|mais rápido|faster)/i;

const PERCENT_CLAIM_RE = /(\+\s?\d+\s?%|\d+\s?%\s+(de|of|mais|menos|more|less))/i;

const PRICING_RE = /(r\$\s?\d|us\$\s?\d|\$\s?\d+|€\s?\d+|\d+[.,]\d{2}\s*\/\s*(m[eê]s|mo|month)|por m[eê]s|per month|\/month|\/mo\b|per user|por usu[aá]rio|a partir de r\$|starting at)/i;

const LEGAL_RE = /\b(terms of (service|use)|privacy policy|pol[ií]tica de privacidade|termos de uso|cookie|cookies|all rights reserved|todos os direitos reservados|cnpj|gdpr|lgpd|copyright|©)\b/i;

const NAVIGATION_TERMS = Object.freeze([
  'home', 'inicio', 'features', 'funcionalidades', 'pricing', 'precos', 'planos', 'blog', 'login',
  'entrar', 'contact', 'contato', 'about', 'sobre', 'careers', 'support', 'suporte', 'menu',
  'demo', 'solutions', 'solucoes', 'products', 'produtos', 'resources', 'recursos', 'partners',
]);

const TESTIMONIAL_RE = /(["“][^"”]{20,}["”]\s*[-–—]|depoimento|testimonial|what (our )?customers say|quem usa (recomenda|aprova)|^["“].{30,}["”]$)/i;

const RULE_STRUCTURE_RE = /\b(up to|at[eé]|maximum|m[aá]ximo|no m[aá]ximo|per year|por ano|per month|por m[eê]s|within|em at[eé]|prazo|deadline|penalty|multa|fee|taxa|refund|reembolso|notice|aviso pr[eé]vio|car[eê]ncia|minimum term|fidelidade|if |quando|when |in case|em caso|unless|exceto|except)\b/i;

const JOURNEY_STRUCTURE_RE = /\b(onboarding|step[- ]by[- ]step|passo a passo|getting started|primeiros passos|como funciona|how it works|fluxo de|processo de|jornada|workflow|from .+ to .+|de .+ at[eé])\b/i;

const ACTOR_RE = /\b(member|members|aluno|alunos|membro|membros|cliente|clientes|gestor|manager|admin|staff|recepcionista|trainer|treinador|professor|instructor|user|usu[aá]rio)\b/i;

const TRIGGER_RE = /\b(when|quando|ao |ap[oó]s|after|once|assim que|no momento|upon)\b/i;

const OUTCOME_RE = /\b(so that|para que|de modo que|assim|ent[aã]o|then|resulting|resultando|e recebe|and gets)\b/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Contexto de seção derivado do locator (`section:<heading>`). */
function sectionFromLocator(locator) {
  const raw = String(locator || '');
  if (!raw.startsWith('section:')) return null;
  const section = raw.slice('section:'.length).trim();
  return section || null;
}

function sectionKind(section) {
  if (!isNonEmptyString(section)) return null;
  const normalized = normalizeTerm(section);
  if (/\b(nav|menu|header|footer|rodape|navegacao)\b/.test(normalized)) return 'navigation';
  if (/\b(pricing|precos|planos e precos|price|quanto custa)\b/.test(normalized)) return 'pricing';
  if (/\b(faq|perguntas frequentes|duvidas|q&a|questions)\b/.test(normalized)) return 'faq';
  if (/\b(depoimentos|testimonials|cases|clientes)\b/.test(normalized)) return 'testimonial';
  return null;
}

/** A observação É o próprio heading da seção (provedor emite headings como itens). */
function isHeadingObservation(text, locator) {
  const section = sectionFromLocator(locator);
  return isNonEmptyString(section) && normalizeTerm(section) === normalizeTerm(text);
}

function countClauses(text) {
  return String(text).split(/[,;•·]|\.{3}|\s-\s|\s–\s/).filter((part) => part.trim().length > 0).length;
}

/**
 * Termos declarados da política de normalização presentes no texto (frase
 * contígua de tokens). É a prova de equivalência DECLARADA — um heading curto
 * só vira sinal quando a política declara o termo.
 */
function declaredTermMatches(text) {
  const tokens = tokenize(text);
  const matches = [];
  for (const rule of Array.isArray(NORMALIZATION_POLICY.rules) ? NORMALIZATION_POLICY.rules : []) {
    for (const term of Array.isArray(rule.terms) ? rule.terms : []) {
      const termTokens = normalizeTerm(term).split(' ').filter(Boolean);
      if (termTokens.length === 0 || tokens.length < termTokens.length) continue;
      for (let start = 0; start <= tokens.length - termTokens.length; start += 1) {
        if (termTokens.every((token, offset) => tokens[start + offset] === token)) {
          matches.push({ canonicalId: rule.canonicalId, term: normalizeTerm(term), kind: rule.kind || null });
          break;
        }
      }
    }
  }
  return matches;
}

/** Estrutura verbo + objeto de negócio do texto (sinais, nunca regra única). */
function analyzeStructure(text) {
  const tokens = tokenize(text);
  const businessObjects = tokens.filter((token) => BUSINESS_OBJECT_TERMS.includes(token));
  const verbs = tokens.filter((token) => ACTION_VERB_TERMS.includes(token));
  return {
    tokens,
    tokenCount: tokens.length,
    businessObjects,
    verbs,
    hasVerbObject: verbs.length > 0 && businessObjects.length > 0,
    declaredMatches: declaredTermMatches(text),
    clauseCount: countClauses(text),
  };
}

function result(type, reason, signals) {
  return { type, reason, signals };
}

/**
 * Classifica UMA observação bruta.
 *
 * @param {object} observation
 * @param {string} observation.text       texto bruto extraído pela inspeção
 * @param {string} [observation.locator]  locator na fonte (`section:X`, `line:N`, `operation:...`)
 * @param {string} [observation.axis]     eixo sugerido pelo provider (dica, não decisão)
 * @returns {{type: string, reason: string, signals: object}}
 */
function classifyObservation(observation = {}) {
  const text = String(observation.text ?? '').trim();
  const locator = isNonEmptyString(observation.locator) ? observation.locator.trim() : null;
  const section = sectionFromLocator(locator);
  const structure = analyzeStructure(text);

  const signals = {
    section,
    sectionKind: sectionKind(section),
    heading: isHeadingObservation(text, locator),
    tokenCount: structure.tokenCount,
    clauseCount: structure.clauseCount,
    hasVerbObject: structure.hasVerbObject,
    businessObjects: structure.businessObjects,
    verbs: structure.verbs,
    declaredMatches: structure.declaredMatches,
  };

  if (!isNonEmptyString(text) || structure.tokenCount === 0) {
    return result(OBSERVATION_TYPES.NOISE, 'empty_observation', signals);
  }

  // Pergunta é pergunta — nunca capacidade.
  if (text.endsWith('?')) {
    return result(OBSERVATION_TYPES.FAQ_QUESTION, 'terminal_question_mark', signals);
  }

  // Contexto de seção domina: nav/pricing/faq/testimonial.
  if (signals.sectionKind === 'navigation') {
    return result(OBSERVATION_TYPES.NAVIGATION, 'navigation_section', signals);
  }
  if (signals.sectionKind === 'pricing' || PRICING_RE.test(text)) {
    return result(OBSERVATION_TYPES.PRICING_TEXT, signals.sectionKind === 'pricing' ? 'pricing_section' : 'pricing_pattern', signals);
  }
  if (signals.sectionKind === 'testimonial' || TESTIMONIAL_RE.test(text)) {
    return result(OBSERVATION_TYPES.TESTIMONIAL, signals.sectionKind === 'testimonial' ? 'testimonial_section' : 'testimonial_pattern', signals);
  }
  if (LEGAL_RE.test(text)) {
    return result(OBSERVATION_TYPES.LEGAL_TEXT, 'legal_pattern', signals);
  }

  // Itens de menu soltos (uma palavra de navegação, sem estrutura).
  if (structure.tokenCount <= 2
    && structure.tokens.every((token) => NAVIGATION_TERMS.includes(token))
    && structure.declaredMatches.length === 0) {
    return result(OBSERVATION_TYPES.NAVIGATION, 'navigation_vocabulary', signals);
  }

  // CTA explícito nunca é sinal de produto.
  if (CTA_RE.test(text)) {
    return result(OBSERVATION_TYPES.MARKETING_CLAIM, 'cta_pattern', signals);
  }

  // Voz de marketing: imperativo de benefício ao negócio do cliente.
  if (MARKETING_VOICE_RE.test(text) || text.endsWith('!')) {
    // Exceção honesta: imperativo de benefício pode EMBUTIR estrutura real
    // ("Economize... com prescrição de treinos") — mas o TEMA da frase é o
    // benefício, não o mecanismo. Sem termo declarado, não vira sinal.
    if (structure.declaredMatches.length === 0) {
      return result(
        BENEFIT_RE.test(text) || PERCENT_CLAIM_RE.test(text)
          ? OBSERVATION_TYPES.BENEFIT_STATEMENT
          : OBSERVATION_TYPES.MARKETING_CLAIM,
        MARKETING_VOICE_RE.test(text) ? 'marketing_imperative_voice' : 'exclamatory_slogan',
        signals,
      );
    }
  }
  if (SUPERLATIVE_RE.test(text)) {
    return result(OBSERVATION_TYPES.MARKETING_CLAIM, 'superlative_slogan', signals);
  }
  // Enumeração de substantivos sem verbo: slogan de "tudo junto".
  if (structure.clauseCount >= 3 && structure.verbs.length === 0 && structure.declaredMatches.length === 0) {
    return result(OBSERVATION_TYPES.MARKETING_CLAIM, 'noun_enumeration_slogan', signals);
  }
  if (BENEFIT_RE.test(text) && structure.declaredMatches.length === 0) {
    return result(OBSERVATION_TYPES.BENEFIT_STATEMENT, 'benefit_outcome_claim', signals);
  }

  // FAQ answer: resposta em seção de FAQ — pode render sinal por estrutura.
  const fromFaqAnswer = signals.sectionKind === 'faq';

  // Equivalência DECLARADA com kind próprio (política versionada) roteia o
  // eixo: um termo declarado de regra de negócio é regra, não capability.
  const declaredKinds = new Set(structure.declaredMatches.map((match) => match.kind).filter(Boolean));
  if (declaredKinds.has('businessRule')) {
    return result(OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL, fromFaqAnswer ? 'declared_rule_term_via_faq_answer' : 'declared_rule_term', { ...signals, viaFaqAnswer: fromFaqAnswer });
  }

  // Regra de negócio: estrutura de condição/limite/efeito.
  if (RULE_STRUCTURE_RE.test(text) && (structure.hasVerbObject || structure.declaredMatches.length > 0)) {
    return result(OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL, fromFaqAnswer ? 'rule_structure_via_faq_answer' : 'rule_structure', { ...signals, viaFaqAnswer: fromFaqAnswer });
  }

  // Jornada: ator + gatilho/desfecho, ou vocabulário declarado de jornada.
  const declaredJourney = structure.declaredMatches.some((match) => match.kind === 'journey');
  if (declaredJourney || (JOURNEY_STRUCTURE_RE.test(text) && ACTOR_RE.test(text))
    || (ACTOR_RE.test(text) && TRIGGER_RE.test(text) && OUTCOME_RE.test(text) && structure.hasVerbObject)) {
    return result(OBSERVATION_TYPES.JOURNEY_SIGNAL, fromFaqAnswer ? 'journey_structure_via_faq_answer' : 'journey_structure', { ...signals, viaFaqAnswer: fromFaqAnswer });
  }

  // Capability: verbo + objeto de negócio, ou termo declarado da política.
  if (structure.hasVerbObject || structure.declaredMatches.length > 0) {
    return result(OBSERVATION_TYPES.CAPABILITY_SIGNAL, fromFaqAnswer ? 'verb_object_via_faq_answer' : (structure.declaredMatches.length > 0 ? 'declared_term_match' : 'verb_object_structure'), { ...signals, viaFaqAnswer: fromFaqAnswer });
  }

  // Heading curto sem estrutura e sem termo declarado: rótulo de seção, não
  // capacidade ("Financeiro", "Treinos", "Relatórios" isolados).
  if (signals.heading) {
    return result(OBSERVATION_TYPES.HEADLINE, 'section_heading_without_structure', signals);
  }

  return result(OBSERVATION_TYPES.NOISE, 'no_business_structure', signals);
}

module.exports = {
  OBSERVATION_TYPES,
  SIGNAL_TYPES,
  BUSINESS_OBJECT_TERMS,
  ACTION_VERB_TERMS,
  classifyObservation,
  analyzeStructure,
  sectionFromLocator,
  isHeadingObservation,
  declaredTermMatches,
};
