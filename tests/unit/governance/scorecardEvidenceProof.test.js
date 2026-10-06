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
const crypto = require('crypto');

const {
  ACCEPTED_REQUIREMENT_STATUSES,
  BINDING_FILE_BYTES,
  BINDING_SELF_PROJECTION,
  listScorecardEvidence,
  buildScorecardEvidenceProof,
  assessScorecardEvidenceProof,
  serializeManifest,
  selfCarrierProjection,
  evidenceBinding,
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

  // DEFEITO MEDIDO (2026-10-06, ciclo do selo): o `verify:delivered-release` grava o
  // SEU PRÓPRIO resultado em `governance/delivered-release-verification-report.json`,
  // que é evidência de RAP-055/RAP-056. Uma verificação que falhou gravou NO_GO ali e
  // o verifier passou a reprovar por causa do próprio resultado anterior: laço fechado,
  // em que repetir o ciclo reproduzia o mesmo estado. Auto-referência não é prova.
  describe('4. auto-referência: o veredito do verifier não é prova de si mesmo', () => {
    const SELF_PATH = 'governance/delivered-release-verification-report.json';

    function withSelfProducedRoot(run) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-self-'));
      fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
      fs.writeFileSync(path.join(root, SELF_PATH), JSON.stringify({
        status: 'DELIVERED_RELEASE_NO_GO',
        finalDecision: 'NO_GO',
        generatedAt: '2026-10-05T13:00:00.000Z',
        runId: RUN_ID,
        sourceFingerprint: 'b'.repeat(64),
      }, null, 2));
      try {
        return run(root);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }

    test('o próprio resultado do verifier NÃO veta — e continua auditável', () => {
      withSelfProducedRoot((root) => {
        const proof = build(root, { registry: fakeRegistry(SELF_PATH), scorecard: fakeScorecard('INVALID') });
        const record = proof.records[0];
        expect(record.selfProduced).toBe(true);
        // Nada é apagado: o resultado real e o hash continuam no proof set.
        expect(record.result).toBe('INVALID');
        expect(record.sha256).toBeTruthy();
        // O que deixa de existir é o veto circular.
        expect(record.resultAccepted).toBe(true);
        expect(assessScorecardEvidenceProof(proof).violations).toEqual([]);
      });
    });

    test('qualquer OUTRO artefato com o mesmo veredito continua vetando (sem brecha)', () => {
      withTempRoot((root) => {
        const proof = build(root, { scorecard: fakeScorecard('INVALID') });
        expect(proof.records[0].selfProduced).toBe(false);
        expect(assessScorecardEvidenceProof(proof).violations.map((v) => v.code))
          .toContain('SCORECARD_EVIDENCE_NOT_ACCEPTED');
      });
    });
  });

  // ── ARTEFATO PORTADOR: o manifest carrega o proof set e por isso NÃO pode ser
  // prova de si mesmo por hash de bytes (defeito medido em 2026-10-06: o
  // evidence-manifest voltava sem `scorecardEvidence` porque a projeção DB→JSON o
  // reescrevia depois do proof-engine, e o hash do manifest dentro dele mesmo é
  // impossível por construção).
  describe('5. artefato portador (evidence-manifest) — projeção auto-excludente', () => {
    const CARRIER = 'governance/evidence-manifest.json';
    const manifestBase = () => ({
      artifactType: 'evidence-manifest',
      artifactVersion: '1.0.0',
      generatedAt: '2026-10-06T13:07:39.950Z',
      runId: RUN_ID,
      sourceFingerprint: 'b'.repeat(64),
      status: 'PASS',
      finalDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE',
      artifacts: [{ path: 'governance/system-scope-audit.json', packageRequired: true }],
      fingerprints: { sourceFingerprint: 'b'.repeat(64), chainFingerprint: 'c'.repeat(64) },
    });

    function withCarrierRoot(run) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-carrier-'));
      fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
      const base = manifestBase();
      fs.writeFileSync(
        path.join(root, 'governance', 'evidence-manifest.json'),
        serializeManifest({ ...base, scorecardEvidence: { artifactType: 'scorecard-evidence-proof', records: [] } }),
      );
      try {
        return run(root);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }

    const buildCarrier = (root, { manifestForCarrier = manifestBase() } = {}) => buildScorecardEvidenceProof({
      rootDir: root,
      registry: fakeRegistry(CARRIER),
      scorecard: fakeScorecard('PASS'),
      runContext: { runId: RUN_ID, sourceFingerprint: 'b'.repeat(64), startedAt: RUN_STARTED_AT },
      manifestForCarrier,
    });

    test('o portador é vinculado pela PROJEÇÃO (sem o proof set), não pelo arquivo inteiro', () => {
      withCarrierRoot((root) => {
        const proof = buildCarrier(root);
        const record = proof.records[0];
        expect(record.bindingKind).toBe(BINDING_SELF_PROJECTION);
        // O hash gravado é o do manifest SEM `scorecardEvidence` — verificável por
        // qualquer leitor, e impossível de ser o hash do arquivo que o contém.
        const expected = crypto.createHash('sha256').update(serializeManifest(manifestBase())).digest('hex');
        expect(record.sha256).toBe(expected);
        // E o hash do arquivo inteiro é DIFERENTE (prova de que não é auto-hash).
        const wholeFile = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, CARRIER))).digest('hex');
        expect(wholeFile).not.toBe(record.sha256);
        expect(assessScorecardEvidenceProof(proof).violations).toEqual([]);
      });
    });

    test('sem a projeção fornecida o portador REPROVA (nunca aceitação silenciosa)', () => {
      withCarrierRoot((root) => {
        const proof = buildCarrier(root, { manifestForCarrier: null });
        const codes = assessScorecardEvidenceProof(proof).violations.map((v) => v.code);
        expect(codes).toContain('SCORECARD_EVIDENCE_CARRIER_UNBOUND');
        expect(codes).toContain('SCORECARD_EVIDENCE_HASH_MISSING');
      });
    });

    test('ADVERSARIAL: projeção declarada em OUTRO caminho é fraude, não atalho', () => {
      // Sem esta guarda, marcar `bindingKind` bastaria para escapar do binding
      // criptográfico de qualquer evidência.
      const forged = {
        runStartedAt: RUN_STARTED_AT,
        records: [{
          dimensionId: 'RAP-001',
          requirementId: 'runtime-validated',
          path: 'governance/system-scope-audit.json',
          classification: 'CERTIFICATION_ARTIFACT',
          classificationAuthoritative: true,
          exists: true,
          sha256: 'a'.repeat(64),
          bindingKind: BINDING_SELF_PROJECTION,
          result: 'PASS',
          resultAccepted: true,
          selfProduced: false,
          temporalValidity: 'SAME_RUN',
        }],
      };
      expect(assessScorecardEvidenceProof(forged).violations.map((v) => v.code))
        .toContain('SCORECARD_EVIDENCE_BINDING_KIND_FORGED');
    });

    test('a projeção do manifest ESCRITO é idêntica à do objeto sem o proof set', () => {
      // Invariante que faz produtor e verifier offline concordarem: escrever
      // `{...base, scorecardEvidence}` e depois projetar tem de devolver os bytes
      // de `base` — sem depender de ordem de chaves nem de reserialização livre.
      const base = manifestBase();
      const written = { ...base, scorecardEvidence: { artifactType: 'scorecard-evidence-proof', records: [{}] } };
      const reparsed = JSON.parse(serializeManifest(written).toString('utf8'));
      expect(selfCarrierProjection(reparsed).toString('utf8')).toBe(serializeManifest(base).toString('utf8'));
    });

    test('arquivo ausente não inventa hash; arquivo presente vincula por bytes', () => {
      expect(evidenceBinding({ rootDir: '/tmp/nao-existe-' + Date.now(), relPath: 'governance/x.json' }))
        .toEqual({ sha256: null, bindingKind: null });
      withTempRoot((root) => {
        expect(evidenceBinding({ rootDir: root, relPath: 'governance/system-scope-audit.json' }).bindingKind)
          .toBe(BINDING_FILE_BYTES);
      });
    });
  });
});
