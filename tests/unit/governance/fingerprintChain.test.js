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

describe('HARD-024 — consumer do proof engine lê o evidence-manifest corretamente', () => {
  const { resolveWorkspacePath } = require('../../../tools/system/lib/runtime-paths');
  const REPO_ROOT = path.join(__dirname, '..', '..', '..');

  test('caminho do manifest resolve para ARQUIVO (não para o diretório governance/)', () => {
    // Regressão: a chamada variádica resolveWorkspacePath(ROOT, 'governance',
    // 'evidence-manifest.json') ignorava o 3º argumento e resolvia para o
    // DIRETÓRIO governance/ → readJsonMaybe falhava → registered=null →
    // UNREGISTERED permanente e STALE jamais disparava (invariante 6 morta).
    const correct = resolveWorkspacePath(REPO_ROOT, 'governance/evidence-manifest.json');
    expect(correct.endsWith(path.join('governance', 'evidence-manifest.json'))).toBe(true);
    expect(fs.statSync(correct).isFile()).toBe(true);

    // Documenta a armadilha: a forma variádica NÃO concatena segmentos.
    const wrong = resolveWorkspacePath(REPO_ROOT, 'governance', 'evidence-manifest.json');
    expect(wrong).toBe(path.join(REPO_ROOT, 'governance'));
    expect(fs.statSync(wrong).isDirectory()).toBe(true);
  });

  test('manifest versionado carrega a cadeia de fingerprints registrada', () => {
    const manifestPath = resolveWorkspacePath(REPO_ROOT, 'governance/evidence-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.fingerprints).toBeTruthy();
    expect(typeof manifest.fingerprints.chainFingerprint).toBe('string');
    expect(manifest.fingerprints.chainFingerprint).toHaveLength(64);
  });
});

describe('HARD-024 — superfície de prova faz parte do sourceFingerprint', () => {
  const { SOURCE_ROOTS, computeFingerprintChain } = require('../../../governance/proof-engine/fingerprint-chain');

  test('proof engine, contratos de step, validadores de evidência, executor QA e smokes estão na cadeia', () => {
    for (const required of [
      'scripts/governance',
      'governance/proof-engine',
      'qa/contracts',
      'qa/evidence',
      'api/services/qa',
      'scripts/smoke',
    ]) {
      expect(SOURCE_ROOTS).toContain(required);
    }
  });

  test('mudança no validador de evidência invalida o proof (STALE)', () => {
    const root = makeFixtureRoot();
    fs.mkdirSync(path.join(root, 'qa/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'qa/evidence/postStateProofValidator.js'), "'use strict'; // v1\n", 'utf8');
    const registered = computeFingerprintChain(root);
    fs.appendFileSync(path.join(root, 'qa/evidence/postStateProofValidator.js'), '// semântica nova\n', 'utf8');
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('sourceFingerprint');
  });
});

describe('HARD-027 — superfície de prova cobre todo o runtime provado', () => {
  const {
    SOURCE_ROOTS,
    FILTERED_SOURCE_ROOTS,
    walkSourceFiles,
  } = require('../../../governance/proof-engine/fingerprint-chain');

  test('serviços de domínio, Cognitive Core, RPA, mesh e pipeline estão na cadeia', () => {
    for (const required of [
      'api/services',
      'api/middleware',
      'src',
      'core',
      'lib',
      'pipeline',
      'qa/coverage',
      'qa-mesh/adapters',
    ]) {
      expect(SOURCE_ROOTS).toContain(required);
    }
    const filteredPaths = FILTERED_SOURCE_ROOTS.map((entry) => entry.path);
    for (const required of ['qa', 'qa-mesh', 'governance', 'scripts', 'frontend/src']) {
      expect(filteredPaths).toContain(required);
    }
  });

  test('mudança em serviço de domínio (ex.: rpaService.impl.js) invalida o proof', () => {
    const root = makeFixtureRoot();
    fs.mkdirSync(path.join(root, 'api/services'), { recursive: true });
    fs.writeFileSync(path.join(root, 'api/services/rpaService.impl.js'), "'use strict'; // v1\n", 'utf8');
    const registered = computeFingerprintChain(root);
    fs.appendFileSync(path.join(root, 'api/services/rpaService.impl.js'), '// fix\n', 'utf8');
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('sourceFingerprint');
  });

  test('mudança em runner RPA (core/rpa) invalida o proof', () => {
    const root = makeFixtureRoot();
    fs.mkdirSync(path.join(root, 'core/rpa'), { recursive: true });
    fs.writeFileSync(path.join(root, 'core/rpa/rpaTestRunner.js'), "'use strict'; // v1\n", 'utf8');
    const registered = computeFingerprintChain(root);
    fs.appendFileSync(path.join(root, 'core/rpa/rpaTestRunner.js'), '// fix\n', 'utf8');
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('sourceFingerprint');
  });

  test('mudança em página do frontend invalida o proof', () => {
    const root = makeFixtureRoot();
    fs.mkdirSync(path.join(root, 'frontend/src/pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'frontend/src/pages/Workspace.jsx'), 'export default () => null;\n', 'utf8');
    const registered = computeFingerprintChain(root);
    fs.appendFileSync(path.join(root, 'frontend/src/pages/Workspace.jsx'), '// ui nova\n', 'utf8');
    const result = compareFingerprintChains(registered, computeFingerprintChain(root));
    expect(result.status).toBe('STALE');
    expect(result.diverged).toContain('sourceFingerprint');
  });

  test('artefatos GERADOS não invalidam o proof (sem STALE perpétuo)', () => {
    const root = makeFixtureRoot();
    const generated = {
      'governance/final-readiness-report.json': JSON.stringify({ v: 1 }),
      'qa-mesh/metrics.json': JSON.stringify({ v: 1 }),
      'qa-mesh/meshHistory/mesh-x.json': JSON.stringify({ v: 1 }),
      'qa-mesh/meshEvidence/run/scenarios/s.json': JSON.stringify({ v: 1 }),
      'qa/mesh/intelligence/history/stability-x.json': JSON.stringify({ v: 1 }),
      'api/data/config.json': JSON.stringify({ v: 1 }),
      'core/rpa/config/rpa-token.json': JSON.stringify({ token: 'a' }),
      'core/rpa/reports/bugs/bug-memory.json': JSON.stringify({ v: 1 }),
    };
    const writeAll = (version) => {
      for (const [relPath, content] of Object.entries(generated)) {
        const absPath = path.join(root, relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content.replace('"v": 1', `"v": ${version}`).replace('"a"', `"${version}"`), 'utf8');
      }
    };
    writeAll(1);
    const before = computeFingerprintChain(root);
    writeAll(2);
    const after = computeFingerprintChain(root);
    expect(after).toEqual(before);
  });

  test('arquivos de teste não entram na superfície provada', () => {
    const root = makeFixtureRoot();
    fs.mkdirSync(path.join(root, 'api/services/qa/__tests__'), { recursive: true });
    fs.writeFileSync(path.join(root, 'api/services/qa/__tests__/x.test.js'), '// teste\n', 'utf8');
    fs.mkdirSync(path.join(root, 'frontend/src/pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'frontend/src/pages/W.test.jsx'), '// teste\n', 'utf8');
    const files = walkSourceFiles(root);
    expect(files.some((f) => f.includes('__tests__'))).toBe(false);
    expect(files.some((f) => /\.(test|spec)\.(js|jsx|ts|tsx|cjs)$/.test(f))).toBe(false);
  });
});
