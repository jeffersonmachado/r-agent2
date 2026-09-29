/**
 * timeoutInventorySemantics.test.js — SEMÂNTICA do inventário de timeouts.
 *
 * DEFEITOS REAIS medidos (auditoria 2026-09-28) no classificador
 * `scripts/governance/lib/timeoutInventory.js`:
 *
 *   1. `/lease/i` casava por SUBSTRING dentro de `RELEASE` (RE-LEASE) — inclusive quando o
 *      "RELEASE" vinha do CAMINHO do arquivo ou de uma linha de contexto. Resultado: artefato de
 *      release classificado como LEASE_DURATION.
 *   2. `DEFAULT_HEARTBEAT_INTERVAL_MS` dentro de um arquivo com "lease" no nome virava
 *      LEASE_DURATION (o nome do arquivo vencia o nome da constante).
 *   3. `setTimeout(() => controller.abort(), requestTimeoutMs)` era classificado como DELAY_SLEEP
 *      (o corpo "trivial" vencia a política) — um timeout de REQUISIÇÃO escondido como pausa.
 *   4. `AbortController` com número fixo precisa ser REQUEST_TIMEOUT, nunca "sem categoria".
 *
 * Um inventário que erra a categoria não é evidência: ele produz número bonito com significado
 * errado. Estes fixtures fixam a semântica nos DOIS sentidos (o que DEVE e o que NÃO DEVE casar).
 */
'use strict';

const { scanFile, classify, isCancellationCallee, tokensOf } = require('../../../scripts/governance/lib/timeoutInventory');

/** Arquivo de fixture com o caminho REAL problemático (`leasePolicy.js`) e nomes ambíguos. */
const FIXTURE_FILE = 'api/services/engineeringMission/leasePolicy.js';
const FIXTURE_SOURCE = `
'use strict';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
const ENGINEERING_LEASE_TTL_MS = 60000;
const RELEASE_ARTIFACTS = ['tarball.tar.gz', 'manifest.json'];
const RELEASE_MANIFEST_TIMEOUT = 5000;
const POLL_INTERVAL_MS = 2000;
const NO_PROGRESS_TIMEOUT_MS = 300000;
const SHUTDOWN_GRACE_PERIOD_MS = 15000;
const PROVIDER_REQUEST_TIMEOUT_MS = 45000;

function schedule(controller, requestTimeoutMs) {
  setTimeout(() => controller.abort(), requestTimeoutMs);
  setTimeout(resolve, 250);
  setInterval(poll, POLL_INTERVAL_MS);
  return AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS);
}
`;

function entriesFor(name) {
  return scanFile({ file: FIXTURE_FILE, source: FIXTURE_SOURCE }).entries.filter((entry) => entry.name === name);
}

function categoriesFor(name) {
  return entriesFor(name).map((entry) => entry.category);
}

describe('timeoutInventory — tokenização e fronteiras', () => {
  test('tokensOf separa snake_case, camelCase e caminhos', () => {
    expect(tokensOf('RELEASE_ARTIFACTS')).toEqual(['release', 'artifacts']);
    expect(tokensOf('DEFAULT_HEARTBEAT_INTERVAL_MS')).toEqual(['default', 'heartbeat', 'interval', 'ms']);
    expect(tokensOf('leaseExpiresAt')).toEqual(['lease', 'expires', 'at']);
    expect(tokensOf('api/services/engineeringMission/leasePolicy.js')).toContain('lease');
  });

  test('RELEASE e LEASE são tokens DIFERENTES (a colisão de substring acabou)', () => {
    expect(tokensOf('RELEASE_ARTIFACTS')).not.toContain('lease');
    expect(tokensOf('ENGINEERING_LEASE_TTL_MS')).toContain('lease');
  });

  test('classify não confunde RELEASE_ARTIFACTS com lease', () => {
    const result = classify({ name: 'RELEASE_ARTIFACTS', file: FIXTURE_FILE, context: 'const RELEASE_ARTIFACTS = [...]', kind: 'declaration' });
    expect(result.category).not.toBe('LEASE_DURATION');
  });
});

