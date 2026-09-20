'use strict';

/**
 * T21 — identidade e localização canônica dos artefatos RUNTIME_EVIDENCE.
 * Defeitos medidos em 2026-09-20 (run rap-governed-20260920093537068-aeb33aa7,
 * mesh GO 144/144 no run corrente e seal-time-gate SEAL_NO_GO):
 *
 * 1. RAP-024/RAP-026 caíram com ARTIFACT_CONTRACT_INCOMPLETE: o
 *    `qa-mesh/go-no-go-report.json` nascia com lineage na origem (P0.3) mas
 *    SEM artifactType/artifactVersion — o stamp histórico preenchia esses
 *    campos, mas desde o P0.3 ele RECUSA artefatos de execução (correto:
 *    lineage retroativo é adoção de prova). Identidade do artefato é metadado
 *    do produtor, não lineage: tem que nascer no escritor do mesh.
 *
 * 2. RAP-068 caiu com FOREIGN_RUN_ARTIFACT: o enterprise proof smoke passou a
 *    escrever os artefatos primários APENAS no runtime root
 *    (~/.local/share/ragent2-runtime/qa/enterprise) e nada sincronizava as
 *    cópias de workspace `qa/enterprise/*.json` que os engines de governança
 *    leem (cross-report-validator, final-governance-engine,
 *    governance-consistency-engine, platform-readiness). A cópia de workspace
 *    de pbx-voice-flow-prod-like.json ficou congelada no run de 2026-09-18.
 *    O espelho é CÓPIA de bytes já estampados na origem — não é stamping
 *    retroativo (o conteúdo nasceu na execução deste run).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MESH_RUNNER = fs.readFileSync(path.join(ROOT, 'qa-mesh', 'meshRunner.js'), 'utf8');
const SMOKE = fs.readFileSync(
  path.join(ROOT, 'scripts', 'smoke', 'qa-waves-enterprise-proof-smoke.js'),
  'utf8',
);

function goNoGoPayloadBlock() {
  const idx = MESH_RUNNER.indexOf('writeJson(QA_MESH_GO_NO_GO_PATH');
  if (idx === -1) throw new Error('escritor do go-no-go-report não encontrado no meshRunner');
  return MESH_RUNNER.slice(idx, idx + 900);
}

describe('go-no-go-report — identidade do artefato na origem', () => {
  it('payload inclui artifactType=go-no-go-report e artifactVersion (contrato do scorecard)', () => {
    const block = goNoGoPayloadBlock();
    expect(block).toMatch(/artifactType:\s*['"]go-no-go-report['"]/);
    expect(block).toMatch(/artifactVersion:\s*['"][\d]+\.[\d]+\.[\d]+['"]/);
  });
});

describe('enterprise proof smoke — espelho de workspace dos artefatos primários', () => {
  const PRIMARY = [
    'human-handoff-full-validation.json',
    'pbx-voice-flow-prod-like.json',
    'omnichannel-unified-replay.json',
    'enterprise-proof-report.json',
  ];

  it('os 4 artefatos consumidos pelos engines de governança são escritos pelo smoke', () => {
    for (const name of PRIMARY) {
      expect(SMOKE).toContain(`writeJson('${name}'`);
    }
  });

  it('writeJson espelha os bytes para o workspace qa/enterprise/ (cópia, não re-stamp)', () => {
    const fn = SMOKE.slice(SMOKE.indexOf('function writeJson'), SMOKE.indexOf('function writeJson') + 1400);
    expect(fn).toMatch(/copyFileSync/);
    expect(fn).toMatch(/qa\/enterprise|qa['"]\s*,\s*['"]enterprise/);
  });

  it('o espelho preserva bytes (copyFileSync sobre o arquivo já estampado na origem)', () => {
    // Re-serializar no espelho poderia divergir do artefato canônico; o
    // espelho correto copia o arquivo escrito (mesmo hash → mesma prova).
    const mirror = SMOKE.slice(SMOKE.indexOf('workspaceMirror'), SMOKE.indexOf('workspaceMirror') + 600);
    expect(mirror).toMatch(/copyFileSync\(out, workspaceMirror\)/);
    expect(mirror).not.toMatch(/JSON\.stringify/);
  });
});
