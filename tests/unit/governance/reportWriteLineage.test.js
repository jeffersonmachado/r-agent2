'use strict';

/**
 * Lineage na origem em todo relatório oficial (P2-2).
 *
 * Medição antes do fix (2026-10-10): dos 154 relatórios em `reports/`, **120 não
 * tinham `runId`**; dos 36 produtores que usam `writeReport`, só 5 chamavam
 * `withLineage`. O teste usa um root temporário para não escrever em `reports/`
 * real — um teste que vandaliza artefato governado é defeito, não verificação.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeReport } = require('../../../scripts/governance/common');

const RUN = {
  runId: 'rap-governed-20261010045617268-19ce0cbd',
  startedAt: '2026-10-10T04:56:17.406Z',
  sourceFingerprint: 'ee991914bddf1787c34fda9eff5cccbc96b55570390c8569102f431458a8ffbc',
};

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-'));
  fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance', '.current-run.json'), JSON.stringify(RUN));
  return root;
}

describe('writeReport — todo relatório nasce com lineage (P2-2)', () => {
  let root;
  beforeEach(() => { root = makeRoot(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('runId e sourceFingerprint do run corrente entram no relatório', () => {
    writeReport('exemplo-report.json', { status: 'PASS' }, { rootDir: root });
    const written = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'exemplo-report.json'), 'utf8'));
    expect(written.runId).toBe(RUN.runId);
    expect(written.sourceFingerprint).toBe(RUN.sourceFingerprint);
    expect(written.generatedAt).toBeTruthy();
    expect(written.status).toBe('PASS');
  });

  test('artifactType é derivado do nome do arquivo quando o relatório não declara um', () => {
    writeReport('algum-gate-report.json', { status: 'PASS' }, { rootDir: root });
    const written = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'algum-gate-report.json'), 'utf8'));
    expect(written.artifactType).toBe('algum-gate-report');
  });

  test('artifactType declarado pelo produtor é preservado (idempotente, não sobrescreve)', () => {
    writeReport('outro-report.json', { artifactType: 'TIPO_PROPRIO', status: 'PASS' }, { rootDir: root });
    const written = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'outro-report.json'), 'utf8'));
    expect(written.artifactType).toBe('TIPO_PROPRIO');
  });

  test('runId já preenchido pelo produtor NÃO é sobrescrito', () => {
    writeReport('terceiro.json', { runId: 'outro-run-deliberado', status: 'PASS' }, { rootDir: root });
    const written = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'terceiro.json'), 'utf8'));
    expect(written.runId).toBe('outro-run-deliberado');
  });

  test('sem run governado o relatório ainda é escrito, com lineage nulo explícito (não quebra o produtor)', () => {
    const semRun = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-norun-'));
    try {
      const out = writeReport('sem-run.json', { status: 'PASS' }, { rootDir: semRun });
      const written = JSON.parse(fs.readFileSync(out, 'utf8'));
      expect(written.status).toBe('PASS');
      expect(written.runId).toBeNull();
      expect(written.artifactVersion).toBeTruthy();
    } finally {
      fs.rmSync(semRun, { recursive: true, force: true });
    }
  });

  test('não-vacuidade: o payload ANTIGO (sem withLineage) não tinha runId', () => {
    const legado = { generatedAt: new Date().toISOString(), status: 'PASS' };
    expect(legado.runId).toBeUndefined();
    const written = JSON.parse(fs.readFileSync(
      writeReport('prova.json', { status: 'PASS' }, { rootDir: root }), 'utf8',
    ));
    expect(written.runId).toBe(RUN.runId);
  });
});
