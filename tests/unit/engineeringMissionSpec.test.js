'use strict';

/**
 * missionSpec — ENTRADA DE REQUIREMENTS: o descarte é RUIDOSO, nunca silencioso.
 *
 * DEFEITO ELIMINADO (2026-10-08). `normalizeRequirements` aceitava um item e o "normalizava" para
 * { id, text, source, enrichmentType, confidence, riskImpact } — todo o resto sumia SEM ERRO.
 *
 * Efeitos medidos:
 *   1. Uma emenda de contrato enviada com `originalContract`/`implemented`/`decision`/`rationale` foi
 *      aprovada como MATERIAL e ficou com QUATRO ITENS VAZIOS: apenas o `id` sobreviveu. A spec
 *      registrava a emenda sem o conteúdo dela e nada indicava o problema.
 *   2. O PRODUTOR REAL (`enrichmentBuilder`) emite `ruleId` (e `blocksAutoApproval`) nos requisitos
 *      derivados. `ruleId` não é decorativo: `materiality.js` o usa para CRITICAL_REQUIREMENT_
 *      INTRODUCED e `autoApprovalPolicy.js` para bloquear decisão humana (HUMAN_ONLY_RULE_IDS).
 *      Como o caminho de EDIÇÃO alimenta o auto-approval com a spec normalizada, o descarte deixava
 *      esses bloqueios desarmados.
 *
 * A lista de campos é FECHADA: o que o produtor real emite é aceito e PRESERVADO; o que é
 * desconhecido falha alto, com o nome do campo e a lista aceita.
 */
const { createSpec, createNextVersion } = require('../../engine/engineeringMission/missionSpec');
const { MISSION_FAILURE_CODES } = require('../../engine/engineeringMission/constants');

const specBase = (overrides = {}) => createSpec({
  missionId: 'm1',
  originalMission: 'intenção original do usuário',
  missionType: 'BUG_FIX',
  objective: 'objetivo',
  repository: 'r-agent2',
  branch: 'main',
  scope: 'MEDIUM',
  constraints: [],
  acceptanceCriteria: ['critério em texto'],
  derivedRequirements: ['requisito em texto'],
  testStrategy: [],
  assumptions: [],
  contextSources: [],
  subsystems: [],
  risk: 'LOW',
  confidence: 0.9,
  ...overrides,
});

