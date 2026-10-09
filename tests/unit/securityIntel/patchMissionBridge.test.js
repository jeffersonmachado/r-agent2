'use strict';

/**
 * Ponte `patch-mission` (achado → candidato → missão no Roteador Engenheiro).
 *
 * A prova em runtime só exercitou as RECUSAS (403 para Nível C sem autorização, 404
 * para candidato inexistente). O caminho positivo nunca havia sido provado — e
 * "só recusa provada" é metade da fiação. Aqui o caminho positivo é provado com
 * dublês, sem criar missão real nem tocar o Roteador:
 *   - candidato inexistente ⇒ erro nomeado, nada compilado;
 *   - Nível C sem `authorizedBy` ⇒ RECUSA antes de compilar (nada acontece);
 *   - candidato que já tem missão ⇒ idempotente, nada compilado de novo;
 *   - caminho feliz ⇒ compila com o spec correto (missão, opções, idempotência),
 *     grava o vínculo no candidato e devolve `created`.
 */

jest.mock('../../../api/db/sequelize', () => ({
  connect: jest.fn(),
  getSequelize: jest.fn(),
}));
jest.mock('../../../api/db/models/SecurityPatchCandidate', () => jest.fn());
jest.mock('../../../api/services/engineeringMission/missionCompilerService', () => ({
  compileMission: jest.fn(),
}));
jest.mock('../../../api/services/engineeringMission/missionApprovalService', () => ({
  editAndApprove: jest.fn(),
}));
jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { getSequelize } = require('../../../api/db/sequelize');
const getSecurityPatchCandidate = require('../../../api/db/models/SecurityPatchCandidate');
const { compileMission } = require('../../../api/services/engineeringMission/missionCompilerService');
const { editAndApprove } = require('../../../api/services/engineeringMission/missionApprovalService');

const { createPatchMission } = require('../../../api/services/securityIntel/patchPlanService');

function candidateFixture(overrides = {}) {
  const candidate = {
    id: 'c1',
    candidate_key: 'GHSA-x|npm:ws@8.20.0#RESOLVED#api#ws|8.21.0|DIRECT_BUMP',
    finding_key: 'GHSA-x|npm:ws@8.20.0#RESOLVED#api#ws',
    advisory_id: 'GHSA-x',
    package_name: 'ws',
    service: 'api',
    current_version: '8.20.0',
    target_version: '8.21.0',
    kind: 'DIRECT_BUMP',
    update_risk: 'PATCH',
    autonomy: 'LEVEL_B_ISOLATED',
    requires_human_approval: false,
    severity: 'HIGH',
    kev: false,
    dev_only: false,
    status: 'PROPOSED',
    mission_id: null,
    preconditions: [],
    plan: { updateRisk: 'PATCH' },
    update: jest.fn(async function update(patch) { Object.assign(this, patch); return this; }),
    ...overrides,
  };
  getSecurityPatchCandidate.mockReturnValue({
    findOne: jest.fn().mockResolvedValue(candidate),
  });
  return candidate;
}

beforeEach(() => {
  getSequelize.mockReturnValue({});
  editAndApprove.mockResolvedValue({ created: true });
});

