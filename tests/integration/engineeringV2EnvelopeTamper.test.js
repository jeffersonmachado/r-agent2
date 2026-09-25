'use strict';

/**
 * AUDIT ENVELOPE V2 — GENERATE ≠ VERIFY, e tamper é DETECTADO.
 *
 * Requisito explícito da missão: a verificação consome um envelope JÁ EXISTENTE e NUNCA o
 * regenera. Envelope que se regenera durante a verificação é AUTO-REFERENTE — sempre concorda
 * consigo mesmo e não prova nada. O teste prova isso pelo único meio válido: ADULTERA o envelope
 * em disco e exige INVALID, depois RESTAURA os bytes originais e exige VERIFIED de novo.
 *
 * Cobre também o sentido oposto (arquivo presente e não declarado, arquivo declarado e ausente),
 * a coerência entre `manifest` e `hashes`, a não-mistura de execuções (runId) e a assinatura
 * Ed25519 sobre o manifesto canônico.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  generateEnvelope,
  signEnvelope,
  verifyEnvelope,
  MANIFEST_FILE,
  HASHES_FILE,
  SIGNATURE_FILE,
} = require('../../scripts/governance/lib/engineeringV2Envelope');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, 'reports', '.v2-envelope-test');

function makeArtifacts() {
  return {
    'mission-evidence.json': {
      artifactType: 'mission-evidence',
      missionsCompiled: 3,
      notes: 'evidência de teste',
    },
    'task-fencing-evidence.json': {
      artifactType: 'task-fencing-evidence',
      fencesObserved: 5,
      staleWritesRefused: 2,
    },
    'suite-execution-evidence.json': {
      artifactType: 'suite-execution-evidence',
      suites: 24,
      testsExecuted: 252,
    },
  };
}

function freshEnvelope(name, extra = {}) {
  const dir = path.join(TMP, name);
  const result = generateEnvelope({
    outDir: dir,
    artifacts: makeArtifacts(),
    runId: 'run-v2-test-0001',
    sourceFingerprint: 'fingerprint-de-teste',
    generatedAt: '2026-09-25T10:00:00.000Z',
    ...extra,
  });
  return { dir, result };
}

beforeAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('Envelope de auditoria V2 — integridade e tamper', () => {
  describe('geração', () => {
    it('recusa envelope VAZIO (sem artefatos não há o que provar)', () => {
      expect(() => generateEnvelope({ outDir: path.join(TMP, 'vazio'), artifacts: {}, runId: 'r1' }))
        .toThrow(/ao menos um artefato/);
    });

    it('exige runId — sem ele não há como detectar mistura de execuções', () => {
      expect(() => generateEnvelope({ outDir: path.join(TMP, 'sem-run'), artifacts: makeArtifacts() }))
        .toThrow(/runId/);
    });

    it('reserva os nomes de controle (não dá para forjar o manifesto como artefato)', () => {
      expect(() => generateEnvelope({
        outDir: path.join(TMP, 'reservado'),
        artifacts: { [MANIFEST_FILE]: { x: 1 } },
        runId: 'r1',
      })).toThrow(/reservado/);
    });

    it('gera manifesto, hashes e propaga o runId a todos os artefatos', () => {
      const { dir, result } = freshEnvelope('gerado');
      expect(result.files).toHaveLength(3);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
      expect(manifest.runId).toBe('run-v2-test-0001');
      expect(manifest.scope).toBe('engineering-router-v2');
      for (const name of result.files) {
        const artifact = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        expect(artifact.runId).toBe('run-v2-test-0001');
      }
      const hashes = JSON.parse(fs.readFileSync(path.join(dir, HASHES_FILE), 'utf8'));
      expect(hashes.hashes).toEqual(manifest.artifactHashes);
    });
  });

  describe('verificação de envelope íntegro', () => {
    it('envelope recém-gerado é VERIFIED', () => {
      const { dir } = freshEnvelope('integro');
      const result = verifyEnvelope(dir);
      expect(result.failures).toEqual([]);
      expect(result.status).toBe('VERIFIED');
    });

    it('a verificação NÃO altera os bytes do envelope (não é gerador disfarçado)', () => {
      const { dir } = freshEnvelope('imutavel');
      const antes = fs.readdirSync(dir).sort().map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]);
      verifyEnvelope(dir);
      const depois = fs.readdirSync(dir).sort().map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]);
      expect(depois).toEqual(antes);
    });
  });

  describe('tamper — adulteração detectada e reversível', () => {
    it('TAMPER_ARTIFACT: alterar 1 artefato ⇒ INVALID; restaurar os bytes ⇒ VERIFIED', () => {
      const { dir } = freshEnvelope('tamper-artifact');
      const target = path.join(dir, 'task-fencing-evidence.json');
      const original = fs.readFileSync(target, 'utf8');
      expect(verifyEnvelope(dir).status).toBe('VERIFIED');

      // Adultera o CONTEÚDO mantendo o formato válido — o ataque mais plausível.
      const parsed = JSON.parse(original);
      parsed.staleWritesRefused = 0; // esconde que escritas obsoletas foram recusadas
      fs.writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`);

      const tampered = verifyEnvelope(dir);
      expect(tampered.status).toBe('INVALID');
      expect(tampered.failures.map((f) => f.id)).toContain('ARTIFACT_HASH:task-fencing-evidence.json');

      // Restaura os BYTES originais: o verifier volta a aprovar, provando que ele mede o disco
      // (e não um estado interno ou um envelope regenerado).
      fs.writeFileSync(target, original);
      expect(verifyEnvelope(dir).status).toBe('VERIFIED');
    });

    it('TAMPER_UNDECLARED: arquivo presente e não declarado ⇒ INVALID', () => {
      const { dir } = freshEnvelope('tamper-undec');
      fs.writeFileSync(path.join(dir, 'evidencia-injetada.json'), `${JSON.stringify({ runId: 'run-v2-test-0001', extra: true }, null, 2)}\n`);
      const result = verifyEnvelope(dir);
      expect(result.status).toBe('INVALID');
      expect(result.failures.map((f) => f.id)).toContain('ARTIFACT_UNDECLARED:evidencia-injetada.json');
    });

    it('TAMPER_MISSING: artefato declarado removido ⇒ INVALID', () => {
      const { dir } = freshEnvelope('tamper-missing');
      fs.rmSync(path.join(dir, 'mission-evidence.json'));
      const result = verifyEnvelope(dir);
      expect(result.status).toBe('INVALID');
      expect(result.failures.map((f) => f.id)).toContain('ARTIFACT_PRESENT:mission-evidence.json');
    });

    it('TAMPER_MANIFEST: alterar o manifesto ⇒ INVALID (binding com hashes.json quebra)', () => {
      const { dir } = freshEnvelope('tamper-manifest');
      const manifestPath = path.join(dir, MANIFEST_FILE);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.artifactCount = 99;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = verifyEnvelope(dir);
      expect(result.status).toBe('INVALID');
      expect(result.failures.map((f) => f.id)).toContain('MANIFEST_HASH_BINDING');
    });

    it('TAMPER_HASHES: hashes.json adulterado para combinar com o artefato forjado ⇒ INVALID na referência', () => {
      const { dir } = freshEnvelope('tamper-hashes');
      const target = path.join(dir, 'suite-execution-evidence.json');
      const forged = { artifactType: 'suite-execution-evidence', runId: 'run-v2-test-0001', suites: 999, testsExecuted: 999999 };
      fs.writeFileSync(target, `${JSON.stringify(forged, null, 2)}\n`);
      const forgedHash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');

      const hashesPath = path.join(dir, HASHES_FILE);
      const hashes = JSON.parse(fs.readFileSync(hashesPath, 'utf8'));
      hashes.hashes['suite-execution-evidence.json'] = forgedHash;
      fs.writeFileSync(hashesPath, `${JSON.stringify(hashes, null, 2)}\n`);

      const result = verifyEnvelope(dir);
      expect(result.status).toBe('INVALID');
      // O manifesto continua com o hash VERDADEIRO — a divergência entre as duas fontes aparece.
      expect(result.failures.map((f) => f.id)).toContain('HASHES_REFERENCE:suite-execution-evidence.json');
    });

    it('TAMPER_RUN_MIX: artefato de OUTRA execução ⇒ INVALID (nunca mistura de runs)', () => {
      const { dir } = freshEnvelope('tamper-run');
      const target = path.join(dir, 'mission-evidence.json');
      const artifact = JSON.parse(fs.readFileSync(target, 'utf8'));
      artifact.runId = 'run-de-outra-execucao';
      fs.writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`);
      const result = verifyEnvelope(dir);
      expect(result.status).toBe('INVALID');
      expect(result.failures.map((f) => f.id)).toContain('ARTIFACT_RUN_ID:mission-evidence.json');
    });
  });

  describe('assinatura Ed25519 (operação separada de gerar e verificar)', () => {
    it('envelope assinado é VERIFIED e assinatura detecta manifesto modificado', () => {
      const { dir } = freshEnvelope('assinado');
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });

      const signed = signEnvelope(dir, { privateKeyPem: privatePem });
      expect(signed.signed).toBe(true);
      expect(fs.existsSync(path.join(dir, SIGNATURE_FILE))).toBe(true);
      expect(verifyEnvelope(dir).status).toBe('VERIFIED');

      // O atacante reescreve o manifesto e re-gera as hashes, mas NÃO tem a chave privada.
      const manifestPath = path.join(dir, MANIFEST_FILE);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.artifactHashes['mission-evidence.json'] = 'hash-forjado';
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const result = verifyEnvelope(dir);
      expect(result.status).toBe('INVALID');
      const ids = result.failures.map((f) => f.id);
      expect(ids).toContain('SIGNATURE_PAYLOAD_BINDING');
      expect(ids).toContain('SIGNATURE_VALID');

      // A chave pública embutida é a do par usado — verificável de forma independente.
      const signature = JSON.parse(fs.readFileSync(path.join(dir, SIGNATURE_FILE), 'utf8'));
      expect(signature.publicKeyPem).toBe(publicKey.export({ type: 'spki', format: 'pem' }));
    });

    it('insumo que JÁ tem runId próprio não quebra o envelope — o runId do insumo é PRESERVADO', () => {
      // Regressão de defeito real: `{ runId, ...payload }` deixava o runId do relatório de entrada
      // sobrescrever o do envelope e o verifier acusava (corretamente) mistura de execuções. A
      // correção preserva a proveniência do insumo em `sourceRunId` em vez de descartá-la.
      const dir = path.join(TMP, 'run-proprio');
      generateEnvelope({
        outDir: dir,
        runId: 'envelope-run-01',
        artifacts: {
          'route-mount-report.json': { artifactType: 'route-mount-report', runId: 'rap-governed-20260924', mounted: 42 },
        },
        generatedAt: '2026-09-25T10:00:00.000Z',
      });
      const result = verifyEnvelope(dir);
      expect(result.failures).toEqual([]);
      expect(result.status).toBe('VERIFIED');

      const artifact = JSON.parse(fs.readFileSync(path.join(dir, 'route-mount-report.json'), 'utf8'));
      expect(artifact.runId).toBe('envelope-run-01');
      expect(artifact.sourceRunId).toBe('rap-governed-20260924');
      expect(artifact.mounted).toBe(42);
    });

    it('envelope sem assinatura é VERIFIED por hash e declara a ausência (não é selo implícito)', () => {
      const { dir } = freshEnvelope('sem-assinatura');
      const result = verifyEnvelope(dir);
      expect(result.status).toBe('VERIFIED');
      const check = result.checks.find((c) => c.id === 'SIGNATURE_PRESENT');
      expect(check.ok).toBe(true);
      expect(check.detail).toMatch(/não assinado/);
    });
  });
});
