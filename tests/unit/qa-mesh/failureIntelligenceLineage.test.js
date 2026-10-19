'use strict';

/**
 * Regressão do envenenamento de evidência governada pela malha (medido 2026-10-16).
 *
 * Falha observada: o gate agregado reprovou com
 *   QA_EVIDENCE_LINEAGE_MISSING: qa-mesh/intelligence/latest.json
 * Causa raiz: o produtor JA carimbava lineage, mas o `execution` chega do
 * meshRunner com campos nulos quando a malha roda FORA de run governado
 * (`resolveOriginLineage()` lê apenas GOVERNANCE_* do ambiente). Assim, uma
 * execução MANUAL local sobrescrevia o artefato governado com lineage nulo e
 * derrubava o agregado — ação de desenvolvedor destruindo evidência governada.
 *
 * Comportamento correto:
 * 1. execução COM lineage escreve `latest.json` (evidência governada) e marca
 *    isGovernedEvidence=true;
 * 2. execução SEM lineage escreve `latest-ungoverned.json` e **PRESERVA** o
 *    `latest.json` existente, byte a byte;
 * 3. sem `outputDir` nada é escrito.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildFailureIntelligence } = require('../../../qa-mesh/intelligence/failureIntelligence');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-intelligence-'));
}

function execucaoCom(extra = {}) {
  return {
    executionId: 'mesh-TEST',
    results: [
      { domain: 'inbox', status: 'passed' },
      { domain: 'inbox', status: 'failed', failureType: 'loading', errorMessage: 'tela vazia' },
    ],
    ...extra,
  };
}

describe('qa-mesh/intelligence — lineage não pode ser destruído por execução manual', () => {
  test('execução COM lineage escreve latest.json (evidência governada)', () => {
    const dir = tempDir();
    const out = buildFailureIntelligence(
      execucaoCom({
        runId: 'rap-governed-ATUAL',
        sourceFingerprint: 'fingerprint-atual',
        sourceCommit: 'abc123',
      }),
      [],
      { outputDir: dir }
    );

    const governado = path.join(dir, 'latest.json');
    expect(fs.existsSync(governado)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'latest-ungoverned.json'))).toBe(false);

    const json = JSON.parse(fs.readFileSync(governado, 'utf8'));
    expect(json.runId).toBe('rap-governed-ATUAL');
    expect(json.sourceFingerprint).toBe('fingerprint-atual');
    expect(json.isGovernedEvidence).toBe(true);
    expect(out.isGovernedEvidence).toBe(true);
  });

  test('execução SEM lineage NÃO sobrescreve a evidência governada (regressão do QA_EVIDENCE_LINEAGE_MISSING)', () => {
    const dir = tempDir();
    const governado = path.join(dir, 'latest.json');
    const sentinela = `${JSON.stringify({ runId: 'rap-governed-ANTERIOR', sourceFingerprint: 'fp-anterior' }, null, 2)}\n`;
    fs.writeFileSync(governado, sentinela, 'utf8');

    const out = buildFailureIntelligence(execucaoCom(), [], { outputDir: dir });

    // o artefato governado fica INTACTO, byte a byte
    expect(fs.readFileSync(governado, 'utf8')).toBe(sentinela);

    // e o resultado não governado vai para um arquivo explicitamente separado
    const naoGovernado = path.join(dir, 'latest-ungoverned.json');
    expect(fs.existsSync(naoGovernado)).toBe(true);
    const json = JSON.parse(fs.readFileSync(naoGovernado, 'utf8'));
    expect(json.runId).toBeNull();
    expect(json.sourceFingerprint).toBeNull();
    expect(json.isGovernedEvidence).toBe(false);
    expect(out.outputPath).toBe(naoGovernado);
  });

  test('lineage parcial (só runId, sem fingerprint) NÃO é tratado como governado', () => {
    const dir = tempDir();
    const governado = path.join(dir, 'latest.json');
    const sentinela = '{"runId":"rap-governed-ANTERIOR"}\n';
    fs.writeFileSync(governado, sentinela, 'utf8');

    buildFailureIntelligence(execucaoCom({ runId: 'rap-governed-PARCIAL' }), [], { outputDir: dir });

    expect(fs.readFileSync(governado, 'utf8')).toBe(sentinela);
    expect(fs.existsSync(path.join(dir, 'latest-ungoverned.json'))).toBe(true);
  });

  test('sem outputDir nada é escrito (função pura)', () => {
    const out = buildFailureIntelligence(execucaoCom(), [], {});
    expect(out.outputPath).toBeUndefined();
    expect(out.artifactType).toBe('mesh-intelligence');
  });
});
