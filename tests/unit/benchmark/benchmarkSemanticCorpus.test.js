'use strict';

/**
 * Corpus semântico de benchmark — casos ADVERSARIAIS medidos.
 *
 * Este arquivo trava o comportamento do pipeline semântico em textos que a
 * missão apontou como risco de falso positivo e falso negativo. Cada caso tem
 * a medição real ao lado, porque um teste sem a medição correspondente vira
 * ficção: ele prova o que achamos que o código faz, não o que ele faz.
 *
 * Um detalhe que engana: sem `locator`, o funil rejeita TUDO por
 * `benchmark_evidence_locator_missing` — estrutural, não semântico. Os casos
 * abaixo sempre passam locator para que a asserção seja sobre SEMÂNTICA.
 */

const { extractInspectionFindings } = require('../../../api/services/benchmark/benchmarkFindingExtraction');

const LOCATOR = 'https://example.com/features#section';

/**
 * Roda o funil exatamente como o runner faz, com locator e evidência.
 * @returns {{ accepted: Array, unresolved: Array, rejected: Array }}
 */
function run(text) {
  const result = extractInspectionFindings({
    inspection: { capabilities: [{ name: text, locator: LOCATOR }] },
    vertical: 'fitness',
    benchmarkId: 'semantic-corpus-probe',
    contentHash: 'sha256:probe',
    sourceTier: 1,
  });
  return {
    accepted: result.findings,
    unresolved: result.unresolved,
    rejected: result.rejected,
  };
}

function normalizedIds(result) {
  return result.accepted.map((finding) => finding.normalizedId);
}

describe('corpus semântico — o que NÃO pode ser extraído', () => {
  it('"check our recurring payments" NÃO produz payment.checkin', () => {
    // MEDIDO: aceito como `payment.recurring`. O risco apontado era o
    // classificador ler o verbo "check" como check-in de pessoa.
    const text = 'We check our recurring payments automatically and notify you by email.';
    const result = run(text);

    expect(normalizedIds(result)).not.toContain('payment.checkin');
    expect(normalizedIds(result)).toContain('payment.recurring');
  });

  it('verificação genérica NÃO produz check-in de pessoa', () => {
    for (const text of [
      'You can check the payment status of any member at any time.',
      'The system performs a check on every invoice before charging.',
    ]) {
      const result = run(text);
      expect(normalizedIds(result)).not.toContain('payment.checkin');
      expect(normalizedIds(result)).not.toContain('checkin');
    }
  });

  it('texto de marketing genérico NÃO vira capacidade', () => {
    // MEDIDO (defeito real, 2026-09-19): a primeira frase era ACEITA como
    // CAPABILITY_SIGNAL/verb_object_structure — verbo `sell` + objeto
    // `membership` — produzindo a capability `membership.sell`.
    const marketingTexts = [
      'Our platform helps your staff sell more memberships with powerful marketing tools.',
      'Our software helps you grow your gym faster than ever.',
      'We empower your team to serve more clients with less effort.',
    ];

    for (const text of marketingTexts) {
      const result = run(text);
      expect(result.accepted).toHaveLength(0);
      expect(normalizedIds(result)).not.toContain('membership.sell');
      expect(normalizedIds(result)).not.toContain('staff.sell');
    }
  });

  it('slogan com superlativo continua rejeitado', () => {
    const result = run('Sell more to every member with our all-in-one gym software.');
    expect(result.accepted).toHaveLength(0);
  });

  it('o motivo da rejeição é SEMÂNTICO, não a ausência de locator', () => {
    const result = run('Our platform helps your staff sell more memberships with powerful marketing tools.');
    const reasons = result.rejected.map((item) => item.reason);
    expect(reasons).toContain('semantic_type_benefit_statement');
    expect(reasons).not.toContain('benchmark_evidence_locator_missing');
  });
});

describe('corpus semântico — o que DEVE continuar sendo extraído (anti over-reach)', () => {
  // Sem estes casos, "rejeitar tudo" passaria como correção. A regra de
  // benefício em 3ª pessoa exige MARCADOR DE GRAU justamente para não engolir
  // funções legítimas descritas com "allows/enables/helps".
  it('capacidade operacional com ator real continua aceita', () => {
    const cases = [
      ['Staff can sell a membership plan at the reception desk.', 'membership.sell'],
      ['Members can book a class through the mobile app.', 'class.book'],
    ];
    for (const [text, expectedId] of cases) {
      const result = run(text);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].normalizedId).toBe(expectedId);
    }
  });

  it('função descrita com "allows you to" SEM grau continua aceita', () => {
    // Discriminador: a promessa exige grau ("more/faster/easier"). Descrever
    // uma função com "allows you to schedule appointments" é capacidade, não
    // benefício — rejeitar aqui seria o erro oposto, e mais caro.
    const result = run('Allows you to schedule appointments and manage the team calendar.');
    expect(result.accepted).toHaveLength(1);
  });

  it('texto aceito carrega a versão do pipeline semântico que o produziu', () => {
    const result = run('Staff can sell a membership plan at the reception desk.');
    expect(result.accepted[0].semanticPipelineVersion).toMatch(/^sem-v1:[0-9a-f]{32}$/);
  });
});

/**
 * GAPS REGISTRADOS — falsos NEGATIVOS medidos, NÃO corrigidos aqui.
 *
 * Os dois textos abaixo descrevem capacidades operacionais reais e são
 * rejeitados como `no_business_structure`: o vocabulário do classificador
 * (BUSINESS_OBJECT_TERMS / ACTION_VERB_TERMS) não cobre "check in ... QR code",
 * "front desk", "issue an invoice". É o erro OPOSTO ao falso positivo de
 * marketing — perder capacidade verdadeira.
 *
 * POR QUE NÃO CORRIGI: ampliar o vocabulário é uma DECISÃO DE POLÍTICA
 * SEMÂNTICA, não um bug localizado. Ela muda o significado de ~4.200 achados já
 * persistidos e exige reprocessamento completo do corpus (o que a missão prevê,
 * mas na ordem certa). Tomar essa decisão sozinho para "fechar" o item seria
 * exatamente o atalho que este trabalho existe para impedir.
 *
 * ESTES TESTES TRAVAM O ESTADO ATUAL DE PROPÓSITO: quando a decisão for tomada,
 * eles falham — e falhar aqui é o sinal correto de que o corpus precisa ser
 * reprocessado e a versão semântica vai mudar.
 */
describe('corpus semântico — GAPS REGISTRADOS (falsos negativos conhecidos)', () => {
  const registeredGaps = [
    'Check in members at the front desk using a QR code.',
    'The system issues an invoice for every monthly subscription.',
  ];

  it('permanecem rejeitados por vocabulário — estado atual CONHECIDO, não desejado', () => {
    for (const text of registeredGaps) {
      const result = run(text);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejected.map((item) => item.reason)).toContain('semantic_type_noise');
    }
  });
});
