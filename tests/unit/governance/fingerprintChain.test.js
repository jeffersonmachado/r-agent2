'use strict';

/**
 * FASE 11 — Fingerprint chain / proof invalidation (INVARIANTE 6):
 * CHANGED CODE → STALE PROOF.
 *
 * Ciclo testado: proof válido (registrado) → modificação de arquivo-fonte
 * relevante (fixture temp) → proof STALE → regerar evidência (registrar de
 * novo) → proof FRESH. A comparação é por conteúdo — mudança apenas de
 * timestamp (mtime) NÃO invalida.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computeFingerprintChain,
  compareFingerprintChains,
} = require('../../../governance/proof-engine/fingerprint-chain');

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-chain-'));
  const files = {
    'api/modules/tickets/routes.js': "'use strict'; module.exports = {};\n",
    'api/db/models/Ticket.js': "'use strict'; module.exports = {};\n",
    'migrations/001-tickets.sql': 'CREATE TABLE tickets (id TEXT);\n',
    'tools/system/validate.js': "'use strict';\n",
    'contracts/tenant.contract.json': JSON.stringify({ version: 1 }),
    'config/system-inventory.json': JSON.stringify({
      items: [
        { id: 'api:GET:/tickets', fingerprint: 'aaa' },
        { id: 'model:Ticket', fingerprint: 'bbb' },
      ],
    }),
    'qa/qa-waves/scenario-store.json': JSON.stringify({ version: 1, scenarios: [{ id: 's1', status: 'approved' }] }),
    'qa-mesh/meshRegistry.json': JSON.stringify({ scenarios: [{ id: 'm1', domain: 'tickets' }] }),
    'config/journey-contracts.json': JSON.stringify({ journeys: { ticket_flow: {} } }),
    'config/coverage-gate-thresholds.json': JSON.stringify({ visitedMin: 90 }),
    'governance/visual-critical-journeys.json': JSON.stringify({ criticalJourneys: ['ticket'] }),
    'contracts/versions.json': JSON.stringify({ versions: {} }),
  };
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }
  return root;
}

describe('fingerprint-chain — determinismo e independência de timestamps', () => {
  test('mesma árvore produz fingerprints idênticos (determinístico)', () => {
    const root = makeFixtureRoot();
    const first = computeFingerprintChain(root);
    const second = computeFingerprintChain(root);
    expect(second).toEqual(first);
  });

  test('mudança apenas de mtime NÃO invalida a cadeia', () => {
    const root = makeFixtureRoot();
    const before = computeFingerprintChain(root);
    const target = path.join(root, 'api/modules/tickets/routes.js');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(target, future, future);
    const after = computeFingerprintChain(root);
    expect(after).toEqual(before);
    expect(compareFingerprintChains(before, after).status).toBe('FRESH');
  });
});

describe('fingerprint-chain — ciclo de invalidação do proof', () => {
  test('proof válido → mudança de fonte → STALE → regerar → FRESH', () => {
    const root = makeFixtureRoot();

    // 1. proof válido: cadeia registrada no evidence-manifest
    const registered = computeFingerprintChain(root);
    expect(compareFingerprintChains(registered, computeFingerprintChain(root)).status).toBe('FRESH');

    // 2. código-fonte relevante muda → proof vira STALE
    fs.appendFileSync(path.join(root, 'api/db/models/Ticket.js'), '// novo campo\n', 'utf8');
    const afterChange = computeFingerprintChain(root);
    const staleResult = compareFingerprintChains(registered, afterChange);
    expect(staleResult.status).toBe('STALE');
    expect(staleResult.diverged).toContain('sourceFingerprint');
    expect(staleResult.diverged).toContain('chainFingerprint');
    expect(afterChange.sourceFingerprint).not.toBe(registered.sourceFingerprint);

    // 3. evidência regerada sobre o código atual → proof FRESH de novo
    const reRegistered = afterChange;
    expect(compareFingerprintChains(reRegistered, computeFingerprintChain(root)).status).toBe('FRESH');
  });

  test('mudança no scenario registry diverge scenarioRegistryFingerprint', () => {
    const root = makeFixtureRoot();
    const registered = computeFingerprintChain(root);
    fs.writeFileSync(
      path.join(root, 'qa/qa-waves/scenario-store.json'),
      JSON.stringify({ version: 1, scenarios: [{ id: 's1', status: 'approved' }, { id: 's2', status: 'draft_ai' }] }),
      'utf8',
    );
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('scenarioRegistryFingerprint');
  });

  test('mudança de política diverge policyFingerprint', () => {
    const root = makeFixtureRoot();
    const registered = computeFingerprintChain(root);
    fs.writeFileSync(path.join(root, 'config/journey-criticality.json'), JSON.stringify({ blocking: ['ticket_flow'] }), 'utf8');
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('policyFingerprint');
  });

  test('mudança no inventário diverge inventoryFingerprint', () => {
    const root = makeFixtureRoot();
    const registered = computeFingerprintChain(root);
    fs.writeFileSync(
      path.join(root, 'config/system-inventory.json'),
      JSON.stringify({ items: [{ id: 'api:GET:/tickets', fingerprint: 'ccc' }] }),
      'utf8',
    );
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('inventoryFingerprint');
  });

  test('sem cadeia registrada → UNREGISTERED (primeiro registro, nunca STALE)', () => {
    const root = makeFixtureRoot();
    expect(compareFingerprintChains(null, computeFingerprintChain(root)).status).toBe('UNREGISTERED');
    expect(compareFingerprintChains(undefined, computeFingerprintChain(root)).status).toBe('UNREGISTERED');
  });

  test('STALE nunca convive com GO: status divergente nunca é FRESH', () => {
    const root = makeFixtureRoot();
    const registered = computeFingerprintChain(root);
    fs.appendFileSync(path.join(root, 'contracts/tenant.contract.json'), '\n', 'utf8');
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.status).not.toBe('FRESH');
  });
});
