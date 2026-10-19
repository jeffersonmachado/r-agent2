'use strict';

/**
 * IDENTIDADE COMPLETA NOS PRODUTORES DOS RELATÓRIOS FINAIS (P0 — 2026-10-17).
 *
 * CADEIA DO DEFEITO (medida):
 *   1. a decisão canônica exige `runId` + `sourceCommit` + `sourceFingerprint`
 *      (CAMPOS_IDENTIDADE_OBRIGATORIOS em governance/canonical-release-decision.js);
 *   2. o estampador passou a propagar `sourceCommit` do run (correção anterior);
 *   3. MAS os produtores dos três relatórios finais rodam DEPOIS do estampador e
 *      gravavam apenas `runId` + `sourceFingerprint` — sobrescrevendo o carimbo;
 *   4. resultado medido em `assert-canonical-release-decision`:
 *        state=NO_GO motivo=GATE_OBRIGATORIO_FALHOU:final_governance,final_readiness,final_proof,identidade
 *        final_governance:INCOMPLETA:faltantes=sourceCommit (idem os outros dois)
 *      isto é, GO definitivo impossível — o mesmo dead-end do run sem commit,
 *      agora no nível dos produtores.
 *
 * Estes testes prendem a concordância entre QUEM EXIGE e QUEM PRODUZ identidade,
 * nos três produtores e no artefato real (quando produzido nesta máquina).
 */

const fs = require('fs');
const path = require('path');

const { CAMPOS_IDENTIDADE_OBRIGATORIOS } = require('../../../governance/canonical-release-decision');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PRODUTORES = [
  'governance/proof-engine/index.js',
  'governance/export-governance-artifacts.js',
  'tools/system/platform-readiness.js',
];

describe('produtores gravam os TRÊS campos que a decisão canônica exige', () => {
  it('a exigência canônica inclui sourceCommit (não é só runId + fingerprint)', () => {
    expect(CAMPOS_IDENTIDADE_OBRIGATORIOS).toEqual(
      expect.arrayContaining(['runId', 'sourceCommit', 'sourceFingerprint'])
    );
  });

  // Asserção por PADRÃO DE CÓDIGO EXATO (não por substring solta): o termo
  // "sourceCommit" também aparece nos comentários que documentam o defeito, e
  // remover comentários por regex é frágil em arquivo grande. Cada padrão abaixo
  // só existe na atribuição real.
  it.each(PRODUTORES)('%s grava sourceCommit', (arquivo) => {
    expect(ler(arquivo)).toMatch(/sourceCommit:\s*[^,]+/);
  });

  it('o proof engine lê o lineage do RUN congelado, não do HEAD vivo', () => {
    const fonte = ler('governance/proof-engine/index.js');
    expect(fonte).toContain('function readCurrentRunLineage()');
    expect(fonte).toContain('sourceCommit: readCurrentRunLineage().sourceCommit');
    // HEAD vivo mudaria a identidade quando o worktree avançasse depois do run.
    expect(fonte).not.toMatch(/sourceCommit:\s*execSync/);
  });

  it('export-governance-artifacts usa o commit do registro do run', () => {
    const fonte = ler('governance/export-governance-artifacts.js');
    expect(fonte).toContain('sourceCommit: run.git_commit || null');
  });

  it('platform-readiness propaga sourceCommit do proof para readiness e proof', () => {
    const fonte = ler('tools/system/platform-readiness.js');
    expect(fonte).toContain('sourceCommit: proofReport?.sourceCommit || null');
    expect(fonte).toContain('sourceCommit: report.proofReport?.sourceCommit || null');
  });
});

describe('artefatos reais: quando produzidos, a identidade está completa', () => {
  const RELATORIOS = [
    'governance/final-governance-report.json',
    'governance/final-readiness-report.json',
    'governance/final-proof-report.json',
  ];

  it.each(RELATORIOS)('%s tem runId + sourceCommit + sourceFingerprint (ou não existe)', (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return; // artefato não produzido nesta máquina
    const j = JSON.parse(fs.readFileSync(abs, 'utf8'));
    // Só exige completude de quem já declara lineage (artefato pré-run é outro caso).
    if (!j.runId) return;
    for (const campo of CAMPOS_IDENTIDADE_OBRIGATORIOS) {
      expect({ artefato: rel, campo, presente: Boolean(j[campo]) })
        .toEqual({ artefato: rel, campo, presente: true });
    }
  });
});
