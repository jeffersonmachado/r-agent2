'use strict';

/**
 * SCORECARD_EVIDENCE_PROOF — a nota do Master Scorecard precisa ser VERIFICÁVEL
 * OFFLINE por quem recebe o pacote.
 *
 * DEFEITO MEDIDO (2026-10-05) no artefato entregue:
 *   44 evidências únicas usadas para atribuir nota
 *    3 delas com proof record no evidence-manifest
 *   41 sem NENHUMA prova offline
 * E o verifier, ao não achar o arquivo, fazia `if (!exists) continue`.
 *
 * Este teste trava o comportamento nos DOIS sentidos:
 *   - prova completa ⇒ ACEITA;
 *   - qualquer elo faltando (arquivo, hash, classificação, temporal, veredito)
 *     ⇒ REPROVA, com código explícito. Ausência NUNCA é `continue`.
 *
 * O produtor não re-julga nada: ele espelha o veredito do engine. Por isso o
 * teste alimenta um scorecard (a autoridade) e verifica que o record o segue —
 * inclusive quando o engine diz STALE.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ACCEPTED_REQUIREMENT_STATUSES,
  listScorecardEvidence,
  buildScorecardEvidenceProof,
  assessScorecardEvidenceProof,
} = require('../../../scripts/governance/lib/scorecard-evidence-proof');

const RUN_STARTED_AT = '2026-10-05T12:00:00.000Z';
const RUN_ID = 'rap-governed-20261005120000000-cafe0000';

/** Registry mínimo com a MESMA forma do canônico (não uma cópia do real). */
function fakeRegistry(evidencePath = 'governance/system-scope-audit.json') {
  return [
    {
      id: 'RAP-001',
      applicable: true,
      requirements: [
        {
          id: 'runtime-validated',
          category: 'RUNTIME_VALIDATED',
          evidence: [{ type: 'current_artifact', path: evidencePath, acceptedValues: ['PASS'] }],
        },
      ],
    },
  ];
}

/** Scorecard no formato que o engine produz — aqui, sob controle do teste. */
function fakeScorecard(status, { score = 10 } = {}) {
  return {
    dimensions: [
      {
        id: 'RAP-001',
        score,
        gaps: [],
        blockers: [],
        requirements: [{ id: 'runtime-validated', category: 'RUNTIME_VALIDATED', status, reason: `veredito=${status}` }],
      },
    ],
  };
}

