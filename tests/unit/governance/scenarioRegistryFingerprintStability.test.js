'use strict';

/**
 * Regressão do defeito medido em 2026-09-27 (§ ciclo de selagem): o
 * `scenario-store.json` é RASTREADO e o serviço de QA Waves reescreve
 * `updatedAt`/`history`/`executionStatus` durante o próprio ciclo. Sem projeção,
 * o `scenarioRegistryFingerprint` muda entre o proof e o gate final e o
 * `release:seal` aborta com `gap-proof-stale-fingerprints`.
 *
 * A projeção precisa ser precisa nos DOIS sentidos:
 *  - ruído de runtime NÃO pode mudar o fingerprint (senão STALE auto-infligido);
 *  - POLÍTICA declarada (inclusive campos novos) PRECISA continuar mudando
 *    (senão a governança deixa de rastrear o que importa).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computeScenarioRegistryFingerprint,
} = require('../../../governance/proof-engine/fingerprint-chain');

function storeRoot(scenarios, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-fp-'));
  fs.mkdirSync(path.join(root, 'qa', 'qa-waves'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'qa', 'qa-waves', 'scenario-store.json'),
    JSON.stringify({
      version: 1,
      scenarios,
      history: {},
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...extra,
    }),
  );
  return root;
}

function policyScenario(overrides = {}) {
  return {
    id: 'sc-1',
    waveId: 'wave-1',
    vertical: 'core',
    journey: 'support_ticket_flow',
    name: 'Cenário canônico',
    status: 'active',
    version: 1,
    steps: ['a', 'b'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    executionStatus: 'passed',
    ...overrides,
  };
}

describe('scenarioRegistryFingerprint — estabilidade contra metadados voláteis', () => {
  test('updatedAt/history/executionStatus NÃO mudam o fingerprint', () => {
    const base = computeScenarioRegistryFingerprint(storeRoot([policyScenario()]));
    const afterRuntimeWrites = computeScenarioRegistryFingerprint(
      storeRoot(
        [
          policyScenario({
            createdAt: '2026-09-27T20:43:54.627Z',
            updatedAt: '2026-09-27T20:43:54.627Z',
            executionStatus: 'failed',
          }),
        ],
        { updatedAt: '2026-09-27T20:43:54.627Z', history: { runs: 42, lastId: 'abc' } },
      ),
    );

    expect(afterRuntimeWrites).toBe(base);
  });

  test('mudança de política no cenário MUDA o fingerprint', () => {
    const base = computeScenarioRegistryFingerprint(storeRoot([policyScenario()]));
    const changed = computeScenarioRegistryFingerprint(
      storeRoot([policyScenario({ steps: ['a', 'c'] })]),
    );

    expect(changed).not.toBe(base);
  });

  test('campo de política NOVO (não listado) MUDA o fingerprint', () => {
    const base = computeScenarioRegistryFingerprint(storeRoot([policyScenario()]));
    const changed = computeScenarioRegistryFingerprint(
      storeRoot([policyScenario({ campoDePoliticaNovo: true })]),
    );

    expect(changed).not.toBe(base);
  });

  test('conjunto de cenários (adição/remoção) MUDA o fingerprint', () => {
    const base = computeScenarioRegistryFingerprint(storeRoot([policyScenario()]));
    const added = computeScenarioRegistryFingerprint(
      storeRoot([policyScenario(), policyScenario({ id: 'sc-2' })]),
    );
    const removed = computeScenarioRegistryFingerprint(storeRoot([]));

    expect(added).not.toBe(base);
    expect(removed).not.toBe(base);
  });

  test('store ausente e store ilegível são tratados de forma explícita', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-fp-empty-'));
    const absent = computeScenarioRegistryFingerprint(emptyRoot);
    expect(typeof absent).toBe('string');

    const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-fp-bad-'));
    fs.mkdirSync(path.join(badRoot, 'qa', 'qa-waves'), { recursive: true });
    fs.writeFileSync(path.join(badRoot, 'qa', 'qa-waves', 'scenario-store.json'), '{invalido');

    expect(() => computeScenarioRegistryFingerprint(badRoot)).toThrow(/policy_projection_failed/);
  });
});