describe('missionSpec — requirements com descarte ruidoso', () => {
  test('item com o shape do PRODUTOR REAL é aceito e PRESERVA ruleId/blocksAutoApproval', () => {
    const spec = specBase({
      derivedRequirements: [{
        id: 'DR-TENANT_ISOLATION',
        text: 'isolamento de tenant preservado',
        source: 'PLATFORM_POLICY',
        enrichmentType: 'POLICY_REQUIRED',
        confidence: 1,
        riskImpact: 'HIGH',
        ruleId: 'TENANT_ISOLATION',
        blocksAutoApproval: true,
      }],
    });

    const [item] = spec.derivedRequirements;
    expect(item.id).toBe('DR-TENANT_ISOLATION');
    expect(item.text).toBe('isolamento de tenant preservado');
    expect(item.ruleId).toBe('TENANT_ISOLATION');
    expect(item.blocksAutoApproval).toBe(true);
  });

  test('item SEM os campos de regra continua válido (ruleId null, blocksAutoApproval false)', () => {
    const spec = specBase({ derivedRequirements: [{ id: 'DR-1', text: 'requisito', source: 'X' }] });
    expect(spec.derivedRequirements[0].ruleId).toBeNull();
    expect(spec.derivedRequirements[0].blocksAutoApproval).toBe(false);
  });

  test('string simples continua aceita e vira item com text', () => {
    const spec = specBase({ acceptanceCriteria: ['critério', 'outro critério'] });
    expect(spec.acceptanceCriteria).toHaveLength(2);
    expect(spec.acceptanceCriteria[0]).toEqual(expect.objectContaining({ text: 'critério' }));
  });

  test('proveniência de conhecimento continua preservada', () => {
    const spec = specBase({
      derivedRequirements: [{
        id: 'DR-KNOWLEDGE-1',
        text: 'requisito derivado do conhecimento',
        source: 'ENGINEERING_RAG',
        enrichmentType: 'KNOWLEDGE_DERIVED',
        knowledge: { knowledgeSource: 'ENGINEERING_SYSTEM_RAG', sourceId: 's1', chunkHash: 'h', chunkRef: 'r', score: 0.8 },
      }],
    });
    expect(spec.derivedRequirements[0].knowledge.chunkHash).toBe('h');
    expect(spec.derivedRequirements[0].knowledge.derivedField).toBe('acceptanceCriteria');
  });

  // O CASO QUE ORIGINOU O DEFEITO: campos desconhecidos eram descartados em silêncio.
  test('campo FORA do schema falha ALTO, nomeando o campo e a lista aceita', () => {
    expect(() => specBase({
      derivedRequirements: [{
        id: 'R3-EMENDADO',
        originalContract: 'contrato antigo',
        implemented: 'implementação vigente',
        decision: 'DIVERGENCIA_ACEITA',
        rationale: 'motivo',
      }],
    })).toThrow(/fora do schema de requirement/);

    try {
      specBase({
        derivedRequirements: [{ id: 'R3-EMENDADO', text: 'ok', originalContract: 'x', decision: 'y' }],
      });
      throw new Error('deveria ter falhado');
    } catch (err) {
      expect(err.code).toBe(MISSION_FAILURE_CODES.INVALID_REQUIREMENT_ITEM);
      expect(err.detail.list).toBe('derivedRequirements');
      expect(err.detail.unknownFields).toEqual(['originalContract', 'decision']);
      expect(err.detail.acceptedFields).toContain('text');
      expect(err.detail.acceptedFields).toContain('ruleId');
    }
  });

  test('a validação vale para acceptanceCriteria também (nome da lista no erro)', () => {
    try {
      specBase({ acceptanceCriteria: [{ id: 'AC-1', text: 'critério', campoInventado: true }] });
      throw new Error('deveria ter falhado');
    } catch (err) {
      expect(err.code).toBe(MISSION_FAILURE_CODES.INVALID_REQUIREMENT_ITEM);
      expect(err.detail.list).toBe('acceptanceCriteria');
      expect(err.detail.unknownFields).toEqual(['campoInventado']);
    }
  });

  test('item SEM conteúdo falha alto: item vazio é ruído, não registro', () => {
    try {
      specBase({ derivedRequirements: [{ id: 'R2-EMENDADO', source: 'HUMAN_AUTHORITY_DECISION' }] });
      throw new Error('deveria ter falhado');
    } catch (err) {
      expect(err.code).toBe(MISSION_FAILURE_CODES.INVALID_REQUIREMENT_ITEM);
      expect(err.message).toMatch(/sem conteúdo/);
      expect(err.detail.id).toBe('R2-EMENDADO');
    }
    expect(() => specBase({ acceptanceCriteria: [{ id: 'AC-1', text: '   ' }] })).toThrow(/sem conteúdo/);
  });

  test('createNextVersion aplica a MESMA validação no patch de edição', () => {
    const atual = specBase();
    const ok = createNextVersion(atual, {
      derivedRequirements: [{ id: 'R2', text: 'emenda', ruleId: 'TENANT_ISOLATION' }],
    });
    expect(ok.version).toBe(atual.version + 1);
    expect(ok.derivedRequirements[0].ruleId).toBe('TENANT_ISOLATION');

    expect(() => createNextVersion(atual, {
      derivedRequirements: [{ id: 'R2', originalContract: 'texto que sumiria' }],
    })).toThrow(/fora do schema de requirement/);

    expect(() => createNextVersion(atual, {
      derivedRequirements: [{ id: 'R2', decision: 'DIVERGENCIA_ACEITA' }],
    })).toThrow(/fora do schema de requirement/);
  });

  test('o specHash muda quando a regra passa a ser registrada (o conteúdo entra no hash)', () => {
    const semRegra = specBase({ derivedRequirements: [{ id: 'DR-X', text: 'mesmo texto', source: 'S' }] });
    const comRegra = specBase({ derivedRequirements: [{ id: 'DR-X', text: 'mesmo texto', source: 'S', ruleId: 'TENANT_ISOLATION' }] });
    expect(comRegra.specHash).not.toBe(semRegra.specHash);
  });
});