describe('patch-mission — fiação da ponte com o Roteador Engenheiro', () => {
  it('candidato inexistente falha nomeado e NÃO compila nada', async () => {
    getSecurityPatchCandidate.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    await expect(createPatchMission({ candidateKey: 'nao-existe', tenantKey: 'system' }))
      .rejects.toThrow(/patch_candidate_not_found/);
    expect(compileMission).not.toHaveBeenCalled();
  });

  it('Nível C sem authorizedBy é recusado ANTES de compilar (nada acontece)', async () => {
    const candidate = candidateFixture({ autonomy: 'LEVEL_C_PRODUCTION', requires_human_approval: true });
    await expect(createPatchMission({ candidateKey: candidate.candidate_key, tenantKey: 'system', actor: 'engineer' }))
      .rejects.toThrow(/patch_candidate_requires_authorization/);
    expect(compileMission).not.toHaveBeenCalled();
    expect(candidate.update).not.toHaveBeenCalled();
  });

  it('candidato que já possui missão é idempotente (não recria trabalho)', async () => {
    const candidate = candidateFixture({ mission_id: 'missao-existente' });
    const result = await createPatchMission({ candidateKey: candidate.candidate_key, tenantKey: 'system' });
    expect(result).toMatchObject({ missionId: 'missao-existente', created: false, reason: 'mission_already_linked' });
    expect(compileMission).not.toHaveBeenCalled();
  });

  it('caminho feliz: compila com spec/opções corretos, vincula e devolve created', async () => {
    const candidate = candidateFixture();
    compileMission.mockResolvedValue({ created: true, mission: { id: 'missao-nova' } });

    const result = await createPatchMission({
      candidateKey: candidate.candidate_key,
      tenantKey: 'system',
      actor: 'engineer@empresa',
      authorizedBy: null,
    });

    expect(result).toMatchObject({ missionId: 'missao-nova', created: true });
    expect(compileMission).toHaveBeenCalledTimes(1);
    const [missionText, options] = compileMission.mock.calls[0];
    // O corpo da missão precisa levar contexto real do achado (não texto genérico).
    expect(typeof missionText).toBe('string');
    expect(missionText).toMatch(/ws/);
    expect(missionText).toMatch(/8\.20\.0/);
    expect(missionText).toMatch(/8\.21\.0/);
    expect(options).toMatchObject({
      scope: 'single-dependency-update',
      createdBy: 'engineer@empresa',
      tenantId: 'system',
      idempotencyKey: `security-intel:${candidate.candidate_key}`,
    });
    // Idempotência é por candidato: reenviar não pode gerar segunda missão.
    expect(options.idempotencyKey).toContain(candidate.candidate_key);
    expect(candidate.update.mock.calls[0][0]).toMatchObject({
      mission_id: 'missao-nova',
      status: 'MISSION_REQUESTED',
      mission_requested_by: 'engineer@empresa',
    });
  });

  it('Nível B não exige autorização e registra quem pediu', async () => {
    const candidate = candidateFixture({ autonomy: 'LEVEL_B_ISOLATED', requires_human_approval: false });
    compileMission.mockResolvedValue({ created: true, mission: { id: 'missao-b' } });

    await createPatchMission({ candidateKey: candidate.candidate_key, tenantKey: 'system', actor: 'engineer' });

    expect(compileMission).toHaveBeenCalledTimes(1);
    expect(candidate.update.mock.calls[0][0].mission_requested_by).toBe('engineer');
  });

  it('candidato autorizado registra QUEM autorizou (auditoria da autonomia)', async () => {
    const candidate = candidateFixture({ autonomy: 'LEVEL_C_PRODUCTION', requires_human_approval: true });
    compileMission.mockResolvedValue({ created: true, mission: { id: 'missao-c' } });

    await createPatchMission({
      candidateKey: candidate.candidate_key,
      tenantKey: 'system',
      actor: 'engineer',
      authorizedBy: 'cto@empresa',
    });

    expect(candidate.update.mock.calls[0][0].mission_requested_by).toBe('cto@empresa');
  });

  it('aplica o ESCOPO DE CAMINHO como nova versão — sem isto o patch é rejeitado', async () => {
    const candidate = candidateFixture();
    compileMission.mockResolvedValue({ created: true, mission: { id: 'missao-scope' } });

    await createPatchMission({ candidateKey: candidate.candidate_key, tenantKey: 'system', actor: 'engineer' });

    // Sem `allowedPaths` o Roteador rejeita TODO patch (NO_PATCH_SCOPE, ER-V1-FINAL-003):
    // medido em 2026-10-09 — o coder produziu o patch certo do package.json e ele foi barrado.
    expect(editAndApprove).toHaveBeenCalledTimes(1);
    const [missionId, opcoes] = editAndApprove.mock.calls[0];
    expect(missionId).toBe('missao-scope');
    expect(opcoes.patch.allowedPaths).toEqual(expect.arrayContaining(['package.json', 'package-lock.json']));
    expect(opcoes.patch.forbiddenPaths).toEqual(expect.arrayContaining(['scripts/governance/**', '.env']));
    expect(opcoes.reason).toMatch(/escopo de caminho/);
  });

  it('aplicar o escopo NUNCA aprova a missão (decisão humana continua obrigatória)', async () => {
    const candidate = candidateFixture();
    compileMission.mockResolvedValue({ created: true, mission: { id: 'missao-scope2' } });

    await createPatchMission({ candidateKey: candidate.candidate_key, tenantKey: 'system', actor: 'engineer' });

    expect(editAndApprove.mock.calls[0][1].approveEdited).toBe(false);
  });

  it('falha ao aplicar o escopo é EXPLÍCITA e nomeia a missão (nada de estado parcial silencioso)', async () => {
    const candidate = candidateFixture();
    compileMission.mockResolvedValue({ created: true, mission: { id: 'missao-falha' } });
    editAndApprove.mockRejectedValue(new Error('política recusou'));

    await expect(createPatchMission({ candidateKey: candidate.candidate_key, tenantKey: 'system' }))
      .rejects.toMatchObject({ code: 'patch_mission_scope_not_applied', missionId: 'missao-falha' });
    // O vínculo com o candidato permanece: a missão existe e é investigável (sem missão duplicada).
    expect(candidate.update).toHaveBeenCalled();
  });
});