describe('timeoutInventory — invariantes exigidas pela missão', () => {
  test('RELEASE != LEASE (mesmo dentro de um arquivo com "lease" no caminho)', () => {
    const categories = scanFile({ file: FIXTURE_FILE, source: FIXTURE_SOURCE }).entries
      .filter((entry) => entry.name.startsWith('RELEASE_'))
      .map((entry) => entry.category);
    expect(categories.length).toBeGreaterThan(0);
    expect(categories).not.toContain('LEASE_DURATION');
  });

  test('HEARTBEAT != LEASE_DURATION (nome da constante vence o nome do arquivo)', () => {
    expect(categoriesFor('DEFAULT_HEARTBEAT_INTERVAL_MS')).toEqual(['HEARTBEAT_INTERVAL']);
  });

  test('LEASE continua sendo LEASE (a correção não cega o classificador)', () => {
    expect(categoriesFor('ENGINEERING_LEASE_TTL_MS')).toEqual(['LEASE_DURATION']);
  });

  test('AbortController com nome de requisição = REQUEST_TIMEOUT (nunca DELAY_SLEEP)', () => {
    const abortEntries = scanFile({ file: FIXTURE_FILE, source: FIXTURE_SOURCE }).entries
      .filter((entry) => /controller\.abort\(\)/.test(entry.context));
    expect(abortEntries).toHaveLength(1);
    expect(abortEntries[0].category).toBe('REQUEST_TIMEOUT');
    expect(abortEntries[0].category).not.toBe('DELAY_SLEEP');
  });

  test('AbortSignal.timeout também é REQUEST_TIMEOUT', () => {
    const signalEntry = scanFile({ file: FIXTURE_FILE, source: FIXTURE_SOURCE }).entries
      .find((entry) => entry.kind === 'abortSignalTimeout');
    expect(signalEntry).toBeDefined();
    expect(signalEntry.category).toBe('REQUEST_TIMEOUT');
  });

  test('DELAY_SLEEP continua sendo pausa (`setTimeout(resolve, ms)`)', () => {
    const sleepEntry = scanFile({ file: FIXTURE_FILE, source: FIXTURE_SOURCE }).entries
      .find((entry) => /setTimeout\(resolve/.test(entry.context));
    expect(sleepEntry).toBeDefined();
    expect(sleepEntry.category).toBe('DELAY_SLEEP');
  });

  test('polling = POLL_INTERVAL (setInterval não é deadline de operação)', () => {
    const intervalEntry = scanFile({ file: FIXTURE_FILE, source: FIXTURE_SOURCE }).entries
      .find((entry) => entry.kind === 'setInterval');
    expect(intervalEntry).toBeDefined();
    expect(intervalEntry.category).toBe('POLL_INTERVAL');
  });

  test('nome do provedor/política é reconhecido (PROVIDER + OPERATION + SHUTDOWN + NO_PROGRESS)', () => {
    expect(categoriesFor('PROVIDER_REQUEST_TIMEOUT_MS')).toEqual(['PROVIDER_TIMEOUT']);
    expect(categoriesFor('NO_PROGRESS_TIMEOUT_MS')).toEqual(['NO_PROGRESS_TIMEOUT']);
    expect(categoriesFor('SHUTDOWN_GRACE_PERIOD_MS')).toEqual(['SHUTDOWN_GRACE_PERIOD']);
  });

  test('isCancellationCallee reconhece cancelamento por método, inclusive qualificado', () => {
    expect(isCancellationCallee('controller.abort')).toBe(true);
    expect(isCancellationCallee('cancel')).toBe(true);
    expect(isCancellationCallee('resolve')).toBe(false);
    expect(isCancellationCallee('poll')).toBe(false);
  });
});
