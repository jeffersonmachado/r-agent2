'use strict';

/**
 * FASE 15 — Cenários draft_ai nunca executam como evidência.
 *
 * Falha coberta (falharia antes da correção): em ambiente não-produção,
 * `payloadAllowsDevExecution` retornava true e o bypass de status permitia
 * executar cenários em `draft_ai` (rascunho gerado por IA, sem aprovação)
 * como se fossem evidência válida. Agora draft_ai falha explicitamente com
 * SCENARIO_NOT_APPROVED, inclusive com devMode/allowNonExecutableStatus.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function loadServiceWithStore(scenarios) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-store-'));
  const storePath = path.join(dir, 'scenario-store.json');
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, scenarios, history: {} }), 'utf8');

  jest.resetModules();
  process.env.QA_WAVES_SCENARIO_STORE_PATH = storePath;
  const service = require('../../api/services/qaWavesScenarioService');
  delete process.env.QA_WAVES_SCENARIO_STORE_PATH;
  return service;
}

const draftAiScenario = {
  id: 'scn_draft_ai_1',
  tenantId: 'tenant-w5',
  waveId: 'wave-w5',
  journeyId: 'support_ticket_flow',
  status: 'draft_ai',
  version: 'v1',
  steps: [],
};

describe('qaWavesScenarioService — draft_ai não executa como evidência', () => {
  test('draft_ai falha explicitamente mesmo com devMode=true', () => {
    const service = loadServiceWithStore([draftAiScenario]);
    expect(() => service.runScenarioExecution({
      scenarioIds: ['scn_draft_ai_1'],
      tenantId: 'tenant-w5',
      mode: 'real',
      replay: true,
      devMode: true,
    })).toThrow(expect.objectContaining({ code: 'SCENARIO_NOT_APPROVED' }));
  });

  test('draft_ai falha explicitamente com allowNonExecutableStatus=true', () => {
    const service = loadServiceWithStore([{ ...draftAiScenario, id: 'scn_draft_ai_2' }]);
    let caught = null;
    try {
      service.runScenarioExecution({
        scenarioIds: ['scn_draft_ai_2'],
        tenantId: 'tenant-w5',
        mode: 'real',
        allowNonExecutableStatus: true,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('SCENARIO_NOT_APPROVED');
    expect(caught.details.requiredStatus).toEqual(['approved', 'active', 'regression']);
  });

  test('cenário draft (manual) não é confundido com a regra draft_ai', () => {
    const service = loadServiceWithStore([{ ...draftAiScenario, id: 'scn_draft_1', status: 'draft' }]);
    let caught = null;
    try {
      service.runScenarioExecution({ scenarioIds: ['scn_draft_1'], tenantId: 'tenant-w5', mode: 'real' });
    } catch (error) {
      caught = error;
    }
    // Pode falhar por outras validações (payload mínimo), mas NUNCA pela
    // regra de aprovação de rascunho de IA.
    expect(caught?.code ?? null).not.toBe('SCENARIO_NOT_APPROVED');
  });
});

describe('qaWavesScenarioService — isSeedExecutableForEvidence', () => {
  const { isSeedExecutableForEvidence } = require('../../api/services/qaWavesScenarioService');

  test('seed draft_ai não é evidência executável', () => {
    expect(isSeedExecutableForEvidence({ id: 's1', status: 'draft_ai' })).toBe(false);
  });

  test('seed disabled não é evidência executável', () => {
    expect(isSeedExecutableForEvidence({ id: 's2', status: 'disabled' })).toBe(false);
  });

  test('seed approved é evidência executável', () => {
    expect(isSeedExecutableForEvidence({ id: 's3', status: 'approved' })).toBe(true);
  });

  test('seed legada sem status permanece elegível (compatibilidade)', () => {
    expect(isSeedExecutableForEvidence({ id: 's4' })).toBe(true);
  });
});
