'use strict';

/**
 * P1–P4 / T11 — a projeção de jornada não pode depender de comando manual oculto.
 *
 * Defeito reproduzido (2026-09-12): `reports/business-journey-projections.json`
 * é ignorado pelo git (`.gitignore: reports/*`), então em checkout limpo o
 * artefato NÃO existe — e `validate-ask-ai-copilot` falhava com a instrução
 * "rode npm run journey:projections". Um PASS que depende de passo manual não
 * documentado não é readiness de pacote (P1).
 *
 * Política adotada (P2, opção B): a projeção é artefato DETERMINÍSTICO derivado
 * de fontes canônicas; o gate precisa GARANTI-LA antes de validar. A prova de
 * frescor é o fingerprint das ENTRADAS (P4), não a data do arquivo.
 */

const fs = require('fs');
const path = require('path');

const generator = require('../../../scripts/generate-journey-projections');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ARTIFACT = path.join(REPO_ROOT, 'reports', 'business-journey-projections.json');
const GATE_SOURCE = path.join(REPO_ROOT, 'scripts', 'governance', 'validate-ask-ai-copilot.js');

describe('P — projeção de jornada determinística no pacote', () => {
  describe('P1 — o gate não depende de comando manual oculto', () => {
    it('o gate não instrui mais o operador a rodar o gerador manualmente', () => {
      const source = fs.readFileSync(GATE_SOURCE, 'utf8');
      expect(source).not.toMatch(/rode npm run journey:projections/);
    });

    it('o gate usa o gerador determinístico', () => {
      const source = fs.readFileSync(GATE_SOURCE, 'utf8');
      expect(source).toMatch(/ensureProjectionsFresh/);
    });
  });

  describe('P2 — geração determinística', () => {
    it('duas execuções produzem exatamente o mesmo conteúdo', () => {
      const first = generator.serializeProjections(generator.buildProjections().artifact);
      const second = generator.serializeProjections(generator.buildProjections().artifact);
      expect(first).toBe(second);
    });

    it('o build não escreve em disco (separação build/escrita)', () => {
      const before = fs.existsSync(ARTIFACT) ? fs.readFileSync(ARTIFACT, 'utf8') : null;
      generator.buildProjections();
      const after = fs.existsSync(ARTIFACT) ? fs.readFileSync(ARTIFACT, 'utf8') : null;
      expect(after).toBe(before);
    });
  });

  describe('P3/T11 — checkout limpo: artefato ausente é REGERADO, nunca erro manual', () => {
    let backup = null;

    beforeEach(() => {
      backup = fs.existsSync(ARTIFACT) ? fs.readFileSync(ARTIFACT, 'utf8') : null;
    });

    afterEach(() => {
      if (backup !== null) fs.writeFileSync(ARTIFACT, backup);
      else if (fs.existsSync(ARTIFACT)) fs.unlinkSync(ARTIFACT);
    });

    it('artefato ausente é regenerado deterministicamente', () => {
      fs.unlinkSync(ARTIFACT);
      const result = generator.ensureProjectionsFresh();

      expect(result.generated).toBe(true);
      expect(result.reason).toBe('artifact_absent');
      expect(fs.existsSync(ARTIFACT)).toBe(true);
      expect(result.artifact.journeys.length).toBeGreaterThan(0);
    });

    it('artefato corrompido é regenerado', () => {
      fs.writeFileSync(ARTIFACT, '{ isto não é json');
      const result = generator.ensureProjectionsFresh();
      expect(result.generated).toBe(true);
      expect(result.reason).toBe('artifact_unreadable');
    });

    it('o artefato regenerado passa pela mesma limpeza OPERATIONAL', () => {
      fs.unlinkSync(ARTIFACT);
      generator.ensureProjectionsFresh();
      const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
      const projection = require(path.join(REPO_ROOT, 'src', 'core', 'operational', 'journey-projection'));
      expect(() => projection.assertOperationalClean(artifact)).not.toThrow();
    });
  });

  describe('P4 — frescor provado por fingerprint das ENTRADAS', () => {
    it('o fingerprint é um SHA-256 estável', () => {
      const a = generator.computeInputFingerprint();
      const b = generator.computeInputFingerprint();
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('artefato fresco carrega o fingerprint atual das entradas', () => {
      const result = generator.ensureProjectionsFresh();
      expect(result.artifact.inputFingerprint).toBe(generator.computeInputFingerprint());
    });

    it('artefato com fingerprint divergente é tratado como DESATUALIZADO', () => {
      const original = fs.readFileSync(ARTIFACT, 'utf8');
      try {
        const artifact = JSON.parse(original);
        artifact.inputFingerprint = 'f'.repeat(64);
        fs.writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);

        const result = generator.ensureProjectionsFresh();
        expect(result.generated).toBe(true);
        expect(result.reason).toBe('input_fingerprint_changed');
      } finally {
        fs.writeFileSync(ARTIFACT, original);
      }
    });

    it('artefato fresco não é reescrito (idempotente)', () => {
      generator.ensureProjectionsFresh();
      const result = generator.ensureProjectionsFresh();
      expect(result.generated).toBe(false);
      expect(result.reason).toBe('fresh');
    });
  });
});
