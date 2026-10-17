'use strict';

/**
 * ARTEFATO AUTO-REFERENCIAL NÃO PODE SER ESTAMPADO (P0 — medido 2026-10-17).
 *
 * CADEIA DO DEFEITO (medida, não suposta):
 *   `qa/qa-waves-enterprise-governance.json` embute `reportHash` (sha256 do próprio
 *   conteúdo) e `enterpriseGovernanceSignature` (HMAC sobre o próprio conteúdo). O
 *   produtor (`tools/system/qa-waves-enterprise-governance-bridge.js`) já resolve o
 *   lineage NA ORIGEM (`report.runId = readCurrentRunLineage().runId`).
 *
 *   `stamp-report-lineage.js` injetava runId/sourceFingerprint/artifactType/
 *   artifactVersion DEPOIS da assinatura:
 *
 *     [replay-integrity] pass=false replays=9 issues=1
 *       enterprise_replay_governance_invalid:
 *         qa_waves_enterprise_report_hash_invalid
 *         qa_waves_enterprise_signature_invalid
 *     ✗ BLOQUEADO: Replay integrity falhou     (npm run zip:release)
 *
 *   Isto é: o estampador destruía a prova que o próprio artefato carrega, e o
 *   empacotamento era bloqueado por um arquivo que era válido antes de ser
 *   "ajudado".
 *
 * Regra corrigida:
 *  - lineage já é o do run  -> PRESERVA byte a byte (não reescreve);
 *  - lineage de outro run  -> RECUSA (estampar destruiria o hash/assinatura);
 *  - nunca "conserta" o arquivo reescrevendo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { stamp, artefatoAutoReferencial } = require('../../../scripts/governance/stamp-report-lineage');

const RUN = {
  run_id: 'rap-governed-teste',
  source_fingerprint: 'a'.repeat(64),
  started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

function comArtefato(relativo, conteudo, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-auto-ref-'));
  const abs = path.join(dir, relativo);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(conteudo, null, 2));
  const cwdAnterior = process.cwd();
  process.chdir(dir);
  try {
    return fn(abs);
  } finally {
    process.chdir(cwdAnterior);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('artefatoAutoReferencial — quem prova o próprio conteúdo', () => {
  it('reconhece hash + assinatura sobre si mesmo', () => {
    expect(artefatoAutoReferencial({ reportHash: 'x', enterpriseGovernanceSignature: 'y' })).toBe(true);
    expect(artefatoAutoReferencial({ contentHash: 'x', governanceSignature: 'y' })).toBe(true);
  });

  it('NÃO classifica relatório comum (só lineage/status) como auto-referencial', () => {
    expect(artefatoAutoReferencial({ status: 'PASS', runId: 'r' })).toBe(false);
    expect(artefatoAutoReferencial({ reportHash: 'x' })).toBe(false);          // hash sem assinatura
    expect(artefatoAutoReferencial({ enterpriseGovernanceSignature: 'y' })).toBe(false); // assinatura sem hash
    expect(artefatoAutoReferencial(null)).toBe(false);
  });
});

describe('stamp — não destrói a prova que o artefato carrega', () => {
  const autoRef = {
    generatedAt: new Date().toISOString(),
    runId: RUN.run_id,
    sourceFingerprint: RUN.source_fingerprint,
    status: 'GO',
    reportHash: 'hash-do-conteudo',
    enterpriseGovernanceSignature: 'assinatura-do-conteudo',
  };

  it('lineage do run + auto-referencial ⇒ PRESERVA byte a byte', () => {
    comArtefato('qa/qa-waves-enterprise-governance.json', autoRef, (abs) => {
      const antes = fs.readFileSync(abs, 'utf8');
      const r = stamp('qa/qa-waves-enterprise-governance.json', RUN);
      expect(r.stamped).toBe(false);
      expect(r.reason).toBe('SELF_REFERENTIAL_LINEAGE_ALREADY_AT_SOURCE');
      expect(fs.readFileSync(abs, 'utf8')).toBe(antes);
    });
  });

  it('lineage de OUTRO run + auto-referencial ⇒ RECUSA (não estampa)', () => {
    const outroRun = { ...autoRef, runId: 'outro-run-qualquer' };
    comArtefato('qa/qa-waves-enterprise-governance.json', outroRun, (abs) => {
      const antes = fs.readFileSync(abs, 'utf8');
      const r = stamp('qa/qa-waves-enterprise-governance.json', RUN);
      expect(r.stamped).toBe(false);
      expect(r.reason).toBe('rejected_stale_artifact');
      expect(r.detail).toContain('auto-referencial');
      expect(fs.readFileSync(abs, 'utf8')).toBe(antes);
    });
  });

  it('o caminho do defeito medido: qa/qa-waves-enterprise-governance.json é auto-referencial', () => {
    const rel = 'qa/qa-waves-enterprise-governance.json';
    const abs = path.join(__dirname, '..', '..', '..', rel);
    if (!fs.existsSync(abs)) return; // artefato não produzido nesta máquina
    const report = JSON.parse(fs.readFileSync(abs, 'utf8'));
    // Se ele carrega as duas provas, o estampador NUNCA pode reescrevê-lo.
    if (artefatoAutoReferencial(report)) {
      const antes = fs.readFileSync(abs, 'utf8');
      const r = stamp(rel, { ...RUN, run_id: report.runId, source_fingerprint: report.sourceFingerprint });
      expect(r.stamped).toBe(false);
      expect(fs.readFileSync(abs, 'utf8')).toBe(antes);
    }
  });
});
