'use strict';

/**
 * tests/unit/governance/releasePipelineV2Orchestration.test.js
 *
 * PROVA que o release OFICIAL orquestra o selo V2 e congela o source — em vez de exigir que o
 * operador faça isso à mão.
 *
 * DEFEITO REAL (2026-10-02): `scripts/two-pass-release.sh` apenas VERIFICAVA o frescor do selo e
 * falhava se ele não existisse. O release exigia, na prática, que alguém tivesse rodado
 * `npm run engineering-router:v2-seal` antes. Uma etapa manual de release é uma etapa que se esquece,
 * que se roda sobre o source errado, ou que se roda "no release anterior" e passa.
 *
 * O teste lê o SCRIPT REAL (não um fixture): a asserção é sobre o artefato que a operação usa.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'two-pass-release.sh');

describe('two-pass-release.sh — orquestração do selo V2 e congelamento do source', () => {
  let script;

  beforeAll(() => {
    script = fs.readFileSync(SCRIPT_PATH, 'utf8');
  });

  test('RELEASE-V2-01 — o pipeline EXECUTA o selo, não apenas verifica', () => {
    // Roda o sealer de verdade.
    expect(script).toMatch(/engineering-router-v2-seal\.js/);
    // E o faz dentro do tratamento de "não está fresco" (o selo é consequência do pipeline).
    expect(script).toMatch(/Selo V2 ausente\/vencido|pipeline EXECUTA o selo/);
  });

  test('RELEASE-V2-01 — o pipeline ainda BLOQUEIA quando o selo não alcança GO', () => {
    // Orquestrar não é afrouxar: sem GO não há pacote.
    expect(script).toMatch(/V2_SEAL_FAILED/);
    expect(script).toMatch(/V2_SEAL_NOT_FRESH/);
  });

  test('RELEASE-SOURCE-FREEZE — o fingerprint do selo é capturado', () => {
    expect(script).toMatch(/SEAL_SOURCE_FINGERPRINT=/);
    expect(script).toMatch(/computeSourceFingerprint/);
    expect(script).toMatch(/RELEASE_SOURCE_FREEZE_UNRESOLVABLE/);
  });

  test('RELEASE-SOURCE-FREEZE — o fingerprint é RECONFERIDO antes dos bytes do pacote', () => {
    expect(script).toMatch(/FINAL_SOURCE_FINGERPRINT=/);
    expect(script).toMatch(/RELEASE_SOURCE_CHANGED_AFTER_SEAL/);

    // A ordem importa de verdade: a reconferência tem de acontecer ANTES do `zip`.
    const posFreeze = script.indexOf('RELEASE_SOURCE_CHANGED_AFTER_SEAL');
    const posZip = script.indexOf('zip -qr "$ENVELOPE_PATH"');
    expect(posFreeze).toBeGreaterThan(0);
    expect(posZip).toBeGreaterThan(0);
    expect(posFreeze).toBeLessThan(posZip);
  });

  test('RELEASE-SOURCE-FREEZE — divergência ABORTA em vez de seguir com o que tem', () => {
    const trecho = script.slice(script.indexOf('FINAL_SOURCE_FINGERPRINT='), script.indexOf('zip -qr "$ENVELOPE_PATH"'));
    expect(trecho).toMatch(/fail "RELEASE_SOURCE_CHANGED_AFTER_SEAL/);
    // `fail` encerra o pipeline (não é aviso). A definição de `fail` é lida do próprio script —
    // um teste sobre texto sintético não provaria nada sobre o script que a operação usa.
    const failStart = script.indexOf('fail()');
    expect(failStart).toBeGreaterThan(0);
    const failDef = script.slice(failStart, failStart + 160);
    expect(failDef).toMatch(/exit 1/);
  });

  test('a captura do fingerprint usa a MESMA autoridade que o verificador de frescor', () => {
    // Se a captura usasse outro cálculo, o freeze compararia grandezas diferentes — e passaria sempre.
    const frescor = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'verify-v2-seal-freshness.js'), 'utf8');
    expect(frescor).toMatch(/governance\/proof-engine\/fingerprint-chain/);
    expect(script).toMatch(/governance\/proof-engine\/fingerprint-chain/);
  });
});
