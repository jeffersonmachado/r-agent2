'use strict';

/**
 * REGRESSÃO DAS SALVAGUARDAS DE GOVERNANÇA NO CAMINHO DE EDIÇÃO.
 *
 * Contexto medido (2026-10-08). `normalizeRequirements` (missionSpec.js) descartava em SILÊNCIO todo
 * campo fora do schema do item de requirement — inclusive `ruleId`, que o PRODUTOR REAL
 * (`enrichmentBuilder`) emite. `ruleId` NÃO é decorativo:
 *
 *   - `materiality.js` usa `CRITICAL_RULE_IDS` → CRITICAL_REQUIREMENT_INTRODUCED;
 *   - `autoApprovalPolicy.js` usa `HUMAN_ONLY_RULE_IDS` → bloqueio de decisão humana.
 *
 * No caminho de EDIÇÃO, `missionApprovalService` alimenta o auto-approval com
 * `nextSpec.derivedRequirements` (a spec JÁ normalizada). Com o descarte, o requisito chegava lá sem
 * `ruleId` e os bloqueios HUMAN_ONLY simplesmente NÃO disparavam: a salvaguarda ficava desarmada
 * exatamente no caminho da emenda.
 *
 * Estes testes amarram o dado à salvaguarda: se a spec voltar a perder `ruleId`, eles reprovam.
 */

const { createSpec, createNextVersion } = require('../../engine/engineeringMission/missionSpec');
const { classifyMateriality, CRITICAL_RULE_IDS } = require('../../engine/engineeringMission/materiality');
const { evaluateAutoApproval, HUMAN_ONLY_RULE_IDS } = require('../../engine/engineeringMission/autoApprovalPolicy');
const { AUTO_APPROVAL_BLOCK_REASONS } = require('../../engine/engineeringMission/constants');

const REGRA_CRITICA = 'TENANT_ISOLATION';

const specBase = () => createSpec({
  missionId: 'm1',
  originalMission: 'intenção original',
  missionType: 'BUG_FIX',
  objective: 'objetivo',
  repository: 'r-agent2',
  branch: 'main',
  scope: 'MEDIUM',
  constraints: [],
  acceptanceCriteria: ['critério'],
  derivedRequirements: ['requisito'],
  testStrategy: [],
  assumptions: [],
  contextSources: [],
  subsystems: [],
  risk: 'LOW',
  confidence: 0.9,
});

/** Spec de edição exatamente como o caminho de aprovação a entrega ao auto-approval. */
const specEditada = (extra) => createNextVersion(specBase(), {
  derivedRequirements: [{
    id: 'DR-TENANT_ISOLATION',
    text: 'isolamento de tenant preservado',
    source: 'PLATFORM_POLICY',
    enrichmentType: 'POLICY_REQUIRED',
    confidence: 1,
    riskImpact: 'HIGH',
    ...extra,
  }],
});

describe('salvaguardas de governança — o caminho de edição não pode desarmá-las', () => {
  test('as listas de regras são as mesmas que exigem decisão humana', () => {
    // Se um dia divergirem, esta é a linha que avisa.
    expect(HUMAN_ONLY_RULE_IDS).toEqual(CRITICAL_RULE_IDS);
    expect(HUMAN_ONLY_RULE_IDS).toContain(REGRA_CRITICA);
  });

  test('PRÉ-REQUISITO: `ruleId` sobrevive à normalização da spec (era o dado descartado)', () => {
    const next = specEditada({ ruleId: REGRA_CRITICA });
    expect(next.derivedRequirements[0].ruleId).toBe(REGRA_CRITICA);
    // e a versão anterior continua válida, sem o campo
    expect(specBase().derivedRequirements[0].ruleId).toBeNull();
  });

  test('AUTO-APPROVAL com a spec normalizada: HUMAN_ONLY bloqueia a decisão humana', () => {
    const next = specEditada({ ruleId: REGRA_CRITICA });

    const result = evaluateAutoApproval({
      policy: { enabled: true, mode: 'SAFE_ONLY' },
      spec: next,
      // EXATAMENTE o que missionApprovalService passa no caminho de edição.
      enrichment: {
        derivedRequirements: next.derivedRequirements,
        risk: next.risk,
        confidence: next.confidence,
      },
    });

    expect(result.eligible).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(AUTO_APPROVAL_BLOCK_REASONS.TENANT_ISOLATION_CHANGE);
  });

  test('MATERIALIDADE: regra crítica introduzida escala o nível para CRITICAL', () => {
    const previous = specBase();
    const next = specEditada({ ruleId: REGRA_CRITICA });

    const materiality = classifyMateriality({
      previousSpec: previous,
      nextSpec: next,
      enrichment: { derivedRequirements: next.derivedRequirements },
      changes: [],
    });

    expect(materiality.level).toBe('CRITICAL');
    expect(materiality.reasons.map((r) => r.code)).toContain('CRITICAL_REQUIREMENT_INTRODUCED');
  });

  // CONTROLE: sem `ruleId` — o estado EXATO que o defeito produzia — nenhuma salvaguarda dispara.
  // O teste existe para provar que o que armava o bloqueio era o dado perdido na normalização.
  test('CONTROLE: requisito SEM ruleId não bloqueia (era o efeito do descarte silencioso)', () => {
    const semRegra = specEditada({});

    const autoApproval = evaluateAutoApproval({
      policy: { enabled: true, mode: 'SAFE_ONLY' },
      spec: semRegra,
      enrichment: { derivedRequirements: semRegra.derivedRequirements, risk: semRegra.risk, confidence: semRegra.confidence },
    });
    expect(autoApproval.blockers.map((b) => b.code)).not.toContain(AUTO_APPROVAL_BLOCK_REASONS.TENANT_ISOLATION_CHANGE);

    const materiality = classifyMateriality({
      previousSpec: specBase(),
      nextSpec: semRegra,
      enrichment: { derivedRequirements: semRegra.derivedRequirements },
      changes: [],
    });
    expect(materiality.reasons.map((r) => r.code)).not.toContain('CRITICAL_REQUIREMENT_INTRODUCED');
  });

  test('MARCAÇÃO EXPLÍCITA: `blocksAutoApproval` do produtor também sobrevive', () => {
    const next = specEditada({ ruleId: REGRA_CRITICA, blocksAutoApproval: true });
    expect(next.derivedRequirements[0].blocksAutoApproval).toBe(true);
    const sem = specEditada({ ruleId: null });
    expect(sem.derivedRequirements[0].blocksAutoApproval).toBe(false);
  });
});