function withTempRoot(run, { artifact = true, generatedAt = '2026-10-05T13:00:00.000Z', lifeCycle = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-proof-'));
  fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
  if (artifact) {
    const payload = { status: 'PASS' };
    if (generatedAt !== null) payload.generatedAt = generatedAt;
    if (lifeCycle) {
      payload.runId = RUN_ID;
      payload.sourceFingerprint = 'b'.repeat(64);
    }
    fs.writeFileSync(path.join(root, 'governance', 'system-scope-audit.json'), JSON.stringify(payload, null, 2));
  }
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function build(root, { scorecard = fakeScorecard('PASS'), registry = fakeRegistry() } = {}) {
  return buildScorecardEvidenceProof({
    rootDir: root,
    registry,
    scorecard,
    runContext: { runId: RUN_ID, sourceFingerprint: 'b'.repeat(64), startedAt: RUN_STARTED_AT },
  });
}

describe('SCORECARD_EVIDENCE_PROOF', () => {
  describe('1. o produtor materializa a prova que faltava', () => {
    test('prova completa ⇒ ACEITA, com hash, classificação e lineage', () => {
      withTempRoot((root) => {
        const proof = build(root);
        expect(proof.total).toBe(1);
        const record = proof.records[0];
        expect(record.exists).toBe(true);
        expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
        // Classificação vem da TAXONOMIA canônica, não de heurística local.
        expect(record.classification).toBe('CERTIFICATION_ARTIFACT');
        expect(record.classificationAuthoritative).toBe(true);
        expect(record.temporalValidity).toBe('SAME_RUN');
        expect(record.result).toBe('PASS');
        expect(assessScorecardEvidenceProof(proof).ok).toBe(true);
      });
    });

    test('o record segue o VEREDITO do engine (não uma segunda opinião)', () => {
      withTempRoot((root) => {
        // O engine diz STALE (ex.: artefato de outro run): o record não pode dizer PASS
        // só porque o arquivo existe e tem hash.
        const stale = build(root, { scorecard: fakeScorecard('STALE', { score: 6 }) });
        expect(stale.records[0].result).toBe('STALE');
        expect(stale.records[0].resultAccepted).toBe(false);
        expect(stale.records[0].dimensionScore).toBe(6);

        const verdict = assessScorecardEvidenceProof(stale);
        expect(verdict.ok).toBe(false);
        expect(verdict.violations.map((v) => v.code)).toContain('SCORECARD_EVIDENCE_NOT_ACCEPTED');
      });
    });

    test('DEFERRED conta como prova aceita (dimensão de fase DELIVERED em PRE_PACKAGE)', () => {
      expect(ACCEPTED_REQUIREMENT_STATUSES).toContain('DEFERRED');
      withTempRoot((root) => {
        const proof = build(root, { scorecard: fakeScorecard('DEFERRED', { score: 8 }) });
        expect(proof.records[0].resultAccepted).toBe(true);
        expect(assessScorecardEvidenceProof(proof).ok).toBe(true);
      });
    });

    test('lista as evidências a partir do registry (fonte única)', () => {
      const listed = listScorecardEvidence(fakeRegistry('foo/bar.json'));
      expect(listed).toEqual([
        { dimensionId: 'RAP-001', requirementId: 'runtime-validated', category: 'RUNTIME_VALIDATED', path: 'foo/bar.json' },
      ]);
      // Evidência que não é artefato (ex.: all_paths_exist) NÃO vira proof record.
      const withPathsOnly = [
        { id: 'RAP-009', applicable: true, requirements: [{ id: 'implemented', category: 'IMPLEMENTED', evidence: [{ type: 'all_paths_exist', paths: ['src/a.js'] }] }] },
      ];
      expect(listScorecardEvidence(withPathsOnly)).toHaveLength(0);
    });
  });

  describe('2. ADVERSARIAL: ausência de prova é FAIL, nunca `continue`', () => {
    test('artefato obrigatório AUSENTE ⇒ SCORECARD_EVIDENCE_MISSING', () => {
      withTempRoot((root) => {
        const proof = build(root);
        // O bundle perdeu a evidência: o produtor registra a ausência…
        expect(proof.records[0].exists).toBe(false);
        expect(proof.summary.missing).toBe(1);

        // …e o consumidor REPROVA. O comportamento proibido era seguir adiante.
        const verdict = assessScorecardEvidenceProof(proof);
        expect(verdict.ok).toBe(false);
        expect(verdict.violations[0].code).toBe('SCORECARD_EVIDENCE_MISSING');
      }, { artifact: false });
    });

    test('hash ausente ⇒ SCORECARD_EVIDENCE_HASH_MISSING', () => {
      withTempRoot((root) => {
        const proof = build(root);
        const verdict = assessScorecardEvidenceProof({ ...proof, records: [{ ...proof.records[0], sha256: null }] });
        expect(verdict.ok).toBe(false);
        expect(verdict.violations.map((v) => v.code)).toContain('SCORECARD_EVIDENCE_HASH_MISSING');
      });
    });

    test('artefato fora da taxonomia ⇒ SCORECARD_EVIDENCE_UNCLASSIFIED (não sustenta decisão)', () => {
      withTempRoot(
        (root) => {
          fs.writeFileSync(path.join(root, 'governance', 'ad-hoc.json'), JSON.stringify({ status: 'PASS', generatedAt: '2026-10-05T13:00:00.000Z' }));
          const proof = build(root, { registry: fakeRegistry('governance/ad-hoc.json') });
          const verdict = assessScorecardEvidenceProof(proof);
          expect(proof.records[0].classification).toBeNull();
          expect(verdict.ok).toBe(false);
          expect(verdict.violations.map((v) => v.code)).toContain('SCORECARD_EVIDENCE_UNCLASSIFIED');
        },
        { artifact: false },
      );
    });

    test('evidência PRÉ-RUN ⇒ STALE_ARTIFACT (o produtor precisa ser reexecutado)', () => {
      withTempRoot((root) => {
        const proof = build(root, { scorecard: fakeScorecard('PASS', { score: 10 }) });
        const tampered = { ...proof, records: [{ ...proof.records[0], temporalValidity: 'PRE_RUN', generatedAt: '2026-10-05T00:00:00.000Z' }] };
        const verdict = assessScorecardEvidenceProof(tampered);
        expect(verdict.ok).toBe(false);
        expect(verdict.violations.map((v) => v.code)).toContain('STALE_ARTIFACT');
      });
    });

    test('requisito sem veredito registrado ⇒ WITHOUT_VERDICT (nota sem julgamento é indistinguível de engano)', () => {
      withTempRoot((root) => {
        const proof = build(root, { scorecard: { dimensions: [] } });
        expect(proof.records[0].result).toBeNull();
        const verdict = assessScorecardEvidenceProof(proof);
        expect(verdict.ok).toBe(false);
        expect(verdict.violations.map((v) => v.code)).toContain('SCORECARD_EVIDENCE_WITHOUT_VERDICT');
      });
    });

    test('proof set vazio ou ausente ⇒ reprovado com código próprio', () => {
      expect(assessScorecardEvidenceProof(null).violations[0].code).toBe('SCORECARD_EVIDENCE_PROOF_MISSING');
      expect(assessScorecardEvidenceProof({ records: [] }).violations[0].code).toBe('SCORECARD_EVIDENCE_PROOF_EMPTY');
    });

    test('runStartedAt desconhecido reprova (sem ele não há como provar same-run)', () => {
      withTempRoot((root) => {
        const proof = build(root);
        const verdict = assessScorecardEvidenceProof({ ...proof, runStartedAt: null });
        expect(verdict.ok).toBe(false);
        expect(verdict.violations.map((v) => v.code)).toContain('SCORECARD_EVIDENCE_RUN_START_UNKNOWN');
      });
    });
  });

  describe('3. o proof set é contável e cobre as dimensões', () => {
    test('summary descreve o conjunto sem esconder o que falta', () => {
      withTempRoot((root) => {
        const proof = build(root);
        expect(proof.summary.total).toBe(proof.records.length);
        expect(proof.summary.missing).toBe(0);
        expect(proof.summary.dimensionsCovered).toBe(1);
        expect(proof.runId).toBe(RUN_ID);
        expect(proof.runStartedAt).toBe(RUN_STARTED_AT);
      });
    });
  });
});
