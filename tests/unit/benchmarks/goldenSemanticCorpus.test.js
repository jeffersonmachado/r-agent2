'use strict';

/**
 * §P0-SEMANTICS — GOLDEN SEMANTIC CORPUS.
 *
 * Corpus de regressão com excertos REAIS de documentação de fornecedores de
 * gestão (features, marketing, FAQ, pricing, testemunho, legal, navegação, API,
 * regra, jornada, ruído e texto ambíguo). Cada caso fixa a SEMÂNTICA esperada.
 *
 * DEFEITOS REPRODUZIDOS (2026-09-18) que este corpus trava:
 *
 *  1. `check` → `checkin` como mapeamento de PALAVRA ISOLADA. O texto
 *     "We check our recurring payments constantly" produzia `payment.checkin`:
 *     uma entrada de academia atribuída a verificação de cobrança. `check` é
 *     ambíguo e a forma canônica depende do CONTEXTO (composto `check-in`,
 *     `check <pessoa> in` → entrada; `check <objeto>` → verificação).
 *  2. Texto promocional genérico virando capability: "Uma ferramenta completa
 *     para simplificar todo o processo de venda" produzia `sell`.
 *
 * Contrato do corpus:
 *  - tipos de observação em `OBSERVATION_TYPES`;
 *  - apenas `*_SIGNAL` segue para extração semântica;
 *  - a forma canônica de um sinal NUNCA é um nome de fornecedor;
 *  - `freeze` ≠ `cancel` ≠ `expire` ≠ `suspend` (anti over-merge).
 */

const {
  classifyObservation,
  OBSERVATION_TYPES,
} = require('../../../api/services/benchmark/semantic/observationClassifier');
const { extractCandidate } = require('../../../api/services/benchmark/semantic/semanticExtractor');

const SIGNAL_TYPES = [
  OBSERVATION_TYPES.CAPABILITY_SIGNAL,
  OBSERVATION_TYPES.JOURNEY_SIGNAL,
  OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL,
];

const EXTRACTABLE = new Set(SIGNAL_TYPES);

/**
 * Extrai a forma canônica de um texto (ou null quando não é sinal).
 * @returns {{type: string, reason: string, form: string|null, status: string|null}}
 */
function analyze(text) {
  const classified = classifyObservation({ text, locator: 'section/feature' });
  if (!EXTRACTABLE.has(classified.type)) {
    return { type: classified.type, reason: classified.reason, form: null, status: null };
  }
  const kind = classified.type === OBSERVATION_TYPES.CAPABILITY_SIGNAL
    ? 'capability'
    : (classified.type === OBSERVATION_TYPES.JOURNEY_SIGNAL ? 'journey' : 'businessRule');
  const candidate = extractCandidate({
    observation: { text, locator: 'section/feature' },
    classified,
    kind,
  });
  return {
    type: classified.type,
    reason: classified.reason,
    form: candidate.form || null,
    status: candidate.semanticStatus,
  };
}

describe('golden corpus — verbo ambíguo `check` é resolvido por CONTEXTO', () => {
  test('"We check our recurring payments constantly" NÃO é check-in', () => {
    const result = analyze('We check our recurring payments constantly');
    expect(result.form).not.toBe('payment.checkin');
    expect(String(result.form || '')).not.toContain('checkin');
  });

  test('"payment status check" NÃO é check-in', () => {
    const result = analyze('payment status check');
    expect(String(result.form || '')).not.toContain('checkin');
  });

  test('"Check members in at the front desk." É check-in de membro', () => {
    const result = analyze('Check members in at the front desk.');
    expect(result.type).toBe(OBSERVATION_TYPES.CAPABILITY_SIGNAL);
    expect(result.form).toBe('member.checkin');
  });

  test('"Check in at the front desk" É check-in', () => {
    const result = analyze('Check in at the front desk');
    expect(result.form).toBe('checkin');
  });

  test('"checkin pelo aplicativo" É check-in pelo app', () => {
    const result = analyze('checkin pelo aplicativo');
    expect(String(result.form)).toContain('checkin');
  });
});

describe('golden corpus — marketing nunca vira capability', () => {
  const MARKETING = [
    'Uma ferramenta completa para simplificar todo o processo de venda',
    'Grow your business faster.',
    'All-in-one platform to manage your entire studio',
    'Tudo em um só lugar para a sua academia',
    'Get started free',
  ];

  test.each(MARKETING)('%s', (text) => {
    const result = analyze(text);
    expect(SIGNAL_TYPES).not.toContain(result.type);
  });

  test('"Sell more memberships with intelligent automation." não produz venda automática', () => {
    const result = analyze('Sell more memberships with intelligent automation.');
    expect(result.form).not.toBe('staff.sell');
    expect(result.form).not.toBe('sell');
  });
});

describe('golden corpus — perguntas de FAQ não são capabilities', () => {
  test.each([
    'What is Zen Planner Payments?',
    'How do I freeze a membership?',
    'Can members book classes online?',
  ])('%s', (text) => {
    const result = analyze(text);
    expect(result.type).toBe(OBSERVATION_TYPES.FAQ_QUESTION);
    expect(result.form).toBeNull();
  });
});

describe('golden corpus — feature documentada vira capability com forma canônica', () => {
  test('freeze de matrícula', () => {
    expect(analyze('Members can freeze an active membership for 30 days.').form).toBe('membership.freeze');
  });

  test('cancelamento de matrícula', () => {
    expect(analyze('Cancel membership').form).toBe('membership.cancel');
  });
});

describe('golden corpus — anti over-merge', () => {
  test('freeze ≠ cancel ≠ suspend ≠ expire', () => {
    const freeze = analyze('Members can freeze a membership.').form;
    const cancel = analyze('Cancel membership').form;
    const suspend = analyze('Suspend membership').form;
    const expire = analyze('Membership will expire').form;

    const forms = [freeze, cancel, suspend, expire].filter(Boolean);
    expect(new Set(forms).size).toBe(forms.length);
  });

  test('verificação de pagamento ≠ check-in de membro', () => {
    const verification = analyze('We check our recurring payments constantly').form;
    const checkin = analyze('Check members in at the front desk.').form;
    expect(verification).not.toBe(checkin);
  });
});

describe('golden corpus — regra de negócio exige estrutura', () => {
  test('regra com condição/limite rende estrutura', () => {
    const result = analyze('Members can freeze their membership for up to 30 days per year.');
    expect(result.type).toBe(OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL);
    expect(result.status).toBe('NORMALIZED');
  });

  test('frase sem estrutura não é promovida a regra nem a capability', () => {
    const result = analyze('A complete solution for modern gyms');
    expect(SIGNAL_TYPES).not.toContain(result.type);
  });
});

describe('golden corpus — a forma canônica nunca é nome de fornecedor', () => {
  const VENDOR_NAMES = [
    'evo', 'tecnofit', 'pacto', 'nextfit', 'sults', 'mindbody', 'glofox', 'zenplanner', 'wellable',
  ];

  const FRAGMENTS = [
    'Members can freeze an active membership for 30 days.',
    'Cancel membership',
    'We check our recurring payments constantly',
    'Check members in at the front desk.',
    'Members can book classes online.',
  ];

  test.each(FRAGMENTS)('nenhum id canônico contém nome de fornecedor: %s', (text) => {
    const form = analyze(text).form;
    if (!form) return;
    const lowered = form.toLowerCase();
    for (const vendor of VENDOR_NAMES) {
      expect(lowered).not.toContain(vendor);
    }
  });

  test('um nome de fornecedor isolado não é capability', () => {
    const result = analyze('Mindbody');
    expect(result.form).toBeNull();
  });
});
