'use strict';

/**
 * ERV1-CLOSE-007 — Release Closure precisa usar autoridade real, nunca um critério paralelo
 * simplificado.
 *
 * Achado real, confirmado no próprio repositório ao implementar esta correção:
 * `governance/.current-run.json` (run corrente real) tinha `runId`/`sourceFingerprint`
 * completamente diferentes de `qa-mesh/go-no-go-report.json` (evidência de um run do dia
 * anterior) — o serviço anterior (`goNoGo.status === 'GO' && finalReadiness.finalDecision
 * .startsWith('PASS')`) teria aceitado esse GO como válido mesmo sendo lineage estrangeiro.
 *
 * Este teste roda `getReleaseClosure()` REAL contra o estado REAL do repositório (nunca escreve
 * em `governance/`/`qa-mesh/` — são artefatos reais e vivos, usados por outros processos de
 * governança concorrentes neste mesmo ambiente) e prova, com os dados reais observados, que:
 *   - `isSameRun` (unidade pura) rejeita corretamente qualquer par com runId/sourceFingerprint
 *     divergentes, mesmo quando outros campos coincidem;
 *   - `getReleaseClosure()` nunca declara `cleanReleaseState:true` quando algum artefato lido é
 *     evidência de um run diferente do corrente — sempre com o motivo exato em `lockReasons`.
 */

const sequelizeModule = require('../../api/db/sequelize');
const { getReleaseClosure, isSameRun } = require('../../api/services/engineeringRouter/releaseClosureService');

let dbAvailable = false;
let dbReason = null;

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[release-closure-authority] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
});

afterAll(async () => {
  if (dbAvailable) await sequelizeModule.close().catch(() => {});
});

describe('ERV1-CLOSE-007 — isSameRun (unidade pura)', () => {
  const currentRun = { runId: 'rap-governed-AAA', sourceFingerprint: 'f'.repeat(64) };

  test('runId E sourceFingerprint iguais → same run', () => {
    expect(isSameRun({ runId: 'rap-governed-AAA', sourceFingerprint: 'f'.repeat(64) }, currentRun)).toBe(true);
  });

  test('runId diferente, mesmo sourceFingerprint → NÃO é same run', () => {
    expect(isSameRun({ runId: 'rap-governed-BBB', sourceFingerprint: 'f'.repeat(64) }, currentRun)).toBe(false);
  });

  test('mesmo runId, sourceFingerprint diferente → NÃO é same run (nunca aceitar por runId sozinho)', () => {
    expect(isSameRun({ runId: 'rap-governed-AAA', sourceFingerprint: 'e'.repeat(64) }, currentRun)).toBe(false);
  });

  test('artefato ausente (null) → nunca same run', () => {
    expect(isSameRun(null, currentRun)).toBe(false);
  });

  test('run corrente ausente (null) → nunca same run, mesmo que o artefato "pareça" válido', () => {
    expect(isSameRun({ runId: 'x', sourceFingerprint: 'y' }, null)).toBe(false);
  });
});

describe('ERV1-CLOSE-007 — getReleaseClosure (autoridade real, estado real do repositório)', () => {
  test('nunca declara cleanReleaseState:true quando algum artefato é evidência de outro run (lockReasons sempre explícito)', async () => {
    if (skipIfNoDatabase()) return;

    const result = await getReleaseClosure();

    // Estrutura sempre presente, nunca undefined — a UI sempre tem o que mostrar.
    expect(Array.isArray(result.lockReasons)).toBe(true);
    expect(typeof result.cleanReleaseState).toBe('boolean');
    expect(typeof result.goNoGo.sameRun).toBe('boolean');
    expect(typeof result.finalReadiness.sameRun).toBe('boolean');
    expect(typeof result.finalConsistencyGate.sameRun).toBe('boolean');

    // Invariante central desta correção: cleanReleaseState só pode ser true quando lockReasons
    // está vazio — nunca um "true" com pendência real listada.
    expect(result.cleanReleaseState).toBe(result.lockReasons.length === 0);

    // Se QALQUER artefato não é do run corrente, ele NUNCA pode ser aceito como válido para
    // fins de release limpo — precisa aparecer em lockReasons de alguma forma (NOT_GO,
    // FOREIGN_RUN ou MISSING, a causa exata real observada no ambiente).
    if (result.releaseCandidate.runId && !result.goNoGo.sameRun) {
      const hasRealReason = result.lockReasons.some((r) => r.startsWith('QA_MESH_'));
      expect(hasRealReason).toBe(true);
    }
    if (result.releaseCandidate.runId && !result.finalReadiness.sameRun) {
      const hasRealReason = result.lockReasons.some((r) => r.startsWith('FINAL_READINESS_'));
      expect(hasRealReason).toBe(true);
    }
    if (result.releaseCandidate.runId && !result.finalConsistencyGate.sameRun) {
      const hasRealReason = result.lockReasons.some((r) => r.startsWith('FINAL_CONSISTENCY_'));
      expect(hasRealReason).toBe(true);
    }
  });

  test('release blocker de engenharia pendente sempre aparece em lockReasons quando > 0', async () => {
    if (skipIfNoDatabase()) return;
    const result = await getReleaseClosure();
    if (result.engineering.releaseBlockers > 0) {
      expect(result.lockReasons).toContain('ENGINEERING_RELEASE_BLOCKERS_PENDING');
      expect(result.cleanReleaseState).toBe(false);
    }
  });
});
