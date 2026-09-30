'use strict';

/**
 * SOURCE CONGELADO — o guard que nomeia a condição que fez o selo V2 falhar em três execuções
 * DIFERENTES por motivos aparentemente não relacionados (2026-09-30).
 *
 * O que aconteceu de verdade: outra sessão commitou e editou o MESMO worktree durante o pipeline
 * (`api/services/websocketService.js`, `reports/qwen-live-evidence.json`,
 * `tests/unit/websocketService.rateLimit.test.js`, dois commits `5ea8d803`/`d8b4be09` entrando no
 * meio). A evidência de runtime coletada minutos antes passou a não pertencer ao source corrente, e o
 * primeiro gate que dependia de fingerprint recusou — corretamente, mas com mensagem que apontava
 * para o subsistema errado. Sem este guard, o operador só tem "repetir e torcer".
 */

const { captureFreeze, compareFreeze, assessInitialFreeze, CODES } = require('../../../scripts/governance/lib/sourceFreezeGuard');

describe('source freeze guard — certificação exige source congelado', () => {
  test('source parado: nenhuma mudança entre os snapshots', () => {
    const snapshot = captureFreeze({ fingerprint: 'a'.repeat(64), commit: 'c'.repeat(40), dirtyFiles: ['src/x.js'] });
    const result = compareFreeze(snapshot, captureFreeze({ fingerprint: 'a'.repeat(64), commit: 'c'.repeat(40), dirtyFiles: ['src/x.js'] }));
    expect(result.ok).toBe(true);
    expect(result.code).toBeNull();
  });

  test('fingerprint mudou (outra sessão mexeu no código) → SOURCE_CHANGED_DURING_CERTIFICATION', () => {
    const before = captureFreeze({ fingerprint: 'a'.repeat(64), commit: 'c'.repeat(40) });
    const after = captureFreeze({ fingerprint: 'b'.repeat(64), commit: 'c'.repeat(40) });
    const result = compareFreeze(before, after);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(CODES.SOURCE_CHANGED_DURING_CERTIFICATION);
    expect(result.changes.fingerprintChanged).toBe(true);
    expect(result.detail).toContain('source CONGELADO');
  });

  test('commit novo entrando durante o selo é detectado mesmo com fingerprint igual', () => {
    const before = captureFreeze({ fingerprint: 'a'.repeat(64), commit: '1'.repeat(40) });
    const after = captureFreeze({ fingerprint: 'a'.repeat(64), commit: '2'.repeat(40) });
    const result = compareFreeze(before, after);
    expect(result.ok).toBe(false);
    expect(result.changes.commitChanged).toBe(true);
    expect(result.detail).toContain('commit mudou');
  });

  test('arquivo que passou a estar modificado é NOMEADO (o operador sabe onde olhar)', () => {
    const before = captureFreeze({ fingerprint: 'a'.repeat(64), commit: '1'.repeat(40), dirtyFiles: [] });
    const after = captureFreeze({ fingerprint: 'a'.repeat(64), commit: '1'.repeat(40), dirtyFiles: ['api/services/websocketService.js', 'tests/unit/websocketService.rateLimit.test.js'] });
    const result = compareFreeze(before, after);
    // Sujeira de artefato de evidência NÃO bloqueia (reports/ não participa do fingerprint): é
    // declarada. DEFEITO do próprio guard, medido no mesmo dia: a primeira versão abortava aqui e
    // travaria o selo por um motivo que não é mudança de código.
    expect(result.ok).toBe(true);
    expect(result.changes).toBeNull();
    expect(result.dirtyDelta.newDirtyFiles).toEqual(['api/services/websocketService.js', 'tests/unit/websocketService.rateLimit.test.js']);
  });

  test('código-fonte alterado SEM mudar commit é deriva material (fingerprint é a autoridade)', () => {
    const before = captureFreeze({ fingerprint: 'a'.repeat(64), commit: '1'.repeat(40), dirtyFiles: [] });
    const after = captureFreeze({ fingerprint: 'c'.repeat(64), commit: '1'.repeat(40), dirtyFiles: [] });
    const result = compareFreeze(before, after);
    expect(result.ok).toBe(false);
    expect(result.changes.fingerprintChanged).toBe(true);
  });

  test('selo iniciado com fonte suja é DECLARADO (não invalidado por si só)', () => {
    const clean = assessInitialFreeze(captureFreeze({ fingerprint: 'a'.repeat(64), commit: '1'.repeat(40) }));
    expect(clean.declared).toBe(false);

    const dirty = assessInitialFreeze(captureFreeze({ fingerprint: 'a'.repeat(64), commit: '1'.repeat(40), dirtyFiles: ['src/x.js'] }));
    expect(dirty.declared).toBe(true);
    expect(dirty.code).toBe(CODES.SOURCE_DIRTY_AT_START);
    expect(dirty.detail).toContain('não commitados');
    expect(dirty.detail).toContain('commit puro');
  });

  test('snapshot sem identidade não gera falso positivo (ausência não é mudança)', () => {
    const result = compareFreeze({ fingerprint: null, commit: null, dirtyFiles: [] }, { fingerprint: null, commit: null, dirtyFiles: [] });
    expect(result.ok).toBe(true);
  });
});
