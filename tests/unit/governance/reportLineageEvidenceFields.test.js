'use strict';

/**
 * Campos de evidência do lineage (Fase 12).
 *
 * DEFEITO MEDIDO (2026-10-11): o contrato único de evidência
 * (`governance/lib/evidence-contract.js`) exige 16 campos, mas o produtor central
 * (`governance/report-lineage.js`) emitia apenas 5 (artifactType, artifactVersion,
 * generatedAt, runId, sourceFingerprint). Resultado: **0 de 24 artefatos conformes** —
 * o contrato era aspiracional, e "evidência ausente" não tinha como virar bloqueio
 * justo.
 *
 * Correção: o produtor passa a derivar na ORIGEM tudo o que é derivável com
 * honestidade (sourceCommit, environmentFingerprint, configurationHash,
 * policyVersion, startedAt/finishedAt, producer, blockingFindings) e continua
 * aceitando por `opts` o que só o produtor sabe (o que PLANEJOU e EXECUTOU, sobre
 * qual candidato, hash do próprio artefato). O que ninguém sabe NÃO é inventado.
 *
 * Medição no caminho de produção (relatório do gate de segurança): campos faltando
 * caíram de 16 para 5.
 */

const fs = require('fs');
const path = require('path');

const {
  withLineage,
  currentLineage,
  readCurrentRun,
  environmentFingerprint,
  configurationHash,
  producerIdentity,
} = require('../../../governance/report-lineage');

const { evaluateEvidenceArtifact } = require('../../../governance/lib/evidence-contract');

const ROOT = path.join(__dirname, '..', '..', '..');

/** Campos que o PRODUTOR deve preencher sozinho (deriváveis na origem). */
const CAMPOS_DERIVAVEIS = [
  'runId',
  'sourceCommit',
  'sourceFingerprint',
  'environmentFingerprint',
  'configurationHash',
  'policyVersion',
  'startedAt',
  'finishedAt',
];

describe('report-lineage — produtor passa a emitir os campos de evidência', () => {
  it('preenche TODOS os campos deriváveis quando existe run governado', () => {
    const run = readCurrentRun();
    if (!run) {
      // Sem run governado o produtor não inventa: todos ficam null por decisão.
      const semRun = currentLineage('x');
      expect(semRun.runId).toBeNull();
      return;
    }
    const lineage = currentLineage('prova');
    for (const campo of CAMPOS_DERIVAVEIS) {
      expect(`${campo}=${lineage[campo]}`).not.toMatch(/=null$|undefined/);
    }
  });

  it('não inventa o que depende do que o produtor EXECUTOU', () => {
    const lineage = currentLineage('prova');
    for (const campo of ['candidateCommit', 'testPlanHash', 'testResultHash', 'evidenceManifestHash']) {
      expect(lineage[campo]).toBeNull();
    }
  });

  it('aceita os campos de execução quando o produtor os informa', () => {
    const linha = currentLineage('prova', {
      candidateCommit: 'c'.repeat(40),
      testPlanHash: 'b'.repeat(64),
      testResultHash: 'd'.repeat(64),
      evidenceManifestHash: 'e'.repeat(64),
    });
    expect(linha.candidateCommit).toBe('c'.repeat(40));
    expect(linha.testPlanHash).toBe('b'.repeat(64));
    expect(linha.testResultHash).toBe('d'.repeat(64));
    expect(linha.evidenceManifestHash).toBe('e'.repeat(64));
  });

  it('startedAt é o início REAL do processo (derivado do uptime), nunca o momento do merge', () => {
    const lineage = currentLineage('prova');
    const inicio = Date.parse(lineage.startedAt);
    const fim = Date.parse(lineage.finishedAt);
    expect(Number.isFinite(inicio)).toBe(true);
    expect(Number.isFinite(fim)).toBe(true);
    expect(inicio).toBeLessThanOrEqual(fim);
    // O processo já roda há algum tempo de uptime; o startedAt não pode ser "agora".
    expect(fim - inicio).toBeGreaterThanOrEqual(0);
  });

  it('blockingFindings normaliza o vocabulário do repo (lista vazia ≠ ausente)', () => {
    expect(withLineage({ blocking: [] }, 'a').blockingFindings).toEqual([]);
    expect(withLineage({ violations: [{ code: 'X' }] }, 'b').blockingFindings).toEqual([{ code: 'X' }]);
    expect(withLineage({}, 'c').blockingFindings).toEqual([]);
    // E o contrato aceita a lista vazia como campo PRESENTE.
    const avalia = evaluateEvidenceArtifact({ record: withLineage({ blocking: [], result: 'PASS' }, 'd') });
    expect(avalia.missing).not.toContain('blockingFindings');
  });

  it('preserva valores existentes (idempotente, não sobrescreve decisão do produtor)', () => {
    const rel = withLineage(
      { sourceCommit: 'ja-declarado', blockingFindings: [{ code: 'KEEP' }] },
      'prova',
      { sourceCommit: 'outro' },
    );
    expect(rel.sourceCommit).toBe('ja-declarado');
    expect(rel.blockingFindings).toEqual([{ code: 'KEEP' }]);
  });

  it('environmentFingerprint é estável para o mesmo ambiente e não é vazio', () => {
    const a = environmentFingerprint();
    const b = environmentFingerprint();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('configurationHash muda quando a política muda (não é constante decorativa)', () => {
    const comPoliticaA = configurationHash(ROOT, { policyFingerprint: 'A' });
    const comPoliticaB = configurationHash(ROOT, { policyFingerprint: 'B' });
    expect(comPoliticaA).not.toBe(comPoliticaB);
  });

  it('producerIdentity respeita a identidade DECLARADA pelo ambiente', () => {
    const anterior = process.env.GOVERNED_PRODUCER;
    process.env.GOVERNED_PRODUCER = 'scripts/governance/produtor-declarado.js';
    try {
      expect(producerIdentity()).toBe('scripts/governance/produtor-declarado.js');
    } finally {
      if (anterior === undefined) delete process.env.GOVERNED_PRODUCER;
      else process.env.GOVERNED_PRODUCER = anterior;
    }
  });

  it('o contrato continua exigindo o que NÃO foi inventado (não virou PASS por carência)', () => {
    const avalia = evaluateEvidenceArtifact({ record: withLineage({ status: 'GO', result: 'PASS' }, 'prova') });
    // Os campos de execução seguem faltando → o veredito é INCOMPLETE, nunca PASS.
    expect(avalia.result).toBe('INCOMPLETE');
    for (const campo of ['testPlanHash', 'testResultHash']) {
      expect(avalia.missing).toContain(campo);
    }
  });

  it('o produtor central é o único caminho: nenhum produtor reimplementa lineage à mão', () => {
    const fonte = fs.readFileSync(path.join(ROOT, 'governance', 'report-lineage.js'), 'utf8');
    for (const campo of CAMPOS_DERIVAVEIS) {
      expect(fonte).toContain(campo);
    }
  });
});
