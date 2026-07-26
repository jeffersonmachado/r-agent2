'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { executeScenarioWithFallback } = require('../meshRunner');

/**
 * Regressão: cenário de jornada blocking executado pelo mesh sem browser
 * falhava SEMPRE com `blocking_journey_requires_browser_operational_runner`,
 * mesmo quando o smoke prod-like das QA Waves (browser real) tinha evidência
 * GO fresca da jornada — derrubando o coverage gate (journey FAILED).
 * O mesh deve consumir a evidência operacional válida; sem ela, a falha
 * é mantida (nunca mascara).
 */

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-blocking-evidence-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return file;
}

function evidenceSummary(generatedAt) {
  return {
    generatedAt,
    status: 'GO',
    flows: [
      {
        journeyId: 'support_ticket_flow',
        replay: { id: 'replay-1', status: 'GO', screenshots: [{ id: 's1' }] },
        audit: { valid: true },
        strictGovernance: { status: 'GO' },
      },
    ],
  };
}

function blockingScenario() {
  return {
    id: 'business-core-flow-support-ticket',
    domain: 'core',
    type: 'regression',
    source: 'qa',
    criticality: 'blocking',
    adapter: 'api',
    journeyId: 'support_ticket_flow',
    command: process.execPath,
    commandArgs: ['-e', 'console.log("flow ok")'],
  };
}

describe('meshRunner — jornada blocking consome evidência operacional do smoke', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('evidência operacional fresca e GO => cenário passa (comprovação real, não page null)', async () => {
    process.env.MESH_BLOCKING_EVIDENCE_PATH = writeEvidence(evidenceSummary(new Date().toISOString()));

    const result = await executeScenarioWithFallback(blockingScenario(), { executionMode: 'operational_go' });

    expect(result.status).toBe('passed');
    expect(result.operationalExecution.evidenceSource).toBe('qa-waves-operational-smoke');
    expect(result.operationalExecution.blockers).toEqual([]);
  });

  test('evidência STALE => falha preservada com evidenceStatus stale', async () => {
    process.env.MESH_BLOCKING_EVIDENCE_PATH = writeEvidence(
      evidenceSummary(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
    );

    const result = await executeScenarioWithFallback(blockingScenario(), { executionMode: 'operational_go' });

    expect(result.status).toBe('failed');
    const guardError = result.errors.find((e) => e.message === 'blocking_journey_requires_browser_operational_runner');
    expect(guardError).toBeDefined();
    expect(guardError.evidenceStatus).toBe('stale');
  });

  test('sem evidência operacional => falha preservada (comportamento atual)', async () => {
    delete process.env.MESH_BLOCKING_EVIDENCE_PATH;
    process.env.MESH_BLOCKING_EVIDENCE_PATH = path.join(os.tmpdir(), 'evidencia-inexistente.json');

    const result = await executeScenarioWithFallback(blockingScenario(), { executionMode: 'operational_go' });

    expect(result.status).toBe('failed');
    const guardError = result.errors.find((e) => e.message === 'blocking_journey_requires_browser_operational_runner');
    expect(guardError).toBeDefined();
    expect(guardError.evidenceStatus).toBe('missing');
  });

  test('jornada não blocking não é afetada pelo guard', async () => {
    delete process.env.MESH_BLOCKING_EVIDENCE_PATH;

    const result = await executeScenarioWithFallback(
      { ...blockingScenario(), id: 'generic', journeyId: 'generic_flow' },
      { executionMode: 'operational_go' },
    );

    expect(result.status).toBe('passed');
  });
});
