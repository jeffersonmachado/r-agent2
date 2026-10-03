'use strict';

/**
 * tests/unit/engineeringMission/bugFixIntegrationProvenance.test.js
 *
 * BUG_FIX_INTEGRATION_PROVENANCE — um candidate nascido de um bug encontrado autonomamente tem de
 * ser integrado como BUG_FIX_CANDIDATE, com o finding ligado à integração.
 *
 * DEFEITO ELIMINADO (2026-10-03): o runtime de promoção chamava `integrateTaskCandidate` com o tipo
 * FIXO `'TASK_CANDIDATE'` e SEM `findingId` — embora o parâmetro já existisse desde sempre e a
 * tabela já tivesse as colunas `finding_id`/`integration_type`. Um bug fix autônomo era integrado
 * como trabalho genérico e a cadeia finding → task → candidate → integração ficava irrecuperável:
 * não havia como responder depois "que bug este commit corrige?".
 */

const missionSource = require('../../../engine/engineeringMission/missionSource');

const mockFindOne = jest.fn();
jest.mock('../../../api/db/models/EngineeringBugFinding', () => () => ({
  // `model()` exige `create` como função (guard contra modelo indisponível).
  create: () => {},
  findByPk: jest.fn(),
  findOne: (...args) => mockFindOne(...args),
}));

const bugFindingService = require('../../../api/services/engineeringMission/bugFindingService');

beforeEach(() => mockFindOne.mockReset());

describe('resolveIntegrationProvenance (decisão pura)', () => {
  test('BUG_PROV_01 sem finding o candidate é trabalho GENÉRICO', () => {
    const provenance = missionSource.resolveIntegrationProvenance(null);

    expect(provenance.integrationType).toBe('TASK_CANDIDATE');
    expect(provenance.findingId).toBeNull();
    expect(provenance.isBugFix).toBe(false);
    // Nenhum campo de bug inventado na evidência de um trabalho que não vem de bug.
    expect(provenance.evidence).toEqual({});
  });

  test('BUG_PROV_02 finding ligado produz BUG_FIX_CANDIDATE com o vínculo e o contexto', () => {
    const provenance = missionSource.resolveIntegrationProvenance({
      id: 'f-1',
      severity: 'HIGH',
      category: 'FUNCTIONAL',
      fingerprint: 'fp-abc',
      status: 'CONFIRMED',
    });

    expect(provenance.integrationType).toBe('BUG_FIX_CANDIDATE');
    expect(provenance.findingId).toBe('f-1');
    expect(provenance.isBugFix).toBe(true);
    expect(provenance.evidence.findingId).toBe('f-1');
    expect(provenance.evidence.findingSeverity).toBe('HIGH');
    expect(provenance.evidence.findingCategory).toBe('FUNCTIONAL');
    expect(provenance.evidence.findingFingerprint).toBe('fp-abc');
  });

  test('BUG_PROV_03 objeto sem id NUNCA é declarado bug fix', () => {
    // Honestidade do tipo: sem vínculo real não se afirma "este commit corrige um bug".
    for (const bogus of [{}, { id: null }, { id: '' }, { severity: 'HIGH' }]) {
      const provenance = missionSource.resolveIntegrationProvenance(bogus);
      expect(provenance.isBugFix).toBe(false);
      expect(provenance.integrationType).toBe('TASK_CANDIDATE');
      expect(provenance.findingId).toBeNull();
    }
  });

  test('BUG_PROV_04 o tipo emitido pertence ao vocabulário canônico', () => {
    const generic = missionSource.resolveIntegrationProvenance(null);
    const bugFix = missionSource.resolveIntegrationProvenance({ id: 'f-1' });

    expect(missionSource.INTEGRATION_TYPES).toContain(generic.integrationType);
    expect(missionSource.INTEGRATION_TYPES).toContain(bugFix.integrationType);
    expect(generic.integrationType).not.toBe(bugFix.integrationType);
  });

  test('BUG_PROV_05 campos ausentes viram null (evidência com forma estável)', () => {
    const provenance = missionSource.resolveIntegrationProvenance({ id: 'f-1' });

    expect(provenance.evidence.findingSeverity).toBeNull();
    expect(provenance.evidence.findingCategory).toBeNull();
    expect(provenance.evidence.findingFingerprint).toBeNull();
    expect(provenance.evidence.findingStatus).toBeNull();
  });
});

describe('findByFixTaskId (proveniência reversa)', () => {
  test('BUG_PROV_06 encontra o finding ligado à task de correção', async () => {
    mockFindOne.mockResolvedValue({ id: 'f-1', fix_task_id: 't-1', severity: 'HIGH' });

    const found = await bugFindingService.findByFixTaskId('t-1');

    expect(found).toMatchObject({ id: 'f-1', fix_task_id: 't-1' });
    expect(mockFindOne.mock.calls[0][0].where).toEqual({ fix_task_id: 't-1' });
  });

  test('BUG_PROV_07 task sem finding ligado devolve null (não inventa vínculo)', async () => {
    mockFindOne.mockResolvedValue(null);

    await expect(bugFindingService.findByFixTaskId('t-9')).resolves.toBeNull();
  });

  test('BUG_PROV_08 task vazia devolve null SEM consultar o banco', async () => {
    await expect(bugFindingService.findByFixTaskId('')).resolves.toBeNull();
    await expect(bugFindingService.findByFixTaskId(null)).resolves.toBeNull();

    expect(mockFindOne).not.toHaveBeenCalled();
  });
});
