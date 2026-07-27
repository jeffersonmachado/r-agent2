'use strict';

/**
 * Regressão: trilha de governança e artefatos do agent-hardening.
 *
 * Falhas observadas (sondagem 2026-07-27):
 * 1. recordGovernanceTrail usava eventType 'agent_validation', fora do ENUM
 *    do Postgres (ai_governance_records_event_type_check) — todo publish de
 *    agente terminava em 500.
 * 2. ROOT_DIR resolvia para api/ (3 níveis acima de services/), gravando
 *    evidências em api/qa-mesh/ e replays em api/replays/ em vez da raiz do
 *    repositório — dentro do diretório vigiado pelo nodemon e fora das raízes
 *    de evidência governadas.
 */

const fs = require('fs');
const path = require('path');

const mockLogGovernanceEvent = jest.fn(async () => ({}));
jest.mock('../../api/modules/ai-governance/service', () => ({
  logGovernanceEvent: (...args) => mockLogGovernanceEvent(...args),
}));
jest.mock('../../api/modules/agent-registry/service', () => ({}));

const {
  recordGovernanceTrail,
  generateEvidence,
  generateReplayArtifact,
} = require('../../api/modules/agent-os/services/agent-hardening-service');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALID_EVENT_TYPES = [
  'create', 'approve', 'reject', 'publish', 'deprecate',
  'archive', 'execute', 'decision', 'audit',
];

const agent = { id: 'agent-1', slug: 'qa-agent', name: 'QA Agent', governance: { riskLevel: 'low' } };
const waveResult = { waveId: 'wave-1', executionId: 'exec-1', status: 'GO' };

describe('recordGovernanceTrail — eventType dentro do ENUM do Postgres', () => {
  beforeEach(() => jest.clearAllMocks());

  test('eventType registrado pertence ao ENUM ai_governance_records', async () => {
    await recordGovernanceTrail({ agent, waveResult, evidence: null, replay: null, tenantId: 'system' });
    expect(mockLogGovernanceEvent).toHaveBeenCalledTimes(1);
    const { eventType } = mockLogGovernanceEvent.mock.calls[0][0];
    expect(VALID_EVENT_TYPES).toContain(eventType);
  });
});

describe('artefatos de validação — gravados na raiz do repositório, nunca em api/', () => {
  let writeSpy;
  let mkdirSpy;
  let existsSpy;

  beforeEach(() => {
    writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
    existsSpy.mockRestore();
  });

  test('evidência é gravada fora de api/', async () => {
    const { evidencePath } = await generateEvidence({ agent, waveResult, tenantId: 'system' });
    const rel = path.relative(REPO_ROOT, evidencePath);
    expect(rel.startsWith(`api${path.sep}`)).toBe(false);
  });

  test('replay artifact é gravado fora de api/', async () => {
    const { replayPath } = await generateReplayArtifact({ agent, waveResult, evidence: null, tenantId: 'system' });
    const rel = path.relative(REPO_ROOT, replayPath);
    expect(rel.startsWith(`api${path.sep}`)).toBe(false);
  });
});
