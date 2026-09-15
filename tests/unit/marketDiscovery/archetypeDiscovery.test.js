'use strict';

/**
 * Arquétipos: aceitação é baseada em EVIDÊNCIA — nunca em confiança no config.
 * Inclui a revalidação dos arquétipos fitness `financial-billing` e
 * `student-digital-experience`: nunca removidos para forçar PASS, apenas
 * aceitos/rejeitados por evidência.
 */

const {
  ARCHETYPE_STATES,
  evaluateArchetypeAcceptance,
  buildArchetypeRecord,
  revalidateArchetypes,
} = require('../../../api/services/marketDiscovery/archetypeDiscovery');

const EVIDENCE = {
  url: 'https://fornecedor.example.com/cobranca-recorrente',
  evidenceRef: 'ev-abc123',
  contentHash: 'sha256:deadbeef',
  tier: 5,
};

describe('archetypeDiscovery — evidência obrigatória', () => {
  test('arquétipo sem evidência NÃO é aceito (EVIDENCE_REQUIRED)', () => {
    const verdict = evaluateArchetypeAcceptance({ archetypeKey: 'financial-billing', name: 'Financeiro', sourceEvidence: [] });
    expect(verdict.accepted).toBe(false);
    expect(verdict.state).toBe(ARCHETYPE_STATES.EVIDENCE_REQUIRED);
    expect(verdict.reason).toBe('archetype_without_evidence');
  });

  test('"evidência" em texto livre (sem url + ref/hash) é inválida', () => {
    const verdict = evaluateArchetypeAcceptance({
      archetypeKey: 'financial-billing',
      name: 'Financeiro',
      sourceEvidence: [{ note: 'todo fornecedor tem cobrança' }],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('archetype_evidence_invalid');
  });

  test('arquétipo com evidência real é ACCEPTED', () => {
    const verdict = evaluateArchetypeAcceptance({ archetypeKey: 'financial-billing', name: 'Financeiro', sourceEvidence: [EVIDENCE] });
    expect(verdict.accepted).toBe(true);
    expect(verdict.state).toBe(ARCHETYPE_STATES.ACCEPTED);
  });

  test('evidência contraditória REJEITA o arquétipo com motivo auditável', () => {
    const verdict = evaluateArchetypeAcceptance({
      archetypeKey: 'fax-machine',
      name: 'Emissor de fax',
      sourceEvidence: [{ ...EVIDENCE, contradicts: true }],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.state).toBe(ARCHETYPE_STATES.REJECTED);
    expect(verdict.reason).toBe('archetype_contradicted_by_evidence');
  });

  test('o registro computa o estado da evidência — o chamador não escolhe ACCEPTED', () => {
    const record = buildArchetypeRecord({
      vertical: 'fitness',
      archetypeKey: 'financial-billing',
      name: 'Financeiro e cobrança recorrente',
      sourceEvidence: [],
    });
    expect(record.state).toBe(ARCHETYPE_STATES.EVIDENCE_REQUIRED);
  });
});

describe('archetypeDiscovery — revalidação dos arquétipos fitness', () => {
  const DECLARED = [
    { id: 'financial-billing', importance: 'REQUIRED', name: 'Financeiro e cobrança recorrente', evidence: 'categoria central de todos os fornecedores (texto histórico)' },
    { id: 'student-digital-experience', importance: 'REQUIRED', name: 'Experiência digital do aluno', evidence: 'app do aluno divulgado (texto histórico)' },
  ];

  test('com evidência deste run, ambos são ACCEPTED e permanecem REQUIRED', () => {
    const { records, accepted } = revalidateArchetypes({
      declared: DECLARED,
      evidenceByArchetype: {
        'financial-billing': [EVIDENCE],
        'student-digital-experience': [{ ...EVIDENCE, url: 'https://fornecedor.example.com/app-do-aluno' }],
      },
    });

    expect(accepted).toEqual(expect.arrayContaining(['financial-billing', 'student-digital-experience']));
    for (const record of records) {
      expect(record.state).toBe(ARCHETYPE_STATES.ACCEPTED);
      expect(record.importance).toBe('REQUIRED');
      expect(record.origin).toBe('config');
      expect(record.source_evidence ?? record.sourceEvidence).toBeTruthy();
    }
  });

  test('sem evidência neste run, nenhum é aceito — e NENHUM é removido', () => {
    const { records, accepted, evidenceRequired, rejected } = revalidateArchetypes({
      declared: DECLARED,
      evidenceByArchetype: {},
    });

    expect(accepted).toEqual([]);
    expect(evidenceRequired).toEqual(expect.arrayContaining(['financial-billing', 'student-digital-experience']));
    expect(rejected).toEqual([]); // ausência de prova não é rejeição fabricada
    expect(records).toHaveLength(2); // nunca removidos para forçar PASS
  });

  test('evidência contraditória rejeita sem apagar o histórico declarado', () => {
    const { records, rejected } = revalidateArchetypes({
      declared: DECLARED,
      evidenceByArchetype: {
        'financial-billing': [{ ...EVIDENCE, contradicts: true, note: 'categoria absorvida por ERPs genéricos' }],
      },
    });

    expect(rejected).toEqual([{ archetypeKey: 'financial-billing', rationale: expect.any(String) }]);
    const billing = records.find((r) => r.archetypeKey === 'financial-billing');
    expect(billing.state).toBe(ARCHETYPE_STATES.REJECTED);
    expect(billing.metadata.declaredEvidence).toMatch(/categoria central/);
    const digital = records.find((r) => r.archetypeKey === 'student-digital-experience');
    expect(digital.state).toBe(ARCHETYPE_STATES.EVIDENCE_REQUIRED);
  });
});
